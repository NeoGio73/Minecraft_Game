/**
 * Element counts, Hill formula, degrees of unsaturation, ring and pi counts.
 * PURE MODULE. See docs/design/02-chemistry-core.md section 8.
 */
import { ELEMENTS } from './types';
import type { ChemApi, Element, MoleculeGraph } from './types';
import { components } from './graph';

/** Per-element atom counts; every one of the 10 keys is present. `H` is the
 *  sum of `hydrogens` (plus one per atom of element H, which never occurs). */
export function elementCounts(g: MoleculeGraph, hydrogens: readonly number[]): Record<Element, number> {
  const counts = {} as Record<Element, number>;
  for (const el of ELEMENTS) counts[el] = 0;
  g.atoms.forEach((a, i) => {
    counts[a.el] += 1;
    counts.H += hydrogens[i] ?? 0;
  });
  return counts;
}

/** Sum of formal charges. */
export function netCharge(g: MoleculeGraph): number {
  let q = 0;
  for (const a of g.atoms) q += a.charge;
  return q;
}

/** Alphabetical symbol order used after C/H (RDKit CalcMolFormula order). */
const OTHERS: readonly Element[] = ['Br', 'Cl', 'F', 'I', 'N', 'O', 'P', 'S'];

function part(el: Element, count: number): string {
  return count === 1 ? el : `${el}${count}`;
}

export function chargeSuffix(q: number): string {
  if (q === 0) return '';
  const sign = q > 0 ? '+' : '-';
  const mag = Math.abs(q);
  return mag === 1 ? sign : `${mag}${sign}`;
}

/** Hill formula: C, H, then alphabetical; H first when there is no carbon;
 *  net charge appended as `+`, `-`, `2-`... when non-zero. */
export function hillFormula(g: MoleculeGraph, hydrogens: readonly number[]): string {
  const counts = elementCounts(g, hydrogens);
  const parts: string[] = [];
  if (counts.C > 0) parts.push(part('C', counts.C));
  if (counts.H > 0) parts.push(part('H', counts.H));
  for (const el of OTHERS) if (counts[el] > 0) parts.push(part(el, counts[el]));
  return parts.join('') + chargeSuffix(netCharge(g));
}

/** (2C + 2 + N - H - X) / 2 with X = F + Cl + Br + I; O, S, P and charge ignored. */
export function degreesOfUnsaturation(counts: Readonly<Record<Element, number>>): number {
  const x = counts.F + counts.Cl + counts.Br + counts.I;
  return (2 * counts.C + 2 + counts.N - counts.H - x) / 2;
}

/** bonds - atoms + components. */
export function ringCount(g: MoleculeGraph): number {
  if (g.atoms.length === 0) return 0;
  return g.bonds.length - g.atoms.length + components(g).length;
}

/** Sum of (order - 1) over bonds; equals dou - ringCount for neutral molecules. */
export function piBondCount(g: MoleculeGraph): number {
  let p = 0;
  for (const b of g.bonds) p += b.order - 1;
  return p;
}

const _check: Pick<ChemApi, 'hillFormula' | 'elementCounts' | 'degreesOfUnsaturation' | 'ringCount'> = {
  hillFormula, elementCounts, degreesOfUnsaturation, ringCount,
};
void _check;
