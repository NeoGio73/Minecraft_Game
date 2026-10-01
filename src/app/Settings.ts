/**
 * Settings schema, validation and localStorage persistence (DOM module; it
 * touches `localStorage` only inside the load/save functions so a node test
 * can import it). docs/design/07-ui.md §1.2, 06-engine.md §1 (`stereoOverlay`,
 * `wasStored`) and §10.1 (inventory persistence).
 *
 * The key schema (`KEY_ACTIONS`, `KeyAction`, `DEFAULT_KEYS`) is declared by
 * the pure `src/input/keymap.ts` and re-exported here so there is one source.
 */
import { DEFAULT_KEYS, KEY_ACTIONS, RESERVED_CODES } from '../input/keymap';
import type { KeyAction } from '../input/keymap';
import { STORAGE_KEY_INVENTORY, STORAGE_KEY_SETTINGS } from '../lms/types';
import { BLOCK_ELEMENTS } from '../world/types';
import type { BlockElement } from '../world/types';

export { DEFAULT_KEYS, KEY_ACTIONS };
export type { KeyAction };

export interface Settings {
  readonly lowGraphics: boolean;                    // false
  readonly showHydrogens: boolean;                  // false: studs; true: mini-blocks
  readonly reducedMotion: 'auto' | 'on' | 'off';    // 'auto' = prefers-reduced-motion
  readonly theme: 'auto' | 'dark' | 'light';        // 'auto' = prefers-color-scheme
  readonly invertY: boolean;                        // false
  readonly sensitivity: number;                     // rad/px, 0.0005..0.006, default 0.002
  readonly turnRate: number;                        // yaw rad/s, 1..5, default 2.5; pitch rate = 0.6 * turnRate
  readonly uiScale: 1 | 1.25 | 1.5;                 // 1
  /** R/S halos, E/Z sprites, ghost H and ring discs in the world (06 §1 addition). Default true. */
  readonly stereoOverlay: boolean;
  readonly keys: Readonly<Partial<Record<KeyAction, string>>>;   // overrides of DEFAULT_KEYS
}

export const SENSITIVITY_RANGE = { min: 0.0005, max: 0.006, step: 0.0001, default: 0.002 } as const;
export const TURN_RATE_RANGE = { min: 1, max: 5, step: 0.1, default: 2.5 } as const;
export const UI_SCALES: readonly Settings['uiScale'][] = [1, 1.25, 1.5];

export const DEFAULT_SETTINGS: Settings = {
  lowGraphics: false,
  showHydrogens: false,
  reducedMotion: 'auto',
  theme: 'auto',
  invertY: false,
  sensitivity: SENSITIVITY_RANGE.default,
  turnRate: TURN_RATE_RANGE.default,
  uiScale: 1,
  stereoOverlay: true,
  keys: {},
};

/** Field names of the persisted record, in schema order. */
export const SETTING_KEYS: readonly (keyof Settings)[] = [
  'lowGraphics', 'showHydrogens', 'reducedMotion', 'theme', 'invertY', 'sensitivity', 'turnRate', 'uiScale', 'stereoOverlay', 'keys',
];

/** Keys present in the record that was last loaded or saved (06 §11.1: once the
 *  student saved the Graphics select, the low-graphics heuristic never overrides it). */
let storedKeys: Set<keyof Settings> = new Set();

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isKeyAction(s: string): s is KeyAction {
  return (KEY_ACTIONS as readonly string[]).includes(s);
}

/** A bindable KeyboardEvent.code: non-empty, not reserved. */
export function isBindableCode(code: unknown): code is string {
  return typeof code === 'string' && code.length > 0 && code.length <= 32 && !RESERVED_CODES.has(code);
}

