/**
 * Select-atom answer sets: `answerSet(selector, graphs, analyses)`,
 * `normalizeSelection`, `itemKey`. PURE MODULE.
 * See docs/design/05-content.md section 8 and 7.6.
 */
import type { Selector } from './types';
import { PKA_TIE } from '../chem/types';
import type { Analysis, MoleculeGraph } from '../chem/types';
import { neighborsOf } from '../chem/graph';
import { cipRank } from '../chem/cip';

export interface SelectionItem {
  readonly molecule: number;
  readonly atom: number;
  readonly hSlot?: number;
}

/** `${molecule}:${atom}` or `${molecule}:${atom}:${hSlot}`. */
export function itemKey(i: SelectionItem): string {
  return i.hSlot === undefined ? `${i.molecule}:${i.atom}` : `${i.molecule}:${i.atom}:${i.hSlot}`;
}

function item(molecule: number, atom: number, hSlot?: number): SelectionItem {
  return hSlot === undefined ? { molecule, atom } : { molecule, atom, hSlot };
}

const HALOGEN_CX = new Set(['Cl', 'Br', 'I']);
const ELECTRONEGATIVE = new Set(['O', 'N', 'F', 'Cl', 'Br', 'I']);

function carbonNeighbourCount(g: MoleculeGraph, atom: number): number {
  let n = 0;
  for (const j of neighborsOf(g, atom)) if (g.atoms[j]!.el === 'C') n++;
  return n;
}

