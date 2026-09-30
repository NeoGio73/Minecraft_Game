/**
 * Lattice embedding of a molecule graph onto the cubic grid (port of
 * `tools/reference/embed.py` + the stereo constraints of reaction-bench 4.2,
 * docs/design/02-chemistry-core.md section 13), amended for SCOPE.md
 * Amendment 1 ("no bond" between touching atom blocks):
 *
 *  - Bonded heavy atoms must be face-adjacent (edge-diagonal for a bond
 *    flagged `diagonal`, only with `allowDiagonal`).
 *  - Unbonded heavy atoms MAY be face-adjacent. Every such pair is reported
 *    in `suppressedPairs`; the world places the atoms and sets that pair's
 *    bond to order 0 with the bond wand, so the chemistry graph never sees
 *    a phantom bond. The embedder still prefers induced embeddings: it first
 *    searches with the minimum number of suppressed pairs that the E/Z tags
 *    force (0 for most molecules) and only then allows more.
 *  - Explicit H nodes exist only for tagged tetrahedral centres whose
 *    `tet.order` contains 'H'. An H node must be face-adjacent to its parent
 *    and to nothing else (an H block with two heavy neighbours is refused by
 *    placement validation and the bond wand refuses H blocks), so H nodes are
 *    never part of a suppressed pair.
 *  - Tetrahedral tags: sign of V = ((p1-p0)x(p2-p0)).(p3-p0) over the tips in
 *    `tet.order` must equal `tet.sign` (V = 0 rejects).
 *  - E/Z tags: every substituent of both alkene carbons lies perpendicular to
 *    the C=C axis, all substituents are coplanar with the axis, and the two
 *    reference substituents are on the same side iff `cis`. A ref of 'H' is
 *    rewritten to the carbon's other heavy substituent with `cis` inverted
 *    (an =CH2 end carries no geometry and its tag is ignored), so Z alkenes
 *    and tri/tetrasubstituted alkenes embed with their cis pairs suppressed.
 *
 * Multi-component graphs are embedded per component and laid out 4 empty
 * cells apart along +x. Returns null when the graph is not bipartite under
 * face bonds (odd rings), when the search space is exhausted, or when the
 * node budget is hit. PURE MODULE.
 */
import { EMBED_NODE_BUDGET } from './types';
import type { ChemApi, EmbedOptions, Embedding, MoleculeGraph, Vec3 } from './types';
import { bondBetween, components, otherEnd } from './graph';
import { add, cross, dot, manhattan, sub } from '../util/vec3';

/** Embedding plus the unbonded face-adjacent heavy-atom pairs (Amendment 1). */
export interface LatticeEmbedding extends Embedding {
  /** Pairs `[a, b]` with `a < b` of heavy atoms that touch in the embedding
   *  but are not bonded in the graph; the world sets them to "no bond".
   *  Empty when the embedding is induced. Sorted ascending. */
  readonly suppressedPairs: readonly (readonly [number, number])[];
}

export interface LatticeEmbedOptions extends EmbedOptions {
  /** Allow face-adjacent unbonded heavy atoms (reported in `suppressedPairs`).
   *  Default true. With false the embedding must be induced (pre-amendment rule). */
  readonly allowSuppressedPairs?: boolean;
}

