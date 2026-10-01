/**
 * CIP priority ranking by Rule 1a (atomic number) over the hierarchical
 * digraph — McMurry 5.5 Rules 1–3 (atomic number; first point of difference
 * exploring outward; multiple bonds as duplicated atoms).
 * PURE MODULE. Line-by-line port of `tools/reference/cipref.py`; see
 * docs/design/03-stereo-acidity-hybridization.md section 1.
 *
 * Rules 2–5 (isotopes, Z/E, like/unlike, r/s) are not implemented; the
 * engine detects when they would decide and reports `tieNeedsAdvancedRules`.
 * Phantom atoms (Z = 0) are never materialised: a duplicate node and a
 * hydrogen node have no children, and every comparison pads the shorter list
 * with Z = 0 (IUPAC P-92.1.4).
 */
import { ATOMIC_NUMBER } from './types';
import type { ChemApi, CipRank, MoleculeGraph } from './types';
import { otherEnd } from './graph';

/** Nodes in one sphere list before `compareLigands` gives up (cipref.py used
 *  200; neither is reachable at <= 30 heavy atoms). */
export const CIP_SPHERE_CAP = 500;

/** Node of the hierarchical digraph. */
export interface DNode {
  /** -1 = hydrogen node (implicit or collapsed explicit H). */
  readonly atom: number;
  /** Duplicate atom (multiple-bond or ring-closure duplicate). */
  readonly dup: boolean;
  readonly parent: DNode | null;
  /** ATOMIC_NUMBER[el]; 1 for a hydrogen node. */
  readonly Z: number;
  /** Memo key: parent.path + '>' + atom + (dup ? 'd' : 'r'); root = '' + centre + 'r'. */
  readonly path: string;
}

/** Per-`cipRank`-call context (one memo per call). */
export interface CipCtx {
  readonly g: MoleculeGraph;
  readonly hydrogens: readonly number[];
  /** E/Z: the partner across the double bond, dropped from the ROOT only. */
  readonly exclude: number | undefined;
  readonly memo: Map<string, -1 | 0 | 1>;
  /** Sorted child lists by node path (children depend only on the path). */
  readonly kids: Map<string, readonly DNode[]>;
  capHit: boolean;
}

/** `cipRank` returns CipRank plus `capHit` (assignable to CipRank). */
export type CipRankResult = CipRank & { readonly capHit: boolean };

function makeCtx(g: MoleculeGraph, hydrogens: readonly number[], exclude: number | undefined): CipCtx {
  return { g, hydrogens, exclude, memo: new Map(), kids: new Map(), capHit: false };
}

function zOf(g: MoleculeGraph, atom: number): number {
  return atom === -1 ? 1 : ATOMIC_NUMBER[g.atoms[atom]!.el];
}

function node(g: MoleculeGraph, atom: number, parent: DNode | null, dup: boolean): DNode {
  const path = `${parent ? parent.path + '>' : ''}${atom}${dup ? 'd' : 'r'}`;
  return { atom, dup, parent, Z: zOf(g, atom), path };
}

/**
 * Substituents of a node in the digraph (03 section 1.2): the bond back to
 * the parent contributes only its multiplicity duplicates; a bond to an
 * ancestor (ring closure) contributes one duplicate; every other bond
 * contributes one real node plus `order - 1` duplicates; then one hydrogen
 * node per hydrogen. Duplicate and hydrogen nodes have no children.
 */
function children(ctx: CipCtx, n: DNode): DNode[] {
  if (n.dup || n.atom === -1) return [];
  const { g } = ctx;
  const i = n.atom;
  const ancestors = new Set<number>();
  for (let p: DNode | null = n; p !== null; p = p.parent) if (!p.dup) ancestors.add(p.atom);
  const kids: DNode[] = [];
  for (const bi of g.adj[i]!) {
    const bond = g.bonds[bi]!;
    const j = otherEnd(g, bi, i);
    const o = bond.order;
    if (n.parent === null && j === ctx.exclude) continue;
    if (n.parent !== null && j === n.parent.atom && !n.parent.dup) {
      for (let k = 1; k < o; k++) kids.push(node(g, j, n, true));
      continue;
    }
    kids.push(node(g, j, n, ancestors.has(j)));
    for (let k = 1; k < o; k++) kids.push(node(g, j, n, true));
  }
  const nH = ctx.hydrogens[i] ?? 0;
  for (let k = 0; k < nH; k++) kids.push(node(g, -1, n, false));
  return kids;
}

