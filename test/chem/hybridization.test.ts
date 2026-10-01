import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { perceiveAromaticity } from '@/chem/aromatic';
import { lonePairs } from '@/chem/valence';
import { ANGLE_NOTES, angleNote, atomInfo, geometry, hybridization, idealAngleOf } from '@/chem/hybridization';
import type { AtomInfo, Charge, Element, Geometry, Hybridization, IdealAngle, MoleculeGraph } from '@/chem/types';

function infoOf(smiles: string): { g: MoleculeGraph; info: AtomInfo[]; hydrogens: number[] } {
  const g = parseSmiles(smiles).graph;
  const { hydrogens } = implicitHydrogens(g);
  return { g, info: atomInfo(g, hydrogens), hydrogens };
}

interface Row {
  readonly sigma: number;
  readonly pi: number;
  readonly lp: number;
  readonly conj: boolean;
  readonly sn: number;
  readonly hyb: Hybridization;
  readonly geo: Geometry;
  readonly angle: IdealAngle;
}

function expectRow(label: string, smiles: string, atom: number, row: Row): AtomInfo {
  const { info } = infoOf(smiles);
  const i = info[atom]!;
  const got = {
    sigma: i.sigma, pi: i.pi, lp: i.lonePairs, conj: i.conjugatedLonePair, sn: i.stericNumber,
    hyb: i.hybridization, geo: i.geometry, angle: i.idealAngle,
  };
  expect(got, label).toEqual(row);
  // the pure lookups agree with the stored fields
  expect(hybridization(i), label).toBe(row.hyb);
  expect(geometry(i), label).toBe(row.geo);
  expect(idealAngleOf(i), label).toBe(row.angle);
  expect(i.valenceError, label).toBeUndefined();
  return i;
}

describe('hybridization.ts: lone-pair table (design 8.1)', () => {
  it('lonePairs(el, q) matches the derived table', () => {
    const table: readonly [Element, Charge, number][] = [
      ['H', 0, 0],
      ['C', -1, 1], ['C', 0, 0], ['C', 1, 0],
      ['N', -1, 2], ['N', 0, 1], ['N', 1, 0],
      ['O', -1, 3], ['O', 0, 2], ['O', 1, 1],
      ['S', -1, 3], ['S', 0, 2], ['S', 1, 1],
      ['P', 0, 1], ['P', 1, 0],
      ['F', -1, 4], ['F', 0, 3],
      ['Cl', -1, 4], ['Cl', 0, 3],
      ['Br', -1, 4], ['Br', 0, 3],
      ['I', -1, 4], ['I', 0, 3],
    ];
    for (const [el, q, lp] of table) expect(lonePairs(el, q), `${el} ${q}`).toBe(lp);
  });
});

