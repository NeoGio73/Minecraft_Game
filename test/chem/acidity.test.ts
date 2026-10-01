import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { perceiveAromaticity } from '@/chem/aromatic';
import { buildGraph } from '@/chem/graph';
import { atomInfo } from '@/chem/hybridization';
import {
  BASIC, PKA, PKA_MOD, PKA_SOURCES, PKA_TEXT_ONLY,
  acidity, basicSites, hydrogenSites, predictAcidBase, unverifiedWarnings,
} from '@/chem/acidity';
import { PKA_MIN_MARGIN, PKA_TIE } from '@/chem/types';
import type { AcidityAnalysis, BasicSite, HydrogenSite, MoleculeGraph, WorldAtom } from '@/chem/types';

/** Parse, perceive aromaticity (as `analyze` does), derive AtomInfo. */
function prep(smiles: string): { g: MoleculeGraph; a: AcidityAnalysis } {
  const g = perceiveAromaticity(parseSmiles(smiles).graph);
  const info = atomInfo(g, implicitHydrogens(g).hydrogens);
  return { g, a: acidity(g, info) };
}

/** Sites of the hydrogens on atom `parent`. */
function sitesOn(a: AcidityAnalysis, parent: number): HydrogenSite[] {
  return a.hydrogens.filter((s) => s.parentId === parent);
}

/** classKey and pKa of the hydrogens on `parent` (all slots agree). */
function hClass(smiles: string, parent: number): { classId: string; classKey: string; pKa: number; verified: boolean; label: string; source: string } {
  const { a } = prep(smiles);
  const sites = sitesOn(a, parent);
  expect(sites.length, `${smiles} atom ${parent} has hydrogens`).toBeGreaterThan(0);
  const first = sites[0]!;
  for (const s of sites) {
    expect(s.classKey).toBe(first.classKey);
    expect(s.pKa).toBe(first.pKa);
  }
  return { classId: first.classId, classKey: first.classKey, pKa: first.pKa, verified: first.verified, label: first.label, source: first.source };
}

function mostAcidic(smiles: string): { classKeys: string[]; pKa: number; parents: number[]; verified: boolean } {
  const { a } = prep(smiles);
  expect(a.mostAcidic.length, `${smiles} has a most acidic H`).toBeGreaterThan(0);
  return {
    classKeys: [...new Set(a.mostAcidic.map((s) => s.classKey))].sort(),
    pKa: a.mostAcidic[0]!.pKa,
    parents: [...new Set(a.mostAcidic.map((s) => s.parentId))].sort((x, y) => x - y),
    verified: a.mostAcidic.every((s) => s.verified),
  };
}

function mostBasic(smiles: string): { classIds: string[]; pKaH: number; atoms: number[] } {
  const { a } = prep(smiles);
  return {
    classIds: [...new Set(a.mostBasic.map((s) => s.classId))].sort(),
    pKaH: a.mostBasic[0]?.pKaH ?? Number.NaN,
    atoms: a.mostBasic.map((s) => s.atomId),
  };
}

function basicOf(smiles: string, atom: number): BasicSite | undefined {
  return prep(smiles).a.basicSites.find((b) => b.atomId === atom);
}