/** Children sorted best-first by the FULL recursive compare, memoised by path. */
function sortedChildren(ctx: CipCtx, n: DNode): readonly DNode[] {
  const hit = ctx.kids.get(n.path);
  if (hit) return hit;
  const kids = children(ctx, n).sort((p, q) => -compareLigands(ctx, p, q));
  ctx.kids.set(n.path, kids);
  return kids;
}

function memo(ctx: CipCtx, key: string, r: -1 | 0 | 1): -1 | 0 | 1 {
  ctx.memo.set(key, r);
  return r;
}

/**
 * Rule 1a hierarchical comparison of two ligand nodes (03 section 1.3).
 * +1 when `a` ranks higher, -1 when `b` does, 0 when indistinguishable by
 * Rule 1a (constitutionally identical) or when the sphere cap was hit.
 * The comparator is a total preorder, so `Array.prototype.sort` is safe.
 */
export function compareLigands(ctx: CipCtx, a: DNode, b: DNode): -1 | 0 | 1 {
  const key = `${a.path}|${b.path}`;
  const hit = ctx.memo.get(key);
  if (hit !== undefined) return hit;
  let la: readonly DNode[] = [a];
  let lb: readonly DNode[] = [b];
  for (;;) {
    // (1) this sphere in hierarchical order, phantom padding
    const n = Math.max(la.length, lb.length);
    for (let k = 0; k < n; k++) {
      const za = la[k]?.Z ?? 0;
      const zb = lb[k]?.Z ?? 0;
      if (za !== zb) return memo(ctx, key, za > zb ? 1 : -1);
    }
    // (2) expand every node; each child set sorted best-first by the full compare
    const ca = la.map((x) => sortedChildren(ctx, x));
    const cb = lb.map((x) => sortedChildren(ctx, x));
    // (3) compare child sets parent by parent (aligned: step 1 passed => equal lengths)
    for (let k = 0; k < la.length; k++) {
      const sa = ca[k]!;
      const sb = cb[k]!;
      const m = Math.max(sa.length, sb.length);
      for (let t = 0; t < m; t++) {
        const za = sa[t]?.Z ?? 0;
        const zb = sb[t]?.Z ?? 0;
        if (za !== zb) return memo(ctx, key, za > zb ? 1 : -1);
      }
    }
    la = ca.flat();
    lb = cb.flat();
    if (la.length === 0 && lb.length === 0) return memo(ctx, key, 0);
    if (la.length > CIP_SPHERE_CAP || lb.length > CIP_SPHERE_CAP) {
      ctx.capHit = true;
      return memo(ctx, key, 0);
    }
  }
}

interface BasicRank {
  readonly ligs: readonly DNode[];
  readonly tie: boolean;
  readonly ctx: CipCtx;
}

/** Steps 1–3 of `cipRank` (no advanced-rule detection, hence no recursion). */
function cipRankBasic(g: MoleculeGraph, hydrogens: readonly number[], center: number, exclude: number | undefined): BasicRank {
  const ctx = makeCtx(g, hydrogens, exclude);
  const root = node(g, center, null, false);
  const ligs = sortedChildren(ctx, root);
  let tie = false;
  for (let i = 0; i + 1 < ligs.length; i++) {
    if (compareLigands(ctx, ligs[i]!, ligs[i + 1]!) === 0) {
      tie = true;
      break;
    }
  }
  return { ligs, tie, ctx };
}

