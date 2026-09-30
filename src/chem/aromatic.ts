/**
 * Six-ring aromaticity perception on Kekulé graphs (DESIGN-draft 4.6,
 * docs/design/02-chemistry-core.md section 7). PURE MODULE.
 *
 * Applied identically to targets and student graphs so both Kekulé forms of
 * an arene hash and compare equal. Kekulé orders are never touched; only the
 * `aromatic` flags change. `pos`, `hPos`, `tet`, `ez`, `diagonal` are kept.
 */
import type { Atom, ChemApi, MoleculeGraph } from './types';
import { buildGraph, otherEnd } from './graph';
import type { BondInput } from './graph';

/** Simple 6-cycles in cycle order, each starting at its smallest atom id,
 *  deduplicated by atom set, sorted by smallest atom id then key. */
function sixCycles(g: MoleculeGraph): number[][] {
  const n = g.atoms.length;
  const nb: number[][] = [];
  for (let i = 0; i < n; i++) nb.push(g.adj[i]!.map((k) => otherEnd(g, k, i)));
  const found = new Map<string, number[]>();
  const path: number[] = [];
  function dfs(start: number, cur: number): void {
    if (path.length === 6) {
      if (nb[cur]!.includes(start)) {
        const key = [...path].sort((x, y) => x - y).join(',');
        if (!found.has(key)) found.set(key, [...path]);
      }
      return;
    }
    for (const j of nb[cur]!) {
      if (j > start && !path.includes(j)) {
        path.push(j);
        dfs(start, j);
        path.pop();
      }
    }
  }
  for (let s = 0; s < n; s++) {
    path.length = 0;
    path.push(s);
    dfs(s, s);
  }
  const cycles = [...found.values()];
  cycles.sort((x, y) => (x[0]! - y[0]!) || (x.join(',') < y.join(',') ? -1 : 1));
  return cycles;
}

function bondKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/** Aromatic six-cycles of a Kekulé graph (the rule of section 7, steps 2-4). */
function aromaticCycles(g: MoleculeGraph): number[][] {
  const n = g.atoms.length;
  const doublePartner = new Array<number>(n).fill(-1);
  const doubleCount = new Array<number>(n).fill(0);
  const tripleCount = new Array<number>(n).fill(0);
  for (const bond of g.bonds) {
    if (bond.order === 2) {
      doubleCount[bond.a]!++;
      doubleCount[bond.b]!++;
      doublePartner[bond.a] = bond.b;
      doublePartner[bond.b] = bond.a;
    } else if (bond.order === 3) {
      tripleCount[bond.a]!++;
      tripleCount[bond.b]!++;
    }
  }
  const cycles = sixCycles(g);
  const candidates: { atoms: number[]; set: Set<number>; bonds: Set<string> }[] = [];
  for (const cyc of cycles) {
    const ok = cyc.every((i) => {
      const el = g.atoms[i]!.el;
      return (el === 'C' || el === 'N') && doubleCount[i] === 1 && tripleCount[i] === 0;
    });
    if (!ok) continue;
    const bondsOf = new Set<string>();
    for (let k = 0; k < 6; k++) bondsOf.add(bondKey(cyc[k]!, cyc[(k + 1) % 6]!));
    candidates.push({ atoms: cyc, set: new Set(cyc), bonds: bondsOf });
  }
  const out: number[][] = [];
  for (const c of candidates) {
    const aromatic = c.atoms.every((i) => {
      const p = doublePartner[i]!;
      if (c.set.has(p)) return true;
      return candidates.some((d) => d !== c && d.set.has(p) && [...d.bonds].some((bk) => c.bonds.has(bk)));
    });
    if (aromatic) out.push(c.atoms);
  }
  return out;
}

/** Returns a copy with `aromatic` recomputed on atoms and bonds. */
export function perceiveAromaticity<A extends Atom>(g: MoleculeGraph<A>): MoleculeGraph<A> {
  const rings = aromaticCycles(g);
  const aromaticAtoms = new Set<number>();
  const aromaticBonds = new Set<string>();
  for (const r of rings) {
    for (let k = 0; k < 6; k++) {
      aromaticAtoms.add(r[k]!);
      aromaticBonds.add(bondKey(r[k]!, r[(k + 1) % 6]!));
    }
  }
  const atoms: A[] = g.atoms.map((a) => ({ ...a, aromatic: aromaticAtoms.has(a.id) }));
  const bonds: BondInput[] = g.bonds.map((b) => ({ ...b, aromatic: aromaticBonds.has(bondKey(b.a, b.b)) }));
  return buildGraph(atoms, bonds);
}

/** Six-cycles (atoms in cycle order, sorted by smallest atom id) that
 *  `perceiveAromaticity` marks aromatic. Call on a perceived graph. */
export function aromaticRings(g: MoleculeGraph): number[][] {
  return aromaticCycles(g);
}

const _check: Pick<ChemApi, 'perceiveAromaticity'> = { perceiveAromaticity };
void _check;
