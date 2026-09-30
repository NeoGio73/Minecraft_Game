/**
 * Weisfeiler-Lehman refinement hash (FNV-1a 64-bit) of constitution + charge.
 * PURE MODULE. See docs/design/02-chemistry-core.md section 9.
 *
 * The hash is a filter only (WL cannot separate every regular graph);
 * `findIsomorphisms` is the arbiter. Compute it on a perceived graph so both
 * Kekulé forms of an arene collide. `tet`, `ez`, `pos`, `diagonal` are ignored.
 */
import type { Atom, Bond, ChemApi, MoleculeGraph } from './types';
import { otherEnd } from './graph';

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the low byte of each char code; 16 lowercase hex chars. */
export function fnv1a64(s: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i) & 0xff);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

/** "el/H/charge/a|k", e.g. `C/3/0/k`, `N/0/1/k`, `C/1/0/a`. */
export function atomLabel(atom: Atom, hydrogens: number): string {
  return `${atom.el}/${hydrogens}/${atom.charge}/${atom.aromatic ? 'a' : 'k'}`;
}

/** "1" | "2" | "3" | "ar". */
export function bondLabel(bond: Bond): string {
  return bond.aromatic ? 'ar' : String(bond.order);
}

export function wlHash(g: MoleculeGraph, hydrogens: readonly number[]): { hash: string; classes: number[] } {
  const n = g.atoms.length;
  let labels: string[] = g.atoms.map((a, i) => atomLabel(a, hydrogens[i] ?? 0));
  let distinct = new Set(labels).size;
  for (let round = 0; round < n; round++) {
    const next: string[] = [];
    for (let i = 0; i < n; i++) {
      const parts = g.adj[i]!.map((k) => `${bondLabel(g.bonds[k]!)}:${labels[otherEnd(g, k, i)]}`).sort();
      next.push(fnv1a64(`${labels[i]}|${parts.join('|')}`));
    }
    const d2 = new Set(next).size;
    labels = next;
    if (d2 === distinct) break;
    distinct = d2;
  }
  const hash = fnv1a64(`${n}|${g.bonds.length}|${[...labels].sort().join('|')}`);
  const sortedDistinct = [...new Set(labels)].sort();
  const index = new Map<string, number>();
  sortedDistinct.forEach((l, i) => index.set(l, i));
  const classes = labels.map((l) => index.get(l)!);
  return { hash, classes };
}

const _check: Pick<ChemApi, 'wlHash'> = { wlHash };
void _check;
