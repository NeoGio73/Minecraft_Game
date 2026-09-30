/**
 * Molecule graph construction, queries and immutable edits.
 * PURE MODULE. See docs/design/02-chemistry-core.md section 3.
 *
 * Invariants enforced by `buildGraph`: atom ids are dense and equal their
 * index; every bond has `a < b`; no duplicate or self bonds; `adj[i]` lists
 * bond indices in ascending order. A diagonal bond is treated exactly like a
 * face bond by every algorithm here (only `embed.ts` looks at the flag).
 */
import type { Atom, Bond, BondOrder, Charge, EzTag, MoleculeGraph, TetTag } from './types';

/** Bond as accepted by `buildGraph` / `withBond` (endpoints in any order). */
export interface BondInput {
  readonly a: number;
  readonly b: number;
  readonly order: BondOrder;
  readonly aromatic?: boolean;
  readonly diagonal?: boolean;
  readonly ez?: EzTag;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Builds a graph from atoms (ids must equal their index) and bonds. Endpoints
 * are sorted so `a < b` (swapping `ez.refA`/`ez.refB` when needed); bond
 * indices keep the input order. Throws `Error` on structural misuse.
 */
export function buildGraph<A extends Atom>(atoms: readonly A[], bonds: readonly BondInput[]): MoleculeGraph<A> {
  const n = atoms.length;
  for (let i = 0; i < n; i++) {
    if (atoms[i]!.id !== i) throw new Error('atom ids must be dense and in order');
  }
  const out: Bond[] = [];
  const seen = new Set<string>();
  for (const input of bonds) {
    let { a, b } = input;
    let ez = input.ez;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= n || b >= n || a === b) {
      throw new Error('bad bond endpoints');
    }
    if (a > b) {
      [a, b] = [b, a];
      if (ez) ez = { refA: ez.refB, refB: ez.refA, cis: ez.cis };
    }
    const key = `${a},${b}`;
    if (seen.has(key)) throw new Error('duplicate bond');
    seen.add(key);
    const bond: Bond = {
      a,
      b,
      order: input.order,
      aromatic: input.aromatic ?? false,
      ...(input.diagonal === true ? { diagonal: true } : {}),
      ...(ez ? { ez } : {}),
    };
    out.push(bond);
  }
  const adj: number[][] = [];
  for (let i = 0; i < n; i++) adj.push([]);
  out.forEach((bond, k) => {
    adj[bond.a]!.push(k);
    adj[bond.b]!.push(k);
  });
  return { atoms, bonds: out, adj };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function checkAtom(g: MoleculeGraph, id: number): void {
  if (!Number.isInteger(id) || id < 0 || id >= g.atoms.length) throw new RangeError(`no atom ${id}`);
}

function checkBond(g: MoleculeGraph, k: number): void {
  if (!Number.isInteger(k) || k < 0 || k >= g.bonds.length) throw new RangeError(`no bond ${k}`);
}

/** Other endpoint of bond `k` seen from atom `id`. */
export function otherEnd(g: MoleculeGraph, k: number, id: number): number {
  const bond = g.bonds[k]!;
  return bond.a === id ? bond.b : bond.a;
}

/** Neighbour ids of `id` in `adj` order. */
export function neighborsOf(g: MoleculeGraph, id: number): number[] {
  checkAtom(g, id);
  return g.adj[id]!.map((k) => otherEnd(g, k, id));
}

/** Index of the bond joining `a` and `b`, or undefined. */
export function bondBetween(g: MoleculeGraph, a: number, b: number): number | undefined {
  if (a < 0 || b < 0 || a >= g.atoms.length || b >= g.atoms.length || a === b) return undefined;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (const k of g.adj[lo]!) {
    const bond = g.bonds[k]!;
    if (bond.a === lo && bond.b === hi) return k;
  }
  return undefined;
}

/** Heavy-atom degree = number of bonds on the atom. */
export function degree(g: MoleculeGraph, id: number): number {
  checkAtom(g, id);
  return g.adj[id]!.length;
}

/** Sum of Kekulé bond orders on the atom (aromatic flags ignored). */
export function bondOrderSum(g: MoleculeGraph, id: number): number {
  checkAtom(g, id);
  let s = 0;
  for (const k of g.adj[id]!) s += g.bonds[k]!.order;
  return s;
}

/** Connected components: each sorted ascending, ordered by smallest atom id. */
export function components(g: MoleculeGraph): number[][] {
  const n = g.atoms.length;
  const visited = new Array<boolean>(n).fill(false);
  const out: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    visited[s] = true;
    const comp: number[] = [];
    const queue = [s];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++]!;
      comp.push(u);
      for (const k of g.adj[u]!) {
        const v = otherEnd(g, k, u);
        if (!visited[v]) {
          visited[v] = true;
          queue.push(v);
        }
      }
    }
    comp.sort((x, y) => x - y);
    out.push(comp);
  }
  return out;
}