function numberIn(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/** Validates one raw record field; returns the value to store or undefined when invalid. */
function validateField<K extends keyof Settings>(key: K, v: unknown): Settings[K] | undefined {
  switch (key) {
    case 'lowGraphics':
    case 'showHydrogens':
    case 'invertY':
    case 'stereoOverlay':
      return typeof v === 'boolean' ? (v as Settings[K]) : undefined;
    case 'reducedMotion':
      return v === 'auto' || v === 'on' || v === 'off' ? (v as Settings[K]) : undefined;
    case 'theme':
      return v === 'auto' || v === 'dark' || v === 'light' ? (v as Settings[K]) : undefined;
    case 'sensitivity': {
      const n = numberIn(v, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max);
      return n === null ? undefined : (n as Settings[K]);
    }
    case 'turnRate': {
      const n = numberIn(v, TURN_RATE_RANGE.min, TURN_RATE_RANGE.max);
      return n === null ? undefined : (n as Settings[K]);
    }
    case 'uiScale':
      return (UI_SCALES as readonly unknown[]).includes(v) ? (v as Settings[K]) : undefined;
    case 'keys': {
      if (!isRecord(v)) return undefined;
      const keys: Partial<Record<KeyAction, string>> = {};
      const used = new Set<string>();
      for (const [action, code] of Object.entries(v)) {
        if (!isKeyAction(action) || !isBindableCode(code) || used.has(code)) continue;
        keys[action] = code;
        used.add(code);
      }
      return keys as Settings[K];
    }
    default:
      return undefined;
  }
}

/** Parses a stored JSON string into a Settings record; invalid fields fall back to the defaults. */
export function parseSettings(json: string | null): { settings: Settings; stored: Set<keyof Settings> } {
  const stored = new Set<keyof Settings>();
  if (json === null || json === '') return { settings: { ...DEFAULT_SETTINGS }, stored };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, stored };
  }
  if (!isRecord(raw)) return { settings: { ...DEFAULT_SETTINGS }, stored };
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of SETTING_KEYS) {
    if (!(key in raw)) continue;
    const v = validateField(key, raw[key]);
    if (v === undefined) continue;
    out[key] = v;
    stored.add(key);
  }
  return { settings: out as unknown as Settings, stored };
}

/** try/catch localStorage; invalid fields -> defaults. Records which keys the stored record held. */
export function loadSettings(): Settings {
  let json: string | null = null;
  try {
    json = storage()?.getItem(STORAGE_KEY_SETTINGS) ?? null;
  } catch {
    json = null;
  }
  const { settings, stored } = parseSettings(json);
  storedKeys = stored;
  return settings;
}

/** try/catch; emits nothing (hud.ts emits settings:changed per changed field). */
export function saveSettings(s: Settings): void {
  const record: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) record[key] = s[key];
  storedKeys = new Set(SETTING_KEYS);
  try {
    storage()?.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(record));
  } catch {
    // storage unavailable (private mode, quota): settings live for the session only
  }
}

/** true when the last loaded or saved record held `key` (06 §11.1 low-graphics rule). */
export function wasStored(key: keyof Settings): boolean {
  return storedKeys.has(key);
}

export function effectiveKeys(s: Settings): Readonly<Record<KeyAction, string>> {
  const out: Record<KeyAction, string> = { ...DEFAULT_KEYS };
  for (const action of KEY_ACTIONS) {
    const code = s.keys[action];
    if (isBindableCode(code)) out[action] = code;
  }
  return out;
}

/** 'on', or 'auto' && matchMedia('(prefers-reduced-motion: reduce)').matches. */
export function reducedMotionActive(s: Settings): boolean {
  if (s.reducedMotion === 'on') return true;
  if (s.reducedMotion === 'off') return false;
  return mediaMatches('(prefers-reduced-motion: reduce)');
}

/** Guarded matchMedia (false outside a browser). */
export function mediaMatches(query: string): boolean {
  try {
    const mm = (globalThis as { matchMedia?: (q: string) => MediaQueryList }).matchMedia;
    return typeof mm === 'function' ? mm.call(globalThis, query).matches : false;
  } catch {
    return false;
  }
}

/** null when ok; otherwise the conflicting action. Escape/Tab/F-keys and duplicates are conflicts. */
export function keyConflict(keys: Readonly<Record<KeyAction, string>>, action: KeyAction, code: string): KeyAction | 'reserved' | null {
  if (!isBindableCode(code)) return 'reserved';
  for (const other of KEY_ACTIONS) {
    if (other !== action && keys[other] === code) return other;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inventory persistence (06 §10.1: Settings.ts writes it; Game reads it at start)
// ---------------------------------------------------------------------------

/** The stored per-element counts (H omitted: Infinity does not survive JSON), or null when absent/invalid. */
export function loadInventory(): Partial<Record<BlockElement, number>> | null {
  let json: string | null = null;
  try {
    json = storage()?.getItem(STORAGE_KEY_INVENTORY) ?? null;
  } catch {
    return null;
  }
  if (json === null || json === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const out: Partial<Record<BlockElement, number>> = {};
  for (const el of BLOCK_ELEMENTS) {
    if (el === 'H') continue;
    const v = raw[el];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[el] = Math.floor(v);
  }
  return out;
}

/** Writes every finite count (H is skipped). try/catch. */
export function saveInventory(counts: Readonly<Partial<Record<BlockElement, number>>>): void {
  const record: Partial<Record<BlockElement, number>> = {};
  for (const el of BLOCK_ELEMENTS) {
    if (el === 'H') continue;
    const v = counts[el];
    if (typeof v === 'number' && Number.isFinite(v)) record[el] = v;
  }
  try {
    storage()?.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(record));
  } catch {
    // ignore
  }
}