describe('hybridization.ts: design 8.4 test table', () => {
  it('1 methane C', () => {
    expectRow('methane C', 'C', 0, { sigma: 4, pi: 0, lp: 0, conj: false, sn: 4, hyb: 'sp3', geo: 'tetrahedral', angle: 109.5 });
  });
  it('2 ethene C', () => {
    expectRow('ethene C', 'C=C', 0, { sigma: 3, pi: 1, lp: 0, conj: false, sn: 3, hyb: 'sp2', geo: 'trigonal planar', angle: 120 });
  });
  it('3 ethyne C', () => {
    expectRow('ethyne C', 'C#C', 0, { sigma: 2, pi: 2, lp: 0, conj: false, sn: 2, hyb: 'sp', geo: 'linear', angle: 180 });
  });
  it('4 formaldehyde C', () => {
    expectRow('formaldehyde C', 'C=O', 0, { sigma: 3, pi: 1, lp: 0, conj: false, sn: 3, hyb: 'sp2', geo: 'trigonal planar', angle: 120 });
  });
  it('5 formaldehyde O', () => {
    expectRow('formaldehyde O', 'C=O', 1, { sigma: 1, pi: 1, lp: 2, conj: false, sn: 3, hyb: 'sp2', geo: 'terminal', angle: null });
  });
  it('6 acetonitrile N', () => {
    expectRow('acetonitrile N', 'CC#N', 2, { sigma: 1, pi: 2, lp: 1, conj: false, sn: 2, hyb: 'sp', geo: 'terminal', angle: null });
  });
  it('7 acetonitrile nitrile C', () => {
    expectRow('acetonitrile C2', 'CC#N', 1, { sigma: 2, pi: 2, lp: 0, conj: false, sn: 2, hyb: 'sp', geo: 'linear', angle: 180 });
  });
  it('8 acetonitrile CH3 C', () => {
    expectRow('acetonitrile C1', 'CC#N', 0, { sigma: 4, pi: 0, lp: 0, conj: false, sn: 4, hyb: 'sp3', geo: 'tetrahedral', angle: 109.5 });
  });
  it('9 water O (note 104.5)', () => {
    const i = expectRow('water O', 'O', 0, { sigma: 2, pi: 0, lp: 2, conj: false, sn: 4, hyb: 'sp3', geo: 'bent', angle: 109.5 });
    expect(i.observedAngleNote).toBe('measured 104.5° in water (Chem 2e 7.6); C–O–H 108.5° in methanol (McMurry 1.10)');
  });
  it('10 ammonia N', () => {
    const i = expectRow('ammonia N', 'N', 0, { sigma: 3, pi: 0, lp: 1, conj: false, sn: 4, hyb: 'sp3', geo: 'trigonal pyramidal', angle: 109.5 });
    expect(i.observedAngleNote).toBe('measured 107.1° H–N–H in methylamine (McMurry 1.10)');
  });
  it('11 acetamide N (conjugated)', () => {
    const i = expectRow('acetamide N', 'CC(N)=O', 2, { sigma: 3, pi: 0, lp: 1, conj: true, sn: 3, hyb: 'sp2', geo: 'trigonal planar', angle: 120 });
    expect(i.observedAngleNote).toBe('amide-type nitrogen is planar: its lone pair is delocalized into the neighbouring pi bond (McMurry 24.3, 26.4)');
  });
  it('12 acetamide carbonyl C', () => {
    expectRow('acetamide C2', 'CC(N)=O', 1, { sigma: 3, pi: 1, lp: 0, conj: false, sn: 3, hyb: 'sp2', geo: 'trigonal planar', angle: 120 });
  });
  it('13 dimethyl ether O', () => {
    expectRow('dimethyl ether O', 'COC', 1, { sigma: 2, pi: 0, lp: 2, conj: false, sn: 4, hyb: 'sp3', geo: 'bent', angle: 109.5 });
  });
  it('14 allene central C', () => {
    expectRow('allene C2', 'C=C=C', 1, { sigma: 2, pi: 2, lp: 0, conj: false, sn: 2, hyb: 'sp', geo: 'linear', angle: 180 });
  });
  it('15 allene terminal C', () => {
    expectRow('allene C1', 'C=C=C', 0, { sigma: 3, pi: 1, lp: 0, conj: false, sn: 3, hyb: 'sp2', geo: 'trigonal planar', angle: 120 });
    expectRow('allene C3', 'C=C=C', 2, { sigma: 3, pi: 1, lp: 0, conj: false, sn: 3, hyb: 'sp2', geo: 'trigonal planar', angle: 120 });
  });
  it('16 benzene C (Kekulé, and after aromaticity perception)', () => {
    const row: Row = { sigma: 3, pi: 1, lp: 0, conj: false, sn: 3, hyb: 'sp2', geo: 'trigonal planar', angle: 120 };
    for (let k = 0; k < 6; k++) expectRow(`benzene C${k}`, 'C1=CC=CC=C1', k, row);
    const g = perceiveAromaticity(parseSmiles('c1ccccc1').graph);
    const info = atomInfo(g, implicitHydrogens(g).hydrogens);
    for (const i of info) {
      expect(i.hybridization).toBe('sp2');
      expect(i.geometry).toBe('trigonal planar');
      expect(i.pi).toBe(1);
    }
  });
  it('17 methyl cation C (+1)', () => {
    const i = expectRow('methyl cation', '[CH3+]', 0, { sigma: 3, pi: 0, lp: 0, conj: false, sn: 3, hyb: 'sp2', geo: 'trigonal planar', angle: 120 });
    expect(i.formalCharge).toBe(1);
    expect(i.observedAngleNote).toBe('carbocations are planar, sp2, with a vacant p orbital (McMurry 7.9)');
  });
  it('18 methyl anion C (-1)', () => {
    const i = expectRow('methyl anion', '[CH3-]', 0, { sigma: 3, pi: 0, lp: 1, conj: false, sn: 4, hyb: 'sp3', geo: 'trigonal pyramidal', angle: 109.5 });
    expect(i.formalCharge).toBe(-1);
  });
  it('19 acetylide C- (HC≡C-)', () => {
    const i = expectRow('acetylide C-', 'C#[C-]', 1, { sigma: 1, pi: 2, lp: 1, conj: false, sn: 2, hyb: 'sp', geo: 'terminal', angle: null });
    expect(i.formalCharge).toBe(-1);
    expectRow('acetylide CH', 'C#[C-]', 0, { sigma: 2, pi: 2, lp: 0, conj: false, sn: 2, hyb: 'sp', geo: 'linear', angle: 180 });
  });
  it('20 ammonium N', () => {
    const i = expectRow('ammonium N', '[NH4+]', 0, { sigma: 4, pi: 0, lp: 0, conj: false, sn: 4, hyb: 'sp3', geo: 'tetrahedral', angle: 109.5 });
    expect(i.formalCharge).toBe(1);
  });
  it('21 methyl acetate alkoxy O (conjugated, bent, 120)', () => {
    expectRow('methyl acetate O1', 'COC(C)=O', 1, { sigma: 2, pi: 0, lp: 2, conj: true, sn: 3, hyb: 'sp2', geo: 'bent', angle: 120 });
    // the carbonyl O is not conjugated (it owns the pi bond)
    expectRow('methyl acetate O=', 'COC(C)=O', 4, { sigma: 1, pi: 1, lp: 2, conj: false, sn: 3, hyb: 'sp2', geo: 'terminal', angle: null });
  });
  it('22 acetone enolate C- (conjugated)', () => {
    const i = expectRow('enolate C-', 'CC(=O)[CH2-]', 3, { sigma: 3, pi: 0, lp: 1, conj: true, sn: 3, hyb: 'sp2', geo: 'trigonal planar', angle: 120 });
    expect(i.formalCharge).toBe(-1);
    // the other methyl is an ordinary sp3 carbon
    expectRow('enolate CH3', 'CC(=O)[CH2-]', 0, { sigma: 4, pi: 0, lp: 0, conj: false, sn: 4, hyb: 'sp3', geo: 'tetrahedral', angle: 109.5 });
  });
  it('23 vinyl chloride Cl (halogens are never conjugated)', () => {
    expectRow('vinyl chloride Cl', 'C=CCl', 2, { sigma: 1, pi: 0, lp: 3, conj: false, sn: 4, hyb: 'sp3', geo: 'terminal', angle: null });
  });
  it('24 DMSO S+ (C[S+](C)[O-])', () => {
    const i = expectRow('DMSO S+', 'C[S+](C)[O-]', 1, { sigma: 3, pi: 0, lp: 1, conj: false, sn: 4, hyb: 'sp3', geo: 'trigonal pyramidal', angle: 109.5 });
    expect(i.formalCharge).toBe(1);
    const o = infoOf('C[S+](C)[O-]').info[3]!;
    expect(o.formalCharge).toBe(-1);
    expect(o.lonePairs).toBe(3);
    expect(o.geometry).toBe('terminal');
    expect(o.hybridization).toBe('sp3');
  });
});

