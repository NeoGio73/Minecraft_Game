/**
 * Per-atom hybridization, geometry and ideal angle (McMurry 1.6-1.10).
 * PURE MODULE. See docs/design/03-stereo-acidity-hybridization.md section 8.
 *
 * `atomInfo` derives one `AtomInfo` per atom of the graph, in id order, from
 * the heavy bonds and the total hydrogen count supplied by
 * `implicitHydrogens`. Lone pairs are never stored: they follow from the
 * element and the stored charge (`lonePairs` in valence.ts). A lone pair that
 * is conjugated with a neighbouring pi bond (amide N, ester alkoxy O, enolate
 * C-) is removed from the steric number so that such atoms report sp2, exactly
 * as McMurry draws them.
 */
import { TARGET_VALENCE, VALENCE_ELECTRONS } from './types';
import type { AtomInfo, ChemApi, Geometry, Hybridization, IdealAngle, MoleculeGraph } from './types';
import { otherEnd } from './graph';
import { lonePairs } from './valence';

// ---------------------------------------------------------------------------
// Pure lookups on an existing AtomInfo (used by selectors and quizzes)
// ---------------------------------------------------------------------------

/** Steric number -> hybridization; an atom with no sigma partners has none. */
export function hybridization(info: Pick<AtomInfo, 'sigma' | 'stericNumber'>): Hybridization {
  if (info.sigma === 0) return 'none';
  const sn = info.stericNumber;
  if (sn >= 4) return 'sp3';
  if (sn === 3) return 'sp2';
  if (sn === 2) return 'sp';
  return 'none';
}

/** Electron-domain geometry from sigma partners and steric number (design 8.2). */
export function geometry(info: Pick<AtomInfo, 'sigma' | 'stericNumber'>): Geometry {
  const sigma = info.sigma;
  const sn = info.stericNumber;
  if (sigma === 0) return 'none';
  if (sigma === 1) return 'terminal';
  if (sn >= 4) {
    if (sigma === 4) return 'tetrahedral';
    if (sigma === 3) return 'trigonal pyramidal';
    if (sigma === 2) return 'bent';
    return 'none';
  }
  if (sn === 3) {
    if (sigma === 3) return 'trigonal planar';
    if (sigma === 2) return 'bent';
    return 'none';
  }
  if (sn === 2 && sigma === 2) return 'linear';
  return 'none';
}

/** Ideal McMurry angle for the geometry; null for terminal atoms and ions. */
export function idealAngleOf(info: Pick<AtomInfo, 'sigma' | 'stericNumber'>): IdealAngle {
  const geo = geometry(info);
  if (geo === 'terminal' || geo === 'none') return null;
  const sn = info.stericNumber;
  if (sn >= 4) return 109.5;
  if (sn === 3) return 120;
  return 180;
}

// ---------------------------------------------------------------------------
// Observed-angle notes (design 8.3; first matching row wins)
// ---------------------------------------------------------------------------

export const ANGLE_NOTES: readonly { readonly when: (i: AtomInfo) => boolean; readonly note: string }[] = [
  {
    when: (i) => i.el === 'O' && i.sigma === 2 && i.lonePairs === 2 && !i.conjugatedLonePair,
    note: 'measured 104.5° in water (Chem 2e 7.6); C–O–H 108.5° in methanol (McMurry 1.10)',
  },
  {
    when: (i) => i.el === 'N' && i.sigma === 3 && i.lonePairs === 1 && !i.conjugatedLonePair,
    note: 'measured 107.1° H–N–H in methylamine (McMurry 1.10)',
  },
  {
    when: (i) => i.el === 'N' && i.conjugatedLonePair,
    note: 'amide-type nitrogen is planar: its lone pair is delocalized into the neighbouring pi bond (McMurry 24.3, 26.4)',
  },
  {
    when: (i) => i.el === 'C' && i.charge === 1 && i.sigma === 3,
    note: 'carbocations are planar, sp2, with a vacant p orbital (McMurry 7.9)',
  },
  {
    when: (i) => i.el === 'C' && i.hybridization === 'sp2' && i.sigma === 3,
    note: 'measured 117.4° H–C–H and 121.3° H–C–C in ethylene (McMurry 1.8)',
  },
  {
    when: (i) => i.el === 'S' && i.sigma === 2 && i.lonePairs === 2,
    note: 'measured 96.5° C–S–H in methanethiol, 99.1° C–S–C in dimethyl sulfide (McMurry 1.10)',
  },
];

