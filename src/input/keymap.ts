/**
 * Key resolution for the InputManager. PURE MODULE (no three, no DOM).
 * docs/design/06-engine.md §9.1; action names and default bindings are the
 * 07-ui.md §1.2 schema (`src/app/Settings.ts`).
 *
 * Settings.ts (WP-09) is the owner of the key schema in the design, but it did
 * not exist when this package was written and this file must stay pure, so the
 * action list and the default codes are declared here; Settings.ts should
 * import or re-export them from this module (see the contract change request
 * recorded in the WP-07 report) so there is a single source of truth.
 */

/** Remappable actions, in the order the settings panel lists them and the
 *  order `resolveAction` searches a key map. */
export const KEY_ACTIONS = [
  'forward', 'back', 'left', 'right', 'jump', 'sprint',
  'lookLeft', 'lookRight', 'lookUp', 'lookDown',
  'mine', 'place',
  'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9',
  'bondWand', 'chargeTool', 'selectTool', 'slotPrev', 'slotNext',
  'analyze', 'submit', 'nextChallenge', 'prevChallenge', 'hint', 'roster',
  'help', 'bench', 'toggleHydrogens', 'clearSelection',
] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];

/** KeyboardEvent.code values. Escape, Tab and F3 are fixed (pause, leave
 *  canvas, debug) and are not in this map. */
export const DEFAULT_KEYS: Readonly<Record<KeyAction, string>> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft',
  lookLeft: 'ArrowLeft', lookRight: 'ArrowRight', lookUp: 'ArrowUp', lookDown: 'ArrowDown',
  mine: 'KeyQ', place: 'KeyE',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', slot5: 'Digit5',
  slot6: 'Digit6', slot7: 'Digit7', slot8: 'Digit8', slot9: 'Digit9',
  bondWand: 'KeyB', chargeTool: 'KeyC', selectTool: 'KeyV', slotPrev: 'BracketLeft', slotNext: 'BracketRight',
  analyze: 'KeyF', submit: 'Enter', nextChallenge: 'Period', prevChallenge: 'Comma', hint: 'KeyI', roster: 'KeyL',
  help: 'KeyH', bench: 'KeyR', toggleHydrogens: 'KeyT', clearSelection: 'Backspace',
};

/** Every action the engine can receive: the remappable ones plus the two
 *  fixed codes ('pause' = Escape, 'debug' = F3). */
export type InputAction = KeyAction | 'pause' | 'debug';

/** Codes that are never remappable and always resolve to the same action. */
export const FIXED_CODES: Readonly<Record<string, 'pause' | 'debug'>> = { Escape: 'pause', F3: 'debug' };

/** Actions that are true while the key is down (everything else is edge-triggered). */
export const HELD_ACTIONS: ReadonlySet<InputAction> = new Set<InputAction>([
  'forward', 'back', 'left', 'right', 'jump', 'sprint', 'lookLeft', 'lookRight', 'lookUp', 'lookDown',
]);

/** Never bindable, never prevented: Tab leaves the canvas, Escape pauses /
 *  releases the pointer, the function keys belong to the browser. Same set the
 *  settings panel's `keyConflict` reports as 'reserved'. */
export const RESERVED_CODES: ReadonlySet<string> = new Set<string>([
  'Tab', 'Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

/** Codes whose browser default scrolls the (D2L) page; prevented whenever the
 *  canvas is active even when unbound. */
export const SCROLL_CODES: ReadonlySet<string> = new Set<string>([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End',
]);

/** true when `a` is a held (continuous) action rather than an edge-triggered one. */
export function isHeldAction(a: InputAction): boolean {
  return HELD_ACTIONS.has(a);
}

/**
 * FIXED_CODES[code] ?? the first action whose bound code equals `code`
 * (KEY_ACTIONS order) ?? null.
 */
export function resolveAction(keys: Readonly<Record<KeyAction, string>>, code: string): InputAction | null {
  if (Object.prototype.hasOwnProperty.call(FIXED_CODES, code)) {
    const fixed = FIXED_CODES[code];
    if (fixed !== undefined) return fixed;
  }
  for (const action of KEY_ACTIONS) {
    if (keys[action] === code) return action;
  }
  return null;
}

/** !RESERVED_CODES.has(code) && (SCROLL_CODES.has(code) || resolveAction(keys, code) !== null). */
export function shouldPreventDefault(keys: Readonly<Record<KeyAction, string>>, code: string): boolean {
  return !RESERVED_CODES.has(code) && (SCROLL_CODES.has(code) || resolveAction(keys, code) !== null);
}
