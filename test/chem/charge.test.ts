import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { perceiveAromaticity } from '@/chem/aromatic';
import { buildGraph } from '@/chem/graph';
import { netCharge } from '@/chem/formula';
import { atomInfo } from '@/chem/hybridization';
import { CHARGE_REFUSAL, canSetCharge, formalCharge, withCharge } from '@/chem/charge';
import { TARGET_VALENCE, VALENCE_ELECTRONS } from '@/chem/types';
import type { Charge, MoleculeGraph, WorldAtom, WorldGraph } from '@/chem/types';
import { REFUSAL_TEXT } from '@/world/types';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;
const hyd = (g: MoleculeGraph): number[] => implicitHydrogens(g).hydrogens;

const LIB_CSV = new URL('../../tools/reference/lib.csv', import.meta.url);
const MOLECULES_JSON = new URL('../../src/content/molecules.json', import.meta.url);

/** Isobutane as a world graph; `hOnCentral` explicit H blocks collapsed onto the central carbon (atom 1). */
function worldIsobutane(hOnCentral: number): WorldGraph {
  const g = parse('CC(C)C');
  const positions: readonly (readonly [number, number, number])[] = [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 0, 1]];
  const atoms: WorldAtom[] = g.atoms.map((a, i) => ({
    ...a,
    explicitH: null,
    pos: positions[i]!,
    hPos: i === 1 ? Array.from({ length: hOnCentral }, (_, k) => [0, k + 1, 0] as const) : [],
  }));
  return buildGraph(atoms, g.bonds);
}

describe('charge.ts: formalCharge (design 9.1)', () => {
  it('is McMurry 2.3: V - (2 LP + heavy bond order + H)', () => {
    const g = parse('C[S+](C)[O-]');
    const info = atomInfo(g, hyd(g));
    for (const i of info) {
      expect(formalCharge(i)).toBe(VALENCE_ELECTRONS[i.el] - (2 * i.lonePairs + i.heavyBondOrderSum + i.hydrogens));
      expect(formalCharge(i)).toBe(i.formalCharge);
    }
    expect(formalCharge(info[1]!)).toBe(1);
    expect(formalCharge(info[3]!)).toBe(-1);
  });
  it('design 11 rows 40-45: ions report their stored charge as formal charge', () => {
    const cases: readonly [string, number, number][] = [
      ['C[S+](C)[O-]', 1, 1], ['C[S+](C)[O-]', 3, -1],   // DMSO
      ['C[C+](C)C', 1, 1],                                // tert-butyl cation
      ['[CH3-]', 0, -1],                                  // methyl anion
      ['[NH4+]', 0, 1],                                   // ammonium
      ['[OH3+]', 0, 1],                                   // hydronium
      ['C[O-]', 1, -1],                                   // methoxide
      ['CC(=O)[O-]', 3, -1],                              // acetate
      ['C#[C-]', 1, -1],                                  // acetylide
      ['[NH2-]', 0, -1],                                  // amide ion
    ];
    for (const [s, atom, q] of cases) {
      const g = parse(s);
      const info = atomInfo(g, hyd(g));
      expect(formalCharge(info[atom]!), `${s} atom ${atom}`).toBe(q);
      expect(info[atom]!.charge, `${s} atom ${atom}`).toBe(q);
    }
  });
  it('equals the stored charge for every atom of every reference-library molecule (and molecules.json when present)', () => {
    const rows = readFileSync(LIB_CSV, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => l.split(','));
    expect(rows.length).toBeGreaterThan(100);
    const check = (smiles: string, label: string): void => {
      const g = perceiveAromaticity(parse(smiles));
      const info = atomInfo(g, hyd(g));
      let sum = 0;
      for (const i of info) {
        expect(i.valenceError, `${label} atom ${i.id}`).toBeUndefined();
        expect(formalCharge(i), `${label} atom ${i.id}`).toBe(i.charge);
        sum += formalCharge(i);
      }
      expect(sum, label).toBe(netCharge(g));
    };
    for (const row of rows) check(row[2]!.replace(/\\\\/g, '\\'), row[0]!);
    if (existsSync(MOLECULES_JSON)) {
      const entries = JSON.parse(readFileSync(MOLECULES_JSON, 'utf8')) as { id: string; smiles: string }[];
      for (const e of entries) check(e.smiles, e.id);
    }
  });
});

