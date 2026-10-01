/**
 * HUD root: builds the DOM skeleton of docs/design/07-ui.md §2.1, mounts every
 * panel, subscribes to the game events (§18 wiring matrix), throttles panel
 * refreshes (§4), owns the focus stack (§17), the crosshair / target-info text
 * (§7), the look hint, the theme/reduced-motion/scale application (§2.3–2.4)
 * and the screen-reader scene mirror (§16.3). DOM module.
 *
 * The State contract of 07 §1.1 (`StateView`, `StateCommands`, `UiState`,
 * `TargetState`, `LockedPlacement`, `HOTBAR`) is declared HERE as the local
 * interface that src/app/State.ts (WP-11) satisfies; `RenderHooks` (07 §1.3)
 * is what Game.ts passes in.
 */
import type { Vec3 } from '../chem/types';
import { Block, LAB_MAX, LAB_MIN, LAB_Y, cellKey, elementOf, isOre, splitPairKey } from '../world/types';
import type { BlockElement, CellKey, ComponentId, PairKey, VoxelHit } from '../world/types';
import { blockName } from '../world/blocks';
import { WAND_CYCLE } from '../world/molecule-index';
import type { WandOrder } from '../world/molecule-index';
import type { Charge } from '../chem/types';
import type { EngineEvents, GameEvents } from '../app/events';
import type { HoverInfo } from '../app/events';
import { HOTBAR } from '../app/State';
import type { UiState } from '../app/State';
import type { KeyAction, Settings } from '../app/Settings';
import { effectiveKeys, mediaMatches, reducedMotionActive, saveInventory, saveSettings } from '../app/Settings';
import { BENCH, COMPASS, ENGINE_TEXT, HYBRIDIZATION_WORD, SETTING_LABEL, STRINGS, atomLabel, settingValueText } from './strings';
import { createLiveRegion } from './live-region';
import type { LiveRegion } from './live-region';
import { mountToolbar } from './toolbar';
import { mountHotbar } from './hotbar';
import { mountMoleculePanel } from './molecule-panel';
import type { MoleculePanel } from './molecule-panel';
import { mountChallengePanel } from './challenge-panel';
import type { ChallengePanel } from './challenge-panel';
import { mountQuizPanel } from './quiz-panel';
import type { QuizPanel } from './quiz-panel';
import { mountBenchPanel } from './bench-panel';
import type { BenchPanel } from './bench-panel';
import { mountSelectMode } from './select-atom';
import type { SelectMode } from './select-atom';
import { createConfirm, mountPauseMenu, showFinishedOverlay } from './pause-menu';
import type { PauseMenu } from './pause-menu';
import { mountHelp } from './help';
import { mountSettingsPanel } from './settings-panel';
import type { SettingsPanel } from './settings-panel';

export { LIVE_POLITE_MS, ALERT_DEDUPE_MS, TOAST_MS } from './live-region';

// ---------------------------------------------------------------------------
// Constants (§4)
// ---------------------------------------------------------------------------

export const PANEL_UPDATE_MS = 250;
export const MIRROR_MS = 1000;
export const SELECT_PICK_MS = 33;
export const LOOK_HINT_MS = 4000;
export const FLASH_MS = 600;
export const FLASH_COUNT = 2;
export const WRONG_HOLD_MS = 2000;
/** Stages shorter than this start with the side panels collapsed (08-deployment §7). */
export const SHORT_STAGE_PX = 640;

// ---------------------------------------------------------------------------
// 07 §1.1 — the State contract lives in src/app/State.ts (pure); re-exported here for the panels.
// 06 §1 EngineEvents (hover, bench:open, analyze, input:focus, gfx, world:ready, bond:suppressed/restored)
// are part of GameEvents since the integration contracts revision.
// ---------------------------------------------------------------------------

export type { LockedPlacement, HotbarTool, TargetState, BenchState, StateView, StateCommands, UiState } from '../app/State';
export { HOTBAR } from '../app/State';
export type { HoverInfo } from '../app/events';
export type UiEngineEvents = EngineEvents;
export type UiEvents = GameEvents;

// ---------------------------------------------------------------------------
// 07 §1.3 — render hooks (implemented by src/render/* through Game.ts)
// ---------------------------------------------------------------------------

export type HighlightColor = 'group' | 'hover' | 'selected' | 'correct' | 'wrong' | 'marked';
export interface HCell { readonly cell: CellKey; readonly slot?: number; readonly center: Vec3; readonly half: number }

export interface RenderHooks {
  /** Tint the atoms of a functional group (null clears). Only one group highlight at a time. */
  setGroupHighlight(cells: readonly CellKey[] | null): void;
  /** Select-mode outlines. Each list replaces the previous one; reduced motion disables pulsing. */
  setSelectHighlights(h: { hovered: HCell | null; selected: readonly HCell[]; correct: readonly HCell[]; wrong: readonly HCell[] }): void;
  setHydrogenMode(mode: 'studs' | 'blocks' | 'select'): void;
  /** Quiz "marked atom": orange outline + "?" sprite (static under reduced motion). */
  setMarkedAtom(cell: CellKey | null): void;
  /** Camera ray in world units for select-mode picking. */
  crosshairRay(): { readonly origin: Vec3; readonly dir: Vec3 };
  /** Current voxel hit under the crosshair (<= PICK_DISTANCE) or null. */
  atomHit(): VoxelHit | null;
  setLowGraphics(on: boolean): void;
  setReducedMotion(on: boolean): void;
  setStereoOverlay(on: boolean): void;
  /** Crosshair flash on refusal (no-op under reduced motion). */
  flashCrosshair(): void;
  requestFullscreen(): Promise<void>;
  /** World block reader (implicitHCell for select-mode H candidates; 07 §11.1). */
  getBlock(x: number, y: number, z: number): number;
  /** Optional: the order the bond wand would set next on `pair` (validateBondChange without applying), null when refused. */
  wandPreview?(pair: PairKey): WandOrder | null;
  /** Optional: ghost-preview cell under the placement target (07 §7 ghost rows). */
  ghostCellInfo?(cell: CellKey): { readonly el: BlockElement; readonly breakEndpoint: boolean } | null;
  /** Optional: on-screen touch controls feed the InputManager through these (07 §2.2, §21.9). */
  readonly touch?: { setHeld(action: KeyAction, down: boolean): void; inject(action: KeyAction): void };
  /** `?debug=1`: the stocked debug inventory is never persisted (engineering review finding 8). */
  readonly debug: boolean;
  /** Mirrors the dialog stack into InputManager.modal: keys, wheel and buttons are ignored while a dialog is open (finding 11). */
  setModal(on: boolean): void;
}