/** Distinct pKa values ascending over all hydrogen sites. */
function distinctPkas(smiles: string): number[] {
  return [...new Set(prep(smiles).a.hydrogens.map((s) => s.pKa))].sort((x, y) => x - y);
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

describe('acidity.ts: PKA table (design 10.2)', () => {
  const rows: readonly [string, number, boolean][] = [
    ['HX.F', 3.2, true], ['HX.Cl', -7.0, true], ['HX.Br', -9, false], ['HX.I', -10, false],
    ['OH.carboxylic', 4.8, true], ['OH.peracid', 8.2, true], ['OH.enol', 10.0, true], ['OH.water', 15.74, true],
    ['OH.gemdiol', 13.3, true], ['OH.alcohol.methanol', 15.5, true], ['OH.alcohol.primary', 16.0, true],
    ['OH.alcohol.secondary', 17.1, true], ['OH.alcohol.tertiary', 18.0, true], ['OH.oxime', 12.4, true],
    ['OH.hydroperoxide', 11.6, false], ['OH.oxonium.hydronium', -1.7, false], ['OH.oxonium.alcohol', -2.4, false],
    ['OH.oxonium.ether', -3.5, false], ['OH.oxonium.carbonyl', -7, false], ['OH.oxonium.carboxylic', -6, false],
    ['OH.oxonium.amide', -1, false],
    ['NH.ammonium.nh4', 9.26, true], ['NH.ammonium.primary', 10.6, true], ['NH.ammonium.secondary', 11.0, true],
    ['NH.ammonium.tertiary', 10.8, true], ['NH.anilinium', 4.6, true], ['NH.amide', 17, false], ['NH.imide', 9, false],
    ['NH.sulfonamide', 10, false], ['NH.aniline', 30, false], ['NH.amine.nh3', 36, true], ['NH.amine.primary', 36, true],
    ['NH.amine.secondary', 40, true], ['NH.amide-ion', 99, false],
    ['SH.thiol', 10.3, true], ['SH.thiol.benzylic', 9.4, true], ['SH.thiophenol', 6.6, true], ['SH.h2s', 7.0, false],
    ['SH.sulfonium', -7, false],
    ['CH.hcn', 9.31, true], ['CH.alkyne', 25, true], ['CH.alpha.aldehyde', 17, true], ['CH.alpha.ketone', 19, true],
    ['CH.alpha.acid-chloride', 16, true], ['CH.alpha.thioester', 21, true], ['CH.alpha.ester', 25, true],
    ['CH.alpha.nitrile', 25, true], ['CH.alpha.amide', 30, true], ['CH.alpha.carboxylic', 25, false],
    ['CH.alpha.nitro.0', 10.3, true], ['CH.alpha.nitro.1', 8.5, true], ['CH.alpha.nitro.2', 7.7, true],
    ['CH.alpha.sulfoxide', 35, true], ['CH.alpha.sulfone', 28, true],
    ['CH.alpha.ketone+ketone', 9, true], ['CH.alpha.ester+ketone', 11, true], ['CH.alpha.ester+ester', 13, true],
    ['CH.alpha.nitrile+nitrile', 11.2, true], ['CH.alpha.aldehyde+ketone', 5.8, true], ['CH.alpha.ketone+nitro', 5.1, true],
    ['CH.alpha.ester+nitro', 5.8, true], ['CH.alpha.ketone+sulfoxide', 10.0, true], ['CH.alpha.nitro+nitro+nitro', 0.1, true],
    ['CH.vinylic', 44, true], ['CH.allylic.1', 41, false], ['CH.allylic.2', 34, false], ['CH.allylic.3', 32, false],
    ['CH.alkane', 60, true], ['CH.carbanion', 99, false], ['CH.carbocation', 99, false], ['XH.other', 99, false],
  ];
  it('holds exactly the design rows with their pKa and verified flag', () => {
    expect(Object.keys(PKA).sort()).toEqual(rows.map((r) => r[0]).sort());
    for (const [id, pKa, verified] of rows) {
      const e = PKA[id]!;
      expect(e.id, id).toBe(id);
      expect(e.pKa, id).toBe(pKa);
      expect(e.verified, id).toBe(verified);
      expect(e.label.length, id).toBeGreaterThan(0);
      expect(e.source.length, id).toBeGreaterThan(0);
    }
  });
  it('cites the design sources; unverified rows cite GENERAL', () => {
    expect(PKA_SOURCES.T2_3).toBe('MM 2.8 T2.3 (m00025)');
    expect(PKA_SOURCES.APP_B).toBe('MM App B (m00030)');
    expect(PKA_SOURCES.T9_1).toBe('MM 9.7 T9.1 (m00109)');
    expect(PKA_SOURCES.T17_1).toBe('MM 17.2 T17.1 (m00201)');
    expect(PKA_SOURCES.T20_3).toBe('MM 20.2 T20.3 (m00231)');
    expect(PKA_SOURCES.T22_1).toBe('MM 22.5 T22.1 (m00261)');
    expect(PKA_SOURCES.T24_1).toBe('MM 24.3 T24.1 (m00291)');
    expect(PKA_SOURCES.T24_2).toBe('MM 24.4 T24.2 (m00292)');
    expect(PKA_SOURCES.CHEM2E_H).toBe('Chem 2e App H (m68866)');
    expect(PKA_SOURCES.GENERAL).toBe('general textbook value, not tabulated by McMurry (unverified)');
    for (const e of Object.values(PKA)) {
      // unverified rows cite GENERAL, except the allylic family whose App B analogues (toluene, Ph2CH2, Ph3CH) are recorded
      if (!e.verified && !e.id.startsWith('CH.allylic.')) expect(e.source, e.id).toContain(PKA_SOURCES.GENERAL);
      if (e.verified) expect(e.source, e.id).not.toContain('unverified');
    }
    expect(PKA['CH.allylic.1']!.source).toBe('MM App B (m00030) (toluene)');
    expect(PKA['OH.carboxylic']!.source).toBe('MM App B (m00030) (T2.3: 4.76)');
    expect(PKA['HX.Cl']!.source).toBe(PKA_SOURCES.T2_3);
    expect(PKA['CH.alkane']!.source).toContain(PKA_SOURCES.T9_1);
    expect(PKA['NH.amine.nh3']!.source).toContain(PKA_SOURCES.APP_B);
    expect(PKA['CH.alpha.ketone']!.source).toContain(PKA_SOURCES.T22_1);
    expect(PKA['NH.ammonium.primary']!.source).toContain(PKA_SOURCES.T24_1);
  });
  it('R12: alkane C–H is the single constant 60; NH3 is quoted as 36', () => {
    expect(PKA['CH.alkane']!.pKa).toBe(60);
    expect(PKA['NH.amine.nh3']!.pKa).toBe(36);
  });
  it('PKA_TEXT_ONLY carries the quiz-only constants', () => {
    const values = Object.values(PKA_TEXT_ONLY).map((e) => e.pKa).sort((x, y) => x - y);
    expect(values).toEqual([-1.8, 0.4, 1.0, 1.3, 1.74, 3.86, 3.98, 5.08, 5.25, 5.34, 5.4, 6.15, 6.95, 7.15, 7.9, 9.38, 10.17, 10.46, 15.0, 23].sort((x, y) => x - y));
    for (const e of Object.values(PKA_TEXT_ONLY)) {
      expect(PKA[e.id], e.id).toBeUndefined();
      expect(e.verified, e.id).toBe(true);
    }
  });
});

describe('acidity.ts: PKA_MOD table (design 10.3)', () => {
  it('carboxylic modifiers', () => {
    const d = (k: string): number | undefined => PKA_MOD[k]!.delta;
    const o = (k: string): number | undefined => PKA_MOD[k]!.override;
    expect(d('formic')).toBe(-1.1);
    expect(d('arylvinyl')).toBe(-0.6);
    expect(d('aF1')).toBe(-2.1);
    expect(d('aCl1')).toBe(-2.0);
    expect(d('aBr1')).toBe(-1.9);
    expect(d('aI1')).toBe(-1.6);
    expect(o('aCl2')).toBe(1.3);
    expect(o('aCl3')).toBe(0.5);
    expect(o('aF3')).toBe(0.5);
    expect(d('aOH')).toBe(-1.0);
    expect(d('aOR')).toBe(-1.2);
    expect(d('aCN')).toBe(-2.3);
    expect(d('aNO2')).toBe(-3.5);
    expect(d('aCO')).toBe(-2.4);
    expect(d('aCOOH')).toBe(-2.0);
    expect(o('oxalic')).toBe(1.2);
    expect(d('bX')).toBe(-0.8);
    expect(d('tert')).toBe(0.2);
    for (const k of ['formic', 'arylvinyl', 'aF1', 'aCl1', 'aBr1', 'aI1', 'aCl2', 'aCl3', 'aF3', 'aOH', 'aOR', 'aCN', 'aNO2', 'aCO', 'aCOOH', 'oxalic', 'bX', 'tert']) {
      expect(PKA_MOD[k]!.verified, k).toBe(true);
      expect(PKA_MOD[k]!.source.length, k).toBeGreaterThan(0);
    }
  });
  it('alcohol modifiers', () => {
    expect(PKA_MOD.bF1!.delta).toBe(-1.2);
    expect(PKA_MOD.bF2!.delta).toBe(-2.4);
    expect(PKA_MOD.bF3!.delta).toBe(-3.6);
    expect(PKA_MOD.bCl1!.delta).toBe(-1.7);
    expect(PKA_MOD.bCl2!.delta).toBe(-3.1);
    expect(PKA_MOD.bCl3!.delta).toBe(-3.8);
    expect(PKA_MOD.allylic!.delta).toBe(-0.5);
    for (const k of ['bF1', 'bF2', 'bF3', 'bCl1', 'bCl2', 'bCl3', 'allylic']) expect(PKA_MOD[k]!.verified, k).toBe(true);
    for (const h of ['Br', 'I']) {
      for (const n of [1, 2, 3]) {
        const m = PKA_MOD[`b${h}${n}`]!;
        expect(m.delta, `b${h}${n}`).toBe(PKA_MOD[`bCl${n}`]!.delta);
        expect(m.verified, `b${h}${n}`).toBe(false);
      }
    }
  });
});

describe('acidity.ts: BASIC table (design 10.7)', () => {
  const rows: readonly [string, number, boolean][] = [
    ['B.C.acetylide', 25, true], ['B.C.vinyl', 44, true], ['B.C.enolate', 19, true], ['B.C.alkyl', 60, true],
    ['B.N.amide-ion.primary', 36, true], ['B.N.amide-ion.secondary', 40, true], ['B.N.amide', -1, false],
    ['B.N.nitrile', -10, false], ['B.N.imine', 7, false], ['B.N.conjugated', 4.6, true],
    ['B.N.amine.nh3', 9.26, true], ['B.N.amine.primary', 10.6, true], ['B.N.amine.secondary', 11.0, true], ['B.N.amine.tertiary', 10.8, true],
    ['B.O.hydroxide', 15.74, true], ['B.O.carboxylate', 4.8, true], ['B.O.phenoxide', 10, true], ['B.O.enolate', 19, true],
    ['B.O.alkoxide.methoxide', 15.5, true], ['B.O.alkoxide.primary', 16.0, true], ['B.O.alkoxide.secondary', 17.1, true], ['B.O.alkoxide.tertiary', 18.0, true],
    ['B.O.amide', -1, false], ['B.O.ester', -6.5, false], ['B.O.acid', -6, false], ['B.O.carbonyl', -7, false],
    ['B.O.water', -1.7, false], ['B.O.alcohol', -2.4, false], ['B.O.ether', -3.5, false],
    ['B.S.thiolate', 10.3, true], ['B.S.thiol', -7, false],
    ['B.X.halide.F', 3.2, true], ['B.X.halide.Cl', -7, true], ['B.X.halide.Br', -9, false], ['B.X.halide.I', -10, false],
    ['B.X.bound', -10, false], ['B.other', -10, false],
  ];
  it('holds exactly the design rows (pKa field = pKaH)', () => {
    expect(Object.keys(BASIC).sort()).toEqual(rows.map((r) => r[0]).sort());
    for (const [id, pKaH, verified] of rows) {
      expect(BASIC[id]!.id, id).toBe(id);
      expect(BASIC[id]!.pKa, id).toBe(pKaH);
      expect(BASIC[id]!.verified, id).toBe(verified);
      if (!verified) expect(BASIC[id]!.source, id).toContain(PKA_SOURCES.GENERAL);
    }
    expect(BASIC['B.O.enolate']!.pKa).toBe(BASIC['B.C.enolate']!.pKa);
    expect(BASIC['B.X.halide.F']!.pKa).toBe(PKA['HX.F']!.pKa);
    expect(BASIC['B.X.halide.Cl']!.pKa).toBe(PKA['HX.Cl']!.pKa);
  });
});

// ---------------------------------------------------------------------------
// hydrogenSites: classification rules (design 10.5)
// ---------------------------------------------------------------------------

describe('acidity.ts: hydrogenSites classification', () => {
  it('halogen acids', () => {
    expect(hClass('F', 0)).toMatchObject({ classId: 'HX.F', pKa: 3.2, verified: true, classKey: 'HX.F|' });
    expect(hClass('Cl', 0)).toMatchObject({ classId: 'HX.Cl', pKa: -7, verified: true });
    expect(hClass('Br', 0)).toMatchObject({ classId: 'HX.Br', pKa: -9, verified: false });
    expect(hClass('I', 0)).toMatchObject({ classId: 'HX.I', pKa: -10, verified: false });
  });

  describe('oxygen', () => {
    it('rule 1: oxonium ions', () => {
      expect(hClass('[OH3+]', 0)).toMatchObject({ classId: 'OH.oxonium.hydronium', pKa: -1.7, verified: false });
      expect(hClass('C[OH2+]', 1)).toMatchObject({ classId: 'OH.oxonium.alcohol', pKa: -2.4 });
      expect(hClass('C[OH+]C', 1)).toMatchObject({ classId: 'OH.oxonium.ether', pKa: -3.5 });
      expect(hClass('CC(C)=[OH+]', 3)).toMatchObject({ classId: 'OH.oxonium.carbonyl', pKa: -7 });
      expect(hClass('CC=[OH+]', 2)).toMatchObject({ classId: 'OH.oxonium.carbonyl', pKa: -7 });
      expect(hClass('CC(O)=[OH+]', 3)).toMatchObject({ classId: 'OH.oxonium.carboxylic', pKa: -6 });
      expect(hClass('CC(N)=[OH+]', 3)).toMatchObject({ classId: 'OH.oxonium.amide', pKa: -1 });
    });
    it('rule 2: carboxylic acids with modifiers', () => {
      expect(hClass('CC(=O)O', 3)).toMatchObject({ classId: 'OH.carboxylic', classKey: 'OH.carboxylic|', pKa: 4.8, verified: true, label: 'O–H of a carboxylic acid' });
      expect(hClass('OC=O', 0)).toMatchObject({ classKey: 'OH.carboxylic|formic', pKa: 3.7, verified: true });
      expect(hClass('C=CC(=O)O', 4)).toMatchObject({ classKey: 'OH.carboxylic|arylvinyl', pKa: 4.2, verified: true });
      expect(hClass('OC(=O)c1ccccc1', 0)).toMatchObject({ classKey: 'OH.carboxylic|arylvinyl', pKa: 4.2, verified: true });
      expect(hClass('OC(=O)C1=CC=CC=C1', 0)).toMatchObject({ classKey: 'OH.carboxylic|arylvinyl', pKa: 4.2 });
      expect(hClass('FCC(=O)O', 4)).toMatchObject({ classKey: 'OH.carboxylic|aF1', pKa: 2.7, verified: true });
      expect(hClass('ClCC(=O)O', 4)).toMatchObject({ classKey: 'OH.carboxylic|aCl1', pKa: 2.8, verified: true });
      expect(hClass('BrCC(=O)O', 4)).toMatchObject({ classKey: 'OH.carboxylic|aBr1', pKa: 2.9, verified: true });
      expect(hClass('ICC(=O)O', 4)).toMatchObject({ classKey: 'OH.carboxylic|aI1', pKa: 3.2, verified: true });
      expect(hClass('ClC(Cl)C(=O)O', 5)).toMatchObject({ classKey: 'OH.carboxylic|aCl2', pKa: 1.3, verified: true });
      expect(hClass('ClC(Cl)(Cl)C(=O)O', 6)).toMatchObject({ classKey: 'OH.carboxylic|aCl3', pKa: 0.5, verified: true });
      expect(hClass('FC(F)(F)C(=O)O', 6)).toMatchObject({ classKey: 'OH.carboxylic|aF3', pKa: 0.5, verified: true });
      expect(hClass('OCC(=O)O', 4)).toMatchObject({ classKey: 'OH.carboxylic|aOH', pKa: 3.8, verified: true });
      expect(hClass('OCC(=O)O', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|', pKa: 16.0 });
      expect(hClass('COCC(=O)O', 5)).toMatchObject({ classKey: 'OH.carboxylic|aOR', pKa: 3.6, verified: true });
      expect(hClass('N#CCC(=O)O', 5)).toMatchObject({ classKey: 'OH.carboxylic|aCN', pKa: 2.5, verified: true });
      expect(hClass('[O-][N+](=O)CC(=O)O', 6)).toMatchObject({ classKey: 'OH.carboxylic|aNO2', pKa: 1.3, verified: true });
      expect(hClass('CC(=O)C(=O)O', 5)).toMatchObject({ classKey: 'OH.carboxylic|aCO', pKa: 2.4, verified: true });
      expect(hClass('OC(=O)CC(=O)O', 0)).toMatchObject({ classKey: 'OH.carboxylic|aCOOH', pKa: 2.8, verified: true });
      expect(hClass('OC(=O)C(=O)O', 0)).toMatchObject({ classKey: 'OH.carboxylic|oxalic', pKa: 1.2, verified: true });
      expect(hClass('BrCCC(=O)O', 5)).toMatchObject({ classKey: 'OH.carboxylic|bX', pKa: 4.0, verified: true });
      expect(hClass('CC(C)(C)C(=O)O', 6)).toMatchObject({ classKey: 'OH.carboxylic|tert', pKa: 5.0, verified: true });
      expect(hClass('CCC(=O)O', 4)).toMatchObject({ classKey: 'OH.carboxylic|', pKa: 4.8 });
    });
    it('rule 2: other multi-halogen counts/mixes and stacked modifiers are unverified', () => {
      // difluoroacetic: 4.8 - 2 x 2.1 = 0.6
      expect(hClass('FC(F)C(=O)O', 5)).toMatchObject({ classKey: 'OH.carboxylic|aF2', pKa: 0.6, verified: false });
      // dibromoacetic: 4.8 - 3.8 = 1.0
      expect(hClass('BrC(Br)C(=O)O', 5)).toMatchObject({ classKey: 'OH.carboxylic|aBr2', pKa: 1.0, verified: false });
      // chlorofluoroacetic: mix of two single (verified) deltas is unverified
      expect(hClass('FC(Cl)C(=O)O', 5)).toMatchObject({ classKey: 'OH.carboxylic|aCl1,aF1', pKa: 0.7, verified: false });
      // α-OH + α-CN: two non-halogen modifiers
      expect(hClass('N#CC(O)C(=O)O', 6)).toMatchObject({ classKey: 'OH.carboxylic|aCN,aOH', pKa: 1.5, verified: false });
      // triiodoacetic: 4.8 - 4.8 = 0 -> clamped to 0.2
      expect(hClass('IC(I)(I)C(=O)O', 6)).toMatchObject({ classKey: 'OH.carboxylic|aI3', pKa: 0.2, verified: false });
    });
    it('rule 3: peracids and hydroperoxides', () => {
      expect(hClass('CC(=O)OO', 4)).toMatchObject({ classId: 'OH.peracid', classKey: 'OH.peracid|', pKa: 8.2, verified: true });
      expect(hClass('OOC=O', 0)).toMatchObject({ classKey: 'OH.peracid|formic', pKa: 7.1, verified: true });
      expect(hClass('COO', 2)).toMatchObject({ classId: 'OH.hydroperoxide', pKa: 11.6, verified: false });
      expect(hClass('OO', 0)).toMatchObject({ classId: 'OH.hydroperoxide', pKa: 11.6 });
    });
    it('rule 4: oxime', () => {
      expect(hClass('CC=NO', 3)).toMatchObject({ classId: 'OH.oxime', pKa: 12.4, verified: true });
      // hydroxylamine (N without a C=N) is not an oxime
      expect(hClass('NO', 1).classId).not.toBe('OH.oxime');
    });
    it('rule 5: enol and phenol', () => {
      expect(hClass('C=CO', 2)).toMatchObject({ classId: 'OH.enol', pKa: 10.0, verified: true });
      expect(hClass('Oc1ccccc1', 0)).toMatchObject({ classId: 'OH.enol', pKa: 10.0 });
      expect(hClass('OC1=CC=CC=C1', 0)).toMatchObject({ classId: 'OH.enol', pKa: 10.0 });
    });
    it('rule 6: water', () => {
      expect(hClass('O', 0)).toMatchObject({ classId: 'OH.water', pKa: 15.74, verified: true });
    });
    it('rule 7: gem-diol', () => {
      expect(hClass('CC(O)O', 2)).toMatchObject({ classId: 'OH.gemdiol', classKey: 'OH.gemdiol|', pKa: 13.3, verified: true });
      expect(hClass('CC(O)O', 3).classKey).toBe('OH.gemdiol|');
      // a vicinal diol is two ordinary alcohols
      expect(hClass('OCCO', 0)).toMatchObject({ classId: 'OH.alcohol.primary', pKa: 16.0 });
    });
    it('rule 8: alcohols by degree with modifiers', () => {
      expect(hClass('CO', 1)).toMatchObject({ classKey: 'OH.alcohol.methanol|', pKa: 15.5, verified: true });
      expect(hClass('CCO', 2)).toMatchObject({ classKey: 'OH.alcohol.primary|', pKa: 16.0, verified: true });
      expect(hClass('CC(C)O', 3)).toMatchObject({ classKey: 'OH.alcohol.secondary|', pKa: 17.1, verified: true });
      expect(hClass('CC(C)(C)O', 4)).toMatchObject({ classKey: 'OH.alcohol.tertiary|', pKa: 18.0, verified: true });
      expect(hClass('OCC(F)(F)F', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|bF3', pKa: 12.4, verified: true });
      expect(hClass('OCCF', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|bF1', pKa: 14.8, verified: true });
      expect(hClass('OCC(F)F', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|bF2', pKa: 13.6, verified: true });
      expect(hClass('OCCCl', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|bCl1', pKa: 14.3, verified: true });
      expect(hClass('OCC(Cl)Cl', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|bCl2', pKa: 12.9, verified: true });
      expect(hClass('OCC(Cl)(Cl)Cl', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|bCl3', pKa: 12.2, verified: true });
      expect(hClass('OCCBr', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|bBr1', pKa: 14.3, verified: false });
      expect(hClass('OCCI', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|bI1', pKa: 14.3, verified: false });
      expect(hClass('OCC=C', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|allylic', pKa: 15.5, verified: true });
      expect(hClass('OCc1ccccc1', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|allylic', pKa: 15.5, verified: true });
      expect(hClass('OCC#C', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|allylic', pKa: 15.5, verified: true });
      // four beta-fluorines on two beta carbons: 2-propanol 17.1 - 4.8 = 12.3 (unlisted count, unverified)
      expect(hClass('OC(C(F)F)C(F)F', 0)).toMatchObject({ classKey: 'OH.alcohol.secondary|bF4', pKa: 12.3, verified: false });
      // a halogen on the carbinol carbon itself is not beta
      expect(hClass('OC(Cl)C', 0)).toMatchObject({ classKey: 'OH.alcohol.primary|', pKa: 16.0 });
    });
    it('an O–H on something else falls through to XH.other', () => {
      expect(hClass('NO', 1)).toMatchObject({ classId: 'XH.other', pKa: 99, verified: false });
    });
  });

  describe('nitrogen', () => {
    it('rule 1: ammonium and anilinium ions', () => {
      expect(hClass('[NH4+]', 0)).toMatchObject({ classId: 'NH.ammonium.nh4', pKa: 9.26, verified: true });
      expect(hClass('C[NH3+]', 1)).toMatchObject({ classId: 'NH.ammonium.primary', pKa: 10.6, verified: true });
      expect(hClass('C[NH2+]C', 1)).toMatchObject({ classId: 'NH.ammonium.secondary', pKa: 11.0, verified: true });
      expect(hClass('C[NH+](C)C', 1)).toMatchObject({ classId: 'NH.ammonium.tertiary', pKa: 10.8, verified: true });
      expect(hClass('[NH3+]c1ccccc1', 0)).toMatchObject({ classId: 'NH.anilinium', pKa: 4.6, verified: true });
      expect(hClass('C=C[NH3+]', 2)).toMatchObject({ classId: 'NH.anilinium', pKa: 4.6 });
    });
    it('rule 2: amide ion', () => {
      expect(hClass('[NH2-]', 0)).toMatchObject({ classId: 'NH.amide-ion', pKa: 99, verified: false });
      expect(hClass('C[NH-]', 1)).toMatchObject({ classId: 'NH.amide-ion', pKa: 99 });
    });
    it('rule 3: amides and imides', () => {
      expect(hClass('CC(N)=O', 2)).toMatchObject({ classId: 'NH.amide', pKa: 17, verified: false });
      expect(hClass('CNC(C)=O', 1)).toMatchObject({ classId: 'NH.amide', pKa: 17 });
      expect(hClass('CC(=O)NC(C)=O', 3)).toMatchObject({ classId: 'NH.imide', pKa: 9, verified: false });
    });
    it('rule 4: sulfonamide (sulfinyl drawing)', () => {
      expect(hClass('C[S+]([O-])N', 3)).toMatchObject({ classId: 'NH.sulfonamide', pKa: 10, verified: false });
    });
    it('rule 5: aniline and enamine', () => {
      expect(hClass('Nc1ccccc1', 0)).toMatchObject({ classId: 'NH.aniline', pKa: 30, verified: false });
      expect(hClass('NC1=CC=CC=C1', 0)).toMatchObject({ classId: 'NH.aniline', pKa: 30 });
      expect(hClass('C=CN', 2)).toMatchObject({ classId: 'NH.aniline', pKa: 30 });
    });
    it('rule 6: amines', () => {
      expect(hClass('N', 0)).toMatchObject({ classId: 'NH.amine.nh3', pKa: 36, verified: true });
      expect(hClass('CN', 1)).toMatchObject({ classId: 'NH.amine.primary', pKa: 36, verified: true });
      expect(hClass('CNC', 1)).toMatchObject({ classId: 'NH.amine.secondary', pKa: 40, verified: true });
      expect(sitesOn(prep('CN(C)C').a, 1)).toEqual([]);
    });
  });

  describe('sulfur', () => {
    it('rules 1-5', () => {
      expect(hClass('C[SH+]C', 1)).toMatchObject({ classId: 'SH.sulfonium', pKa: -7, verified: false });
      expect(hClass('C[SH2+]', 1)).toMatchObject({ classId: 'SH.sulfonium', pKa: -7 });
      expect(hClass('S', 0)).toMatchObject({ classId: 'SH.h2s', pKa: 7.0, verified: false });
      expect(hClass('Sc1ccccc1', 0)).toMatchObject({ classId: 'SH.thiophenol', pKa: 6.6, verified: true });
      expect(hClass('C=CS', 2)).toMatchObject({ classId: 'SH.thiophenol', pKa: 6.6 });
      expect(hClass('SCc1ccccc1', 0)).toMatchObject({ classId: 'SH.thiol.benzylic', pKa: 9.4, verified: true });
      expect(hClass('SCC=C', 0)).toMatchObject({ classId: 'SH.thiol.benzylic', pKa: 9.4 });
      expect(hClass('CS', 1)).toMatchObject({ classId: 'SH.thiol', pKa: 10.3, verified: true });
      expect(hClass('CCS', 2)).toMatchObject({ classId: 'SH.thiol', pKa: 10.3 });
    });
  });

  describe('carbon', () => {
    it('rule 1: carbanion and carbocation hydrogens are not acidic', () => {
      expect(hClass('[CH3-]', 0)).toMatchObject({ classId: 'CH.carbanion', pKa: 99, verified: false });
      expect(hClass('[CH3+]', 0)).toMatchObject({ classId: 'CH.carbocation', pKa: 99, verified: false });
    });
    it('rule 2: HCN', () => {
      expect(hClass('C#N', 0)).toMatchObject({ classId: 'CH.hcn', pKa: 9.31, verified: true });
    });
    it('rule 3: terminal alkyne', () => {
      expect(hClass('C#C', 0)).toMatchObject({ classId: 'CH.alkyne', pKa: 25, verified: true });
      expect(hClass('CC#C', 2)).toMatchObject({ classId: 'CH.alkyne', pKa: 25 });
      expect(hClass('CCCCC#C', 5)).toMatchObject({ classId: 'CH.alkyne', pKa: 25 });
    });
    it('rule 4: vinylic (including the formyl C–H of an aldehyde and aromatic C–H)', () => {
      expect(hClass('C=C', 0)).toMatchObject({ classId: 'CH.vinylic', pKa: 44, verified: true });
      expect(hClass('CC=O', 1)).toMatchObject({ classId: 'CH.vinylic', pKa: 44 });
      expect(hClass('C=O', 0)).toMatchObject({ classId: 'CH.vinylic', pKa: 44 });
      expect(hClass('c1ccccc1', 0)).toMatchObject({ classId: 'CH.vinylic', pKa: 44 });
      expect(hClass('C1=CC=CC=C1', 3)).toMatchObject({ classId: 'CH.vinylic', pKa: 44 });
      expect(hClass('C=C=C', 0)).toMatchObject({ classId: 'CH.vinylic', pKa: 44 });
    });
    it('rule 4 before rule 5: sp2 C–H next to an activating group is vinylic, never alpha', () => {
      for (const s of ['C=CC=O', 'C=CC#N', 'C=CC(=O)O', 'O=CC=O']) {
        const { a } = prep(s);
        expect(a.hydrogens.length, s).toBeGreaterThan(0);
        for (const site of a.hydrogens) {
          expect(site.classId.startsWith('CH.alpha.'), `${s} atom ${site.parentId}`).toBe(false);
          if (site.classId.startsWith('CH.')) expect(site, `${s} atom ${site.parentId}`).toMatchObject({ classId: 'CH.vinylic', pKa: 44 });
        }
      }
    });
    it('rule 5: single activating neighbour', () => {
      expect(hClass('CC=O', 0)).toMatchObject({ classId: 'CH.alpha.aldehyde', pKa: 17, verified: true });
      expect(hClass('CC(C)=O', 0)).toMatchObject({ classId: 'CH.alpha.ketone', pKa: 19, verified: true, label: 'C–H alpha to a ketone' });
      expect(hClass('CC(=O)Cl', 0)).toMatchObject({ classId: 'CH.alpha.acid-chloride', pKa: 16, verified: true });
      expect(hClass('CC(=O)Br', 0)).toMatchObject({ classId: 'CH.alpha.acid-chloride', pKa: 16 });
      expect(hClass('CC(=O)SC', 0)).toMatchObject({ classId: 'CH.alpha.thioester', pKa: 21, verified: true });
      expect(hClass('CC(=O)OC', 0)).toMatchObject({ classId: 'CH.alpha.ester', pKa: 25, verified: true });
      expect(hClass('CC#N', 0)).toMatchObject({ classId: 'CH.alpha.nitrile', pKa: 25, verified: true });
      expect(hClass('CC(N)=O', 0)).toMatchObject({ classId: 'CH.alpha.amide', pKa: 30, verified: true });
      expect(hClass('CC(=O)O', 0)).toMatchObject({ classId: 'CH.alpha.carboxylic', pKa: 25, verified: false });
      expect(hClass('CC(=O)[O-]', 0)).toMatchObject({ classId: 'CH.alpha.carboxylic', pKa: 25, verified: false });
      expect(hClass('C[N+](=O)[O-]', 0)).toMatchObject({ classId: 'CH.alpha.nitro.0', pKa: 10.3, verified: true });
      expect(hClass('CC[N+](=O)[O-]', 1)).toMatchObject({ classId: 'CH.alpha.nitro.1', pKa: 8.5, verified: true });
      expect(hClass('CC(C)[N+](=O)[O-]', 1)).toMatchObject({ classId: 'CH.alpha.nitro.2', pKa: 7.7, verified: true });
      expect(hClass('C[S+](C)[O-]', 0)).toMatchObject({ classId: 'CH.alpha.sulfoxide', pKa: 35, verified: true });
      // an ester's alkoxy carbon is not alpha: the activating neighbour is O, not the carbonyl C
      expect(hClass('CC(=O)OC', 4)).toMatchObject({ classId: 'CH.alkane', pKa: 60 });
      // the acetyl methyl of methyl acetate counts the ester once: C attached to carbonyl C
      expect(hClass('COC(C)=O', 3)).toMatchObject({ classId: 'CH.alpha.ester', pKa: 25 });
    });
    it('rule 5: two activating neighbours (listed pairs are verified, ids sorted)', () => {
      expect(hClass('CC(=O)CC(C)=O', 3)).toMatchObject({ classId: 'CH.alpha.ketone+ketone', classKey: 'CH.alpha.ketone+ketone|', pKa: 9, verified: true });
      expect(hClass('CC(=O)CC(=O)OC', 3)).toMatchObject({ classId: 'CH.alpha.ester+ketone', pKa: 11, verified: true });
      expect(hClass('COC(=O)CC(=O)OC', 4)).toMatchObject({ classId: 'CH.alpha.ester+ester', pKa: 13, verified: true });
      expect(hClass('N#CCC#N', 2)).toMatchObject({ classId: 'CH.alpha.nitrile+nitrile', pKa: 11.2, verified: true });
      expect(hClass('CC(=O)CC=O', 3)).toMatchObject({ classId: 'CH.alpha.aldehyde+ketone', pKa: 5.8, verified: true });
      expect(hClass('CC(=O)C[N+](=O)[O-]', 3)).toMatchObject({ classId: 'CH.alpha.ketone+nitro', pKa: 5.1, verified: true });
      expect(hClass('COC(=O)C[N+](=O)[O-]', 4)).toMatchObject({ classId: 'CH.alpha.ester+nitro', pKa: 5.8, verified: true });
      expect(hClass('CC(=O)C[S+](C)[O-]', 3)).toMatchObject({ classId: 'CH.alpha.ketone+sulfoxide', pKa: 10.0, verified: true });
    });
    it('rule 5: unlisted pairs and triples are estimated and unverified', () => {
      // amide + ketone: min(30, 19) - 8 = 11
      expect(hClass('CC(=O)CC(N)=O', 3)).toMatchObject({ classId: 'CH.alpha.amide+ketone', pKa: 11, verified: false });
      // aldehyde + nitrile: min(17, 25) - 8 = 9
      expect(hClass('N#CCC=O', 2)).toMatchObject({ classId: 'CH.alpha.aldehyde+nitrile', pKa: 9, verified: false });
      // trinitromethane
      expect(hClass('C([N+](=O)[O-])([N+](=O)[O-])[N+](=O)[O-]', 0)).toMatchObject({ classId: 'CH.alpha.nitro+nitro+nitro', pKa: 0.1, verified: true });
      // triacetylmethane: 19 - 12 = 7
      expect(hClass('CC(=O)C(C(C)=O)C(C)=O', 3)).toMatchObject({ classId: 'CH.alpha.ketone+ketone+ketone', pKa: 7, verified: false });
      // two nitro + one ketone: min(10.3 [nitro.2], 19) - 12 -> nitro id is CH.alpha.nitro.<degree>; degree of the CH is 1
      const dinitro = hClass('CC(=O)C([N+](=O)[O-])[N+](=O)[O-]', 3);
      expect(dinitro.classId).toBe('CH.alpha.ketone+nitro+nitro');
      expect(dinitro.verified).toBe(false);
      expect(dinitro.pKa).toBe(8.5 - 12);
    });
    it('rule 6: allylic / propargylic / benzylic counts', () => {
      expect(hClass('CC=C', 0)).toMatchObject({ classId: 'CH.allylic.1', pKa: 41, verified: false, label: 'allylic, propargylic or benzylic C–H' });
      expect(hClass('Cc1ccccc1', 0)).toMatchObject({ classId: 'CH.allylic.1', pKa: 41 });
      expect(hClass('CC#C', 0)).toMatchObject({ classId: 'CH.allylic.1', pKa: 41 });
      expect(hClass('C=CCC=C', 2)).toMatchObject({ classId: 'CH.allylic.2', pKa: 34, verified: false });
      expect(hClass('C(c1ccccc1)c1ccccc1', 0)).toMatchObject({ classId: 'CH.allylic.2', pKa: 34 });
      expect(hClass('C(c1ccccc1)(c1ccccc1)c1ccccc1', 0)).toMatchObject({ classId: 'CH.allylic.3', pKa: 32, verified: false });
      // a carbon two bonds away from the pi system is an ordinary alkane C–H
      expect(hClass('CCC=C', 0)).toMatchObject({ classId: 'CH.alkane', pKa: 60 });
    });
    it('rule 7: alkane', () => {
      expect(hClass('C', 0)).toMatchObject({ classId: 'CH.alkane', pKa: 60, verified: true, label: 'alkane C–H' });
      expect(hClass('CCl', 0)).toMatchObject({ classId: 'CH.alkane', pKa: 60 });
      expect(hClass('CO', 0)).toMatchObject({ classId: 'CH.alkane', pKa: 60 });
      expect(hClass('C[C+](C)C', 0)).toMatchObject({ classId: 'CH.alkane', pKa: 60 });
      expect(hClass('C[O-]', 0)).toMatchObject({ classId: 'CH.alkane', pKa: 60 });
    });
  });

  it('P hydrogens are XH.other', () => {
    expect(hClass('P', 0)).toMatchObject({ classId: 'XH.other', pKa: 99, verified: false });
    expect(hClass('CP', 1)).toMatchObject({ classId: 'XH.other', pKa: 99 });
  });

  it('emits one site per hydrogen in id order with slots 0..n-1; explicit H blocks first with explicitPos', () => {
    const { a } = prep('CCO');
    expect(a.hydrogens.map((s) => [s.parentId, s.slot])).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [2, 0]]);
    for (const s of a.hydrogens) expect(s.explicitPos).toBeUndefined();

    const g0 = parseSmiles('CO').graph;
    const atoms: WorldAtom[] = g0.atoms.map((at, i) => ({
      ...at, explicitH: null, pos: [i, 0, 0] as const,
      hPos: i === 0 ? [[0, 1, 0] as const, [0, -1, 0] as const] : [[1, 1, 0] as const],
    }));
    const g = buildGraph(atoms, g0.bonds);
    const sites = hydrogenSites(g, atomInfo(g, implicitHydrogens(g).hydrogens));
    expect(sites.map((s) => [s.parentId, s.slot, s.explicitPos])).toEqual([
      [0, 0, [0, 1, 0]], [0, 1, [0, -1, 0]], [0, 2, undefined], [1, 0, [1, 1, 0]],
    ]);
    expect(sites[3]).toMatchObject({ classId: 'OH.alcohol.methanol', pKa: 15.5 });
  });

  it('classKey never contains the atom id: butanone has ONE alpha class on C2 and C4', () => {
    const { a } = prep('CCC(C)=O');
    const c1 = sitesOn(a, 1);
    const c3 = sitesOn(a, 3);
    expect(c1).toHaveLength(2);
    expect(c3).toHaveLength(3);
    expect(c1[0]!.classKey).toBe('CH.alpha.ketone|');
    expect(c3[0]!.classKey).toBe('CH.alpha.ketone|');
    expect(sitesOn(a, 0)[0]!.classKey).toBe('CH.alkane|');
    expect(a.mostAcidic.map((s) => s.parentId)).toEqual([1, 1, 3, 3, 3]);
    expect(new Set(a.mostAcidic.map((s) => s.classKey)).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// basicSites (design 10.7)
// ---------------------------------------------------------------------------

describe('acidity.ts: basicSites classification', () => {
  it('candidates: lone pair with charge != +1, or any C-/N-/O-/S-', () => {
    expect(prep('[NH4+]').a.basicSites).toEqual([]);
    expect(prep('[OH3+]').a.basicSites).toEqual([]);
    expect(prep('C[C+](C)C').a.basicSites).toEqual([]);
    expect(prep('CCC(C)CC').a.basicSites).toEqual([]);
    expect(prep('C[S+](C)[O-]').a.basicSites.map((b) => b.atomId)).toEqual([3]);
    expect(prep('OCC[NH3+]').a.basicSites.map((b) => b.atomId)).toEqual([0]);
  });
  it('carbon', () => {
    expect(basicOf('C#[C-]', 1)).toMatchObject({ classId: 'B.C.acetylide', pKaH: 25, verified: true, classKey: 'B.C.acetylide|', label: 'lone pair on an acetylide carbanion' });
    expect(basicOf('C=[CH-]', 1)).toMatchObject({ classId: 'B.C.vinyl', pKaH: 44, verified: true });
    expect(basicOf('CC(=O)[CH2-]', 3)).toMatchObject({ classId: 'B.C.enolate', pKaH: 19, verified: true });
    expect(basicOf('[CH3-]', 0)).toMatchObject({ classId: 'B.C.alkyl', pKaH: 60, verified: true });
    expect(basicOf('CC[CH2-]', 2)).toMatchObject({ classId: 'B.C.alkyl', pKaH: 60 });
  });
  it('nitrogen', () => {
    expect(basicOf('[NH2-]', 0)).toMatchObject({ classId: 'B.N.amide-ion.primary', pKaH: 36, verified: true });
    expect(basicOf('C[NH-]', 1)).toMatchObject({ classId: 'B.N.amide-ion.primary', pKaH: 36 });
    expect(basicOf('CC(C)[N-]C(C)C', 3)).toMatchObject({ classId: 'B.N.amide-ion.secondary', pKaH: 40, verified: true });
    expect(basicOf('CC(N)=O', 2)).toMatchObject({ classId: 'B.N.amide', pKaH: -1, verified: false });
    expect(basicOf('CC#N', 2)).toMatchObject({ classId: 'B.N.nitrile', pKaH: -10, verified: false });
    expect(basicOf('CC=N', 2)).toMatchObject({ classId: 'B.N.imine', pKaH: 7, verified: false });
    expect(basicOf('Nc1ccccc1', 0)).toMatchObject({ classId: 'B.N.conjugated', pKaH: 4.6, verified: true });
    expect(basicOf('C=CN', 2)).toMatchObject({ classId: 'B.N.conjugated', pKaH: 4.6 });
    expect(basicOf('N', 0)).toMatchObject({ classId: 'B.N.amine.nh3', pKaH: 9.26, verified: true });
    expect(basicOf('CN', 1)).toMatchObject({ classId: 'B.N.amine.primary', pKaH: 10.6, verified: true, label: 'lone pair on a primary amine nitrogen' });
    expect(basicOf('CNC', 1)).toMatchObject({ classId: 'B.N.amine.secondary', pKaH: 11.0, verified: true });
    expect(basicOf('CN(C)C', 1)).toMatchObject({ classId: 'B.N.amine.tertiary', pKaH: 10.8, verified: true });
    expect(basicOf('CCN(CC)CC', 2)).toMatchObject({ classId: 'B.N.amine.tertiary', pKaH: 10.8 });
  });
  it('oxygen anions', () => {
    expect(basicOf('[OH-]', 0)).toMatchObject({ classId: 'B.O.hydroxide', pKaH: 15.74, verified: true });
    expect(basicOf('CC(=O)[O-]', 3)).toMatchObject({ classId: 'B.O.carboxylate', pKaH: 4.8, verified: true });
    expect(basicOf('CC(=O)[O-]', 2)).toMatchObject({ classId: 'B.O.carboxylate', pKaH: 4.8 });
    expect(basicOf('[O-]c1ccccc1', 0)).toMatchObject({ classId: 'B.O.phenoxide', pKaH: 10, verified: true });
    expect(basicOf('[O-]C1=CC=CC=C1', 0)).toMatchObject({ classId: 'B.O.phenoxide', pKaH: 10 });
    expect(basicOf('CC([O-])=C', 2)).toMatchObject({ classId: 'B.O.enolate', pKaH: 19, verified: true });
    expect(basicOf('C[O-]', 1)).toMatchObject({ classId: 'B.O.alkoxide.methoxide', pKaH: 15.5, verified: true });
    expect(basicOf('CC[O-]', 2)).toMatchObject({ classId: 'B.O.alkoxide.primary', pKaH: 16.0, verified: true });
    expect(basicOf('CC(C)[O-]', 3)).toMatchObject({ classId: 'B.O.alkoxide.secondary', pKaH: 17.1, verified: true });
    expect(basicOf('CC(C)(C)[O-]', 4)).toMatchObject({ classId: 'B.O.alkoxide.tertiary', pKaH: 18.0, verified: true });
  });
  it('neutral oxygen', () => {
    expect(basicOf('CC(N)=O', 3)).toMatchObject({ classId: 'B.O.amide', pKaH: -1, verified: false });
    expect(basicOf('CC(=O)OC', 2)).toMatchObject({ classId: 'B.O.ester', pKaH: -6.5, verified: false });
    expect(basicOf('CC(=O)OC', 3)).toMatchObject({ classId: 'B.O.ester', pKaH: -6.5 });
    expect(basicOf('CC(=O)O', 2)).toMatchObject({ classId: 'B.O.acid', pKaH: -6, verified: false });
    expect(basicOf('CC(=O)O', 3)).toMatchObject({ classId: 'B.O.acid', pKaH: -6 });
    expect(basicOf('CC(C)=O', 3)).toMatchObject({ classId: 'B.O.carbonyl', pKaH: -7, verified: false });
    expect(basicOf('CC=O', 2)).toMatchObject({ classId: 'B.O.carbonyl', pKaH: -7 });
    expect(basicOf('O', 0)).toMatchObject({ classId: 'B.O.water', pKaH: -1.7, verified: false });
    expect(basicOf('CO', 1)).toMatchObject({ classId: 'B.O.alcohol', pKaH: -2.4, verified: false });
    expect(basicOf('COC', 1)).toMatchObject({ classId: 'B.O.ether', pKaH: -3.5, verified: false });
    expect(basicOf('Oc1ccccc1', 0)).toMatchObject({ classId: 'B.O.alcohol', pKaH: -2.4 });
  });
  it('sulfur, halogens and the rest', () => {
    expect(basicOf('C[S-]', 1)).toMatchObject({ classId: 'B.S.thiolate', pKaH: 10.3, verified: true });
    expect(basicOf('CS', 1)).toMatchObject({ classId: 'B.S.thiol', pKaH: -7, verified: false });
    expect(basicOf('CSC', 1)).toMatchObject({ classId: 'B.S.thiol', pKaH: -7 });
    expect(basicOf('[F-]', 0)).toMatchObject({ classId: 'B.X.halide.F', pKaH: 3.2, verified: true });
    expect(basicOf('[Cl-]', 0)).toMatchObject({ classId: 'B.X.halide.Cl', pKaH: -7, verified: true });
    expect(basicOf('[Br-]', 0)).toMatchObject({ classId: 'B.X.halide.Br', pKaH: -9, verified: false });
    expect(basicOf('[I-]', 0)).toMatchObject({ classId: 'B.X.halide.I', pKaH: -10, verified: false });
    expect(basicOf('CCl', 1)).toMatchObject({ classId: 'B.X.bound', pKaH: -10, verified: false });
    expect(basicOf('CBr', 1)).toMatchObject({ classId: 'B.X.bound', pKaH: -10 });
    expect(basicOf('C[S+](C)[O-]', 3)).toMatchObject({ classId: 'B.other', pKaH: -10, verified: false });
    expect(basicOf('C[N+](=O)[O-]', 3)).toMatchObject({ classId: 'B.other', pKaH: -10 });
    expect(basicOf('C[N+](=O)[O-]', 2)).toMatchObject({ classId: 'B.other', pKaH: -10 });
    expect(basicOf('CP', 1)).toMatchObject({ classId: 'B.other', pKaH: -10 });
  });
  it('sites come in atom id order with classKey = classId + "|"', () => {
    const sites = prep('NCCC(N)=O').a.basicSites;
    expect(sites.map((b) => b.atomId)).toEqual([0, 4, 5]);
    expect(sites.map((b) => b.classKey)).toEqual(['B.N.amine.primary|', 'B.N.amide|', 'B.O.amide|']);
  });
});

// ---------------------------------------------------------------------------
// acidity(): most acidic / most basic, design 11 matrix
// ---------------------------------------------------------------------------

describe('acidity.ts: design 11 matrix rows', () => {
  it('1-2 (R)/(S)-2-butanol', () => {
    for (const s of ['C[C@@H](O)CC', 'C[C@H](O)CC']) {
      expect(mostAcidic(s)).toMatchObject({ classKeys: ['OH.alcohol.secondary|'], pKa: 17.1, parents: [2] });
      expect(mostBasic(s)).toMatchObject({ classIds: ['B.O.alcohol'], pKaH: -2.4 });
    }
  });
  it('3 (S)-2-bromobutane: all 9 H one alkane class; Br is the only base', () => {
    const { a } = prep('C[C@H](Br)CC');
    expect(a.hydrogens).toHaveLength(9);
    expect(new Set(a.hydrogens.map((s) => s.classKey))).toEqual(new Set(['CH.alkane|']));
    expect(a.mostAcidic).toHaveLength(9);
    expect(mostBasic('C[C@H](Br)CC')).toMatchObject({ classIds: ['B.X.bound'], pKaH: -10, atoms: [2] });
  });
  it('4 (S)-alanine', () => {
    expect(mostAcidic('N[C@@H](C)C(=O)O')).toMatchObject({ classKeys: ['OH.carboxylic|'], pKa: 4.8, parents: [5] });
    expect(mostBasic('N[C@@H](C)C(=O)O')).toMatchObject({ classIds: ['B.N.amine.primary'], pKaH: 10.6, atoms: [0] });
  });
  it('5 (R)-lactic acid', () => {
    expect(mostAcidic('C[C@@H](O)C(=O)O')).toMatchObject({ classKeys: ['OH.carboxylic|aOH'], pKa: 3.8, parents: [5] });
    expect(mostBasic('C[C@@H](O)C(=O)O')).toMatchObject({ classIds: ['B.O.alcohol'], pKaH: -2.4, atoms: [2] });
  });
  it('6 (R)-glyceraldehyde: primary O–H 16.0 with runner-up alpha-aldehyde 17 (margin 1)', () => {
    expect(mostAcidic('O=C[C@H](O)CO')).toMatchObject({ classKeys: ['OH.alcohol.primary|'], pKa: 16.0, parents: [5] });
    expect(hClass('O=C[C@H](O)CO', 2)).toMatchObject({ classId: 'CH.alpha.aldehyde', pKa: 17 });
    expect(hClass('O=C[C@H](O)CO', 3)).toMatchObject({ classId: 'OH.alcohol.secondary', pKa: 17.1 });
    expect(distinctPkas('O=C[C@H](O)CO').slice(0, 2)).toEqual([16.0, 17]);
    expect(mostBasic('O=C[C@H](O)CO')).toMatchObject({ classIds: ['B.O.alcohol'], pKaH: -2.4 });
  });
  it('7-8 2,3-dibromobutanes', () => {
    for (const s of ['C[C@H](Br)[C@H](Br)C', 'C[C@@H](Br)[C@H](Br)C']) {
      expect(mostAcidic(s)).toMatchObject({ classKeys: ['CH.alkane|'], pKa: 60 });
      expect(mostBasic(s)).toMatchObject({ classIds: ['B.X.bound'], atoms: [2, 4] });
    }
  });
  it('9 (R)-3-methylhexane: alkane only, no basic site', () => {
    expect(mostAcidic('CCC[C@H](C)CC')).toMatchObject({ classKeys: ['CH.alkane|'], pKa: 60 });
    expect(prep('CCC[C@H](C)CC').a.basicSites).toEqual([]);
    expect(prep('CCC[C@H](C)CC').a.mostBasic).toEqual([]);
  });
  it('14 meso-tartaric acid: both carboxylic O–H in one aOH class', () => {
    expect(mostAcidic('OC(=O)[C@H](O)[C@H](O)C(=O)O')).toMatchObject({ classKeys: ['OH.carboxylic|aOH'], pKa: 3.8, parents: [0, 9] });
  });
  it('15 L-threonine', () => {
    expect(mostAcidic('C[C@@H](O)[C@H](N)C(=O)O')).toMatchObject({ classKeys: ['OH.carboxylic|'], pKa: 4.8 });
    expect(mostBasic('C[C@@H](O)[C@H](N)C(=O)O')).toMatchObject({ classIds: ['B.N.amine.primary'], pKaH: 10.6, atoms: [4] });
  });
  it('16 (S)-2-methylcyclohexanone: C2–H and C6–H2 are one alpha-ketone class', () => {
    expect(mostAcidic('C[C@H]1CCCCC1=O')).toMatchObject({ classKeys: ['CH.alpha.ketone|'], pKa: 19, parents: [1, 5] });
    expect(prep('C[C@H]1CCCCC1=O').a.mostAcidic).toHaveLength(3);
    expect(mostBasic('C[C@H]1CCCCC1=O')).toMatchObject({ classIds: ['B.O.carbonyl'], pKaH: -7 });
  });
  it('17 (R)-3-methylcyclohexene', () => {
    expect(mostAcidic('C[C@H]1C=CCCC1')).toMatchObject({ classKeys: ['CH.allylic.1|'], pKa: 41, parents: [1, 4], verified: false });
    expect(hClass('C[C@H]1C=CCCC1', 0)).toMatchObject({ classId: 'CH.alkane', pKa: 60 });
    expect(hClass('C[C@H]1C=CCCC1', 2)).toMatchObject({ classId: 'CH.vinylic', pKa: 44 });
    expect(prep('C[C@H]1C=CCCC1').a.basicSites).toEqual([]);
  });
  it('18 (E)-but-2-ene, 19 (Z)-2-chloro-2-butene, 21 hexa-2,4-diene, 24 propene: allylic 41', () => {
    expect(mostAcidic('C/C=C/C')).toMatchObject({ classKeys: ['CH.allylic.1|'], pKa: 41, parents: [0, 3] });
    expect(prep('C/C=C/C').a.basicSites).toEqual([]);
    expect(mostAcidic('C/C=C(\\Cl)C')).toMatchObject({ classKeys: ['CH.allylic.1|'], pKa: 41, parents: [0, 4] });
    expect(mostBasic('C/C=C(\\Cl)C')).toMatchObject({ classIds: ['B.X.bound'], atoms: [3] });
    expect(mostAcidic('C/C=C/C=C/C')).toMatchObject({ classKeys: ['CH.allylic.1|'], pKa: 41, parents: [0, 5] });
    expect(mostAcidic('CC=C')).toMatchObject({ classKeys: ['CH.allylic.1|'], pKa: 41, parents: [0] });
  });
  it('22 (E)-1,2-dichloroethene: vinylic 44, bound Cl', () => {
    expect(mostAcidic('Cl/C=C/Cl')).toMatchObject({ classKeys: ['CH.vinylic|'], pKa: 44, parents: [1, 2] });
    expect(mostBasic('Cl/C=C/Cl')).toMatchObject({ classIds: ['B.X.bound'], atoms: [0, 3] });
  });
  it('25 3-hydroxypropanoic acid: 4.8, runner-up 16.0', () => {
    expect(mostAcidic('OC(=O)CCO')).toMatchObject({ classKeys: ['OH.carboxylic|'], pKa: 4.8, parents: [0] });
    expect(distinctPkas('OC(=O)CCO').slice(0, 2)).toEqual([4.8, 16.0]);
    expect(mostBasic('OC(=O)CCO')).toMatchObject({ classIds: ['B.O.alcohol'], pKaH: -2.4, atoms: [5] });
  });
  it('26 2-mercaptoethanol: S–H 10.3, runner-up 16.0', () => {
    expect(mostAcidic('OCCS')).toMatchObject({ classKeys: ['SH.thiol|'], pKa: 10.3, parents: [3] });
    expect(distinctPkas('OCCS').slice(0, 2)).toEqual([10.3, 16.0]);
    expect(mostBasic('OCCS')).toMatchObject({ classIds: ['B.O.alcohol'], pKaH: -2.4, atoms: [0] });
  });
  it('27 1-butyne: alkyne 25, runner-up propargylic 41, no base', () => {
    expect(mostAcidic('CCC#C')).toMatchObject({ classKeys: ['CH.alkyne|'], pKa: 25, parents: [3] });
    expect(distinctPkas('CCC#C')).toEqual([25, 41, 60]);
    expect(prep('CCC#C').a.basicSites).toEqual([]);
  });
  it('28 2,4-pentanedione: 9, runner-up 19', () => {
    expect(mostAcidic('CC(=O)CC(=O)C')).toMatchObject({ classKeys: ['CH.alpha.ketone+ketone|'], pKa: 9, parents: [3] });
    expect(distinctPkas('CC(=O)CC(=O)C')).toEqual([9, 19]);
    expect(mostBasic('CC(=O)CC(=O)C')).toMatchObject({ classIds: ['B.O.carbonyl'], pKaH: -7, atoms: [2, 5] });
  });
  it('29 propargyl alcohol: allylic-modified primary O–H 15.5, runner-up 25', () => {
    expect(mostAcidic('OCC#C')).toMatchObject({ classKeys: ['OH.alcohol.primary|allylic'], pKa: 15.5, parents: [0] });
    expect(distinctPkas('OCC#C')).toEqual([15.5, 25, 41]);
    expect(mostBasic('OCC#C')).toMatchObject({ classIds: ['B.O.alcohol'] });
  });
  it('30 acetic acid: 4.8, runner-up alpha-carboxylic 25; both O are acid oxygens (-6, tie)', () => {
    expect(mostAcidic('CC(=O)O')).toMatchObject({ classKeys: ['OH.carboxylic|'], pKa: 4.8, parents: [3] });
    expect(distinctPkas('CC(=O)O')).toEqual([4.8, 25]);
    expect(mostBasic('CC(=O)O')).toMatchObject({ classIds: ['B.O.acid'], pKaH: -6, atoms: [2, 3] });
  });
  it('31 2-ammonioethanol: ammonium N–H 10.6, runner-up 16.0', () => {
    expect(mostAcidic('OCC[NH3+]')).toMatchObject({ classKeys: ['NH.ammonium.primary|'], pKa: 10.6, parents: [3] });
    expect(prep('OCC[NH3+]').a.mostAcidic).toHaveLength(3);
    expect(distinctPkas('OCC[NH3+]').slice(0, 2)).toEqual([10.6, 16.0]);
    expect(mostBasic('OCC[NH3+]')).toMatchObject({ classIds: ['B.O.alcohol'], pKaH: -2.4, atoms: [0] });
  });
  it('32 butanone', () => {
    expect(mostAcidic('CCC(C)=O')).toMatchObject({ classKeys: ['CH.alpha.ketone|'], pKa: 19, parents: [1, 3] });
    expect(hClass('CCC(C)=O', 0)).toMatchObject({ classId: 'CH.alkane', pKa: 60 });
    expect(mostBasic('CCC(C)=O')).toMatchObject({ classIds: ['B.O.carbonyl'], atoms: [4] });
  });
  it('33 ethylamine', () => {
    expect(mostAcidic('CCN')).toMatchObject({ classKeys: ['NH.amine.primary|'], pKa: 36, parents: [2] });
    expect(mostBasic('CCN')).toMatchObject({ classIds: ['B.N.amine.primary'], pKaH: 10.6, atoms: [2] });
  });
  it('34 propanamide: amide N–H 17 (unverified); amide O / N tie at -1', () => {
    expect(mostAcidic('CCC(N)=O')).toMatchObject({ classKeys: ['NH.amide|'], pKa: 17, verified: false, parents: [3] });
    const mb = mostBasic('CCC(N)=O');
    expect(mb.classIds).toEqual(['B.N.amide', 'B.O.amide']);
    expect(mb.pKaH).toBe(-1);
    expect(mb.atoms).toEqual([3, 4]);
    expect(hClass('CCC(N)=O', 1)).toMatchObject({ classId: 'CH.alpha.amide', pKa: 30 });
  });
  it('35 2-aminoethanol: O–H 16.0; N 10.6 beats O -2.4', () => {
    expect(mostAcidic('OCCN')).toMatchObject({ classKeys: ['OH.alcohol.primary|'], pKa: 16.0, parents: [0] });
    expect(mostBasic('OCCN')).toMatchObject({ classIds: ['B.N.amine.primary'], pKaH: 10.6, atoms: [3] });
    expect(basicOf('OCCN', 0)).toMatchObject({ classId: 'B.O.alcohol', pKaH: -2.4 });
  });
  it('36 4-aminobutan-2-one', () => {
    expect(mostAcidic('CC(=O)CCN')).toMatchObject({ classKeys: ['CH.alpha.ketone|'], pKa: 19, parents: [0, 3] });
    expect(mostBasic('CC(=O)CCN')).toMatchObject({ classIds: ['B.N.amine.primary'], pKaH: 10.6, atoms: [5] });
    expect(basicOf('CC(=O)CCN', 2)).toMatchObject({ classId: 'B.O.carbonyl', pKaH: -7 });
  });
  it('37 3-aminopropanamide: amine N 10.6 vs amide N -1', () => {
    expect(mostAcidic('NCCC(N)=O')).toMatchObject({ classKeys: ['NH.amide|'], pKa: 17, verified: false, parents: [4] });
    expect(mostBasic('NCCC(N)=O')).toMatchObject({ classIds: ['B.N.amine.primary'], pKaH: 10.6, atoms: [0] });
    expect(basicOf('NCCC(N)=O', 4)).toMatchObject({ classId: 'B.N.amide', pKaH: -1 });
    // the most-basic-n selector restricted to N: amine beats amide by 11.6 >= PKA_MIN_MARGIN
    const ns = prep('NCCC(N)=O').a.basicSites.filter((b) => b.classId.startsWith('B.N.')).map((b) => b.pKaH).sort((x, y) => y - x);
    expect(ns[0]! - ns[1]!).toBeGreaterThanOrEqual(PKA_MIN_MARGIN);
  });
  it('38 acetonitrile', () => {
    expect(mostAcidic('CC#N')).toMatchObject({ classKeys: ['CH.alpha.nitrile|'], pKa: 25, parents: [0] });
    expect(mostBasic('CC#N')).toMatchObject({ classIds: ['B.N.nitrile'], pKaH: -10, atoms: [2] });
  });
  it('39 acetamide', () => {
    expect(mostAcidic('CC(N)=O')).toMatchObject({ classKeys: ['NH.amide|'], pKa: 17, verified: false });
  });
  it('40 DMSO', () => {
    expect(mostAcidic('C[S+](C)[O-]')).toMatchObject({ classKeys: ['CH.alpha.sulfoxide|'], pKa: 35, parents: [0, 2] });
    expect(mostBasic('C[S+](C)[O-]')).toMatchObject({ classIds: ['B.other'], pKaH: -10, atoms: [3] });
  });
  it('41 tert-butyl cation', () => {
    expect(mostAcidic('C[C+](C)C')).toMatchObject({ classKeys: ['CH.alkane|'], pKa: 60 });
    expect(prep('C[C+](C)C').a.basicSites).toEqual([]);
  });
  it('42 methyl anion', () => {
    expect(mostAcidic('[CH3-]')).toMatchObject({ classKeys: ['CH.carbanion|'], pKa: 99, verified: false });
    expect(mostBasic('[CH3-]')).toMatchObject({ classIds: ['B.C.alkyl'], pKaH: 60, atoms: [0] });
  });
  it('43 ammonium, 44 hydronium: no basic site', () => {
    expect(mostAcidic('[NH4+]')).toMatchObject({ classKeys: ['NH.ammonium.nh4|'], pKa: 9.26, verified: true });
    expect(prep('[NH4+]').a.basicSites).toEqual([]);
    expect(mostAcidic('[OH3+]')).toMatchObject({ classKeys: ['OH.oxonium.hydronium|'], pKa: -1.7, verified: false });
    expect(prep('[OH3+]').a.basicSites).toEqual([]);
  });
  it('45 methoxide', () => {
    expect(mostAcidic('C[O-]')).toMatchObject({ classKeys: ['CH.alkane|'], pKa: 60 });
    expect(mostBasic('C[O-]')).toMatchObject({ classIds: ['B.O.alkoxide.methoxide'], pKaH: 15.5, atoms: [1] });
  });
  it('46 propenal: all four C–H vinylic, one classKey; C2–H is NOT alpha-aldehyde', () => {
    const { a } = prep('C=CC=O');
    expect(a.hydrogens).toHaveLength(4);
    expect(new Set(a.hydrogens.map((s) => s.classKey))).toEqual(new Set(['CH.vinylic|']));
    expect(a.mostAcidic).toHaveLength(4);
    expect(mostBasic('C=CC=O')).toMatchObject({ classIds: ['B.O.carbonyl'], pKaH: -7 });
  });
  it('47 acrylonitrile', () => {
    expect(mostAcidic('C=CC#N')).toMatchObject({ classKeys: ['CH.vinylic|'], pKa: 44 });
    expect(prep('C=CC#N').a.hydrogens.some((s) => s.classId === 'CH.alpha.nitrile')).toBe(false);
    expect(mostBasic('C=CC#N')).toMatchObject({ classIds: ['B.N.nitrile'], pKaH: -10 });
  });
  it('48 acrylic acid: arylvinyl 4.2, runner-up vinylic 44', () => {
    expect(mostAcidic('C=CC(=O)O')).toMatchObject({ classKeys: ['OH.carboxylic|arylvinyl'], pKa: 4.2, verified: true });
    expect(distinctPkas('C=CC(=O)O')).toEqual([4.2, 44]);
    expect(mostBasic('C=CC(=O)O')).toMatchObject({ classIds: ['B.O.acid'], pKaH: -6 });
  });
  it('49 acetone enolate (C- form)', () => {
    expect(mostAcidic('CC(=O)[CH2-]')).toMatchObject({ classKeys: ['CH.alpha.ketone|'], pKa: 19, parents: [0] });
    expect(mostBasic('CC(=O)[CH2-]')).toMatchObject({ classIds: ['B.C.enolate'], pKaH: 19, atoms: [3] });
  });
  it('50 acetone enolate (O- form): same conjugate-acid pKa as the C- form', () => {
    expect(hClass('CC([O-])=C', 3)).toMatchObject({ classId: 'CH.vinylic', pKa: 44 });
    expect(mostAcidic('CC([O-])=C')).toMatchObject({ classKeys: ['CH.allylic.1|'], pKa: 41, verified: false, parents: [0] });
    expect(mostBasic('CC([O-])=C')).toMatchObject({ classIds: ['B.O.enolate'], pKaH: 19, atoms: [2] });
    expect(mostBasic('CC([O-])=C').pKaH).toBe(mostBasic('CC(=O)[CH2-]').pKaH);
  });
  it('51 phenoxide (Kekulé): vinylic C–H, phenoxide O (10, not 19)', () => {
    expect(mostAcidic('[O-]C1=CC=CC=C1')).toMatchObject({ classKeys: ['CH.vinylic|'], pKa: 44 });
    expect(mostBasic('[O-]C1=CC=CC=C1')).toMatchObject({ classIds: ['B.O.phenoxide'], pKaH: 10, atoms: [0] });
    // without aromaticity perception a Kekulé phenoxide would read as an enolate; analyze always perceives first
    const raw = parseSmiles('[O-]C1=CC=CC=C1').graph;
    const rawSites = basicSites(raw, atomInfo(raw, implicitHydrogens(raw).hydrogens));
    expect(rawSites[0]!.classId).toBe('B.O.enolate');
    const perceived = perceiveAromaticity(raw);
    expect(basicSites(perceived, atomInfo(perceived, implicitHydrogens(perceived).hydrogens))[0]!.classId).toBe('B.O.phenoxide');
  });
});

// ---------------------------------------------------------------------------
// acidity(): ties, equivalence, validation facts, warnings
// ---------------------------------------------------------------------------

describe('acidity.ts: acidity(), ties and validation facts', () => {
  it('returns every site plus the PKA_TIE classes', () => {
    const { a } = prep('CC(=O)CC(C)=O');
    expect(a.hydrogens).toHaveLength(8);
    expect(a.basicSites).toHaveLength(2);
    expect(a.mostAcidic.map((s) => s.parentId)).toEqual([3, 3]);
    expect(a.mostBasic.map((b) => b.atomId)).toEqual([2, 6]);
    expect(PKA_TIE).toBe(0.05);
  });
  it('an accidental cross-class tie is one answer set (ester alpha-H 25 vs terminal alkyne 25)', () => {
    const { a } = prep('C#CCC(=O)OC');
    expect(a.mostAcidic.map((s) => s.parentId)).toEqual([0, 2, 2]);
    expect(new Set(a.mostAcidic.map((s) => s.classId))).toEqual(new Set(['CH.alkyne', 'CH.alpha.ester']));
    expect(new Set(a.mostAcidic.map((s) => s.pKa))).toEqual(new Set([25]));
  });
  it('a molecule with no hydrogens has an empty mostAcidic; one with no lone pairs an empty mostBasic', () => {
    const cl = prep('[Cl-]').a;
    expect(cl.hydrogens).toEqual([]);
    expect(cl.mostAcidic).toEqual([]);
    expect(cl.mostBasic.map((b) => b.classId)).toEqual(['B.X.halide.Cl']);
    const ccl4 = prep('ClC(Cl)(Cl)Cl').a;
    expect(ccl4.mostAcidic).toEqual([]);
    expect(ccl4.basicSites).toHaveLength(4);
    const alk = prep('CC(C)C').a;
    expect(alk.basicSites).toEqual([]);
    expect(alk.mostBasic).toEqual([]);
    expect(alk.mostAcidic).toHaveLength(10);
  });
  it('05-content validation facts: shipped select-atom items are verified with margin >= PKA_MIN_MARGIN', () => {
    const margin = (smiles: string): number => {
      const d = distinctPkas(smiles);
      return d.length > 1 ? d[1]! - d[0]! : Infinity;
    };
    expect(mostAcidic('CCO')).toMatchObject({ classKeys: ['OH.alcohol.primary|'], pKa: 16.0, verified: true });
    expect(margin('CCO')).toBe(44);
    // acetic acid vs ethanol scene: global min over both molecules
    expect(mostAcidic('CC(=O)O').pKa).toBe(4.8);
    expect(mostAcidic('CCO').pKa - 4.8).toBeGreaterThanOrEqual(PKA_MIN_MARGIN);
    expect(mostAcidic('OCCS')).toMatchObject({ pKa: 10.3, verified: true });
    expect(margin('OCCS')).toBeCloseTo(5.7);
    expect(mostAcidic('CC(=O)CC(C)=O')).toMatchObject({ pKa: 9, verified: true });
    expect(margin('CC(=O)CC(C)=O')).toBe(10);
    expect(mostAcidic('OCC[NH3+]')).toMatchObject({ pKa: 10.6, verified: true });
    expect(margin('OCC[NH3+]')).toBeCloseTo(5.4);
    expect(mostAcidic('C#CC')).toMatchObject({ classKeys: ['CH.alkyne|'], pKa: 25, verified: true });
    expect(margin('C#CC')).toBe(16);
    const b2 = prep('OCCN').a.basicSites.map((b) => b.pKaH).sort((x, y) => y - x);
    expect(b2[0]! - b2[1]!).toBeGreaterThanOrEqual(PKA_MIN_MARGIN);
    expect(prep('OCCN').a.mostBasic.every((b) => b.verified)).toBe(true);
    // rejected pool items: propanamide (unverified answer class), glycolamide and 3-hydroxypropanoic acid (margin < 3)
    expect(mostAcidic('CCC(N)=O').verified).toBe(false);
    expect(mostAcidic('OCC(N)=O')).toMatchObject({ classKeys: ['OH.alcohol.primary|'], pKa: 16.0 });
    expect(margin('OCC(N)=O')).toBeLessThan(PKA_MIN_MARGIN);
    expect(mostAcidic('OC(=O)CCO').pKa).toBe(4.8);
    expect(margin('OC(=O)CCO')).toBeGreaterThanOrEqual(PKA_MIN_MARGIN);
  });
  it('unverifiedWarnings: one warning per distinct unverified class among mostAcidic and mostBasic', () => {
    expect(unverifiedWarnings(prep('CCC(N)=O').a)).toEqual([
      { kind: 'unverified-pka', classId: 'NH.amide' },
      { kind: 'unverified-pka', classId: 'B.N.amide' },
      { kind: 'unverified-pka', classId: 'B.O.amide' },
    ]);
    expect(unverifiedWarnings(prep('CCO').a)).toEqual([{ kind: 'unverified-pka', classId: 'B.O.alcohol' }]);
    expect(unverifiedWarnings(prep('OCCN').a)).toEqual([]);
    expect(unverifiedWarnings(prep('[OH-]').a)).toEqual([]);
    // acetate: the carboxylate (verified) is the base, but its alpha C–H (unverified) is the only acid site
    expect(unverifiedWarnings(prep('CC(=O)[O-]').a)).toEqual([{ kind: 'unverified-pka', classId: 'CH.alpha.carboxylic' }]);
    expect(unverifiedWarnings(prep('C/C=C/C').a)).toEqual([{ kind: 'unverified-pka', classId: 'CH.allylic.1' }]);
    // several sites of one class produce one warning
    expect(unverifiedWarnings(prep('C[C@H](Br)[C@H](Br)C').a)).toEqual([{ kind: 'unverified-pka', classId: 'B.X.bound' }]);
  });
});

// ---------------------------------------------------------------------------
// predictAcidBase (design 10.8, C2-07 fixtures)
// ---------------------------------------------------------------------------

describe('acidity.ts: predictAcidBase', () => {
  const g = (s: string): MoleculeGraph => parseSmiles(s).graph;
  it('CH3CO2H + OH- : yes (4.8 -> 15.74)', () => {
    const r = predictAcidBase(g('CC(=O)O'), g('[OH-]'));
    expect(r).toMatchObject({ pKaAcid: 4.8, pKaConjugate: 15.74, delta: 10.94, favorsProducts: true });
    expect(r.text).toBe(
      'Reactant acid pKa 4.8 (O–H of a carboxylic acid) → product conjugate acid pKa 15.74 (lone pair on hydroxide ion). '
      + 'Equilibrium favors the weaker acid (higher pKa), so the reaction favors products (Keq ≈ 10^10.94).',
    );
  });
  it('HC≡CH + OH- : no (25 -> 15.74)', () => {
    const r = predictAcidBase(g('C#C'), g('[OH-]'));
    expect(r).toMatchObject({ pKaAcid: 25, pKaConjugate: 15.74, delta: -9.26, favorsProducts: false });
    expect(r.text).toContain('favors reactants (Keq ≈ 10^-9.26)');
    expect(r.text).not.toContain('≈1');
  });
  it('CH3OH + NH2- : yes (15.5 -> 36)', () => {
    expect(predictAcidBase(g('CO'), g('[NH2-]'))).toMatchObject({ pKaAcid: 15.5, pKaConjugate: 36, delta: 20.5, favorsProducts: true });
  });
  it('HCN + CH3CO2- : no (9.31 -> 4.8)', () => {
    const r = predictAcidBase(g('C#N'), g('CC(=O)[O-]'));
    expect(r).toMatchObject({ pKaAcid: 9.31, pKaConjugate: 4.8, delta: -4.51, favorsProducts: false });
    expect(r.text).toContain('(C–H of HCN)');
    expect(r.text).toContain('(lone pair on a carboxylate oxygen)');
  });
  it('CH3SH + EtO- : yes (10.3 -> 16.0)', () => {
    const r = predictAcidBase(g('CS'), g('CC[O-]'));
    expect(r).toMatchObject({ pKaAcid: 10.3, pKaConjugate: 16.0, delta: 5.7, favorsProducts: true });
    expect(r.text).toContain('pKa 16 (');
  });
  it('NH4+ + CH3CO2- : no (9.26 -> 4.8)', () => {
    expect(predictAcidBase(g('[NH4+]'), g('CC(=O)[O-]'))).toMatchObject({ pKaAcid: 9.26, pKaConjugate: 4.8, delta: -4.46, favorsProducts: false });
  });
  it('acetone + EtO- : no (19 -> 16.0); acetone + LDA : yes (19 -> 40)', () => {
    expect(predictAcidBase(g('CC(C)=O'), g('CC[O-]'))).toMatchObject({ pKaAcid: 19, pKaConjugate: 16, delta: -3, favorsProducts: false });
    expect(predictAcidBase(g('CC(C)=O'), g('CC(C)[N-]C(C)C'))).toMatchObject({ pKaAcid: 19, pKaConjugate: 40, delta: 21, favorsProducts: true });
  });
  it('phenol + OH- : yes (10 -> 15.74), Kekulé or aromatic input', () => {
    expect(predictAcidBase(g('OC1=CC=CC=C1'), g('[OH-]'))).toMatchObject({ pKaAcid: 10, pKaConjugate: 15.74, delta: 5.74, favorsProducts: true });
    expect(predictAcidBase(g('Oc1ccccc1'), g('[OH-]'))).toMatchObject({ pKaAcid: 10, favorsProducts: true });
  });
  it('HCl + H2O : yes (-7 -> ≈-1.7), text carries "≈" for an unverified value', () => {
    const r = predictAcidBase(g('Cl'), g('O'));
    expect(r).toMatchObject({ pKaAcid: -7, pKaConjugate: -1.7, delta: 5.3, favorsProducts: true });
    expect(r.text).toBe(
      'Reactant acid pKa ≈-7 (H–Cl) → product conjugate acid pKa ≈-1.7 (lone pair on water). '
      + 'Equilibrium favors the weaker acid (higher pKa), so the reaction favors products (Keq ≈ 10^5.3).',
    );
  });
  it('uses the most acidic H of the acid and the most basic site of the base', () => {
    // 2-mercaptoethanol as acid (S–H 10.3, not O–H 16) against 2-aminoethanol as base (N 10.6, not O -2.4)
    expect(predictAcidBase(g('OCCS'), g('OCCN'))).toMatchObject({ pKaAcid: 10.3, pKaConjugate: 10.6, delta: 0.3, favorsProducts: true });
    // a base whose only sites are weak still counts (delta < 0)
    expect(predictAcidBase(g('CCO'), g('CCO'))).toMatchObject({ pKaAcid: 16, pKaConjugate: -2.4, favorsProducts: false });
  });
  it('a conjugate acid equal to the acid (delta 0) does not favor products', () => {
    expect(predictAcidBase(g('CC(=O)O'), g('CC(=O)[O-]'))).toMatchObject({ delta: 0, favorsProducts: false });
  });
  it('throws when the acid has no hydrogen or the base has no basic site', () => {
    expect(() => predictAcidBase(g('ClC(Cl)(Cl)Cl'), g('[OH-]'))).toThrow('acid has no hydrogens');
    expect(() => predictAcidBase(g('[Cl-]'), g('[OH-]'))).toThrow('acid has no hydrogens');
    expect(() => predictAcidBase(g('CC(=O)O'), g('[NH4+]'))).toThrow('base has no basic site');
    expect(() => predictAcidBase(g('CC(=O)O'), g('CCCC'))).toThrow('base has no basic site');
  });
  it('C2-07 authoring rule: every shipped yes/no pair has |delta| >= 2', () => {
    const pairs: readonly [string, string][] = [
      ['CC(=O)O', '[OH-]'], ['C#C', '[OH-]'], ['CO', '[NH2-]'], ['C#N', 'CC(=O)[O-]'], ['CS', 'CC[O-]'],
      ['[NH4+]', 'CC(=O)[O-]'], ['CC(C)=O', 'CC[O-]'], ['CC(C)=O', 'CC(C)[N-]C(C)C'], ['OC1=CC=CC=C1', '[OH-]'], ['Cl', 'O'],
    ];
    for (const [acid, base] of pairs) {
      expect(Math.abs(predictAcidBase(g(acid), g(base)).delta), `${acid} + ${base}`).toBeGreaterThanOrEqual(2);
    }
  });
});
