/**
 * Carbocation 1,2-shifts (McMurry 7.11): `cationClass`, `checkShift`,
 * `applyShift`. PURE MODULE. See docs/design/04-reaction-bench.md section 5.6.
 *
 * `checkShift(g, c)` is called on a graph in which the cation carbon `c` has
 * already lost its leaving group bond (C–X / C–OH bond removed) or had its
 * pi bond lowered to single, so `deg(c)` is the heavy degree of the cation.
 */
import type { MoleculeGraph } from '../chem/types';
import { bondBetween, neighborsOf, ringsThrough, withBond, withoutBond } from '../chem/graph';
import { deg, hydrogensOf, isAllylic, isBenzylic, sp3 } from './helpers';

export interface Shift {
  readonly kind: 'hydride' | 'methyl';
  readonly from: number;
  readonly to: number;
  /** The migrating carbon (methyl shifts only). */
  readonly migrating?: number;
  readonly newClass: number;
}

/** Heavy degree plus 1 for an allylic/benzylic cation. */
export function cationClass(g: MoleculeGraph, c: number): number {
  return deg(g, c) + (isAllylic(g, c, -1) || isBenzylic(g, c, -1) ? 1 : 0);
}

/** The best 1,2-shift from the cation at `c`, or null when none gives a more stable cation. */
export function checkShift(g: MoleculeGraph, c: number): Shift | null {
  const hyd = hydrogensOf(g);
  const H = (i: number) => hyd[i] ?? 0;
  const cls = cationClass(g, c);
  let best: Shift | null = null;
  const better = (cand: Shift): boolean => {
    if (best === null) return true;
    if (cand.newClass !== best.newClass) return cand.newClass > best.newClass;
    if (cand.kind !== best.kind) return cand.kind === 'hydride';
    return cand.to < best.to;
  };
  for (const n of [...neighborsOf(g, c)].sort((x, y) => x - y)) {
    if (!sp3(g, n) || g.atoms[n]!.el !== 'C') continue;
    const bonus = isAllylic(g, n, c) || isBenzylic(g, n, c) ? 1 : 0;
    if (H(n) >= 1 && deg(g, n) + bonus > cls) {
      const cand: Shift = { kind: 'hydride', from: c, to: n, newClass: deg(g, n) + bonus };
      if (better(cand)) best = cand;
    }
    if (H(n) === 0) {
      const newClass = deg(g, n) - 1 + bonus;
      if (newClass > cls) {
        const ms = neighborsOf(g, n)
          .filter((m) => {
            if (m === c || g.atoms[m]!.el !== 'C') return false;
            const k = bondBetween(g, n, m)!;
            if (g.bonds[k]!.order !== 1) return false;
            return ringsThrough(g, n, m).length === 0;
          })
          .sort((p, q) => {
            const mp = deg(g, p) === 1 ? 0 : 1;
            const mq = deg(g, q) === 1 ? 0 : 1;
            return mp - mq || p - q;
          });
        const m = ms[0];
        if (m !== undefined) {
          const cand: Shift = { kind: 'methyl', from: c, to: n, migrating: m, newClass };
          if (better(cand)) best = cand;
        }
      }
    }
  }
  return best;
}

/** Graph after the 1,2-shift: a hydride shift changes no bond (the cation moves to `to`); a methyl shift moves `migrating` from `to` to `from`. */
export function applyShift(g: MoleculeGraph, s: Shift): MoleculeGraph {
  if (s.kind === 'hydride') return g;
  if (s.migrating === undefined) throw new Error('methyl shift without a migrating atom');
  const k = bondBetween(g, s.to, s.migrating);
  if (k === undefined) throw new Error('applyShift: migrating atom is not bonded to the cation neighbour');
  return withBond(withoutBond(g, k), s.from, s.migrating, 1);
}