describe('hybridization.ts: extra rows of design 8.4', () => {
  it('propene: C1, C2 sp2 and C3 sp3 (answer set of ch1-select-sp2-propene)', () => {
    const { info } = infoOf('C=CC');
    expect(info.map((i) => i.hybridization)).toEqual(['sp2', 'sp2', 'sp3']);
    expect(info.map((i) => i.geometry)).toEqual(['trigonal planar', 'trigonal planar', 'tetrahedral']);
    expect(info.filter((i) => i.el === 'C' && i.hybridization === 'sp2').map((i) => i.id)).toEqual([0, 1]);
    expect(info[0]!.observedAngleNote).toBe('measured 117.4° H–C–H and 121.3° H–C–C in ethylene (McMurry 1.8)');
  });
  it('tert-butyl cation central C: sp2 trigonal planar, formal charge +1', () => {
    const i = expectRow('tBu+ C2', 'C[C+](C)C', 1, { sigma: 3, pi: 0, lp: 0, conj: false, sn: 3, hyb: 'sp2', geo: 'trigonal planar', angle: 120 });
    expect(i.formalCharge).toBe(1);
    expect(i.hydrogens).toBe(0);
    expect(i.observedAngleNote).toBe('carbocations are planar, sp2, with a vacant p orbital (McMurry 7.9)');
  });
  it('carboxylic acid O–H oxygen: conjugated sp2 bent', () => {
    expectRow('acetic acid O–H', 'CC(=O)O', 3, { sigma: 2, pi: 0, lp: 2, conj: true, sn: 3, hyb: 'sp2', geo: 'bent', angle: 120 });
    expectRow('acetic acid O=', 'CC(=O)O', 2, { sigma: 1, pi: 1, lp: 2, conj: false, sn: 3, hyb: 'sp2', geo: 'terminal', angle: null });
  });
  it('nitromethane N+: sigma 3, pi 1, LP 0, sp2', () => {
    const i = expectRow('nitromethane N', 'C[N+](=O)[O-]', 1, { sigma: 3, pi: 1, lp: 0, conj: false, sn: 3, hyb: 'sp2', geo: 'trigonal planar', angle: 120 });
    expect(i.formalCharge).toBe(1);
    const { info } = infoOf('C[N+](=O)[O-]');
    expect(info[3]!.formalCharge).toBe(-1);
    expect(info[3]!.conjugatedLonePair).toBe(true); // O- next to N=O
    expect(info[3]!.hybridization).toBe('sp2');
  });
  it('chloride ion (sigma 0): hybridization none, geometry none', () => {
    const { info } = infoOf('[Cl-]');
    expect(info[0]!.sigma).toBe(0);
    expect(info[0]!.hybridization).toBe('none');
    expect(info[0]!.geometry).toBe('none');
    expect(info[0]!.idealAngle).toBeNull();
    expect(info[0]!.lonePairs).toBe(4);
    expect(info[0]!.formalCharge).toBe(-1);
    expect(info[0]!.neighbors).toEqual([]);
  });
  it('methylamine N and methanol O: sp3 with observed-angle notes', () => {
    const n = infoOf('CN').info[1]!;
    expect(n.hybridization).toBe('sp3');
    expect(n.geometry).toBe('trigonal pyramidal');
    expect(n.observedAngleNote).toBe('measured 107.1° H–N–H in methylamine (McMurry 1.10)');
    const o = infoOf('CO').info[1]!;
    expect(o.geometry).toBe('bent');
    expect(o.observedAngleNote).toBe('measured 104.5° in water (Chem 2e 7.6); C–O–H 108.5° in methanol (McMurry 1.10)');
  });
  it('methanethiol S and dimethyl sulfide S: bent sp3 with the sulfur note', () => {
    for (const [smiles, atom] of [['CS', 1], ['CSC', 1]] as const) {
      const s = infoOf(smiles).info[atom]!;
      expect(s.el).toBe('S');
      expect(s.hybridization).toBe('sp3');
      expect(s.geometry).toBe('bent');
      expect(s.observedAngleNote).toBe('measured 96.5° C–S–H in methanethiol, 99.1° C–S–C in dimethyl sulfide (McMurry 1.10)');
    }
  });
  it('enol / phenol oxygen and aniline nitrogen are conjugated sp2', () => {
    const o = infoOf('C=CO').info[2]!;
    expect(o.conjugatedLonePair).toBe(true);
    expect(o.hybridization).toBe('sp2');
    expect(o.geometry).toBe('bent');
    expect(o.observedAngleNote).toBeUndefined();
    const n = infoOf('Nc1ccccc1').info[0]!;
    expect(n.conjugatedLonePair).toBe(true);
    expect(n.hybridization).toBe('sp2');
    expect(n.geometry).toBe('trigonal planar');
  });
  it('hydronium and hydroxide', () => {
    expectRow('hydronium', '[OH3+]', 0, { sigma: 3, pi: 0, lp: 1, conj: false, sn: 4, hyb: 'sp3', geo: 'trigonal pyramidal', angle: 109.5 });
    expectRow('hydroxide', '[OH-]', 0, { sigma: 1, pi: 0, lp: 3, conj: false, sn: 4, hyb: 'sp3', geo: 'terminal', angle: null });
  });
  it('a lone pair next to an aromatic ring is conjugated whether the ring is Kekulé or perceived', () => {
    const kek = infoOf('OC1=CC=CC=C1').info[0]!;
    expect(kek.conjugatedLonePair).toBe(true);
    const g = perceiveAromaticity(parseSmiles('Oc1ccccc1').graph);
    const per = atomInfo(g, implicitHydrogens(g).hydrogens)[0]!;
    expect(per.conjugatedLonePair).toBe(true);
    expect(per.stericNumber).toBe(3);
  });
});