/**
 * The smallest ring through every bond (size <= maxSize), deduplicated by
 * atom set, sorted by (size, ascending-id key). Ring atoms are in path order
 * starting at the bond's lower endpoint and ending at its upper endpoint.
 */
export function smallestRings(g: MoleculeGraph, maxSize = 8): number[][] {
  const found = new Map<string, number[]>();
  const n = g.atoms.length;
  for (let k = 0; k < g.bonds.length; k++) {
    const { a, b } = g.bonds[k]!;
    const parent = new Array<number>(n).fill(-1);
    const visited = new Array<boolean>(n).fill(false);
    visited[a] = true;
    const queue = [a];
    let head = 0;
    let reached = false;
    while (head < queue.length && !reached) {
      const u = queue[head++]!;
      for (const kk of g.adj[u]!) {
        if (kk === k) continue;
        const v = otherEnd(g, kk, u);
        if (visited[v]) continue;
        visited[v] = true;
        parent[v] = u;
        if (v === b) {
          reached = true;
          break;
        }
        queue.push(v);
      }
    }
    if (!reached) continue;
    const path: number[] = [];
    for (let v = b; v !== -1; v = parent[v]!) path.push(v);
    path.reverse(); // a ... b
    if (path.length > maxSize) continue;
    const key = [...path].sort((x, y) => x - y).join(',');
    if (!found.has(key)) found.set(key, path);
  }
  const rings = [...found.entries()];
  rings.sort((x, y) => (x[1].length - y[1].length) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return rings.map((e) => e[1]);
}

/** Smallest rings containing both `a` and `b`. */
export function ringsThrough(g: MoleculeGraph, a: number, b: number): number[][] {
  return smallestRings(g).filter((r) => r.includes(a) && r.includes(b));
}

// ---------------------------------------------------------------------------
// Immutable edits (every edit rebuilds adj through buildGraph)
// ---------------------------------------------------------------------------

/** Appends an atom with `id = atoms.length`. */
export function withAtom(g: MoleculeGraph, atom: Omit<Atom, 'id'>): MoleculeGraph {
  const atoms: Atom[] = [...g.atoms, { ...atom, id: g.atoms.length }];
  return buildGraph(atoms, g.bonds);
}

function renumberRef(ref: number | 'H', removed: number): number | 'H' | null {
  if (ref === 'H') return ref;
  if (ref === removed) return null;
  return ref > removed ? ref - 1 : ref;
}

/**
 * Removes atom `id` and every bond on it. Ids above `id` decrease by one in
 * atoms, bonds, `tet.order` and `ez` refs; a tag that referenced the removed
 * atom is dropped; bond indices are compacted.
 */
export function withoutAtom(g: MoleculeGraph, id: number): MoleculeGraph {
  checkAtom(g, id);
  const atoms: Atom[] = [];
  g.atoms.forEach((a, i) => {
    if (i === id) return;
    const newId = i > id ? i - 1 : i;
    let tet: TetTag | undefined;
    if (a.tet) {
      const order: (number | 'H')[] = [];
      let dropped = false;
      for (const o of a.tet.order) {
        const r = renumberRef(o, id);
        if (r === null) { dropped = true; break; }
        order.push(r);
      }
      tet = dropped ? undefined : { order, sign: a.tet.sign };
    }
    const { tet: _oldTet, ...rest } = a;
    void _oldTet;
    atoms.push(tet ? { ...rest, id: newId, tet } : { ...rest, id: newId });
  });
  const bonds: BondInput[] = [];
  for (const bond of g.bonds) {
    if (bond.a === id || bond.b === id) continue;
    const a = bond.a > id ? bond.a - 1 : bond.a;
    const b = bond.b > id ? bond.b - 1 : bond.b;
    let ez: EzTag | undefined;
    if (bond.ez) {
      const refA = renumberRef(bond.ez.refA, id);
      const refB = renumberRef(bond.ez.refB, id);
      ez = refA === null || refB === null ? undefined : { refA, refB, cis: bond.ez.cis };
    }
    bonds.push({
      a, b, order: bond.order, aromatic: bond.aromatic,
      ...(bond.diagonal === true ? { diagonal: true } : {}),
      ...(ez ? { ez } : {}),
    });
  }
  return buildGraph(atoms, bonds);
}

/** Appends a bond; `Error` when the atoms are already bonded. */
export function withBond(
  g: MoleculeGraph, a: number, b: number, order: BondOrder,
  extra?: { readonly diagonal?: boolean; readonly ez?: EzTag; readonly aromatic?: boolean },
): MoleculeGraph {
  checkAtom(g, a);
  checkAtom(g, b);
  if (bondBetween(g, a, b) !== undefined) throw new Error('duplicate bond');
  const bond: BondInput = {
    a, b, order, aromatic: extra?.aromatic ?? false,
    ...(extra?.diagonal === true ? { diagonal: true } : {}),
    ...(extra?.ez ? { ez: extra.ez } : {}),
  };
  return buildGraph(g.atoms, [...g.bonds, bond]);
}

/** Removes bond `k`; later bond indices decrease by one. */
export function withoutBond(g: MoleculeGraph, k: number): MoleculeGraph {
  checkBond(g, k);
  return buildGraph(g.atoms, g.bonds.filter((_, i) => i !== k));
}

/** Replaces the Kekulé order of bond `k`; `aromatic` and `ez` are kept. */
export function withBondOrder(g: MoleculeGraph, k: number, order: BondOrder): MoleculeGraph {
  checkBond(g, k);
  const bonds = g.bonds.map((b, i) => (i === k ? { ...b, order } : b));
  return buildGraph(g.atoms, bonds);
}

/**
 * Unchecked immutable charge replacement (00-contracts 8.1). Not part of
 * ChemApi; only `charge.ts` (validating `withCharge`) may import it.
 * Throws RangeError when `id` is not an atom index of `g`.
 */
export function setCharge(g: MoleculeGraph, id: number, q: Charge): MoleculeGraph {
  checkAtom(g, id);
  const atoms = g.atoms.map((a, i) => (i === id ? { ...a, charge: q } : a));
  return buildGraph(atoms, g.bonds);
}

/** Sets (or removes with `undefined`) the tetrahedral tag of an atom. */
export function withTet(g: MoleculeGraph, atom: number, tet: TetTag | undefined): MoleculeGraph {
  checkAtom(g, atom);
  const atoms = g.atoms.map((a, i) => {
    if (i !== atom) return a;
    const { tet: _old, ...rest } = a;
    void _old;
    return tet ? { ...rest, tet } : rest;
  });
  return buildGraph(atoms, g.bonds);
}

/** Sets (or removes with `undefined`) the E/Z tag of a bond. */
export function withEz(g: MoleculeGraph, bondIndex: number, ez: EzTag | undefined): MoleculeGraph {
  checkBond(g, bondIndex);
  const bonds: BondInput[] = g.bonds.map((b, i) => {
    if (i !== bondIndex) return b;
    const { ez: _old, ...rest } = b;
    void _old;
    return ez ? { ...rest, ez } : rest;
  });
  return buildGraph(g.atoms, bonds);
}

/** Same constitution with every `tet` and every `ez` removed. */
export function withoutStereoTags(g: MoleculeGraph): MoleculeGraph {
  const atoms = g.atoms.map((a) => {
    if (!a.tet) return a;
    const { tet: _old, ...rest } = a;
    void _old;
    return rest;
  });
  const bonds: BondInput[] = g.bonds.map((b) => {
    if (!b.ez) return b;
    const { ez: _old, ...rest } = b;
    void _old;
    return rest;
  });
  return buildGraph(atoms, bonds);
}
