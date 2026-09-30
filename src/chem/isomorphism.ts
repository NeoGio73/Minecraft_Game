/**
 * VF2-style graph isomorphism returning every mapping (port of
 * `tools/reference/refimpl.py` `vf2_iso`). PURE MODULE.
 * See docs/design/02-chemistry-core.md section 10.
 *
 * Atoms match on `atomLabel` (element, total H, charge, aromatic flag) and
 * bonds on `bondLabel`; stereo tags and positions are ignored. The
 * comparator (compare.ts) tries every mapping for parity.
 */
import type { ChemApi, MoleculeGraph } from './types';
import { otherEnd } from './graph';
import { implicitHydrogens } from './hydrogens';
import { atomLabel, bondLabel } from './wlhash';

export interface IsomorphismSearch {
  /** mapping[targetId] = studentId */
  readonly mappings: number[][];
  /** recursive calls made */
  readonly states: number;
  /** true when maxStates stopped the search */
  readonly capped: boolean;
}

export const DEFAULT_MAX_STATES = 200_000;

interface Labeled {
  readonly labels: string[];
  readonly deg: number[];
  /** nb[i] = Map<neighbourId, bondLabel> */
  readonly nb: Map<number, string>[];
  readonly sortedBondLabels: string[];
}

function labelGraph(g: MoleculeGraph): Labeled {
  const { hydrogens } = implicitHydrogens(g);
  const labels = g.atoms.map((a, i) => atomLabel(a, hydrogens[i] ?? 0));
  const deg = g.adj.map((a) => a.length);
  const nb: Map<number, string>[] = [];
  for (let i = 0; i < g.atoms.length; i++) {
    const m = new Map<number, string>();
    for (const k of g.adj[i]!) m.set(otherEnd(g, k, i), bondLabel(g.bonds[k]!));
    nb.push(m);
  }
  const sortedBondLabels = g.bonds.map(bondLabel).sort();
  return { labels, deg, nb, sortedBondLabels };
}

function sameMultiset<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** BFS order started from the unvisited atom of highest degree (ties: lowest id). */
function searchOrder(g: MoleculeGraph, deg: readonly number[]): number[] {
  const n = g.atoms.length;
  const seen = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const starts = [...Array(n).keys()].sort((x, y) => (deg[y]! - deg[x]!) || (x - y));
  for (const s of starts) {
    if (seen[s]) continue;
    seen[s] = true;
    const queue = [s];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++]!;
      order.push(u);
      for (const k of g.adj[u]!) {
        const v = otherEnd(g, k, u);
        if (!seen[v]) {
          seen[v] = true;
          queue.push(v);
        }
      }
    }
  }
  return order;
}

export function findIsomorphismsDetailed(
  target: MoleculeGraph,
  student: MoleculeGraph,
  maxStates: number = DEFAULT_MAX_STATES,
  firstOnly = false,
): IsomorphismSearch {
  const n = target.atoms.length;
  const empty: IsomorphismSearch = { mappings: [], states: 0, capped: false };
  if (n !== student.atoms.length) return empty;
  if (target.bonds.length !== student.bonds.length) return empty;
  const T = labelGraph(target);
  const S = labelGraph(student);
  if (!sameMultiset([...T.labels].sort(), [...S.labels].sort())) return empty;
  if (!sameMultiset([...T.deg].sort((x, y) => x - y), [...S.deg].sort((x, y) => x - y))) return empty;
  if (!sameMultiset(T.sortedBondLabels, S.sortedBondLabels)) return empty;

  const order = searchOrder(target, T.deg);
  const m12 = new Array<number>(n).fill(-1);
  const m21 = new Array<number>(n).fill(-1);
  const mappings: number[][] = [];
  let states = 0;
  let capped = false;

  function feasible(u: number, v: number): boolean {
    if (T.labels[u] !== S.labels[v] || T.deg[u] !== S.deg[v]) return false;
    for (const [w, lab] of T.nb[u]!) {
      const mw = m12[w]!;
      if (mw !== -1 && S.nb[v]!.get(mw) !== lab) return false;
    }
    for (const [x, lab] of S.nb[v]!) {
      const mx = m21[x]!;
      if (mx !== -1 && T.nb[u]!.get(mx) !== lab) return false;
    }
    return true;
  }

  /** returns true to stop the whole search */
  function rec(k: number): boolean {
    states++;
    if (states > maxStates) {
      capped = true;
      return true;
    }
    if (k === n) {
      mappings.push([...m12]);
      return firstOnly;
    }
    const u = order[k]!;
    let cands: number[] | null = null;
    for (const w of T.nb[u]!.keys()) {
      const mw = m12[w]!;
      if (mw === -1) continue;
      const set: number[] = [];
      for (const x of S.nb[mw]!.keys()) if (m21[x] === -1) set.push(x);
      cands = cands === null ? set : cands.filter((x) => set.includes(x));
    }
    if (cands === null) {
      cands = [];
      for (let v = 0; v < n; v++) if (m21[v] === -1) cands.push(v);
    }
    cands.sort((x, y) => x - y);
    for (const v of cands) {
      if (!feasible(u, v)) continue;
      m12[u] = v;
      m21[v] = u;
      const stop = rec(k + 1);
      m12[u] = -1;
      m21[v] = -1;
      if (stop) return true;
    }
    return false;
  }

  rec(0);
  return { mappings, states, capped };
}

/** Every isomorphism target -> student (mapping[targetId] = studentId). */
export function findIsomorphisms(target: MoleculeGraph, student: MoleculeGraph, maxStates: number = DEFAULT_MAX_STATES): number[][] {
  return findIsomorphismsDetailed(target, student, maxStates, false).mappings;
}

export function isIsomorphic(a: MoleculeGraph, b: MoleculeGraph): boolean {
  return findIsomorphismsDetailed(a, b, DEFAULT_MAX_STATES, true).mappings.length > 0;
}

const _check: Pick<ChemApi, 'findIsomorphisms'> = { findIsomorphisms };
void _check;