describe('charge.ts: CHARGE_REFUSAL text', () => {
  it('matches the design strings and the world REFUSAL_TEXT byte for byte', () => {
    expect(CHARGE_REFUSAL.hBlock).toBe('Hydrogen blocks cannot carry a charge.');
    expect(CHARGE_REFUSAL.unsupported('F', 1)).toBe('F cannot carry charge +1 in this game.');
    expect(CHARGE_REFUSAL.unsupported('P', -1)).toBe('P cannot carry charge -1 in this game.');
    expect(CHARGE_REFUSAL.valence('C', 1, 3)).toBe('Remove a bond first: C+ allows 3 bonds.');
    expect(CHARGE_REFUSAL.valence('O', -1, 1)).toBe('Remove a bond first: O- allows 1 bonds.');
    expect(CHARGE_REFUSAL.valence('N', 0, 3)).toBe('Remove a bond first: N allows 3 bonds.');
    for (const [el, q] of [['F', 1], ['Cl', 1], ['P', -1], ['H', 1], ['H', -1]] as const) {
      expect(CHARGE_REFUSAL.unsupported(el, q)).toBe(REFUSAL_TEXT.chargeUnsupported(el, q));
    }
    for (const [el, q, max] of [['C', 1, 3], ['C', -1, 3], ['O', -1, 1], ['N', 1, 4], ['S', 1, 3]] as const) {
      expect(CHARGE_REFUSAL.valence(el, q, max)).toBe(REFUSAL_TEXT.chargeValence(el, q, max));
    }
  });
});

