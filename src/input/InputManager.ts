/**
 * Keyboard, mouse-button and wheel input with the canvas focus policy.
 * DOM module. docs/design/06-engine.md §9.2 (rules 1-7) and 07-ui.md §3.
 *
 * Key handlers live on `window` (capture phase) and act only while the canvas
 * is focused or holds the pointer lock, never while a dialog is open
 * (`modal`) or a form control has focus. Single-character shortcuts are
 * therefore scoped to the game area (WCAG 2.1.4); Tab is never handled, so
 * focus always leaves the canvas normally (WCAG 2.1.2).
 */
import type { Emitter, GameEvents } from '../app/events';
import type { FrameInput } from '../world/types';
import { HELD_ACTIONS, resolveAction, shouldPreventDefault } from './keymap';
import type { InputAction, KeyAction } from './keymap';

/** The event this module emits; it lives in `GameEvents` (src/app/events.ts) since the integration contracts revision. */
export type InputEvents = Pick<GameEvents, 'input:focus'>;
export type InputEmitter = Emitter<GameEvents>;

export interface FrameActions {
  readonly move: FrameInput;
  /** Pixels of mouse movement (locked or drag) accumulated this frame. */
  readonly lookDX: number;
  readonly lookDY: number;
  /** Arrow-key look: yaw +1 = turn left, pitch +1 = look up. */
  readonly keyLook: { readonly yaw: -1 | 0 | 1; readonly pitch: -1 | 0 | 1 };
  /** Edge-triggered actions in press order (deduplicated). */
  readonly pressed: readonly InputAction[];
  /** Hotbar steps, +1 = next slot, -1 = previous (may be ±n). */
  readonly wheel: number;
  readonly focused: boolean;
}

/** Minimum spacing between counted wheel steps. */
export const WHEEL_STEP_MS = 60;

const EDITABLE_SELECTOR = 'input, textarea, select, button, [contenteditable]';

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  if (t.matches(EDITABLE_SELECTOR)) return true;
  return t instanceof HTMLElement && t.isContentEditable;
}