// ---------------------------------------------------------------------------
// Panel contracts and the shared context every panel receives
// ---------------------------------------------------------------------------

export interface Panel { readonly el: HTMLElement; refresh(): void; dispose(): void }
export interface Dialog extends Panel { open(opener?: HTMLElement | null): void; close(): void; readonly isOpen: boolean }

export type PanelName = 'toolbar' | 'hotbar' | 'molecule' | 'challenge' | 'bench' | 'target' | 'mirror' | 'help' | 'settings' | 'pause';

export interface DialogHost {
  /** Opens a modal: stores the opener, makes #hud/#canvas and the other dialogs inert, focuses inside (§17). */
  push(dialog: HTMLElement, opener?: HTMLElement | null): void;
  /** Closes a modal and returns focus to its opener (fallback: the canvas). */
  pop(dialog: HTMLElement): void;
  readonly depth: number;
  confirm(text: string, okLabel: string): Promise<boolean>;
}

export interface HudContext {
  readonly state: UiState;
  readonly hooks: RenderHooks;
  readonly stage: HTMLElement;
  readonly canvas: HTMLElement;
  readonly dialogs: DialogHost;
  settings(): Settings;
  /** Saves and emits `settings:changed` for every changed field; the HUD applies theme/motion/scale/hooks. */
  updateSettings(patch: Partial<Settings>): void;
  keys(): Readonly<Record<KeyAction, string>>;
  markDirty(panel: PanelName): void;
  /** Polite announcement queued FIFO (challenge and quiz results). */
  announceSticky(text: string): void;
  /** Subscribe and record the unsubscriber for dispose(). */
  on<K extends keyof UiEvents & string>(name: K, fn: (e: UiEvents[K]) => void): () => void;
  /** Atom label of a cell (state.labelOfCell with a target-based fallback). */
  labelOfCell(cell: CellKey): string;
  /** Label of atom `id` of the targeted component. */
  labelOfTargetAtom(id: number): string;
  /** Narrow-screen sheet selection (§2.2 tabs); null closes the sheet. */
  setSheet(name: 'challenge' | 'molecule' | 'bench' | null): void;
  /** Opens the help / settings dialogs / roster drawer (used by the pause menu and the toolbar). */
  openHelp(opener?: HTMLElement | null): void;
  openSettings(opener?: HTMLElement | null): void;
  openRoster(): void;
  openQuiz(opener?: HTMLElement | null): void;
  openBench(opener?: HTMLElement | null): void;
  showFinished(): void;
  /** Collapses the molecule panel to its title bar (used while the bench panel is open, §2.2). */
  setMoleculeCollapsed(collapsed: boolean): void;
  /** The molecule panel's current Collapse state (the bench panel restores it when it closes, finding 15). */
  isMoleculeCollapsed(): boolean;
  /** Sets the visual look hint (`#look-hint`); ms = null keeps it until replaced, '' clears it. */
  showLookHint(text: string, ms: number | null): void;
}

export interface Hud {
  readonly panels: Record<string, Panel | Dialog>;
  readonly live: LiveRegion;
  readonly select: SelectMode;
  tick(nowMs: number): void;
  /** Actions Game forwards to the HUD (06 §10.4: hint, roster, help, bench, pause; slotPrev/slotNext and place in select mode). true = consumed. */
  handleAction(action: KeyAction | 'pause'): boolean;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// DOM helpers (function declarations only: panels import them across the module cycle)
// ---------------------------------------------------------------------------

export type Child = Node | string | null | undefined | false;

/** Element factory: attributes (`class`, `dataset.*` via `data-*`, booleans) and children. */
export function h(tag: string, attrs: Record<string, string | number | boolean | null | undefined> | null = null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

export function clearChildren(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

const FOCUSABLE = 'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

export function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden')) return false;
  if (el.closest('[hidden]')) return false;
  return el.getClientRects().length > 0 || el.offsetParent !== null;
}

export function focusables(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))) {
    if ((el as HTMLButtonElement).disabled) continue;
    if (!isVisible(el)) continue;
    out.push(el);
  }
  return out;
}

/** Roving tabindex for a toolbar/radiogroup: arrow keys move focus, Home/End jump; `onMove` fires on the newly focused item. */
export function rovingTabindex(container: HTMLElement, selector: string, opts: { vertical?: boolean; onMove?: (el: HTMLElement) => void } = {}): () => void {
  const items = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((el) => !(el as HTMLButtonElement).disabled && isVisible(el));
  const sync = (): void => {
    const list = items();
    if (list.length === 0) return;
    const current = list.find((el) => el.tabIndex === 0) ?? list[0]!;
    for (const el of list) el.tabIndex = el === current ? 0 : -1;
  };
  const onKey = (e: KeyboardEvent): void => {
    const list = items();
    const i = list.indexOf(e.target as HTMLElement);
    if (i < 0 || list.length === 0) return;
    const prev = opts.vertical ? 'ArrowUp' : 'ArrowLeft';
    const next = opts.vertical ? 'ArrowDown' : 'ArrowRight';
    let j = -1;
    if (e.key === next || (!opts.vertical && e.key === 'ArrowDown') || (opts.vertical && e.key === 'ArrowRight')) j = (i + 1) % list.length;
    else if (e.key === prev || (!opts.vertical && e.key === 'ArrowUp') || (opts.vertical && e.key === 'ArrowLeft')) j = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    if (j < 0) return;
    e.preventDefault();
    for (const el of list) el.tabIndex = -1;
    const target = list[j]!;
    target.tabIndex = 0;
    target.focus();
    opts.onMove?.(target);
  };
  const onFocusIn = (e: FocusEvent): void => {
    const list = items();
    const t = e.target as HTMLElement;
    if (!list.includes(t)) return;
    for (const el of list) el.tabIndex = el === t ? 0 : -1;
  };
  container.addEventListener('keydown', onKey);
  container.addEventListener('focusin', onFocusIn);
  sync();
  return () => {
    container.removeEventListener('keydown', onKey);
    container.removeEventListener('focusin', onFocusIn);
  };
}