/** The note of the first ANGLE_NOTES row that matches, or undefined. */
export function angleNote(info: AtomInfo): string | undefined {
  for (const row of ANGLE_NOTES) if (row.when(info)) return row.note;
  return undefined;
}

// ---------------------------------------------------------------------------
// atomInfo
// ---------------------------------------------------------------------------

/**
 * One AtomInfo per atom of `g` in id order. `hydrogens[i]` is the TOTAL
 * hydrogen count of atom i (from `implicitHydrogens`: 0 with an over-valence
 * warning when the heavy bonds already exceed the target valence).
 */
export function atomInfo(g: MoleculeGraph, hydrogens: readonly number[]): AtomInfo[] {
  const out: AtomInfo[] = [];
  const n = g.atoms.length;
  for (let i = 0; i < n; i++) {
    const atom = g.atoms[i]!;
    const el = atom.el;
    const charge = atom.charge;
    const neighbors: number[] = [];
    let heavyBondOrderSum = 0;
    let pi = 0;
    for (const k of g.adj[i]!) {
      const bond = g.bonds[k]!;
      neighbors.push(otherEnd(g, k, i));
      heavyBondOrderSum += bond.order;
      pi += bond.order - 1;
    }
    const h = hydrogens[i] ?? 0;
    const tv = TARGET_VALENCE[el][charge];
    let valenceError: string | undefined;
    if (tv === undefined) {
      valenceError = `${el} cannot carry charge ${charge > 0 ? '+' : ''}${charge}`;
    } else if (heavyBondOrderSum > tv) {
      valenceError = `too many bonds for ${el} with charge ${charge}`;
    }
    const sigma = neighbors.length + h;
    const lp = lonePairs(el, charge);
    const conjugatedLonePair =
      lp > 0
      && pi === 0
      && (el === 'N' || el === 'O' || el === 'S' || (el === 'C' && charge === -1))
      && hasPiNeighbour(g, i);
    const stericNumber = sigma + lp - (conjugatedLonePair ? 1 : 0);
    const shape = { sigma, stericNumber };
    const hyb = hybridization(shape);
    const geo = geometry(shape);
    const idealAngle = idealAngleOf(shape);
    const formalCharge = VALENCE_ELECTRONS[el] - (2 * lp + heavyBondOrderSum + h);
    const base: AtomInfo = {
      id: i,
      el,
      charge,
      neighbors,
      heavyBondOrderSum,
      hydrogens: h,
      sigma,
      pi,
      lonePairs: lp,
      stericNumber,
      conjugatedLonePair,
      hybridization: hyb,
      geometry: geo,
      idealAngle,
      formalCharge,
      ...(valenceError !== undefined ? { valenceError } : {}),
    };
    const note = angleNote(base);
    out.push(note !== undefined ? { ...base, observedAngleNote: note } : base);
  }
  return out;
}

/** True when some neighbour n of `i` has a bond of order >= 2 to a third atom. */
function hasPiNeighbour(g: MoleculeGraph, i: number): boolean {
  for (const k of g.adj[i]!) {
    const nb = otherEnd(g, k, i);
    for (const kk of g.adj[nb]!) {
      const bond = g.bonds[kk]!;
      if (bond.order >= 2 && otherEnd(g, kk, nb) !== i) return true;
    }
  }
  return false;
}

const _check: Pick<ChemApi, 'atomInfo' | 'hybridization'> = { atomInfo, hybridization };
void _check;
