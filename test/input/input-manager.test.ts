/**
 * InputManager wheel gate (06 §9.2 rule 2 applied to the wheel; engineering review finding 11): a wheel over
 * the canvas changes the hotbar only while the canvas is the active element (or holds the pointer lock) and
 * no dialog is open. The DOM is stubbed: only addEventListener / activeElement / pointerLockElement are used.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { InputManager, WHEEL_STEP_MS } from '@/input/InputManager';
import { DEFAULT_KEYS } from '@/input/keymap';
import { createEmitter } from '@/app/events';

type Handler = (ev: unknown) => void;

interface FakeTarget {
  readonly listeners: Map<string, Handler[]>;
  addEventListener(type: string, fn: Handler): void;
  removeEventListener(type: string, fn: Handler): void;
  focus(): void;
}

function fakeTarget(): FakeTarget {
  const listeners = new Map<string, Handler[]>();
  return {
    listeners,
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
    },
    focus() { /* no-op */ },
  };
}

interface FakeDocument extends FakeTarget {
  activeElement: unknown;
  pointerLockElement: unknown;
  visibilityState: string;
}

function setup(): { im: InputManager; doc: FakeDocument; canvas: FakeTarget; wheel: (deltaY: number) => void; prevented: () => number } {
  let clock = 0;
  const canvas = fakeTarget();
  const base = fakeTarget();
  const doc: FakeDocument = {
    listeners: base.listeners,
    addEventListener: base.addEventListener,
    removeEventListener: base.removeEventListener,
    focus: base.focus,
    activeElement: null,
    pointerLockElement: null,
    visibilityState: 'visible',
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', fakeTarget());
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const im = new InputManager(canvas as unknown as HTMLCanvasElement, () => DEFAULT_KEYS, createEmitter());
  let prevented = 0;
  const wheel = (deltaY: number): void => {
    clock += WHEEL_STEP_MS + 1;   // past the step spacing, so every accepted event counts
    for (const fn of canvas.listeners.get('wheel') ?? []) fn({ preventDefault: () => { prevented++; }, deltaY });
  };
  return { im, doc, canvas, wheel, prevented: () => prevented };
}

describe('InputManager wheel gate (finding 11)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('ignores the wheel while the canvas is not active, counts it when focused or pointer-locked', () => {
    const { im, doc, canvas, wheel, prevented } = setup();
    wheel(100);
    expect(im.consumeFrame().wheel).toBe(0);
    expect(prevented()).toBe(1);   // the page still never scrolls
    doc.activeElement = canvas;
    wheel(100);
    wheel(100);
    expect(im.consumeFrame().wheel).toBe(2);
    doc.activeElement = null;
    doc.pointerLockElement = canvas;
    wheel(-100);
    expect(im.consumeFrame().wheel).toBe(-1);
    doc.pointerLockElement = null;
    wheel(-100);
    expect(im.consumeFrame().wheel).toBe(0);
    expect(prevented()).toBe(5);
  });

  it('ignores the wheel while a dialog is open (modal) and resumes when it closes', () => {
    const { im, doc, canvas, wheel } = setup();
    doc.activeElement = canvas;
    im.modal = true;
    expect(im.modal).toBe(true);
    wheel(100);
    expect(im.consumeFrame().wheel).toBe(0);
    im.modal = false;
    wheel(100);
    expect(im.consumeFrame().wheel).toBe(1);
    im.dispose();
  });
});