export function nextCharge(q: Charge): Charge {
  return q === 0 ? 1 : q === 1 ? -1 : 0;
}

/** The order the wand cycle would try first (valence permitting). */
export function naiveNextOrder(order: WandOrder): WandOrder {
  const i = WAND_CYCLE.indexOf(order);
  return WAND_CYCLE[(i + 1) % WAND_CYCLE.length] ?? 1;
}

/** Hill formula with digits in <sub> and the trailing charge in <sup>; aria-label = plain formula. */
export function formulaNode(formula: string): HTMLElement {
  const dd = h('span', { 'aria-label': formula, class: 'formula' });
  const m = /^(.*?)(\d*[+-])$/.exec(formula);
  const body = m ? m[1] ?? '' : formula;
  const charge = m ? m[2] ?? '' : '';
  const re = /([A-Z][a-z]?)(\d*)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(body)) !== null) {
    if (t[0] === '') break;
    dd.append(t[1] ?? '');
    if (t[2]) dd.append(h('sub', null, t[2]));
  }
  if (charge) dd.append(h('sup', null, charge));
  return dd;
}

// ---------------------------------------------------------------------------
// mountHud
// ---------------------------------------------------------------------------

function ensureChild(parent: HTMLElement, id: string, tag: string, attrs: Record<string, string> = {}, before: Element | null = null): HTMLElement {
  let el = parent.querySelector<HTMLElement>(`#${id}`);
  if (!el) {
    el = h(tag, { id, ...attrs });
    if (before) parent.insertBefore(el, before);
    else parent.appendChild(el);
  }
  return el;
}

function resolveTheme(s: Settings): 'dark' | 'light' {
  if (s.theme !== 'auto') return s.theme;
  return mediaMatches('(prefers-color-scheme: light)') ? 'light' : 'dark';
}

function facingOf(yaw: number): string {
  const tau = Math.PI * 2;
  const n = ((yaw % tau) + tau) % tau;
  const i = Math.round(n / (Math.PI / 4)) % 8;
  return COMPASS[i] ?? 'north';
}

