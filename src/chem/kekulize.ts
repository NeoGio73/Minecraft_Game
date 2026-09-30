/**
 * Kekulization of aromatic (lowercase-SMILES) atoms by perfect matching.
 * PURE MODULE. See docs/design/02-chemistry-core.md section 6.
 */
import { SmilesError } from './types';
import type { MoleculeGraph } from './types';
import { buildGraph, otherEnd } from './graph';
import type { BondInput } from './graph';
import { targetValence } from './valence';

/**
 * Assigns Kekulé orders (1/2) to aromatic bonds. Aromatic flags on atoms and
 * bonds are kept (perception recomputes them). Throws
 * `SmilesError('cannot kekulize', '', atomId)` when no perfect matching of
 * the needy atoms exists; the parser maps `atomId` to a character offset.
 */
export function kekulize(g: MoleculeGraph): MoleculeGraph {
  const n = g.atoms.length;
  const aromaticAtoms: number[] = [];
  for (let i = 0; i < n; i++) if (g.atoms[i]!.aromatic) aromaticAtoms.push(i);
  if (aromaticAtoms.length === 0) return g;

  const needy = new Array<boolean>(n).fill(false);
  for (const i of aromaticAtoms) {
    const atom = g.atoms[i]!;
    const tv = targetValence(atom.el, atom.charge);
    if (tv === undefined) continue;
    let nonAromaticSum = 0;
    let aromaticCount = 0;
    for (const k of g.adj[i]!) {
      const bond = g.bonds[k]!;
      if (bond.aromatic) aromaticCount++;
      else nonAromaticSum += bond.order;
    }
    const deficit = tv - nonAromaticSum - aromaticCount - (atom.explicitH ?? 0);
    if (deficit >= 1) needy[i] = true;
  }

  const candidateOn: number[][] = [];
  for (let i = 0; i < n; i++) candidateOn.push([]);
  g.bonds.forEach((bond, k) => {
    if (bond.aromatic && needy[bond.a] && needy[bond.b]) {
      candidateOn[bond.a]!.push(k);
      candidateOn[bond.b]!.push(k);
    }
  });

  const matched = new Array<boolean>(n).fill(false);
  const matchedBonds = new Set<number>();
  const needyIds: number[] = [];
  for (let i = 0; i < n; i++) if (needy[i]) needyIds.push(i);

  function rec(): boolean {
    let i = -1;
    for (const id of needyIds) {
      if (!matched[id]) { i = id; break; }
    }
    if (i === -1) return true;
    for (const k of candidateOn[i]!) {
      const j = otherEnd(g, k, i);
      if (matched[j]) continue;
      matched[i] = true;
      matched[j] = true;
      matchedBonds.add(k);
      if (rec()) return true;
      matched[i] = false;
      matched[j] = false;
      matchedBonds.delete(k);
    }
    return false;
  }

  if (!rec()) {
    throw new SmilesError('cannot kekulize', '', needyIds[0] ?? aromaticAtoms[0]!);
  }

  const bonds: BondInput[] = g.bonds.map((bond, k) => {
    if (!bond.aromatic) return bond;
    return { ...bond, order: matchedBonds.has(k) ? 2 : 1 };
  });
  return buildGraph(g.atoms, bonds);
}
