/**
 * Implicit hydrogen counts from target valence minus heavy bond-order sum.
 * PURE MODULE. See docs/design/02-chemistry-core.md section 4.
 *
 * The count is the TOTAL hydrogen count of the atom (implicit + collapsed
 * explicit H blocks): extracted world graphs carry no H-block bonds, so the
 * heavy bond-order sum alone decides. Chemistry never throws; valence
 * problems become warnings.
 */
import type { ChemApi, MoleculeGraph, Warning } from './types';
import { bondOrderSum } from './graph';
import { targetValence } from './valence';

export function implicitHydrogens(g: MoleculeGraph): { hydrogens: number[]; warnings: Warning[] } {
  const hydrogens: number[] = [];
  const warnings: Warning[] = [];
  for (let i = 0; i < g.atoms.length; i++) {
    const atom = g.atoms[i]!;
    const s = bondOrderSum(g, i);
    const tv = targetValence(atom.el, atom.charge);
    if (tv === undefined) {
      hydrogens.push(0);
      warnings.push({ kind: 'charge-unsupported', atom: i, charge: atom.charge });
      continue;
    }
    if (atom.explicitH !== null) {
      hydrogens.push(atom.explicitH);
      if (s + atom.explicitH > tv) warnings.push({ kind: 'over-valence', atom: i, have: s + atom.explicitH, max: tv });
      continue;
    }
    if (s > tv) {
      hydrogens.push(0);
      warnings.push({ kind: 'over-valence', atom: i, have: s, max: tv });
    } else {
      hydrogens.push(tv - s);
    }
  }
  return { hydrogens, warnings };
}

const _check: Pick<ChemApi, 'implicitHydrogens'> = { implicitHydrogens };
void _check;
