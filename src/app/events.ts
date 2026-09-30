/**
 * Typed game event map and a tiny emitter. PURE MODULE (no three, no DOM).
 */
import type { Analysis, Charge, BondOrder, ReactionResult } from '../chem/types';
import type { ReagentId, SubmitResult } from '../content/types';
import type { AdapterMode } from '../lms/types';
import type { BlockElement, CellKey, ComponentId, PairKey, Zone } from '../world/types';

export interface GameEvents {
  'block:placed': { x: number; y: number; z: number; id: number; el?: BlockElement; zone: Zone };
  'block:removed': { x: number; y: number; z: number; id: number; el?: BlockElement; zone: Zone };
  'block:refused': { x: number; y: number; z: number; message: string };
  'bond:changed': { pair: PairKey; order: BondOrder; previous: BondOrder };
  'charge:changed': { cell: CellKey; charge: Charge; previous: Charge };
  'molecule:analyzed': { component: ComponentId; analysis: Analysis; zone: Zone };
  'target:changed': { component: ComponentId | null; cell: CellKey | null; pair: PairKey | null };
  'selection:changed': { cells: readonly CellKey[]; hydrogens: readonly { cell: CellKey; slot: number }[] };
  'inventory:changed': { counts: Readonly<Record<BlockElement, number>>; slot: number };
  'challenge:changed': { id: string; index: number };
  'challenge:submitted': { id: string; result: SubmitResult };
  'challenge:passed': { id: string; pointsEarned: number; attempt: number };
  'score:changed': { earned: number; total: number; raw: number; solved: number; count: number };
  'quiz:open': { challengeId: string };
  'quiz:answer': { challengeId: string; choice: string | boolean; correct: boolean; attempt: number };
  'quiz:close': { challengeId: string };
  'bench:reacted': { reagentId: ReagentId; result: ReactionResult };
  'bench:cleared': Record<string, never>;
  'lms:status': { mode: AdapterMode; studentId: string | null; message: string };
  'lms:committed': { raw: number | null; status: string };
  'settings:changed': { key: string; value: unknown };
  'look:mode': { mode: 'locked' | 'drag' | 'keys' };
  'live:announce': { text: string; priority: 'polite' | 'assertive' };
}

export type EventName = keyof GameEvents;

export type Listener<K extends EventName> = (e: GameEvents[K]) => void;

export interface Emitter<M extends object = GameEvents> {
  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof M & string>(name: K, fn: (e: M[K]) => void): () => void;
  once<K extends keyof M & string>(name: K, fn: (e: M[K]) => void): () => void;
  off<K extends keyof M & string>(name: K, fn: (e: M[K]) => void): void;
  emit<K extends keyof M & string>(name: K, e: M[K]): void;
  /** Remove every listener (used on teardown / context loss). */
  clear(): void;
}

/** Synchronous, exception-isolating emitter: a throwing listener is logged
 *  and the remaining listeners still run. */
export function createEmitter<M extends object = GameEvents>(): Emitter<M> {
  const map = new Map<string, Set<(e: never) => void>>();
  const on = <K extends keyof M & string>(name: K, fn: (e: M[K]) => void): (() => void) => {
    let set = map.get(name);
    if (!set) {
      set = new Set();
      map.set(name, set);
    }
    set.add(fn as (e: never) => void);
    return () => off(name, fn);
  };
  const off = <K extends keyof M & string>(name: K, fn: (e: M[K]) => void): void => {
    map.get(name)?.delete(fn as (e: never) => void);
  };
  const emit = <K extends keyof M & string>(name: K, e: M[K]): void => {
    const set = map.get(name);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        (fn as (x: M[K]) => void)(e);
      } catch (err) {
        console.error(`[events] listener for "${name}" threw`, err);
      }
    }
  };
  const once = <K extends keyof M & string>(name: K, fn: (e: M[K]) => void): (() => void) => {
    const wrapped = (e: M[K]): void => {
      off(name, wrapped);
      fn(e);
    };
    return on(name, wrapped);
  };
  return { on, once, off, emit, clear: () => map.clear() };
}
