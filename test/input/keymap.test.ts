import { describe, it, expect } from 'vitest';
// 06 §9.1 reads DEFAULT_KEYS from src/app/Settings.ts; that module belongs to WP-09 and
// did not exist when WP-07 was written, so keymap.ts carries the schema (see its header).
import {
  DEFAULT_KEYS, FIXED_CODES, HELD_ACTIONS, KEY_ACTIONS, RESERVED_CODES, SCROLL_CODES,
  isHeldAction, resolveAction, shouldPreventDefault,
} from '@/input/keymap';
import type { InputAction, KeyAction } from '@/input/keymap';

describe('resolveAction (06 §9.1)', () => {
  it('resolves the default bindings', () => {
    expect(resolveAction(DEFAULT_KEYS, 'KeyW')).toBe('forward');
    expect(resolveAction(DEFAULT_KEYS, 'KeyB')).toBe('bondWand');
    expect(resolveAction(DEFAULT_KEYS, 'KeyT')).toBe('toggleHydrogens');
    expect(resolveAction(DEFAULT_KEYS, 'Space')).toBe('jump');
    expect(resolveAction(DEFAULT_KEYS, 'Enter')).toBe('submit');
    expect(resolveAction(DEFAULT_KEYS, 'BracketRight')).toBe('slotNext');
  });

  it('fixed codes resolve for any map', () => {
    expect(resolveAction(DEFAULT_KEYS, 'Escape')).toBe('pause');
    expect(resolveAction(DEFAULT_KEYS, 'F3')).toBe('debug');
    const weird = { ...DEFAULT_KEYS, help: 'Escape', hint: 'F3' };
    expect(resolveAction(weird, 'Escape')).toBe('pause');
    expect(resolveAction(weird, 'F3')).toBe('debug');
    expect(FIXED_CODES).toEqual({ Escape: 'pause', F3: 'debug' });
  });

  it('unbound codes resolve to null (including Object.prototype names)', () => {
    expect(resolveAction(DEFAULT_KEYS, 'KeyZ')).toBe(null);
    expect(resolveAction(DEFAULT_KEYS, 'Tab')).toBe(null);
    expect(resolveAction(DEFAULT_KEYS, 'constructor')).toBe(null);
    expect(resolveAction(DEFAULT_KEYS, 'toString')).toBe(null);
    expect(resolveAction(DEFAULT_KEYS, '')).toBe(null);
  });

  it('remapped keys resolve to the new code only', () => {
    const keys = { ...DEFAULT_KEYS, forward: 'KeyZ' };
    expect(resolveAction(keys, 'KeyZ')).toBe('forward');
    expect(resolveAction(keys, 'KeyW')).toBe(null);
  });

  it('a duplicate binding resolves to the first action in KEY_ACTIONS order', () => {
    const keys = { ...DEFAULT_KEYS, analyze: 'KeyW' };
    expect(resolveAction(keys, 'KeyW')).toBe('forward');
    const keys2 = { ...DEFAULT_KEYS, forward: 'KeyF' };
    expect(resolveAction(keys2, 'KeyF')).toBe('forward');
  });
});

describe('shouldPreventDefault (06 §9.1)', () => {
  it('prevents scroll keys and bound codes', () => {
    for (const code of ['Space', 'ArrowUp', 'KeyW', 'Digit1', 'Period', 'PageDown', 'Backspace', 'Enter', 'Home']) {
      expect(shouldPreventDefault(DEFAULT_KEYS, code), code).toBe(true);
    }
  });

  it('never prevents reserved codes or unbound keys', () => {
    for (const code of ['Tab', 'Escape', 'KeyZ', 'F5', 'F3', 'F1', 'F12']) {
      expect(shouldPreventDefault(DEFAULT_KEYS, code), code).toBe(false);
    }
  });

  it('follows the current map: an unbound W is no longer prevented, a bound Z is', () => {
    const keys = { ...DEFAULT_KEYS, forward: 'KeyZ' };
    expect(shouldPreventDefault(keys, 'KeyW')).toBe(false);
    expect(shouldPreventDefault(keys, 'KeyZ')).toBe(true);
    // scroll keys stay prevented even when unbound
    const noJump = { ...DEFAULT_KEYS, jump: 'KeyJ' };
    expect(shouldPreventDefault(noJump, 'Space')).toBe(true);
  });
});

describe('tables', () => {
  it('HELD_ACTIONS has exactly the ten continuous actions', () => {
    expect(HELD_ACTIONS.size).toBe(10);
    const expected: InputAction[] = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'lookLeft', 'lookRight', 'lookUp', 'lookDown'];
    for (const a of expected) expect(HELD_ACTIONS.has(a), a).toBe(true);
    expect(isHeldAction('mine')).toBe(false);
    expect(isHeldAction('pause')).toBe(false);
    expect(isHeldAction('jump')).toBe(true);
  });

  it('RESERVED_CODES holds Tab, Escape and F1..F12; SCROLL_CODES the nine scrolling keys', () => {
    expect(RESERVED_CODES.size).toBe(14);
    expect(RESERVED_CODES.has('Tab')).toBe(true);
    expect(RESERVED_CODES.has('Escape')).toBe(true);
    for (let i = 1; i <= 12; i++) expect(RESERVED_CODES.has(`F${i}`), `F${i}`).toBe(true);
    expect(SCROLL_CODES.size).toBe(9);
    for (const c of ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']) {
      expect(SCROLL_CODES.has(c), c).toBe(true);
    }
  });

  it('DEFAULT_KEYS binds every action to a unique, non-reserved code', () => {
    expect(KEY_ACTIONS.length).toBe(36);
    const seen = new Set<string>();
    for (const a of KEY_ACTIONS) {
      const code: string = DEFAULT_KEYS[a as KeyAction];
      expect(code.length, a).toBeGreaterThan(0);
      expect(RESERVED_CODES.has(code), `${a} -> ${code}`).toBe(false);
      expect(seen.has(code), `${a} -> ${code} duplicated`).toBe(false);
      seen.add(code);
      expect(resolveAction(DEFAULT_KEYS, code)).toBe(a);
    }
    expect(Object.keys(DEFAULT_KEYS).sort()).toEqual([...KEY_ACTIONS].sort());
  });
});