describe('charge.ts: canSetCharge / withCharge (design 9.3, 9.4 fixtures)', () => {
  it('CH3OH O -> -1: ok, methoxide, the implicit H on O becomes 0', () => {
    const g = parse('CO');
    expect(canSetCharge(g, 1, -1)).toEqual({ ok: true });
    const m = withCharge(g, 1, -1);
    expect(m.atoms[1]!.charge).toBe(-1);
    expect(hyd(m)).toEqual([3, 0]);
    expect(netCharge(m)).toBe(-1);
    // the input graph is untouched
    expect(g.atoms[1]!.charge).toBe(0);
  });
  it('CH3NH2 N -> +1: ok, CH3NH3+ with 3 implicit H', () => {
    const g = parse('CN');
    expect(canSetCharge(g, 1, 1)).toEqual({ ok: true });
    const m = withCharge(g, 1, 1);
    expect(hyd(m)).toEqual([3, 3]);
    expect(netCharge(m)).toBe(1);
  });
  it('H2O O -> +1: ok, H3O+', () => {
    const g = parse('O');
    expect(canSetCharge(g, 0, 1)).toEqual({ ok: true });
    const m = withCharge(g, 0, 1);
    expect(hyd(m)).toEqual([3]);
    const info = atomInfo(m, hyd(m));
    expect(info[0]!.geometry).toBe('trigonal pyramidal');
    expect(formalCharge(info[0]!)).toBe(1);
  });
  it('(CH3)3CH with implicit H: central C -> +1 ok (tert-butyl cation, sp2)', () => {
    const g = parse('CC(C)C');
    expect(canSetCharge(g, 1, 1)).toEqual({ ok: true });
    const m = withCharge(g, 1, 1);
    expect(hyd(m)).toEqual([3, 0, 3, 3]);
    const info = atomInfo(m, hyd(m));
    expect(info[1]!.hybridization).toBe('sp2');
    expect(info[1]!.geometry).toBe('trigonal planar');
    expect(formalCharge(info[1]!)).toBe(1);
    // the same on a world graph with no H block on the central carbon
    expect(canSetCharge(worldIsobutane(0), 1, 1)).toEqual({ ok: true });
  });
  it('(CH3)3CH with an explicit H block on the central C: C -> +1 refused', () => {
    const w = worldIsobutane(1);
    expect(canSetCharge(w, 1, 1)).toEqual({ ok: false, reason: 'Remove a bond first: C+ allows 3 bonds.' });
    expect(canSetCharge(w, 1, -1)).toEqual({ ok: false, reason: 'Remove a bond first: C- allows 3 bonds.' });
    expect(() => withCharge(w, 1, 1)).toThrow('charge refused: Remove a bond first: C+ allows 3 bonds.');
    // a methyl carbon of the same build still accepts a charge (one heavy bond, no H block)
    expect(canSetCharge(w, 0, 1)).toEqual({ ok: true });
  });
  it('bracket H counts of SMILES atoms are fixed exactly like H blocks', () => {
    const g = parse('C[CH3]');
    expect(canSetCharge(g, 1, 1)).toEqual({ ok: false, reason: 'Remove a bond first: C+ allows 3 bonds.' });
    expect(canSetCharge(g, 0, 1)).toEqual({ ok: true });
  });
  it('CH3CH2OH C1 -> +1: ok (a primary carbocation is legal to draw)', () => {
    const g = parse('CCO');
    expect(canSetCharge(g, 0, 1)).toEqual({ ok: true });
    expect(hyd(withCharge(g, 0, 1))).toEqual([2, 2, 1]);
  });
  it('CH2=CH2 C -> -1: ok (vinyl anion)', () => {
    const g = parse('C=C');
    expect(canSetCharge(g, 0, -1)).toEqual({ ok: true });
    const m = withCharge(g, 0, -1);
    expect(hyd(m)).toEqual([1, 2]);
    expect(atomInfo(m, hyd(m))[0]!.hybridization).toBe('sp2');
  });
  it('CH3F F -> +1: refused (unsupported)', () => {
    const g = parse('CF');
    expect(canSetCharge(g, 1, 1)).toEqual({ ok: false, reason: 'F cannot carry charge +1 in this game.' });
    expect(() => withCharge(g, 1, 1)).toThrow('charge refused: F cannot carry charge +1 in this game.');
    // F- would need no bonds at all
    expect(canSetCharge(g, 1, -1)).toEqual({ ok: false, reason: 'Remove a bond first: F- allows 0 bonds.' });
    expect(canSetCharge(parse('[F-]'), 0, 0)).toEqual({ ok: true });
  });
  it('CH3CH3 C -> -1: ok (ethyl anion)', () => {
    const g = parse('CC');
    expect(canSetCharge(g, 0, -1)).toEqual({ ok: true });
    expect(hyd(withCharge(g, 0, -1))).toEqual([2, 3]);
  });
  it('CH3-O-CH3 O -> -1: refused (O- allows 1 bond)', () => {
    const g = parse('COC');
    expect(canSetCharge(g, 1, -1)).toEqual({ ok: false, reason: 'Remove a bond first: O- allows 1 bonds.' });
    expect(() => withCharge(g, 1, -1)).toThrow('charge refused: Remove a bond first: O- allows 1 bonds.');
    // O+ (oxonium) is fine: 3 allowed
    expect(canSetCharge(g, 1, 1)).toEqual({ ok: true });
  });
  it('an H block never carries a charge', () => {
    const h = buildGraph([{ id: 0, el: 'H', charge: 0, explicitH: null, aromatic: false }], []);
    for (const q of [1, -1, 0] as const) {
      expect(canSetCharge(h, 0, q)).toEqual({ ok: false, reason: 'Hydrogen blocks cannot carry a charge.' });
    }
    expect(() => withCharge(h, 0, 1)).toThrow('charge refused: Hydrogen blocks cannot carry a charge.');
  });
  it('resetting to 0 is validated the same way (an over-bonded N+ cannot go neutral)', () => {
    const g = parse('C[N+](C)(C)C');
    expect(canSetCharge(g, 1, 0)).toEqual({ ok: false, reason: 'Remove a bond first: N allows 3 bonds.' });
    // a bracket [NH3+] fixes 3 H, so going neutral would need 4 bonds on N: refused by the same rule
    expect(canSetCharge(parse('C[NH3+]'), 1, 0)).toEqual({ ok: false, reason: 'Remove a bond first: N allows 3 bonds.' });
    // with implicit H (as on the grid) the round trip 0 -> +1 -> 0 is accepted
    const plus = withCharge(parse('CN'), 1, 1);
    expect(canSetCharge(plus, 1, 0)).toEqual({ ok: true });
    expect(hyd(withCharge(plus, 1, 0))).toEqual([3, 2]);
  });
  it('P and S follow TARGET_VALENCE (P- unsupported, S+ allows 3, S- allows 1)', () => {
    expect(canSetCharge(parse('CP'), 1, -1)).toEqual({ ok: false, reason: 'P cannot carry charge -1 in this game.' });
    expect(canSetCharge(parse('CP'), 1, 1)).toEqual({ ok: true });
    expect(canSetCharge(parse('CSC'), 1, 1)).toEqual({ ok: true });
    expect(canSetCharge(parse('CSC'), 1, -1)).toEqual({ ok: false, reason: 'Remove a bond first: S- allows 1 bonds.' });
    expect(canSetCharge(parse('CS'), 1, -1)).toEqual({ ok: true });
  });
  it('withCharge returns a new graph with the same bonds and only that atom changed', () => {
    const g = parse('CC(=O)O');
    const m = withCharge(g, 3, -1);
    expect(m).not.toBe(g);
    expect(m.bonds).toEqual(g.bonds);
    expect(m.atoms.map((a) => a.charge)).toEqual([0, 0, 0, -1]);
    expect(m.atoms[3]!.el).toBe('O');
    expect(hyd(m)).toEqual([3, 0, 0, 0]);
    expect(atomInfo(m, hyd(m))[3]!.formalCharge).toBe(-1);
  });
  it('throws RangeError for an atom index outside the graph', () => {
    const g = parse('CC');
    expect(() => canSetCharge(g, 2, 1)).toThrow(RangeError);
    expect(() => canSetCharge(g, -1, 1)).toThrow(RangeError);
    expect(() => withCharge(g, 5, 0)).toThrow(RangeError);
  });
  it('every supported (element, charge) pair with no heavy bonds is accepted; unsupported pairs are refused', () => {
    for (const el of ['C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I'] as const) {
      const g = buildGraph([{ id: 0, el, charge: 0, explicitH: null, aromatic: false }], []);
      for (const q of [-1, 0, 1] as const satisfies readonly Charge[]) {
        const verdict = canSetCharge(g, 0, q);
        if (TARGET_VALENCE[el][q] === undefined) {
          expect(verdict, `${el} ${q}`).toEqual({ ok: false, reason: CHARGE_REFUSAL.unsupported(el, q) });
        } else {
          expect(verdict, `${el} ${q}`).toEqual({ ok: true });
        }
      }
    }
  });
});