function piOf(g: MoleculeGraph, atom: number): number {
  let pi = 0;
  for (const k of g.adj[atom]!) pi += g.bonds[k]!.order - 1;
  return pi;
}

/** A carbon that Rule 1a alone makes a chirality centre. */
function isRule1aCenter(g: MoleculeGraph, hydrogens: readonly number[], a: number): boolean {
  const atom = g.atoms[a]!;
  const nH = hydrogens[a] ?? 0;
  if (atom.el !== 'C' || piOf(g, a) !== 0 || g.adj[a]!.length + nH !== 4 || nH > 1) return false;
  return !cipRankBasic(g, hydrogens, a, undefined).tie;
}

/** A non-aromatic C=C whose ends each carry two Rule-1a-distinct ligands. */
function isRule1aAlkene(g: MoleculeGraph, hydrogens: readonly number[], bondIndex: number): boolean {
  const bond = g.bonds[bondIndex]!;
  if (bond.order !== 2 || bond.aromatic) return false;
  const A = g.atoms[bond.a]!;
  const B = g.atoms[bond.b]!;
  if (A.el !== 'C' || B.el !== 'C' || A.aromatic || B.aromatic) return false;
  for (const [end, other] of [[bond.a, bond.b], [bond.b, bond.a]] as const) {
    const r = cipRankBasic(g, hydrogens, end, other);
    if (r.ligs.length !== 2 || r.tie) return false;
  }
  return true;
}

/**
 * true iff the part of the graph reachable from ligand `p` without passing
 * through `center` (or `exclude`) contains a stereo element: a Rule-1a
 * chirality centre or a C=C with two Rule-1a-distinct ligands on each end.
 */
function subtreeHasStereoElement(ctx: CipCtx, center: number, p: DNode): boolean {
  if (p.atom === -1) return false;
  const { g, hydrogens } = ctx;
  const blocked = new Set<number>([center]);
  if (ctx.exclude !== undefined) blocked.add(ctx.exclude);
  if (blocked.has(p.atom)) return false;
  const seen = new Set<number>([p.atom]);
  const queue = [p.atom];
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++]!;
    for (const k of g.adj[u]!) {
      const v = otherEnd(g, k, u);
      if (blocked.has(v) || seen.has(v)) continue;
      seen.add(v);
      queue.push(v);
    }
  }
  for (const a of seen) if (isRule1aCenter(g, hydrogens, a)) return true;
  for (let k = 0; k < g.bonds.length; k++) {
    const b = g.bonds[k]!;
    if (seen.has(b.a) && seen.has(b.b) && isRule1aAlkene(g, hydrogens, k)) return true;
  }
  return false;
}

/**
 * Ranks the ligands of `center` best-first (03 section 1.4). `exclude`
 * drops the partner across a double bond (E/Z ends). `ligands` has one entry
 * per digraph child of the root, so a centre with a multiple bond lists its
 * partner twice (`assignRS` requires pi === 0 and never sees that).
 */
export function cipRank(g: MoleculeGraph, hydrogens: readonly number[], center: number, exclude?: number): CipRankResult {
  if (!Number.isInteger(center) || center < 0 || center >= g.atoms.length) throw new RangeError(`no atom ${center}`);
  const { ligs, tie, ctx } = cipRankBasic(g, hydrogens, center, exclude);
  let tieNeedsAdvancedRules = false;
  if (tie) {
    for (let i = 0; i + 1 < ligs.length && !tieNeedsAdvancedRules; i++) {
      const p = ligs[i]!;
      const q = ligs[i + 1]!;
      if (compareLigands(ctx, p, q) !== 0) continue;
      if (subtreeHasStereoElement(ctx, center, p) || subtreeHasStereoElement(ctx, center, q)) tieNeedsAdvancedRules = true;
    }
  }
  return {
    ligands: ligs.map((n) => (n.atom === -1 ? 'H' : n.atom)),
    tie,
    tieNeedsAdvancedRules,
    capHit: ctx.capHit,
  };
}

const _check: Pick<ChemApi, 'cipRank'> = { cipRank };
void _check;