/** The answer set of a selector over the locked molecules (index = rule order). */
export function answerSet(selector: Selector, graphs: readonly MoleculeGraph[], analyses: readonly Analysis[]): SelectionItem[] {
  const out: SelectionItem[] = [];
  const n = Math.min(graphs.length, analyses.length);
  switch (selector.kind) {
    case 'most-acidic-h': {
      let min = Infinity;
      for (let m = 0; m < n; m++) for (const s of analyses[m]!.acidity.hydrogens) if (s.pKa < min) min = s.pKa;
      if (!Number.isFinite(min)) return out;
      for (let m = 0; m < n; m++) {
        for (const s of analyses[m]!.acidity.hydrogens) if (s.pKa <= min + PKA_TIE) out.push(item(m, s.parentId, s.slot));
      }
      return out;
    }
    case 'most-basic-site':
    case 'most-basic-n': {
      const nOnly = selector.kind === 'most-basic-n';
      let max = -Infinity;
      for (let m = 0; m < n; m++) {
        for (const b of analyses[m]!.acidity.basicSites) {
          if (nOnly && graphs[m]!.atoms[b.atomId]!.el !== 'N') continue;
          if (b.pKaH > max) max = b.pKaH;
        }
      }
      if (!Number.isFinite(max)) return out;
      for (let m = 0; m < n; m++) {
        for (const b of analyses[m]!.acidity.basicSites) {
          if (nOnly && graphs[m]!.atoms[b.atomId]!.el !== 'N') continue;
          if (b.pKaH >= max - PKA_TIE) out.push(item(m, b.atomId));
        }
      }
      return out;
    }
    case 'hybridization': {
      for (let m = 0; m < n; m++) {
        for (const info of analyses[m]!.atoms) {
          if (info.hybridization !== selector.value) continue;
          if (selector.el !== undefined && info.el !== selector.el) continue;
          out.push(item(m, info.id));
        }
      }
      return out;
    }
    case 'chirality-center': {
      for (let m = 0; m < n; m++) {
        const g = graphs[m]!;
        const a = analyses[m]!;
        for (const info of a.atoms) {
          if (info.el !== 'C' || info.charge !== 0 || info.sigma !== 4 || info.hydrogens > 1) continue;
          const rank = cipRank(g, a.hydrogens, info.id);
          if (rank.tie) continue;
          out.push(item(m, info.id));
        }
      }
      return out;
    }
    case 'tertiary-carbon': {
      for (let m = 0; m < n; m++) {
        const g = graphs[m]!;
        for (const info of analyses[m]!.atoms) {
          if (info.el !== 'C' || info.charge !== 0 || info.hybridization !== 'sp3') continue;
          if (carbonNeighbourCount(g, info.id) === 3) out.push(item(m, info.id));
        }
      }
      return out;
    }
    case 'electrophilic-carbon': {
      for (let m = 0; m < n; m++) {
        const g = graphs[m]!;
        for (const info of analyses[m]!.atoms) {
          if (info.el !== 'C' || info.charge !== 0) continue;
          if (neighborsOf(g, info.id).some((j) => ELECTRONEGATIVE.has(g.atoms[j]!.el))) out.push(item(m, info.id));
        }
      }
      return out;
    }
    case 'lone-pair-atom': {
      for (let m = 0; m < n; m++) for (const info of analyses[m]!.atoms) if (info.lonePairs > 0) out.push(item(m, info.id));
      return out;
    }
    case 'more-substituted-alkene-carbon': {
      for (let m = 0; m < n; m++) {
        const g = graphs[m]!;
        for (const bond of g.bonds) {
          if (bond.order !== 2 || bond.aromatic) continue;
          const A = g.atoms[bond.a]!;
          const B = g.atoms[bond.b]!;
          if (A.el !== 'C' || B.el !== 'C' || A.aromatic || B.aromatic) continue;
          const ka = neighborsOf(g, bond.a).filter((j) => j !== bond.b).length;
          const kb = neighborsOf(g, bond.b).filter((j) => j !== bond.a).length;
          if (ka > kb) out.push(item(m, bond.a));
          else if (kb > ka) out.push(item(m, bond.b));
        }
      }
      return out;
    }
    case 'fewest-carbon-substituents-cx': {
      const perMolecule: number[] = [];
      let nmin = Infinity;
      for (let m = 0; m < n; m++) {
        const g = graphs[m]!;
        let best = Infinity;
        for (const bond of g.bonds) {
          if (bond.order !== 1) continue;
          const A = g.atoms[bond.a]!;
          const B = g.atoms[bond.b]!;
          let c = -1;
          if (A.el === 'C' && HALOGEN_CX.has(B.el)) c = bond.a;
          else if (B.el === 'C' && HALOGEN_CX.has(A.el)) c = bond.b;
          if (c < 0) continue;
          best = Math.min(best, carbonNeighbourCount(g, c));
        }
        perMolecule.push(best);
        if (best < nmin) nmin = best;
      }
      if (!Number.isFinite(nmin)) return out;
      for (let m = 0; m < n; m++) {
        if (perMolecule[m] !== nmin) continue;
        for (const a of graphs[m]!.atoms) out.push(item(m, a.id));
      }
      return out;
    }
    case 'atom-ids': {
      const g = graphs[0];
      for (const id of selector.ids) {
        if (g !== undefined && (id < 0 || id >= g.atoms.length)) continue;
        out.push(item(0, id));
      }
      return out;
    }
    default: {
      const _exhaustive: never = selector;
      void _exhaustive;
      return out;
    }
  }
}

/**
 * Heavy-atom fallback (05 §7.6): on a `'hydrogens'` rule an item without
 * `hSlot` expands to every H slot of that atom; an atom with no hydrogens
 * makes the whole selection `'no-hydrogens'`. On an `'atoms'` rule any
 * `hSlot` is dropped. Duplicates are removed (first occurrence kept).
 */
export function normalizeSelection(
  sel: readonly SelectionItem[],
  target: 'atoms' | 'hydrogens',
  analyses: readonly Analysis[],
): SelectionItem[] | 'no-hydrogens' {
  const out: SelectionItem[] = [];
  const seen = new Set<string>();
  const push = (i: SelectionItem): void => {
    const k = itemKey(i);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(i);
  };
  for (const s of sel) {
    if (target === 'atoms') {
      push(item(s.molecule, s.atom));
      continue;
    }
    if (s.hSlot !== undefined) {
      push(item(s.molecule, s.atom, s.hSlot));
      continue;
    }
    const h = analyses[s.molecule]?.hydrogens[s.atom] ?? 0;
    if (h <= 0) return 'no-hydrogens';
    for (let k = 0; k < h; k++) push(item(s.molecule, s.atom, k));
  }
  return out;
}