describe('hybridization.ts: atomInfo bookkeeping', () => {
  it('entries are in id order with heavy neighbour ids and bond-order sums', () => {
    const { info } = infoOf('CC(=O)O');
    expect(info.map((i) => i.id)).toEqual([0, 1, 2, 3]);
    expect(info.map((i) => i.el)).toEqual(['C', 'C', 'O', 'O']);
    expect(info[1]!.neighbors).toEqual([0, 2, 3]);
    expect(info[1]!.heavyBondOrderSum).toBe(4);
    expect(info[1]!.hydrogens).toBe(0);
    expect(info[0]!.hydrogens).toBe(3);
    expect(info[3]!.hydrogens).toBe(1);
    expect(info.map((i) => i.charge)).toEqual([0, 0, 0, 0]);
  });
  it('formalCharge equals the stored charge for every atom (no valence error)', () => {
    for (const s of ['CC(=O)[O-]', 'C[NH3+]', 'C[S+](C)[O-]', '[OH3+]', 'C[C+](C)C', 'CC(=O)[CH2-]', 'C#[C-]', '[NH2-]', 'C[N+](=O)[O-]']) {
      const { info } = infoOf(s);
      for (const i of info) expect(i.formalCharge, `${s} atom ${i.id}`).toBe(i.charge);
    }
  });
  it('over-valent atoms get a valenceError and zero hydrogens (hydrogens come from implicitHydrogens)', () => {
    const { info, hydrogens } = infoOf('O=S=O');
    expect(hydrogens[1]).toBe(0);
    expect(info[1]!.valenceError).toBe('too many bonds for S with charge 0');
    expect(info[1]!.heavyBondOrderSum).toBe(4);
    expect(info[0]!.valenceError).toBeUndefined();
  });
  it('a world graph (positions, collapsed H blocks) analyses like a SMILES graph', () => {
    const g = parseSmiles('CO').graph;
    const world = {
      atoms: g.atoms.map((a, i) => ({ ...a, explicitH: null, pos: [i, 0, 0] as const, hPos: i === 1 ? [[1, 1, 0] as const] : [] })),
      bonds: g.bonds,
      adj: g.adj,
    };
    const info = atomInfo(world, implicitHydrogens(world).hydrogens);
    expect(info[1]!.hydrogens).toBe(1);
    expect(info[1]!.sigma).toBe(2);
    expect(info[1]!.geometry).toBe('bent');
    expect(info[0]!.hybridization).toBe('sp3');
  });
  it('ANGLE_NOTES: six rows, first match wins (carbocation beats the generic sp2 row)', () => {
    expect(ANGLE_NOTES).toHaveLength(6);
    const cation = infoOf('C[C+](C)C').info[1]!;
    expect(angleNote(cation)).toBe(ANGLE_NOTES[3]!.note);
    expect(ANGLE_NOTES[3]!.when(cation)).toBe(true);
    expect(ANGLE_NOTES[4]!.when(cation)).toBe(true);
    const alkaneC = infoOf('CC').info[0]!;
    expect(angleNote(alkaneC)).toBeUndefined();
    expect(alkaneC.observedAngleNote).toBeUndefined();
  });
  it('pure lookups: hybridization() and geometry() on synthetic shapes', () => {
    expect(hybridization({ sigma: 0, stericNumber: 4 })).toBe('none');
    expect(hybridization({ sigma: 1, stericNumber: 1 })).toBe('none');
    expect(hybridization({ sigma: 2, stericNumber: 2 })).toBe('sp');
    expect(hybridization({ sigma: 3, stericNumber: 3 })).toBe('sp2');
    expect(hybridization({ sigma: 4, stericNumber: 4 })).toBe('sp3');
    expect(hybridization({ sigma: 2, stericNumber: 5 })).toBe('sp3');
    expect(geometry({ sigma: 0, stericNumber: 4 })).toBe('none');
    expect(geometry({ sigma: 1, stericNumber: 4 })).toBe('terminal');
    expect(geometry({ sigma: 4, stericNumber: 4 })).toBe('tetrahedral');
    expect(geometry({ sigma: 3, stericNumber: 4 })).toBe('trigonal pyramidal');
    expect(geometry({ sigma: 2, stericNumber: 4 })).toBe('bent');
    expect(geometry({ sigma: 3, stericNumber: 3 })).toBe('trigonal planar');
    expect(geometry({ sigma: 2, stericNumber: 3 })).toBe('bent');
    expect(geometry({ sigma: 2, stericNumber: 2 })).toBe('linear');
    expect(geometry({ sigma: 3, stericNumber: 2 })).toBe('none');
    expect(idealAngleOf({ sigma: 1, stericNumber: 4 })).toBeNull();
    expect(idealAngleOf({ sigma: 2, stericNumber: 3 })).toBe(120);
  });
});
