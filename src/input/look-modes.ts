/**
 * Look modes: pointer lock with the drag-look and key-look fallbacks, plus
 * touch gestures. DOM module. docs/design/06-engine.md §9.3-§9.4.
 *
 * Modes: 'keys' (initial; arrows only), 'locked' (pointer lock held), 'drag'
 * (mouse drag or one-finger touch). The arrow keys feed `keyLook` in every
 * mode (InputManager), so the game stays playable when a sandboxed frame
 * refuses pointer lock.
 */
import type { Emitter, GameEvents } from '../app/events';
import type { InputManager } from './InputManager';
import { MAX_LOCK_FAILURES, RELOCK_COOLDOWN_MS, requestLock } from './pointerlock';

export type LookMode = 'locked' | 'drag' | 'keys';

/** Derived from Settings (07 §1.2): turnRateYaw = turnRate, turnRatePitch = 0.6 * turnRate. */
export interface LookSettings {
  sensitivity: number;
  invertY: boolean;
  turnRateYaw: number;
  turnRatePitch: number;
}

/**
 * Student-facing look texts. These are the `ENGINE_TEXT` entries of 06 §1
 * (owned by src/ui/strings.ts, WP-09); they are declared here verbatim because
 * that module is not a dependency of this package, and strings.ts should
 * re-export them from here (or this module import them) once it lands.
 */
export const LOOK_TEXT = {
  clickToPlay: 'Click the world to play. Esc opens the menu, Tab leaves the game area.',
  dragToLook: 'Drag to look around (mouse capture is not available here).',
  keysToLook: 'Arrow keys look around.',
  lockedHint: 'Mouse captured. Press Esc to release it.',
} as const;

/** A mouse click shorter than this and smaller than TAP_MAX_PX is a tap (= mine). */
export const TAP_MAX_MS = 250;
export const TAP_MAX_PX = 5;
/** Touch: tap radius, long-press duration (= place) and look multiplier. */
export const TOUCH_TAP_MAX_PX = 10;
export const LONG_PRESS_MS = 500;
export const TOUCH_LOOK_SCALE = 1.5;
export const LONG_PRESS_VIBRATE_MS = 20;

interface DragState {
  readonly pointerId: number;
  readonly touch: boolean;
  readonly startX: number;
  readonly startY: number;
  readonly startT: number;
  lastX: number;
  lastY: number;
  /** Largest distance from the start point seen so far (pixels). */
  maxDist: number;
  longPressFired: boolean;
}

function nowMs(): number {
  return performance.now();
}