describe('charge.ts: design 9.2 valence targets as the bond tool sees them', () => {
  it('TARGET_VALENCE rows', () => {
    expect(TARGET_VALENCE.C).toEqual({ [-1]: 3, 0: 4, 1: 3 });
    expect(TARGET_VALENCE.N).toEqual({ [-1]: 2, 0: 3, 1: 4 });
    expect(TARGET_VALENCE.O).toEqual({ [-1]: 1, 0: 2, 1: 3 });
    expect(TARGET_VALENCE.S).toEqual({ [-1]: 1, 0: 2, 1: 3 });
    expect(TARGET_VALENCE.P).toEqual({ 0: 3, 1: 4 });
    for (const x of ['F', 'Cl', 'Br', 'I'] as const) expect(TARGET_VALENCE[x]).toEqual({ [-1]: 0, 0: 1 });
    expect(TARGET_VALENCE.H).toEqual({ 0: 1 });
  });
  it('a C+ or C- with three heavy single bonds cannot take a double bond; N+ may reach 4', () => {
    const tbu = parse('C[C+](C)C');
    const info = atomInfo(tbu, hyd(tbu));
    expect(info[1]!.heavyBondOrderSum).toBe(3);
    expect(info[1]!.heavyBondOrderSum - 1 + 2 > TARGET_VALENCE.C[1]!).toBe(true);
    const nh4 = parse('C[N+](C)(C)C');
    expect(atomInfo(nh4, hyd(nh4))[1]!.valenceError).toBeUndefined();
    expect(hyd(nh4)).toEqual([3, 0, 3, 3, 3]);
  });
});