/** Same order as `FACE_DIRS` in src/world/types.ts (kept local: chem imports nothing from world). */
const FACE_DIRS: readonly Vec3[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const DIAG_DIRS: readonly Vec3[] = [
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
];

function isFaceDir(v: Vec3): boolean {
  return manhattan(v, [0, 0, 0]) === 1;
}
function isDiagDir(v: Vec3): boolean {
  return Math.abs(v[0]) <= 1 && Math.abs(v[1]) <= 1 && Math.abs(v[2]) <= 1 && manhattan(v, [0, 0, 0]) === 2;
}
function key(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

interface TetC { readonly centre: number; readonly tips: readonly number[]; readonly sign: 1 | -1 }
interface EzC {
  readonly a: number; readonly b: number;
  readonly refA: number; readonly refB: number; readonly cis: boolean;
  readonly subsA: readonly number[]; readonly subsB: readonly number[];
}

class BudgetExceeded extends Error {}

export function embedOnLattice(g: MoleculeGraph, opts: LatticeEmbedOptions = {}): LatticeEmbedding | null {
  const origin: Vec3 = opts.origin ?? [0, 0, 0];
  const budget = opts.nodeBudget ?? EMBED_NODE_BUDGET;
  const diag = opts.allowDiagonal ?? false;
  const allowSuppressed = opts.allowSuppressedPairs ?? true;
  const n = g.atoms.length;
  if (n === 0) return { pos: [], hPos: new Map(), nodesVisited: 0, suppressedPairs: [] };

  // ---- nodes: heavy atoms 0..n-1, then one H node per tagged centre with 'H'
  const hNodeOf = new Map<number, number>();
  const hParent: number[] = [];
  let nodeCount = n;
  g.atoms.forEach((a, i) => {
    if (a.tet && a.tet.order.includes('H') && !hNodeOf.has(i)) {
      hNodeOf.set(i, nodeCount);
      hParent[nodeCount] = i;
      nodeCount++;
    }
  });
  const isH = (node: number) => node >= n;

  // node adjacency (bond index for heavy pairs; -2 for H-parent links)
  const nodeNbs: number[][] = [];
  for (let i = 0; i < nodeCount; i++) nodeNbs.push([]);
  for (let i = 0; i < n; i++) for (const k of g.adj[i]!) nodeNbs[i]!.push(otherEnd(g, k, i));
  for (const [parent, h] of hNodeOf) {
    nodeNbs[parent]!.push(h);
    nodeNbs[h]!.push(parent);
  }
  const nodeDeg = nodeNbs.map((l) => l.length);
  const bondKind = (x: number, y: number): 'none' | 'face' | 'diagonal' => {
    if (isH(x) || isH(y)) {
      const h = isH(x) ? x : y;
      const other = isH(x) ? y : x;
      return hParent[h] === other ? 'face' : 'none';
    }
    const k = bondBetween(g, x, y);
    if (k === undefined) return 'none';
    return g.bonds[k]!.diagonal === true ? 'diagonal' : 'face';
  };

  // diagonal bonds need allowDiagonal; face bonds need a bipartite graph
  if (!diag && g.bonds.some((b) => b.diagonal === true)) return null;
  {
    const parity = new Array<number>(n).fill(-1);
    for (let s = 0; s < n; s++) {
      if (parity[s] !== -1) continue;
      parity[s] = 0;
      const queue = [s];
      let head = 0;
      while (head < queue.length) {
        const u = queue[head++]!;
        for (const k of g.adj[u]!) {
          const bond = g.bonds[k]!;
          const v = otherEnd(g, k, u);
          const want = bond.diagonal === true ? parity[u]! : 1 - parity[u]!;
          if (parity[v] === -1) {
            parity[v] = want;
            queue.push(v);
          } else if (parity[v] !== want) {
            return null;
          }
        }
      }
    }
  }

  // ---- stereo constraints
  const tets: TetC[] = [];
  g.atoms.forEach((a, i) => {
    if (!a.tet) return;
    const tips = a.tet.order.map((o) => (o === 'H' ? hNodeOf.get(i)! : o));
    tets.push({ centre: i, tips, sign: a.tet.sign });
  });
  const ezs: EzC[] = [];
  for (const bond of g.bonds) {
    if (!bond.ez) continue;
    const { a, b } = bond;
    let cis = bond.ez.cis;
    const heavySubs = (c: number, partner: number) => nodeNbs[c]!.filter((x) => x !== partner);
    const subsA = heavySubs(a, b);
    const subsB = heavySubs(b, a);
    let refA: number | null = null;
    let refB: number | null = null;
    if (bond.ez.refA === 'H') {
      if (subsA.length === 1) { refA = subsA[0]!; cis = !cis; }
    } else if (subsA.includes(bond.ez.refA)) refA = bond.ez.refA;
    if (bond.ez.refB === 'H') {
      if (subsB.length === 1) { refB = subsB[0]!; cis = !cis; }
    } else if (subsB.includes(bond.ez.refB)) refB = bond.ez.refB;
    if (refA === null || refB === null) continue; // no definable geometry on one end
    ezs.push({ a, b, refA, refB, cis, subsA, subsB });
  }
  const tetsOf: number[][] = [];
  const ezsOf: number[][] = [];
  for (let i = 0; i < nodeCount; i++) { tetsOf.push([]); ezsOf.push([]); }
  tets.forEach((t, idx) => {
    tetsOf[t.centre]!.push(idx);
    for (const tip of t.tips) if (!tetsOf[tip]!.includes(idx)) tetsOf[tip]!.push(idx);
  });
  ezs.forEach((e, idx) => {
    for (const node of [e.a, e.b, ...e.subsA, ...e.subsB]) if (!ezsOf[node]!.includes(idx)) ezsOf[node]!.push(idx);
  });

  // pairs forced face-adjacent by cis relations (lower bound on suppressions per component)
  const forced = new Set<string>();
  for (const e of ezs) {
    for (const x of e.subsA) {
      for (const y of e.subsB) {
        const cisPair = e.cis !== (x !== e.refA) !== (y !== e.refB);
        if (!cisPair || bondKind(x, y) !== 'none') continue;
        if (isH(x) || isH(y) || !allowSuppressed) return null;
        forced.add(x < y ? `${x},${y}` : `${y},${x}`);
      }
    }
  }

  // ---- search state
  const pos: (Vec3 | null)[] = new Array(nodeCount).fill(null);
  const occupied = new Map<string, number>();
  let nodesVisited = 0;
  const suppressed: [number, number][] = [];

  const signOf = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

  function tetOk(t: TetC, i: number, p: Vec3): boolean {
    const tips: Vec3[] = [];
    for (const tip of t.tips) {
      const tp = tip === i ? p : pos[tip];
      if (!tp) return true; // not all placed yet
      tips.push(tp);
    }
    if (tips.length !== 4) return true;
    const [p0, p1, p2, p3] = tips as [Vec3, Vec3, Vec3, Vec3];
    const v = dot(cross(sub(p1, p0), sub(p2, p0)), sub(p3, p0));
    return signOf(v) === t.sign;
  }

  function ezOk(e: EzC, i: number, p: Vec3): boolean {
    const at = (node: number): Vec3 | null => (node === i ? p : (pos[node] ?? null));
    const pa = at(e.a);
    const pb = at(e.b);
    if (!pa || !pb) return true;
    const u = sub(pb, pa);
    const vecs: Vec3[] = [];
    let va: Vec3 | null = null;
    let vb: Vec3 | null = null;
    for (const s of e.subsA) {
      const ps = at(s);
      if (!ps) continue;
      const v = sub(ps, pa);
      if (dot(v, u) !== 0) return false;
      vecs.push(v);
      if (s === e.refA) va = v;
    }
    for (const s of e.subsB) {
      const ps = at(s);
      if (!ps) continue;
      const v = sub(ps, pb);
      if (dot(v, u) !== 0) return false;
      vecs.push(v);
      if (s === e.refB) vb = v;
    }
    for (let x = 0; x < vecs.length; x++) {
      for (let y = x + 1; y < vecs.length; y++) {
        const c = cross(vecs[x]!, vecs[y]!);
        if (c[0] !== 0 || c[1] !== 0 || c[2] !== 0) return false;
      }
    }
    if (va && vb && (dot(va, vb) > 0) !== e.cis) return false;
    return true;
  }

  function feasible(i: number, p: Vec3, placed: readonly number[], maxSuppressed: number): [number, number][] | null {
    if (occupied.has(key(p))) return null;
    const newPairs: [number, number][] = [];
    for (const q of placed) {
      const pq = pos[q]!;
      const d = manhattan(p, pq);
      const kind = bondKind(i, q);
      if (kind === 'face') {
        if (d !== 1) return null;
      } else if (kind === 'diagonal') {
        if (!isDiagDir(sub(p, pq))) return null;
      } else if (d === 1) {
        if (isH(i) || isH(q) || !allowSuppressed) return null;
        if (suppressed.length + newPairs.length >= maxSuppressed) return null;
        newPairs.push(i < q ? [i, q] : [q, i]);
      }
    }
    for (const t of tetsOf[i]!) if (!tetOk(tets[t]!, i, p)) return null;
    for (const e of ezsOf[i]!) if (!ezOk(ezs[e]!, i, p)) return null;
    return newPairs;
  }

  function embedComponent(compNodes: readonly number[], maxSuppressed: number): boolean {
    // BFS order from the max-degree node (ties: lowest id); neighbours by descending degree, ties lowest id
    let start = compNodes[0]!;
    for (const v of compNodes) if (nodeDeg[v]! > nodeDeg[start]! || (nodeDeg[v] === nodeDeg[start] && v < start)) start = v;
    const order: number[] = [];
    const parent = new Map<number, number>();
    const seen = new Set<number>([start]);
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++]!;
      order.push(u);
      const nbs = [...nodeNbs[u]!].sort((x, y) => (nodeDeg[y]! - nodeDeg[x]!) || (x - y));
      for (const v of nbs) {
        if (seen.has(v)) continue;
        seen.add(v);
        parent.set(v, u);
        queue.push(v);
      }
    }
    const placed: number[] = [];

    function candidates(i: number): Vec3[] {
      const par = parent.get(i);
      if (par === undefined) return [[0, 0, 0]];
      const base = pos[par]!;
      const wantDiag = bondKind(par, i) === 'diagonal';
      const dirs = wantDiag ? DIAG_DIRS : FACE_DIRS;
      const gp = parent.get(par);
      const out: Vec3[] = [];
      if (gp !== undefined) {
        const straight = sub(base, pos[gp]!);
        if (wantDiag ? isDiagDir(straight) : isFaceDir(straight)) out.push(straight);
      }
      for (const d of dirs) if (!out.some((o) => o[0] === d[0] && o[1] === d[1] && o[2] === d[2])) out.push(d);
      return out.map((d) => add(base, d));
    }

    function place(k: number): boolean {
      nodesVisited++;
      if (nodesVisited > budget) throw new BudgetExceeded();
      if (k === order.length) return true;
      const i = order[k]!;
      const options: { p: Vec3; pairs: [number, number][] }[] = [];
      for (const p of candidates(i)) {
        const pairs = feasible(i, p, placed, maxSuppressed);
        if (pairs) options.push({ p, pairs });
      }
      options.sort((x, y) => x.pairs.length - y.pairs.length);
      for (const { p, pairs } of options) {
        pos[i] = p;
        occupied.set(key(p), i);
        placed.push(i);
        for (const pr of pairs) suppressed.push(pr);
        if (place(k + 1)) return true;
        for (let r = 0; r < pairs.length; r++) suppressed.pop();
        placed.pop();
        occupied.delete(key(p));
        pos[i] = null;
      }
      return false;
    }

    return place(0);
  }

  // ---- components
  const comps = components(g).map((heavy) => {
    const nodes = [...heavy];
    for (const a of heavy) {
      const h = hNodeOf.get(a);
      if (h !== undefined) nodes.push(h);
    }
    return nodes;
  });

  const finalPos: (Vec3 | null)[] = new Array(nodeCount).fill(null);
  const allSuppressed: [number, number][] = [];
  let prevMaxX: number | null = null;
  try {
    for (const compNodes of comps) {
      const compSet = new Set(compNodes);
      let forcedHere = 0;
      for (const f of forced) {
        const [x] = f.split(',').map(Number) as [number, number];
        if (compSet.has(x)) forcedHere++;
      }
      const levels = allowSuppressed ? [forcedHere, Infinity] : [0];
      let ok = false;
      for (const level of levels) {
        for (const v of compNodes) pos[v] = null;
        occupied.clear();
        suppressed.length = 0;
        if (embedComponent(compNodes, level)) { ok = true; break; }
      }
      if (!ok) return null;
      let minX = Infinity;
      let maxX = -Infinity;
      for (const v of compNodes) {
        const p = pos[v]!;
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
      }
      const shift: number = prevMaxX === null ? 0 : prevMaxX + 5 - minX;
      for (const v of compNodes) {
        const p = pos[v]!;
        finalPos[v] = [p[0] + shift + origin[0], p[1] + origin[1], p[2] + origin[2]];
      }
      prevMaxX = maxX + shift;
      allSuppressed.push(...suppressed);
      for (const v of compNodes) pos[v] = null;
      occupied.clear();
      suppressed.length = 0;
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) return null;
    throw e;
  }

  const heavyPos: Vec3[] = [];
  for (let i = 0; i < n; i++) heavyPos.push(finalPos[i]!);
  const hPos = new Map<number, Vec3[]>();
  for (const [parent, h] of [...hNodeOf.entries()].sort((x, y) => x[0] - y[0])) {
    hPos.set(parent, [finalPos[h]!]);
  }
  allSuppressed.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));
  return { pos: heavyPos, hPos, nodesVisited, suppressedPairs: allSuppressed };
}

const _check: Pick<ChemApi, 'embedOnLattice'> = { embedOnLattice };
void _check;