export class LookModes {
  private readonly canvas: HTMLCanvasElement;
  private readonly input: InputManager;
  private readonly emitter: Emitter<GameEvents>;
  private readonly settings: () => LookSettings;
  private modeValue: LookMode = 'keys';
  private allowed = true;
  private failures = 0;
  private lastUnlockAt = -Infinity;
  private drag: DragState | null = null;
  private longPress: ReturnType<typeof setTimeout> | null = null;
  /** A lock request is in flight; the first of {promise outcome, pointerlockerror} settles it. */
  private pendingLock = false;
  private announcedDrag = false;
  private disposed = false;
  private readonly removers: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, input: InputManager, emitter: Emitter<GameEvents>, settings: () => LookSettings) {
    this.canvas = canvas;
    this.input = input;
    this.emitter = emitter;
    this.settings = settings;
    // One-finger drags must reach us as pointer events instead of scrolling the page.
    canvas.style.touchAction = 'none';

    this.onCanvas('pointerdown', this.onCanvasClick);
    this.onCanvas('pointermove', this.onPointerMove);
    this.onCanvas('pointerup', this.onPointerUp);
    this.onCanvas('pointercancel', this.onPointerCancel);
    this.onDocument('pointerlockchange', this.onLockChange);
    this.onDocument('pointerlockerror', this.onLockError);
  }

  get mode(): LookMode {
    return this.modeValue;
  }

  /** false after MAX_LOCK_FAILURES; Settings "Try mouse capture again" sets it back to true. */
  get lockAllowed(): boolean {
    return this.allowed;
  }
  set lockAllowed(v: boolean) {
    this.allowed = v;
    if (v) this.failures = 0;
  }

  /** Look settings as the Game applies them this frame. */
  currentSettings(): LookSettings {
    return this.settings();
  }

  /** §9.4 state machine for a canvas `pointerdown`. Also registered by the constructor. */
  readonly onCanvasClick = (ev: PointerEvent): void => {
    if (this.disposed || this.modeValue === 'locked') return;   // InputManager rule 6 owns the buttons while locked
    if (ev.pointerType === 'touch') {
      this.beginTouch(ev);
      return;
    }
    // mouse (or pen)
    if (ev.button === 2) {
      this.input.inject('place');
      return;
    }
    if (ev.button !== 0) return;
    // Start the drag first so the click still works if the lock fails; the lock
    // request itself must stay inside this synchronous handler (transient activation).
    this.beginDrag(ev, false);
    if (this.allowed && nowMs() - this.lastUnlockAt >= RELOCK_COOLDOWN_MS) this.tryLock();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.removers.splice(0)) off();
    this.endDrag();
  }

  // -------------------------------------------------------------------------

  private setMode(mode: LookMode): void {
    if (mode === this.modeValue) return;
    this.modeValue = mode;
    this.emitter.emit('look:mode', { mode });
  }

  private tryLock(): void {
    this.pendingLock = true;
    void requestLock(this.canvas).then((outcome) => {
      if (this.disposed) return;
      if (outcome === 'locked') {
        this.pendingLock = false;      // the pointerlockchange handler switched the mode
        return;
      }
      this.failLock();
    });
  }

  /** Rejected / unverified / unsupported promise, or a pointerlockerror event. */
  private failLock(): void {
    if (!this.pendingLock) return;
    this.pendingLock = false;
    this.failures++;
    if (this.failures >= MAX_LOCK_FAILURES) this.allowed = false;
    this.setMode('drag');
    if (!this.announcedDrag) {
      this.announcedDrag = true;
      this.emitter.emit('live:announce', { text: LOOK_TEXT.dragToLook, priority: 'polite' });
    }
  }

  private readonly onLockChange = (): void => {
    if (document.pointerLockElement === this.canvas) {
      this.pendingLock = false;
      this.endDrag();                 // the capturing click never counts as a tap
      this.setMode('locked');
    } else {
      // Esc, tab switch or a dialog: never auto-relock; the next click re-attempts after the cooldown.
      this.lastUnlockAt = nowMs();
      this.setMode('drag');
      // Chromium consumes the Escape that releases the lock (no keydown reaches InputManager), so an unlock while
      // the game is still the active, visible, focused surface is the student's pause request (engineering review
      // finding 12). A dialog opening (modal), a tab switch (hidden) or a lost window focus is not.
      if (!this.input.modal && this.input.active() && !document.hidden && document.hasFocus()) this.input.inject('pause');
    }
  };

  private readonly onLockError = (): void => {
    this.failLock();
  };

  private beginDrag(ev: PointerEvent, touch: boolean): void {
    if (this.drag) return;            // one pointer at a time (second finger ignored)
    this.capture(ev.pointerId);
    this.drag = {
      pointerId: ev.pointerId, touch, startX: ev.clientX, startY: ev.clientY, startT: nowMs(),
      lastX: ev.clientX, lastY: ev.clientY, maxDist: 0, longPressFired: false,
    };
  }

  private beginTouch(ev: PointerEvent): void {
    if (this.drag) return;
    this.beginDrag(ev, true);
    this.longPress = setTimeout(() => {
      this.longPress = null;
      const d = this.drag;
      if (!d || !d.touch || d.maxDist >= TOUCH_TAP_MAX_PX) return;
      d.longPressFired = true;
      this.input.inject('place');
      this.vibrate();
    }, LONG_PRESS_MS);
  }

  private readonly onPointerMove = (ev: PointerEvent): void => {
    const d = this.drag;
    if (!d || ev.pointerId !== d.pointerId || this.modeValue === 'locked') return;
    // Client deltas equal movementX/Y for an unlocked pointer and are defined everywhere.
    const dx = ev.clientX - d.lastX;
    const dy = ev.clientY - d.lastY;
    d.lastX = ev.clientX;
    d.lastY = ev.clientY;
    d.maxDist = Math.max(d.maxDist, Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY));
    if (d.touch) {
      if (d.longPressFired) return;   // a long press is a place, not a look
      if (d.maxDist >= TOUCH_TAP_MAX_PX) this.cancelLongPress();
      this.input.addLook(dx * TOUCH_LOOK_SCALE, dy * TOUCH_LOOK_SCALE);
    } else {
      this.input.addLook(dx, dy);
    }
  };

  private readonly onPointerUp = (ev: PointerEvent): void => {
    const d = this.drag;
    if (!d || ev.pointerId !== d.pointerId) return;
    const dt = nowMs() - d.startT;
    const dist = Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY);
    const maxDist = Math.max(d.maxDist, dist);
    if (d.touch) {
      if (!d.longPressFired && dt < TAP_MAX_MS && maxDist < TOUCH_TAP_MAX_PX) this.input.inject('mine');
    } else if (this.modeValue !== 'locked' && dt < TAP_MAX_MS && maxDist < TAP_MAX_PX) {
      this.input.inject('mine');
    }
    this.endDrag();
  };

  private readonly onPointerCancel = (ev: PointerEvent): void => {
    if (this.drag && ev.pointerId === this.drag.pointerId) this.endDrag();
  };

  private endDrag(): void {
    this.cancelLongPress();
    const d = this.drag;
    this.drag = null;
    if (d) this.release(d.pointerId);
  }

  private cancelLongPress(): void {
    if (this.longPress !== null) {
      clearTimeout(this.longPress);
      this.longPress = null;
    }
  }

  private capture(pointerId: number): void {
    try {
      this.canvas.setPointerCapture(pointerId);
    } catch {
      /* the pointer may already be gone; the drag still works without capture */
    }
  }

  private release(pointerId: number): void {
    try {
      if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
  }

  private vibrate(): void {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(LONG_PRESS_VIBRATE_MS);
    } catch {
      /* vibration is optional */
    }
  }

  private onCanvas<K extends keyof HTMLElementEventMap>(type: K, fn: (ev: HTMLElementEventMap[K]) => void): void {
    this.canvas.addEventListener(type, fn);
    this.removers.push(() => this.canvas.removeEventListener(type, fn));
  }

  private onDocument<K extends keyof DocumentEventMap>(type: K, fn: (ev: DocumentEventMap[K]) => void): void {
    document.addEventListener(type, fn);
    this.removers.push(() => document.removeEventListener(type, fn));
  }
}