export function mountHud(stage: HTMLElement, state: UiState, hooks: RenderHooks, settings: Settings): Hud {
  const doc = stage.ownerDocument;
  let current: Settings = settings;
  const offs: (() => void)[] = [];

  // ---- skeleton (§2.1) ----------------------------------------------------
  const canvas = ensureChild(stage, 'canvas', 'canvas', { tabindex: '0' });
  canvas.setAttribute('role', 'application');
  if (!canvas.getAttribute('aria-label')) canvas.setAttribute('aria-label', STRINGS.canvasLabel);
  if (!doc.querySelector('a.skip')) {
    const skip = h('a', { class: 'skip', href: '#canvas' }, STRINGS.skipToGame);
    stage.parentElement?.insertBefore(skip, stage);
  }
  const hud = ensureChild(stage, 'hud', 'div', {}, canvas.nextSibling as Element | null);
  hud.dataset['ready'] = 'false';
  const toolbarRoot = ensureChild(hud, 'toolbar', 'div', { role: 'toolbar', 'aria-label': STRINGS.toolbarLabel });
  const challengeRoot = ensureChild(hud, 'challenge-panel', 'aside', { 'aria-labelledby': 'cp-title' });
  // Tab order = DOM order: skip link, toolbar, challenge panel, canvas, molecule panel, bench panel, hotbar (§2.1, §17).
  // The canvas therefore sits inside #hud right after the challenge panel; one `inert` covers HUD and canvas alike.
  if (canvas.parentElement !== hud) hud.insertBefore(canvas, challengeRoot.nextSibling);
  const crosshair = ensureChild(hud, 'crosshair', 'div', { 'aria-hidden': 'true' });
  const targetInfo = ensureChild(hud, 'target-info', 'p', { 'aria-hidden': 'true' });
  const lookHint = ensureChild(hud, 'look-hint', 'p', { 'aria-hidden': 'true' });
  const moleculeRoot = ensureChild(hud, 'molecule-panel', 'aside', { 'aria-labelledby': 'mp-title' });
  const benchRoot = ensureChild(hud, 'bench-panel', 'aside', { 'aria-labelledby': 'bp-title', hidden: '' });
  const tabs = ensureChild(hud, 'panel-tabs', 'div', { role: 'tablist', 'aria-label': STRINGS.tabs.label });
  const hotbarRoot = ensureChild(hud, 'hotbar', 'div', { role: 'toolbar', 'aria-label': STRINGS.hotbarLabel });
  const touch = ensureChild(hud, 'touch-controls', 'div', { hidden: '' });
  const dialogsRoot = ensureChild(stage, 'dialogs', 'div', {}, hud.nextSibling as Element | null);
  ensureChild(stage, 'toast', 'div', { class: 'sr-only', role: 'alert', 'aria-atomic': 'true' });
  ensureChild(stage, 'status', 'div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  ensureChild(stage, 'scene-mirror', 'section', { class: 'sr-only', 'aria-label': 'Scene description' });
  ensureChild(stage, 'debug', 'pre', { hidden: '', 'aria-hidden': 'true' });

  const live = createLiveRegion(stage);

  // ---- theme, motion, scale (§2.3, §2.4) -----------------------------------
  const root = doc.documentElement;
  const applyTheme = (): void => { root.dataset['theme'] = resolveTheme(current); };
  const applyMotion = (): void => {
    const on = reducedMotionActive(current);
    root.dataset['reducedMotion'] = on ? 'true' : 'false';
    hooks.setReducedMotion(on);
  };
  const applyScale = (): void => {
    const px = `${16 * current.uiScale}px`;
    hud.style.fontSize = px;
    dialogsRoot.style.fontSize = px;
    const toastEl = stage.querySelector<HTMLElement>('#toast');
    if (toastEl) toastEl.style.fontSize = px;
  };
  applyTheme();
  applyMotion();
  applyScale();
  const mediaOffs: (() => void)[] = [];
  const watchMedia = (query: string, fn: () => void): void => {
    try {
      const mm = (globalThis as { matchMedia?: (q: string) => MediaQueryList }).matchMedia;
      if (typeof mm !== 'function') return;
      const mql = mm.call(globalThis, query);
      mql.addEventListener('change', fn);
      mediaOffs.push(() => mql.removeEventListener('change', fn));
    } catch {
      // no matchMedia
    }
  };
  watchMedia('(prefers-color-scheme: light)', applyTheme);
  watchMedia('(prefers-reduced-motion: reduce)', applyMotion);

  // ---- look hint state (the function is hoisted; §3 pointer-lock hints) ------
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  function showLookHint(text: string, ms: number | null): void {
    if (hintTimer !== null) { clearTimeout(hintTimer); hintTimer = null; }
    setText(lookHint, text);
    setHidden(lookHint, text === '');
    if (ms !== null && text !== '') hintTimer = setTimeout(() => { setText(lookHint, ''); setHidden(lookHint, true); hintTimer = null; }, ms);
  }

  // ---- focus stack (§17) ----------------------------------------------------
  const stack: { dialog: HTMLElement; opener: HTMLElement | null }[] = [];
  const setInert = (el: Element, on: boolean): void => {
    if (on) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  };
  const focusInside = (dialog: HTMLElement): void => {
    const auto = dialog.querySelector<HTMLElement>('[autofocus]');
    const target = (auto && isVisible(auto) && !(auto as HTMLButtonElement).disabled ? auto : null) ?? focusables(dialog)[0] ?? dialog;
    if (target === dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };
  let confirmFn: (text: string, okLabel: string) => Promise<boolean> = () => Promise.resolve(false);
  const dialogs: DialogHost = {
    push(dialog, opener) {
      if (stack.some((s) => s.dialog === dialog)) return;
      // modal first: the pointerlockchange that the exitPointerLock below raises must not read as a pause request
      hooks.setModal(true);
      try {
        if (doc.pointerLockElement) doc.exitPointerLock();
      } catch {
        // no pointer lock
      }
      const op = (opener ?? (doc.activeElement as HTMLElement | null)) ?? null;
      for (const s of stack) setInert(s.dialog, true);
      setInert(hud, true);
      setInert(canvas, true);
      stack.push({ dialog, opener: op && op !== doc.body ? op : null });
      setHidden(dialog, false);
      setInert(dialog, false);
      focusInside(dialog);
    },
    pop(dialog) {
      const i = stack.findIndex((s) => s.dialog === dialog);
      if (i < 0) return;
      const [entry] = stack.splice(i, 1);
      setHidden(dialog, true);
      const top = stack[stack.length - 1];
      if (top) {
        setInert(top.dialog, false);
      } else {
        setInert(hud, false);
        setInert(canvas, false);
        hooks.setModal(false);
      }
      const opener = entry?.opener ?? null;
      const target = opener && opener.isConnected && isVisible(opener) && !(opener as HTMLButtonElement).disabled ? opener : top ? null : canvas;
      if (target) target.focus({ preventScroll: true });
      else if (top) focusInside(top.dialog);
    },
    get depth() { return stack.length; },
    confirm: (text, okLabel) => confirmFn(text, okLabel),
  };
  const onTrapKey = (e: KeyboardEvent): void => {
    const top = stack[stack.length - 1];
    if (!top) return;
    const active = doc.activeElement as HTMLElement | null;
    if (!active || !top.dialog.contains(active)) {
      // focus escaped the modal (e.g. the focused control was rebuilt): pull it back; Escape still reaches the dialog
      focusInside(top.dialog);
      if (e.key === 'Tab') e.preventDefault();
      else if (e.key === 'Escape') {
        e.preventDefault();
        top.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const list = focusables(top.dialog);
    if (list.length === 0) {
      e.preventDefault();
      top.dialog.focus();
      return;
    }
    const first = list[0]!;
    const last = list[list.length - 1]!;
    if (e.shiftKey && (active === first || active === top.dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  doc.addEventListener('keydown', onTrapKey, true);
  offs.push(() => doc.removeEventListener('keydown', onTrapKey, true));

  // ---- dirty flags ------------------------------------------------------------
  const dirty = new Set<PanelName>();
  const lastRefresh = new Map<PanelName, number>();
  const markDirty = (name: PanelName): void => { dirty.add(name); };
  const stickyPending = new Set<string>();

  const on = <K extends keyof UiEvents & string>(name: K, fn: (e: UiEvents[K]) => void): (() => void) => {
    const off = state.events.on(name, fn);
    offs.push(off);
    return off;
  };

  const labelOfCell = (cell: CellKey): string => {
    const fromState = state.labelOfCell(cell);
    if (fromState) return fromState;
    const id = state.target.cellToAtom.get(cell);
    const a = state.target.analysis;
    if (id !== undefined && a) {
      const at = a.atoms[id];
      if (at) return atomLabel(at.el, id);
    }
    return `(${cell.split(',').join(', ')})`;
  };
  const labelOfTargetAtom = (id: number): string => {
    const at = state.target.analysis?.atoms[id];
    return at ? atomLabel(at.el, id) : `#${id + 1}`;
  };

  let sheet: 'challenge' | 'molecule' | 'bench' | null = null;
  const setSheet = (name: 'challenge' | 'molecule' | 'bench' | null): void => {
    sheet = name;
    if (name) hud.dataset['sheet'] = name;
    else delete hud.dataset['sheet'];
    for (const b of Array.from(tabs.querySelectorAll<HTMLElement>('[role="tab"]'))) {
      b.setAttribute('aria-selected', b.dataset['sheet'] === name ? 'true' : 'false');
    }
  };

  const ctx: HudContext = {
    state, hooks, stage, canvas, dialogs,
    settings: () => current,
    updateSettings(patch) {
      const next: Settings = { ...current, ...patch };
      const changed: (keyof Settings)[] = [];
      for (const k of Object.keys(patch) as (keyof Settings)[]) {
        if (k === 'keys') {
          if (JSON.stringify(next.keys) !== JSON.stringify(current.keys)) changed.push(k);
        } else if (next[k] !== current[k]) changed.push(k);
      }
      if (changed.length === 0) return;
      current = next;
      saveSettings(next);
      for (const k of changed) state.events.emit('settings:changed', { key: k, value: next[k] });
    },
    keys: () => effectiveKeys(current),
    markDirty,
    announceSticky(text) {
      stickyPending.add(text);
      state.announce(text, 'polite');
    },
    on,
    labelOfCell,
    labelOfTargetAtom,
    setSheet,
    openHelp: (opener) => help.open(opener),
    openSettings: (opener) => settingsPanel.open(opener),
    openRoster: () => challenge.openRoster(true),
    openQuiz: (opener) => quiz.open(opener),
    openBench: (opener) => bench.open(opener),
    showFinished: () => { showFinishedOverlay(dialogsRoot, dialogs); live.announce(`${STRINGS.finishedTitle} ${STRINGS.finishedBody}`, 'assertive'); },
    setMoleculeCollapsed: (c) => molecule.setCollapsed(c),
    isMoleculeCollapsed: () => molecule.isCollapsed(),
    showLookHint,
  };

  // ---- panels (§4 item 2 order) --------------------------------------------
  const confirmHost = createConfirm(dialogsRoot, dialogs);
  confirmFn = confirmHost.confirm;
  const toolbar = mountToolbar(toolbarRoot, ctx);
  const challenge: ChallengePanel = mountChallengePanel(challengeRoot, ctx);
  const molecule: MoleculePanel = mountMoleculePanel(moleculeRoot, ctx);
  const bench: BenchPanel = mountBenchPanel(benchRoot, ctx);
  const hotbar = mountHotbar(hotbarRoot, ctx);
  const select: SelectMode = mountSelectMode(ctx);
  const quiz: QuizPanel = mountQuizPanel(dialogsRoot, ctx);
  const pause: PauseMenu = mountPauseMenu(dialogsRoot, ctx);
  const help = mountHelp(dialogsRoot, ctx);
  const settingsPanel: SettingsPanel = mountSettingsPanel(dialogsRoot, ctx);

  // narrow-screen tabs (§2.2)
  for (const [name, label] of [['challenge', STRINGS.tabs.challenge], ['molecule', STRINGS.tabs.molecule], ['bench', STRINGS.tabs.bench]] as const) {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-sheet': name, 'aria-controls': `${name}-panel` }, label);
    b.addEventListener('click', () => {
      if (sheet === name) setSheet(null);
      else {
        if (name === 'bench' && !bench.isOpen) bench.open(b);
        setSheet(name);
      }
    });
    tabs.appendChild(b);
  }
  offs.push(rovingTabindex(tabs, '[role="tab"]'));

  // touch controls (§2.2; consumed by InputManager through hooks.touch)
  const touchGroup = h('div', { role: 'group', 'aria-label': STRINGS.touch.move, class: 'tc-dpad' });
  const held: [KeyAction, string, string][] = [['forward', 'tc-forward', STRINGS.touch.forward], ['left', 'tc-left', STRINGS.touch.left], ['right', 'tc-right', STRINGS.touch.right], ['back', 'tc-back', STRINGS.touch.back]];
  for (const [action, id, label] of held) {
    const b = h('button', { type: 'button', id, class: `tc ${action}`, 'aria-label': label }, label);
    const down = (e: Event): void => { e.preventDefault(); hooks.touch?.setHeld(action, true); };
    const up = (): void => { hooks.touch?.setHeld(action, false); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    touchGroup.appendChild(b);
  }
  touch.appendChild(touchGroup);
  const taps: [KeyAction, string, string][] = [['jump', 'tc-jump', STRINGS.touch.jump], ['mine', 'tc-mine', STRINGS.touch.mine], ['place', 'tc-place', STRINGS.touch.place]];
  const tapGroup = h('div', { class: 'tc-actions' });
  for (const [action, id, label] of taps) {
    const b = h('button', { type: 'button', id, class: `tc ${action}`, 'aria-label': label }, label);
    b.addEventListener('click', () => {
      if (action === 'place' && select.active && select.place()) return;
      hooks.touch?.inject(action);
    });
    tapGroup.appendChild(b);
  }
  touch.appendChild(tapGroup);
  if (mediaMatches('(pointer: coarse)')) setHidden(touch, false);

  // short stage: panels start collapsed (08 §7)
  if (stage.clientHeight > 0 && stage.clientHeight < SHORT_STAGE_PX) {
    challenge.setCollapsed(true);
    molecule.setCollapsed(true);
  }

  // ---- hover / target info (§7) ----------------------------------------------
  let hover: HoverInfo = { kind: 'none' };
  const blockText = (id: number): string => {
    if (isOre(id)) {
      const el = elementOf(id);
      if (el && el !== 'H') return STRINGS.targetOre(el);
    }
    switch (id) {
      case Block.Stone: return STRINGS.targetTerrain.stone;
      case Block.Dirt: return STRINGS.targetTerrain.dirt;
      case Block.Grass: return STRINGS.targetTerrain.grass;
      case Block.Sand: return STRINGS.targetTerrain.sand;
      case Block.Glass: return STRINGS.targetTerrain.glass;
      case Block.LabTile:
      case Block.LabTileEdge: return STRINGS.targetTerrain.lab;
      case Block.Bench: return STRINGS.targetTerrain.bench;
      case Block.BenchReactantTile: return STRINGS.targetTerrain.reactant;
      case Block.BenchProductTile: return STRINGS.targetTerrain.product;
      default: return blockName(id);
    }
  };
  const hybOf = (cell: CellKey): string | null => {
    const id = state.target.cellToAtom.get(cell);
    const a = state.target.analysis;
    if (id === undefined || !a) return null;
    const at = a.atoms[id];
    return at ? HYBRIDIZATION_WORD[at.hybridization] : null;
  };
  const isSelectedH = (cell: CellKey, slot: number): boolean => {
    const id = state.target.cellToAtom.get(cell);
    if (id === undefined) return false;
    return state.selection.some((s) => s.atom === id && s.hSlot === slot);
  };
  const targetText = (): string => {
    const cand = select.active ? select.hovered() : null;
    if (cand) return select.hoverText(cand);
    const tool = HOTBAR[state.slot] ?? 'C';
    switch (hover.kind) {
      case 'none': return '';
      case 'bench': return STRINGS.targetTerrain.bench;
      case 'block': {
        if (hooks.ghostCellInfo) {
          const g = hooks.ghostCellInfo(cellKey(hover.x + hover.face[0], hover.y + hover.face[1], hover.z + hover.face[2]));
          if (g) return g.breakEndpoint ? STRINGS.targetGhostBreak(g.el) : STRINGS.targetGhost(g.el);
        }
        return blockText(hover.id);
      }
      case 'atom': {
        const label = labelOfCell(hover.cell);
        if (tool === 'select-tool' && !select.active) {
          const id = state.target.cellToAtom.get(hover.cell);
          const selected = id !== undefined && state.selection.some((s) => s.atom === id && s.hSlot === undefined);
          return STRINGS.targetAtomSelect(label, selected);
        }
        let t = STRINGS.targetAtom(hover.el, label, hover.bonds, hover.hydrogens, hover.charge, hybOf(hover.cell) ?? STRINGS.analyzing);
        if (tool === 'charge-tool') t += STRINGS.targetAtomCharge(nextCharge(hover.charge));
        return t;
      }
      case 'hydrogen': {
        const parent = labelOfCell(hover.cell);
        return hover.explicit ? STRINGS.targetHBlock(parent) : STRINGS.targetHCandidate(parent, isSelectedH(hover.cell, hover.slot));
      }
      case 'bond': {
        const [a, b] = splitPairKey(hover.pair);
        const la = labelOfCell(a);
        const lb = labelOfCell(b);
        if (tool === 'bond-wand') {
          const next = hooks.wandPreview ? hooks.wandPreview(hover.pair) : naiveNextOrder(hover.order);
          return STRINGS.targetBond(la, lb, hover.order, next);
        }
        return STRINGS.targetBondOtherTool(la, lb, hover.order);
      }
      default: return '';
    }
  };
  const refreshTarget = (): void => {
    setText(targetInfo, targetText());
    const tool = HOTBAR[state.slot] ?? 'C';
    crosshair.dataset['tool'] = tool === 'bond-wand' ? 'bond' : tool === 'charge-tool' ? 'charge' : tool === 'select-tool' || select.active ? 'select' : 'atom';
  };

  // ---- look hint ------------------------------------------------------------
  showLookHint(ENGINE_TEXT.clickToPlay, null);
  const onCanvasClick = (): void => { if (lookHint.textContent !== STRINGS.dragToLook) showLookHint('', null); };
  canvas.addEventListener('pointerdown', onCanvasClick);
  offs.push(() => canvas.removeEventListener('pointerdown', onCanvasClick));

  // ---- scene mirror (§16.3) ------------------------------------------------
  let mirrorDirty = true;
  let lastMirror = -Infinity;
  const rebuildMirror = (): void => {
    const p = state.player;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const z = Math.round(p.z);
    const onPad = x >= LAB_MIN && x < LAB_MAX && z >= LAB_MIN && z < LAB_MAX && y >= LAB_Y;
    const facing = facingOf(p.yaw);
    const parts: string[] = [];
    parts.push(`<h2>${escapeHtml(STRINGS.mirror.title)}</h2>`);
    parts.push(`<p>${escapeHtml(onPad ? STRINGS.mirror.position(x, y, z, facing) : STRINGS.mirror.offPad(x, y, z, facing))} ${escapeHtml(STRINGS.mirror.lookMode(state.lookMode))}</p>`);
    const comps = state.padComponents;
    parts.push(`<h3>${escapeHtml(STRINGS.mirror.molecules(comps.length))}</h3>`);
    if (comps.length) {
      parts.push('<ol>');
      for (const c of comps) {
        const a = c.analysis;
        const groups = a.groups.length ? a.groups.map((g) => g.label).join(', ') : '';
        const line = [a.name ?? STRINGS.unnamed, a.formula, groups].filter(Boolean).join(', ')
          + (c.locked ? STRINGS.mirror.lockedSuffix : '') + (c.id === state.target.component ? STRINGS.mirror.targetedSuffix : '');
        parts.push(`<li>${escapeHtml(line)}</li>`);
      }
      parts.push('</ol>');
    }
    parts.push(`<h3>${escapeHtml(STRINGS.mirror.targeted)}</h3>`);
    const mp = molecule.plainText();
    parts.push(mp ? `<p>${escapeHtml(mp)}</p>` : `<p>${escapeHtml(STRINGS.mirror.none)}</p>`);
    if (select.active) {
      parts.push(`<h3>${escapeHtml(STRINGS.mirror.selection)}</h3>`);
      const cands = select.candidates().map((c, i) => `${i + 1} ${select.describe(c)}`).join('; ');
      parts.push(`<p>${escapeHtml(`${STRINGS.mirror.candidates} ${cands || STRINGS.mirror.empty}. ${STRINGS.mirror.selected} ${challenge.selectionText() || STRINGS.mirror.none.toLowerCase()}`)}</p>`);
    }
    parts.push(`<h3>${escapeHtml(STRINGS.mirror.bench)}</h3><p>${escapeHtml(bench.plainText())}</p>`);
    const cur = state.current;
    const status = challenge.statusText();
    parts.push(`<h3>${escapeHtml(STRINGS.mirror.challenge)}</h3><p>${escapeHtml(STRINGS.mirror.challengeLine(cur.index + 1, state.roster.length, cur.challenge.title, status, state.score.earned, state.score.total))}</p>`);
    live.mirror(parts.join(''));
  };

  // ---- marked atom (quiz display, §1.1 step 3 / §10.5) --------------------
  let markedCell: CellKey | null = null;
  const syncMarkedAtom = (): void => {
    const rule = state.current.challenge.rule;
    let cell: CellKey | null = null;
    if (rule.type === 'quiz' && rule.display && rule.display.markedAtom !== undefined) {
      cell = state.locked[0]?.atomToCell[rule.display.markedAtom] ?? null;
    }
    if (cell !== markedCell) {
      markedCell = cell;
      hooks.setMarkedAtom(cell);
    }
  };

  // ---- event wiring (§18) ---------------------------------------------------
  const refreshAll = (): void => { for (const n of ['toolbar', 'hotbar', 'molecule', 'challenge', 'bench', 'target'] as PanelName[]) markDirty(n); mirrorDirty = true; };
  on('world:ready', () => { hud.dataset['ready'] = 'true'; refreshAll(); });
  on('block:placed', () => { markDirty('molecule'); mirrorDirty = true; });
  on('block:removed', () => { markDirty('molecule'); mirrorDirty = true; });
  on('block:refused', (e) => { live.announce(e.message, 'assertive'); hooks.flashCrosshair(); });
  on('bond:changed', (e) => {
    const [a, b] = splitPairKey(e.pair);
    markDirty('molecule'); markDirty('target'); mirrorDirty = true;
    state.announce(STRINGS.bondSet(labelOfCell(a), labelOfCell(b), e.order), 'polite');
  });
  on('bond:suppressed', (e) => {
    const [a, b] = splitPairKey(e.pair);
    markDirty('molecule'); markDirty('target'); mirrorDirty = true;
    state.announce(STRINGS.bondBroken(labelOfCell(a), labelOfCell(b)), 'polite');
  });
  on('bond:restored', (e) => {
    const [a, b] = splitPairKey(e.pair);
    markDirty('molecule'); markDirty('target'); mirrorDirty = true;
    state.announce(STRINGS.bondRestored(labelOfCell(a), labelOfCell(b)), 'polite');
  });
  on('charge:changed', () => { markDirty('molecule'); markDirty('target'); mirrorDirty = true; });
  on('analysis:deferred', (e) => {
    if (e.component === state.target.component) markDirty('molecule');
    if (e.deferred) state.announce(ENGINE_TEXT.analysisDeferred, 'polite');
  });
  on('molecule:analyzed', (e) => {
    if (e.component === state.target.component) { markDirty('molecule'); markDirty('target'); }
    if (state.padComponents.some((c) => c.id === e.component && c.locked) || state.locked.length) { select.rebuild(); syncMarkedAtom(); }
    markDirty('bench');
    mirrorDirty = true;
  });
  let lastTargetComponent: ComponentId | null = state.target.component;
  on('target:changed', (e) => {
    if (e.component !== lastTargetComponent) { molecule.onComponentChanged(); lastTargetComponent = e.component; }
    markDirty('molecule'); markDirty('target'); mirrorDirty = true;
  });
  on('selection:changed', () => { select.onSelectionChanged(); challenge.refreshSelection(); mirrorDirty = true; });
  let lastSlot = state.slot;
  on('inventory:changed', (e) => {
    markDirty('hotbar'); markDirty('target');
    if (!hooks.debug) saveInventory(e.counts);   // the ?debug=1 stock of 99 never leaks into a normal session (finding 8)
    if (e.slot !== lastSlot) {
      lastSlot = e.slot;
      const entry = HOTBAR[e.slot];
      const label = entry === 'bond-wand' ? STRINGS.bondWand : entry === 'charge-tool' ? STRINGS.chargeTool : entry === 'select-tool' ? STRINGS.selectTool
        : entry ? STRINGS.slotLabel(entry, entry === 'H' ? null : state.inventory[entry], e.slot + 1) : '';
      if (label) state.announce(STRINGS.slotSelected(label), 'polite');
    }
  });
  on('challenge:changed', (e) => {
    quiz.close();
    challenge.onChallengeChanged();
    select.onChallengeChanged();
    bench.onChallengeChanged();
    syncMarkedAtom();
    markDirty('challenge'); markDirty('molecule'); markDirty('bench'); markDirty('target'); mirrorDirty = true;
    state.announce(STRINGS.challengeAnnounce(e.index + 1, state.roster.length, state.current.challenge.title), 'polite');
  });
  on('challenge:submitted', (e) => {
    challenge.onSubmitted(e.result);
    select.onSubmitted(e.result);
    quiz.onSubmitted(e);
    bench.onSubmitted(e.result);
    markDirty('challenge'); markDirty('bench'); mirrorDirty = true;
  });
  on('challenge:passed', (e) => {
    const ch = state.roster.find((c) => c.id === e.id);
    challenge.onPassed(e);
    select.onPassed();
    markDirty('challenge'); markDirty('bench');
    state.announce(STRINGS.passed(ch?.title ?? e.id, e.pointsEarned), 'polite');
  });
  on('score:changed', (e) => { challenge.onScoreChanged(e); markDirty('challenge'); mirrorDirty = true; });
  on('quiz:open', () => { /* the quiz dialog uses the focus stack directly */ });
  on('quiz:close', () => { /* idem */ });
  on('quiz:answer', (e) => quiz.onAnswer(e));
  on('bench:reacted', (e) => { bench.onReacted(e); markDirty('bench'); mirrorDirty = true; state.announce(BENCH.reacted(e.result.mechanism), 'polite'); });
  on('bench:cleared', () => { bench.onCleared(); markDirty('bench'); markDirty('molecule'); mirrorDirty = true; state.announce(STRINGS.zoneCleared, 'polite'); });
  on('bench:open', () => { bench.toggle(canvas); });
  on('lms:status', (e) => { toolbar.onStatus(e); pause.onStatus(e); markDirty('toolbar'); });
  on('lms:committed', (e) => { state.announce(state.mode === 'lms' ? STRINGS.savedToGradebook(e.raw) : STRINGS.savedLocally, 'polite'); });
  on('settings:changed', (e) => {
    const key = e.key as keyof Settings;
    switch (key) {
      case 'theme': applyTheme(); break;
      case 'reducedMotion': applyMotion(); break;
      case 'uiScale': applyScale(); break;
      case 'lowGraphics': hooks.setLowGraphics(current.lowGraphics); break;
      case 'stereoOverlay': hooks.setStereoOverlay(current.stereoOverlay); break;
      case 'showHydrogens': if (!select.forcesHydrogens()) hooks.setHydrogenMode(current.showHydrogens ? 'blocks' : 'studs'); break;
      default: break;
    }
    help.refresh();
    settingsPanel.refresh();
    hotbar.refresh();
    challenge.refreshShortcuts();
    markDirty('molecule');
    const label = SETTING_LABEL[e.key];
    if (label) state.announce(STRINGS.settingChanged(label, settingValueText(e.key, e.value)), 'polite');
  });
  on('look:mode', (e) => {
    if (e.mode === 'drag') showLookHint(STRINGS.dragToLook, LOOK_HINT_MS);
    else if (e.mode === 'keys') showLookHint(STRINGS.lookMode('keys'), LOOK_HINT_MS);
    else showLookHint('', null);
    state.announce(STRINGS.lookMode(e.mode), 'polite');
    mirrorDirty = true;
  });
  on('live:announce', (e) => {
    const sticky = stickyPending.delete(e.text);
    live.announce(e.text, e.priority, { sticky });
  });
  on('hover:changed', (e) => { hover = e.hover; markDirty('target'); });
  on('analyze:requested', () => {
    const a = state.target.analysis;
    const summary = a ? STRINGS.analyzeSummary(a, a.name) : STRINGS.nothingTargeted;
    const t = targetInfo.textContent ?? '';
    state.announce(t ? `${summary} ${t}` : summary, 'polite');   // one message: a second polite call would replace the first (§16.1)
  });
  on('input:focus', (e) => { if (!e.focused && dialogs.depth === 0) showLookHint(ENGINE_TEXT.clickToPlay, null); else if (e.focused && lookHint.textContent === ENGINE_TEXT.clickToPlay) showLookHint('', null); });
  on('gfx:context', (e) => { if (e.state === 'lost') live.announce(ENGINE_TEXT.contextLost, 'assertive'); else live.announce(ENGINE_TEXT.contextRestored, 'polite'); });
  on('gfx:changed', (e) => { settingsPanel.onGfxChanged(e); });

  // settings.changed listener for Game-driven key changes handled above; apply initial hooks
  hooks.setStereoOverlay(current.stereoOverlay);
  if (!select.forcesHydrogens()) hooks.setHydrogenMode(current.showHydrogens ? 'blocks' : 'studs');

  // ---- tick (§4) --------------------------------------------------------------
  let ready = false;
  let lastPick = -Infinity;
  const panels: Record<string, Panel | Dialog> = {
    toolbar, challenge, molecule, bench, hotbar, quiz, pause, help, settings: settingsPanel,
  };
  const refreshers: Record<PanelName, () => void> = {
    toolbar: () => toolbar.refresh(),
    hotbar: () => hotbar.refresh(),
    molecule: () => molecule.refresh(),
    challenge: () => challenge.refresh(),
    bench: () => bench.refresh(),
    target: refreshTarget,
    mirror: rebuildMirror,
    help: () => help.refresh(),
    settings: () => settingsPanel.refresh(),
    pause: () => pause.refresh(),
  };
  refreshAll();
  syncMarkedAtom();
  select.onChallengeChanged();
  challenge.onChallengeChanged();
  bench.onChallengeChanged();

  const tick = (now: number): void => {
    if (!ready) { ready = true; hud.dataset['ready'] = 'true'; }
    if (state.paused && !pause.isOpen && !state.finished && dialogs.depth === 0) pause.open(canvas);
    for (const name of Array.from(dirty)) {
      const last = lastRefresh.get(name) ?? -Infinity;
      if (now - last < PANEL_UPDATE_MS) continue;
      dirty.delete(name);
      lastRefresh.set(name, now);
      refreshers[name]();
    }
    if (select.active && now - lastPick >= SELECT_PICK_MS) {
      lastPick = now;
      if (select.pick()) refreshTarget();
    }
    if (mirrorDirty && now - lastMirror >= MIRROR_MS) {
      mirrorDirty = false;
      lastMirror = now;
      rebuildMirror();
    }
  };

  const handleAction = (action: KeyAction | 'pause'): boolean => {
    switch (action) {
      case 'slotPrev': if (select.active) { select.cycle(-1); refreshTarget(); return true; } return false;
      case 'slotNext': if (select.active) { select.cycle(1); refreshTarget(); return true; } return false;
      case 'place': return select.active ? select.place() : false;
      case 'toggleHydrogens':
        // T goes through updateSettings so the HUD's own settings copy, the stored record and the settings
        // checkbox agree (engineering review finding 5); ignored while select mode forces the H view (07 §11.1).
        if (!select.forcesHydrogens()) ctx.updateSettings({ showHydrogens: !current.showHydrogens });
        return true;
      case 'hint': challenge.toggleHint(); return true;
      case 'roster': challenge.toggleRoster(); return true;
      case 'help': if (help.isOpen) help.close(); else help.open(canvas); return true;
      case 'bench': bench.toggle(canvas); return true;
      case 'pause': if (!pause.isOpen) pause.open(canvas); return true;
      default: return false;
    }
  };

  return {
    panels,
    live,
    select,
    tick,
    handleAction,
    dispose() {
      for (const off of offs.splice(0)) off();
      for (const off of mediaOffs.splice(0)) off();
      if (hintTimer !== null) clearTimeout(hintTimer);
      for (const p of Object.values(panels)) p.dispose();
      select.dispose();
      confirmHost.dispose();
      live.dispose();
      setInert(hud, false);
      setInert(canvas, false);
      hooks.setModal(false);
      hud.remove();
      dialogsRoot.remove();
    },
  };
}