function sign3(v: number): -1 | 0 | 1 {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export class InputManager {
  readonly canvas: HTMLCanvasElement;
  private readonly getKeys: () => Readonly<Record<KeyAction, string>>;
  private readonly emitter: InputEmitter;
  /** Keyboard-held actions; cleared on blur / hidden / pointer-lock change (rule 4). */
  private readonly held = new Set<InputAction>();
  /** On-screen (touch) controls held through `setHeld`; survive focus changes. */
  private readonly virtual = new Set<InputAction>();
  /** `inject` of a held action: true for exactly one frame. */
  private readonly pulses = new Set<InputAction>();
  private pressed: InputAction[] = [];
  private lookDX = 0;
  private lookDY = 0;
  private wheelSteps = 0;
  private lastWheel = -Infinity;
  private isModal = false;
  private disposed = false;
  private readonly removers: (() => void)[] = [];

  /** @param getKeys `() => effectiveKeys(settings)`; read on every key event so remaps apply at once. */
  constructor(canvas: HTMLCanvasElement, getKeys: () => Readonly<Record<KeyAction, string>>, emitter: InputEmitter) {
    this.canvas = canvas;
    this.getKeys = getKeys;
    this.emitter = emitter;

    // 1. focus on click; no text selection; no context menu
    this.onCanvas('pointerdown', this.onPointerDown);
    this.onCanvas('contextmenu', (ev) => ev.preventDefault());
    // 2. keys on window, capture phase
    this.onWindow('keydown', this.onKeyDown, true);
    this.onWindow('keyup', this.onKeyUp, true);
    // 3. wheel, non-passive so the page never scrolls
    this.onCanvas('wheel', this.onWheel, { passive: false });
    // 4. nothing stays held after the canvas loses the keyboard
    this.onCanvas('blur', () => {
      this.held.clear();
      this.emitFocus(false);
    });
    this.onWindow('blur', () => this.held.clear());
    this.onDocument('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.held.clear();
        this.virtual.clear();
      }
    });
    this.onDocument('pointerlockchange', () => this.held.clear());
    // 5. focus events for the look hint
    this.onCanvas('focus', () => this.emitFocus(true));
    // 6. locked-mode mouse look
    this.onCanvas('pointermove', this.onPointerMove);
  }

  /** document.activeElement === canvas || document.pointerLockElement === canvas */
  active(): boolean {
    return document.activeElement === this.canvas || document.pointerLockElement === this.canvas;
  }

  /** Set by the HUD while a dialog is open (07 §17 focus stack); keys are ignored while true. */
  get modal(): boolean {
    return this.isModal;
  }
  set modal(v: boolean) {
    this.isModal = v;
    if (v) this.held.clear();
  }

  /**
   * Feeds an action from outside the keyboard (on-screen buttons, the pause
   * menu, LookModes taps). An edge action is queued for the next frame; a held
   * action (e.g. 'forward') counts as held for exactly one frame — use
   * `setHeld` for press-and-hold buttons.
   */
  inject(action: InputAction): void {
    if (HELD_ACTIONS.has(action)) this.pulses.add(action);
    else this.push(action);
  }

  /** Press (`down = true`) or release a held action from an on-screen control. */
  setHeld(action: InputAction, down: boolean): void {
    if (!HELD_ACTIONS.has(action)) {
      if (down) this.push(action);
      return;
    }
    if (down) this.virtual.add(action);
    else this.virtual.delete(action);
  }

  /** Adds raw pointer movement (pixels) for this frame; LookModes uses it in drag/touch mode. */
  addLook(dx: number, dy: number): void {
    if (Number.isFinite(dx)) this.lookDX += dx;
    if (Number.isFinite(dy)) this.lookDY += dy;
  }

  /** Releases every held action (keyboard and on-screen). */
  clearHeld(): void {
    this.held.clear();
    this.virtual.clear();
    this.pulses.clear();
  }

  /** 7. Builds the frame's actions from the held set and resets the accumulators. */
  consumeFrame(): FrameActions {
    const has = (a: InputAction): boolean => this.held.has(a) || this.virtual.has(a) || this.pulses.has(a);
    const bit = (a: InputAction): number => (has(a) ? 1 : 0);
    const move: FrameInput = {
      forward: bit('forward') - bit('back'),
      strafe: bit('right') - bit('left'),
      jump: has('jump'),
      sprint: has('sprint'),
    };
    const keyLook = {
      yaw: sign3(bit('lookLeft') - bit('lookRight')),
      pitch: sign3(bit('lookUp') - bit('lookDown')),
    } as const;
    const out: FrameActions = {
      move,
      lookDX: this.lookDX,
      lookDY: this.lookDY,
      keyLook,
      pressed: this.pressed,
      wheel: this.wheelSteps,
      focused: this.active(),
    };
    this.lookDX = 0;
    this.lookDY = 0;
    this.pressed = [];
    this.wheelSteps = 0;
    this.pulses.clear();
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.removers.splice(0)) off();
    this.clearHeld();
    this.pressed = [];
  }

  // -------------------------------------------------------------------------

  private push(action: InputAction): void {
    if (!this.pressed.includes(action)) this.pressed.push(action);
  }

  private emitFocus(focused: boolean): void {
    this.emitter.emit('input:focus', { focused });
  }

  /** Rule 2's gate: canvas active, no dialog, no form control under the key. */
  private acceptsKeys(ev: KeyboardEvent): boolean {
    return this.active() && !this.isModal && !isEditableTarget(ev.target);
  }

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (!this.acceptsKeys(ev)) return;
    const code = ev.code;
    const keys = this.getKeys();
    if (shouldPreventDefault(keys, code)) ev.preventDefault();
    const a = resolveAction(keys, code);
    if (a === null) return;
    if (HELD_ACTIONS.has(a)) {
      this.held.add(a);
      return;
    }
    // 'pause' (Escape) arrives here while the lock is held too: the browser releases
    // the lock and the pause menu opens on the same key press.
    if (!ev.repeat) this.push(a);
  };

  private readonly onKeyUp = (ev: KeyboardEvent): void => {
    const keys = this.getKeys();
    const a = resolveAction(keys, ev.code);
    // A release always clears the held entry, even when the key-up arrives after focus
    // moved or a dialog opened, so no movement key can stick.
    if (a !== null && HELD_ACTIONS.has(a)) this.held.delete(a);
    if (!this.acceptsKeys(ev)) return;
    if (shouldPreventDefault(keys, ev.code)) ev.preventDefault();
  };

  private readonly onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    if (this.isModal) return;
    const now = performance.now();
    if (now - this.lastWheel >= WHEEL_STEP_MS && Math.abs(ev.deltaY) >= 1) {
      this.wheelSteps += Math.sign(ev.deltaY);
      this.lastWheel = now;
    }
  };

  private readonly onPointerDown = (ev: PointerEvent): void => {
    this.canvas.focus({ preventScroll: true });
    ev.preventDefault();
    // Mouse buttons act directly only while the pointer is locked; in drag mode LookModes
    // decides (tap = mine, right button = place). pointerdown is used rather than mousedown
    // because the preventDefault above suppresses the compatibility mouse events.
    if (document.pointerLockElement !== this.canvas || this.isModal) return;
    if (ev.button === 0) this.push('mine');
    else if (ev.button === 2) this.push('place');
  };

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    this.addLook(ev.movementX, ev.movementY);
  };

  private onCanvas<K extends keyof HTMLElementEventMap>(
    type: K, fn: (ev: HTMLElementEventMap[K]) => void, opts?: boolean | AddEventListenerOptions,
  ): void {
    this.canvas.addEventListener(type, fn, opts);
    this.removers.push(() => this.canvas.removeEventListener(type, fn, opts));
  }

  private onWindow<K extends keyof WindowEventMap>(
    type: K, fn: (ev: WindowEventMap[K]) => void, opts?: boolean | AddEventListenerOptions,
  ): void {
    window.addEventListener(type, fn, opts);
    this.removers.push(() => window.removeEventListener(type, fn, opts));
  }

  private onDocument<K extends keyof DocumentEventMap>(
    type: K, fn: (ev: DocumentEventMap[K]) => void, opts?: boolean | AddEventListenerOptions,
  ): void {
    document.addEventListener(type, fn, opts);
    this.removers.push(() => document.removeEventListener(type, fn, opts));
  }
}
