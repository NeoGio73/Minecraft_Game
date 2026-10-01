import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { embedOnLattice } from '@/chem/embed';
import { sameMolecule } from '@/chem/compare';
import type { MoleculeGraph, ReactOptions, ReactionResult, StereoPolicy } from '@/chem/types';
import type { ReagentId } from '@/content/types';
import { defaultCard, react } from '@/reactions/react';
import { JUSTIFY, WARN, findCX } from '@/reactions/helpers';
import { applyE2, buildAlkene, eliminationSet } from '@/reactions/elimination';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;
const same = (g: MoleculeGraph, smiles: string, policy: StereoPolicy = 'none'): boolean => sameMolecule(g, parse(smiles), { stereo: policy }).same;

function run(id: ReagentId, smiles: string, opts: ReactOptions = {}): ReactionResult {
  return react(parse(smiles), defaultCard(id), opts);
}

function expectList(list: readonly MoleculeGraph[] | undefined, expected: readonly string[], policy: StereoPolicy = 'none'): void {
  expect(list).toBeDefined();
  expect(list!.length).toBe(expected.length);
  const left = [...expected];
  for (const p of list!) {
    const i = left.findIndex((s) => same(p, s, policy));
    expect(i, `no expected product matches; remaining ${left.join(' ')}`).toBeGreaterThanOrEqual(0);
    left.splice(i, 1);
  }
}

function expectMajor(res: ReactionResult, expected: readonly string[], policy: StereoPolicy = 'none'): void {
  expect(res.noReaction ?? false).toBe(false);
  expectList(res.major, expected, policy);
}

function expectNoReaction(res: ReactionResult, justification: string): void {
  expect(res.noReaction).toBe(true);
  expect(res.major).toEqual([]);
  expect(res.mechanism).toBe('none');
  expect(res.justification).toBe(justification);
}

describe('04 section 9.1 alcohols (ROH_TO_RX)', () => {
  it('54 ROH_HX_HCL 1-methylcyclohexanol -> 1-chloro-1-methylcyclohexane (SN1, no shift)', () => {
    const r = run('ROH_HX_HCL', 'CC1(O)CCCCC1');
    expectMajor(r, ['CC1(Cl)CCCCC1']);
    expect(r).toMatchObject({ mechanism: 'SN1', stereo: 'none', justification: JUSTIFY.rohSn1 });
    expect(r.warnings).toEqual([]);
  });
  it('55 ROH_HX_HBR tert-butanol', () => {
    const r = run('ROH_HX_HBR', 'CC(C)(C)O');
    expectMajor(r, ['CC(C)(C)Br']);
    expect(r.mechanism).toBe('SN1');
  });
  it('56 ROH_HX_HBR 2-butanol: slow, racemic', () => {
    const r = run('ROH_HX_HBR', 'CCC(C)O');
    expectMajor(r, ['CCC(C)Br']);
    expect(r).toMatchObject({ mechanism: 'SN1', stereo: 'racemic', justification: JUSTIFY.rohSlow });
    expect(r.warnings).toContain(WARN.rohSlow);
    const s = run('ROH_HX_HBR', 'C[C@H](O)CC');
    expect(s.major[0]!.atoms.every((a) => a.tet === undefined)).toBe(true);
    expect(s.stereo).toBe('racemic');
  });
  it('57 ROH_SOCL2 1-propanol -> 1-chloropropane', () => {
    const r = run('ROH_SOCL2', 'CCCO');
    expectMajor(r, ['CCCCl']);
    expect(r).toMatchObject({ mechanism: 'SN2', stereo: 'none', justification: JUSTIFY.rohSn2 });
  });
  it('58 ROH_PBR3 2-butanol -> 2-bromobutane', () => {
    const r = run('ROH_PBR3', 'CCC(C)O');
    expectMajor(r, ['CCC(C)Br']);
    expect(r.stereo).toBe('none');
  });
  it('59 ROH_PBR3 (S)-2-butanol -> (R)-2-bromobutane, absolute', () => {
    const r = run('ROH_PBR3', 'C[C@H](O)CC');
    expectMajor(r, ['C[C@@H](Br)CC'], 'absolute');
    expect(same(r.major[0]!, 'C[C@H](Br)CC', 'absolute')).toBe(false);
    expect(r.stereo).toBe('absolute');
  });
  it('60 ROH_PBR3 tert-butanol -> no reaction', () => {
    expectNoReaction(run('ROH_PBR3', 'CC(C)(C)O'), JUSTIFY.rohTertiary);
  });
  it('61 ROH_HF_PYR 1-propanol -> 1-fluoropropane', () => {
    expectMajor(run('ROH_HF_PYR', 'CCCO'), ['CCCF']);
  });
  it('phenol / enol OH is not an alcohol; SN1 with a hydride shift lists both products', () => {
    expectNoReaction(run('ROH_HX_HBR', 'Oc1ccccc1'), JUSTIFY.noSubstrate(defaultCard('ROH_HX_HBR')));
    const r = run('ROH_HX_HCL', 'CC(C)C(C)(C)O');
    expectMajor(r, ['CC(C)C(C)(C)Cl']);
    const b = run('ROH_HX_HBR', 'OC(c1ccccc1)c1ccccc1');
    expectMajor(b, ['BrC(c1ccccc1)c1ccccc1']);
    expect(b.justification).toBe(JUSTIFY.rohSn1);
  });
});

describe('04 section 9.1 substitution / elimination', () => {
  it('62 SN2_NAOH (S)-2-bromobutane: E2 major, inverted alcohol in minor (absolute)', () => {
    const r = run('SN2_NAOH', 'C[C@H](Br)CC');
    expectMajor(r, ['CC=CC']);
    expect(r.mechanism).toBe('E2');
    expect(r.minor!.length).toBe(2);
    expect(r.minor!.some((m) => same(m, 'C=CCC'))).toBe(true);
    expect(r.minor!.some((m) => same(m, 'C[C@@H](O)CC', 'absolute'))).toBe(true);
    expect(r.minor!.some((m) => same(m, 'C[C@H](O)CC', 'absolute'))).toBe(false);
  });
  it('63 SN2_NAOH 1-bromobutane -> 1-butanol, 1-butene minor', () => {
    const r = run('SN2_NAOH', 'CCCCBr');
    expectMajor(r, ['CCCCO']);
    expectList(r.minor, ['C=CCC']);
    expect(r).toMatchObject({ mechanism: 'SN2', stereo: 'none', justification: JUSTIFY.R3_prim });
  });
  it('64 SN2_NAOCH3 tert-butyl bromide -> 2-methylpropene', () => {
    const r = run('SN2_NAOCH3', 'CC(C)(C)Br');
    expectMajor(r, ['C=C(C)C']);
    expect(r.mechanism).toBe('E2');
    expect(r.minor ?? []).toEqual([]);
  });
  it('65 SN2_NAOCH3 1-bromobutane -> methyl butyl ether', () => {
    const r = run('SN2_NAOCH3', 'CCCCBr');
    expectMajor(r, ['CCCCOC']);
    expectList(r.minor, ['C=CCC']);
  });
  it('66 SN2_NAOET 2-bromobutane -> 2-butene (E shown, not graded), 1-butene and ether minor', () => {
    const r = run('SN2_NAOET', 'CCC(C)Br');
    expectMajor(r, ['CC=CC']);
    expect(same(r.major[0]!, 'C/C=C/C', 'ez')).toBe(true);
    expect(same(r.major[0]!, 'C/C=C\\C', 'ez')).toBe(false);
    expectList(r.minor, ['C=CCC', 'CCC(C)OCC']);
    expect(same(r.minor![0]!, 'C=CCC')).toBe(true);
    expect(r.warnings).toContain(WARN.ezAssumedTrans);
    expect(r.mechanism).toBe('E2');
  });
  it('67 SN2_NAOET 2-bromo-2-methylbutane -> 2-methyl-2-butene, 2-methyl-1-butene minor', () => {
    const r = run('SN2_NAOET', 'CCC(C)(C)Br');
    expectMajor(r, ['CC=C(C)C']);
    expectList(r.minor, ['C=C(C)CC']);
    expect(r.major[0]!.bonds.every((b) => b.ez === undefined)).toBe(true);
  });
  it('68 SN2_NAI 1-bromobutane -> 1-iodobutane', () => {
    const r = run('SN2_NAI', 'CCCCBr');
    expectMajor(r, ['CCCCI']);
    expect(r).toMatchObject({ mechanism: 'SN2', justification: JUSTIFY.R4_prim });
    expect(r.minor ?? []).toEqual([]);
  });
  it('69 SN2_NAI tert-butyl bromide -> no reaction', () => {
    expectNoReaction(run('SN2_NAI', 'CC(C)(C)Br'), JUSTIFY.R4_tert_aprotic);
  });
  it('70 SN2_NACN 1-bromobutane -> pentanenitrile', () => {
    expectMajor(run('SN2_NACN', 'CCCCBr'), ['CCCCC#N']);
  });
  it('71-74 off cards: azide, thiol, amine, acetate', () => {
    expectMajor(run('SN2_NAN3', 'CCCCBr'), ['CCCCN=[N+]=[N-]']);
    expectMajor(run('SN2_NASH', 'CCCCBr'), ['CCCCS']);
    expectMajor(run('SN2_NH3', 'CCCCBr'), ['CCCCN']);
    expectMajor(run('SN2_NAOAC', 'CCCCBr'), ['CCCCOC(C)=O']);
  });
  it('75 SN2_ACETYLIDE bromoethane -> 2-pentyne', () => {
    const r = run('SN2_ACETYLIDE', 'CCBr');
    expectMajor(r, ['CC#CCC']);
    expect(r.mechanism).toBe('SN2');
  });
  it('76 SN2_ACETYLIDE bromocyclohexane -> cyclohexene only (ring note)', () => {
    const r = run('SN2_ACETYLIDE', 'BrC1CCCCC1');
    expectMajor(r, ['C1=CCCCC1']);
    expect(r.minor ?? []).toEqual([]);
    expect(r.mechanism).toBe('E2');
    expect(r.justification).toBe(JUSTIFY.R3_sec_baseOnly);
    expect(r.warnings).toContain(WARN.ringConformation);
    expect(r.warnings).not.toContain(WARN.ezAssumedTrans);
    expect(r.major[0]!.bonds.every((b) => b.ez === undefined)).toBe(true);
  });
  it('77 TBUOK 2-bromo-2-methylbutane -> Hofmann 2-methyl-1-butene', () => {
    const r = run('TBUOK', 'CCC(C)(C)Br');
    expectMajor(r, ['C=C(C)CC']);
    expectList(r.minor, ['CC=C(C)C']);
    expect(r.justification).toBe(JUSTIFY.R3_tert);
  });
  it('78 NANH2_BASE 2-bromobutane -> 2-butene, 1-butene minor, no amine', () => {
    const r = run('NANH2_BASE', 'CCC(C)Br');
    expectMajor(r, ['CC=CC']);
    expectList(r.minor, ['C=CCC']);
    expect(r.justification).toBe(JUSTIFY.R3_sec_baseOnly);
  });
  it('79 KOH_ETOH 1-chloro-1-methylcyclohexane -> 1-methylcyclohexene, methylenecyclohexane minor', () => {
    const r = run('KOH_ETOH', 'CC1(Cl)CCCCC1');
    expectMajor(r, ['CC1=CCCCC1']);
    expectList(r.minor, ['C=C1CCCCC1']);
    expect(r.warnings).toContain(WARN.ringConformation);
  });
  it('80 KOH_ETOH bromocyclohexane -> cyclohexene, cyclohexanol minor', () => {
    const r = run('KOH_ETOH', 'BrC1CCCCC1');
    expectMajor(r, ['C1=CCCCC1']);
    expectList(r.minor, ['OC1CCCCC1']);
    expect(r.justification).toBe(JUSTIFY.R3_sec);
    // A ring C=C never carries an EzTag (00-contracts): no E assumption, no warning, and the preview embeds induced.
    expect(r.warnings).not.toContain(WARN.ezAssumedTrans);
    expect(r.major[0]!.bonds.every((b) => b.ez === undefined)).toBe(true);
    const e = embedOnLattice(r.major[0]!);
    expect(e).not.toBeNull();
    expect(e!.suppressedPairs).toEqual([]);
  });
  it('ring E2 / E1 products of every ring size carry no ez tag (cyclopentyl, cyclooctyl, cyclohexanol dehydration)', () => {
    for (const [id, smiles, expected] of [
      ['KOH_ETOH', 'BrC1CCCC1', 'C1=CCCC1'],
      ['KOH_ETOH', 'BrC1CCCCCCC1', 'C1=CCCCCCC1'],
      ['H2SO4_HEAT_ROH', 'OC1CCCCC1', 'C1=CCCCC1'],
    ] as const) {
      const r = run(id, smiles);
      expectMajor(r, [expected]);
      expect(r.major[0]!.bonds.every((b) => b.ez === undefined), smiles).toBe(true);
      expect(r.warnings, smiles).not.toContain(WARN.ezAssumedTrans);
    }
    // acyclic 1,2-disubstituted alkenes still get the E display tag and the warning
    const r = run('H2SO4_HEAT_ROH', 'CCC(C)O');
    expect(r.major[0]!.bonds.some((b) => b.ez !== undefined && b.ez.cis === false)).toBe(true);
    expect(r.warnings).toContain(WARN.ezAssumedTrans);
  });
  it('81 H2O_HEAT tert-butyl bromide -> tert-butanol, 2-methylpropene minor', () => {
    const r = run('H2O_HEAT', 'CC(C)(C)Br');
    expectMajor(r, ['CC(C)(C)O']);
    expectList(r.minor, ['C=C(C)C']);
    expect(r).toMatchObject({ mechanism: 'SN1', stereo: 'none', justification: JUSTIFY.R5_sn1 });
  });
  it('82 H2O_HEAT 1-bromobutane -> no reaction', () => {
    expectNoReaction(run('H2O_HEAT', 'CCCCBr'), JUSTIFY.R5_primary);
  });
  it('83 ETOH_HEAT tert-butyl bromide -> tert-butyl ethyl ether', () => {
    const r = run('ETOH_HEAT', 'CC(C)(C)Br');
    expectMajor(r, ['CCOC(C)(C)C']);
    expectList(r.minor, ['C=C(C)C']);
  });
  it('84 MEOH_HEAT tert-butyl chloride -> tert-butyl methyl ether', () => {
    const r = run('MEOH_HEAT', 'CC(C)(C)Cl');
    expectMajor(r, ['COC(C)(C)C']);
    expectList(r.minor, ['C=C(C)C']);
  });
  it('85 HCOOH_H2O (S)-1-bromo-1-phenylethane -> racemic formate, styrene minor', () => {
    const r = run('HCOOH_H2O', 'C[C@H](Br)c1ccccc1');
    expectMajor(r, ['CC(OC=O)c1ccccc1']);
    expect(r.major[0]!.atoms.every((a) => a.tet === undefined)).toBe(true);
    expectList(r.minor, ['C=Cc1ccccc1']);
    expect(r).toMatchObject({ mechanism: 'SN1', stereo: 'racemic' });
    expect(r.warnings).toContain(WARN.sn1Racemic);
  });
  it('86 H2SO4_HEAT_ROH 1-methylcyclohexanol -> 1-methylcyclohexene, methylenecyclohexane minor', () => {
    const r = run('H2SO4_HEAT_ROH', 'CC1(O)CCCCC1');
    expectMajor(r, ['CC1=CCCCC1']);
    expectList(r.minor, ['C=C1CCCCC1']);
    expect(r).toMatchObject({ mechanism: 'E1', stereo: 'none', justification: JUSTIFY.dehydration });
    expect(r.warnings).toEqual([]);
  });
  it('87 H2SO4_HEAT_ROH 1-propanol -> no reaction; 2-butanol slow', () => {
    expectNoReaction(run('H2SO4_HEAT_ROH', 'CCCO'), JUSTIFY.dehydrationPrimary);
    const s = run('H2SO4_HEAT_ROH', 'CCC(C)O');
    expectMajor(s, ['CC=CC']);
    expect(s.warnings).toContain(WARN.slowDehydration);
    expectList(s.minor, ['C=CCC']);
  });
  it('dehydration with a 1,2-shift (warn) lists both alkene sets; apply keeps the rearranged one', () => {
    const r = run('H2SO4_HEAT_ROH', 'CC(C)(C)C(C)O');
    // cation at C2 (secondary) -> methyl shift to the tertiary cation; Zaitsev from both
    expect(r.mixture).toBe(true);
    expect(r.warnings).toContain(WARN.rearrangement);
    expect(r.major.some((p) => same(p, 'CC(C)(C)C=C'))).toBe(true);
    expect(r.major.some((p) => same(p, 'CC(C)=C(C)C'))).toBe(true);
    const a = run('H2SO4_HEAT_ROH', 'CC(C)(C)C(C)O', { rearrangement: 'apply' });
    expectMajor(a, ['CC(C)=C(C)C']);
    expect(a.warnings).toContain(WARN.rearrangementApplied);
    const i = run('H2SO4_HEAT_ROH', 'CC(C)(C)C(C)O', { rearrangement: 'ignore' });
    expectMajor(i, ['CC(C)(C)C=C']);
  });
  it('96 SN2_NAOH vinyl chloride -> R1; 97 SN2_NAI fluorobutane -> R2; 98 SN2_NAOH butanol -> no substrate', () => {
    expectNoReaction(run('SN2_NAOH', 'C=CCl'), JUSTIFY.R1);
    expectNoReaction(run('SN2_NAI', 'CCCCF'), JUSTIFY.R2);
    expectNoReaction(run('SN2_NAOH', 'CCCCO'), JUSTIFY.noSubstrate(defaultCard('SN2_NAOH')));
    expect(run('SN2_NAOH', 'CCCCO').justification).toBe('NaOH needs a C–X bond (X = Cl, Br, I); this molecule has none.');
  });
  it('100 SN2_NAOH trityl bromide -> triphenylmethanol by SN1', () => {
    const r = run('SN2_NAOH', 'C(Br)(c1ccccc1)(c1ccccc1)c1ccccc1');
    expectMajor(r, ['OC(c1ccccc1)(c1ccccc1)c1ccccc1']);
    expect(r).toMatchObject({ mechanism: 'SN1', stereo: 'none', justification: JUSTIFY.R3_tert_sn1 });
    expect(r.mixture ?? false).toBe(false);
  });
  it('SN1 with a hydride shift (warn / apply / ignore) through H2O_HEAT on 3-methyl-2-bromobutane', () => {
    const r = run('H2O_HEAT', 'CC(C)C(C)Br');
    expectMajor(r, ['CC(C)C(C)O', 'CCC(C)(C)O']);
    expect(r.mixture).toBe(true);
    expect(r.warnings).toContain(WARN.rearrangement);
    expect(r.warnings).toContain(WARN.slowSolvolysis);
    expect(r.minor!.length).toBeGreaterThan(0);
    const a = run('H2O_HEAT', 'CC(C)C(C)Br', { rearrangement: 'apply' });
    expectMajor(a, ['CCC(C)(C)O']);
    const i = run('H2O_HEAT', 'CC(C)C(C)Br', { rearrangement: 'ignore' });
    expectMajor(i, ['CC(C)C(C)O']);
    expect(i.stereo).toBe('racemic');
  });
  it('content vector: (S)-2-bromobutane + NaI -> (R)-2-iodobutane, absolute, SN2 only', () => {
    const r = run('SN2_NAI', 'C[C@H](Br)CC');
    expectMajor(r, ['C[C@@H](I)CC'], 'absolute');
    expect(r).toMatchObject({ mechanism: 'SN2', stereo: 'absolute', justification: JUSTIFY.R4_sec_sn2 });
    expect(r.minor ?? []).toEqual([]);
  });
  it('Zaitsev tie: 3-bromopentane gives one 2-pentene; 2-bromo-3-methylpentane-like tie gives a mixture', () => {
    const r = run('SN2_NAOET', 'CCC(Br)CC');
    expectMajor(r, ['CCC=CC']);
    expect(r.mixture ?? false).toBe(false);
    expectList(r.minor, ['CCC(OCC)CC']);
    // 3-bromo-3-methylhexane: the ethyl and propyl betas both give a trisubstituted alkene
    const t = run('SN2_NAOET', 'CCC(C)(Br)CCC');
    expect(t.mixture).toBe(true);
    expect(t.warnings).toContain(WARN.zaitsevTie);
    expectMajor(t, ['CC=C(C)CCC', 'CCC(C)=CCC']);
    expectList(t.minor, ['C=C(CC)CCC']); // tertiary: E2 only (R3_tert), no ether
  });
  it('multiple C–X sites: warns and reacts the first sp3 site; neopentyl / bulky primary give E2', () => {
    const r = run('SN2_NAI', 'BrCCCCBr');
    expect(r.warnings).toContain(WARN.multipleSites(2, 'C–X'));
    expectMajor(r, ['ICCCCBr']);
    const n = run('SN2_NAOH', 'CC(C)(C)CBr');
    expect(n.noReaction).toBe(true);
    expect(n.justification).toBe(JUSTIFY.R3_neopentyl_noBetaH);
    const b = run('TBUOK', 'CCCCBr');
    expectMajor(b, ['C=CCC']);
    expect(b.justification).toBe(JUSTIFY.R3_bulky);
  });
});

describe('chemistry review v1.0.0: NaNH2 base-only, KOH/EtOH heat, neopentyl, secondary-alcohol shifts, HX slow text', () => {
  it('NANH2_BASE 1-bromobutane -> but-1-ene only (E2); the amine appears nowhere', () => {
    const r = run('NANH2_BASE', 'CCCCBr');
    expectMajor(r, ['C=CCC']);
    expect(r).toMatchObject({ mechanism: 'E2', stereo: 'none', justification: JUSTIFY.R3_prim_baseOnly });
    expect(r.minor ?? []).toEqual([]);
    expect([...r.major, ...(r.minor ?? [])].some((m) => same(m, 'CCCCN'))).toBe(false);
    const e = run('NANH2_BASE', 'CCBr');
    expectMajor(e, ['C=C']);
    expect(e.minor ?? []).toEqual([]);
    expect([...e.major, ...(e.minor ?? [])].some((m) => same(m, 'CCN'))).toBe(false);
  });
  it('NANH2_BASE bromomethane -> no reaction with the methyl justification (no methylamine)', () => {
    expectNoReaction(run('NANH2_BASE', 'CBr'), JUSTIFY.R3_methyl_baseOnly);
    expect(JUSTIFY.R3_methyl_baseOnly).toContain('no β-hydrogen');
  });
  it('acetylide (nuc.atom C) keeps the SN2 alkylation path on methyl / primary halides', () => {
    const r = run('SN2_ACETYLIDE', 'CCCCBr');
    expectMajor(r, ['CCCCC#CC']);
    expect(r).toMatchObject({ mechanism: 'SN2', justification: JUSTIFY.R3_prim });
    expectList(r.minor, ['C=CCC']);
    const m = run('SN2_ACETYLIDE', 'CBr');
    expectMajor(m, ['CC#CC']);
    expect(m).toMatchObject({ mechanism: 'SN2', justification: JUSTIFY.R3_methyl });
  });
  it('KOH_ETOH 1-bromobutane -> but-1-ene major (E2 first), butan-1-ol minor', () => {
    const r = run('KOH_ETOH', 'CCCCBr');
    expectMajor(r, ['C=CCC']);
    expectList(r.minor, ['CCCCO']);
    expect(r).toMatchObject({ mechanism: 'E2', justification: JUSTIFY.R3_prim_heat });
    expect(JUSTIFY.R3_prim_heat).toBe('KOH/ethanol at reflux favors E2 (McMurry 8.1); some substitution.');
    // the same hydroxide without heat keeps SN2 first (row 63)
    expect(run('SN2_NAOH', 'CCCCBr')).toMatchObject({ mechanism: 'SN2', justification: JUSTIFY.R3_prim });
  });
  it('neopentyl bromide + NaOH -> no reaction, explained by the blocked backside attack and the missing β-H', () => {
    const r = run('SN2_NAOH', 'CC(C)(C)CBr');
    expectNoReaction(r, JUSTIFY.R3_neopentyl_noBetaH);
    expect(r.justification).toContain('neopentyl');
    expect(r.justification).toContain('no β-hydrogen');
    expect(r.justification).not.toBe(JUSTIFY.noBetaH);
    expectNoReaction(run('SN2_NAOET', 'CCC(C)(C)CBr'), JUSTIFY.R3_neopentyl_noBetaH);
  });
  it('3-methylbutan-2-ol + HBr: the secondary cation shifts; both bromides listed (warn), rohSlow kept', () => {
    const r = run('ROH_HX_HBR', 'CC(C)C(C)O');
    expectMajor(r, ['CC(C)C(C)Br', 'CCC(C)(C)Br']);
    expect(r).toMatchObject({ mechanism: 'SN1', mixture: true, justification: JUSTIFY.rohSlow });
    expect(r.warnings).toContain(WARN.rearrangement);
    expect(r.warnings).toContain(WARN.rohSlow);
    const a = run('ROH_HX_HBR', 'CC(C)C(C)O', { rearrangement: 'apply' });
    expectMajor(a, ['CCC(C)(C)Br']);
    expect(a.warnings).toContain(WARN.rearrangementApplied);
    expect(a.warnings).toContain(WARN.rohSlow);
    const i = run('ROH_HX_HBR', 'CC(C)C(C)O', { rearrangement: 'ignore' });
    expectMajor(i, ['CC(C)C(C)Br']);
    expect(i.warnings).not.toContain(WARN.rearrangement);
    // a secondary alcohol with no better cation next door still gives the one bromide (row 56)
    const b = run('ROH_HX_HBR', 'CCC(C)O');
    expectMajor(b, ['CCC(C)Br']);
    expect(b.mixture ?? false).toBe(false);
  });
  it('HX on a primary / secondary alcohol: the justification itself says slow, low-yield, SOCl2/PBr3 (McMurry 10.5)', () => {
    const r = run('ROH_HX_HCL', 'CCCO');
    expectMajor(r, ['CCCCl']);
    expect(r.justification).toBe(JUSTIFY.rohSlow);
    expect(r.warnings).toContain(WARN.rohSlow);
    for (const word of ['slow, low-yield', 'SOCl2', 'PBr3', 'McMurry 10.5']) expect(JUSTIFY.rohSlow).toContain(word);
    const s = run('ROH_HX_HBR', 'CCC(C)O');
    expect(s.justification).toBe(JUSTIFY.rohSlow);
  });
});

describe('04 section 9.4 anti-periplanar E2 (preview path)', () => {
  it('meso-1,2-dibromo-1,2-diphenylethane + KOH -> phenyls cis = (E)-1-bromo-1,2-diphenylethene', () => {
    const r = run('KOH_ETOH', 'Br[C@H](c1ccccc1)[C@@H](Br)c1ccccc1');
    expect(r.mechanism).toBe('E2');
    expectMajor(r, ['Br/C(c1ccccc1)=C/c1ccccc1'], 'ez');
    expect(same(r.major[0]!, 'Br/C(c1ccccc1)=C\\c1ccccc1', 'ez')).toBe(false);
    expect(r.warnings).not.toContain(WARN.ezAssumedTrans);
  });
  it('(S,S)-1,2-dibromo-1,2-diphenylethane + KOH -> phenyls trans = Z', () => {
    const r = run('KOH_ETOH', 'Br[C@H](c1ccccc1)[C@H](Br)c1ccccc1');
    expectMajor(r, ['Br/C(c1ccccc1)=C\\c1ccccc1'], 'ez');
    expect(same(r.major[0]!, 'Br/C(c1ccccc1)=C/c1ccccc1', 'ez')).toBe(false);
  });
  it('buildAlkene writes the ez from both tags, in either cX / beta role', () => {
    const g = parse('Br[C@H](c1ccccc1)[C@@H](Br)c1ccccc1');
    const sites = findCX(g);
    const a = buildAlkene(g, sites[0]!.c, sites[1]!.c, sites[0]!.x, true);
    const b = buildAlkene(g, sites[1]!.c, sites[0]!.c, sites[1]!.x, true);
    expect(a.assumedTrans).toBe(false);
    expect(same(a.graph, 'Br/C(c1ccccc1)=C/c1ccccc1', 'ez')).toBe(true);
    expect(same(b.graph, 'Br/C(c1ccccc1)=C/c1ccccc1', 'ez')).toBe(true);
    const e2 = applyE2(g, sites[0]!, 'zaitsev');
    expect(e2.major.length).toBe(1);
    const e1 = eliminationSet(g, sites[0]!.c, sites[0]!.x, 'zaitsev', false);
    expect(e1.major[0]!.bonds.every((bd) => bd.ez === undefined)).toBe(true);
  });
  it('one tagged end only: no E/Z tag, no assumed-trans warning', () => {
    const r = run('SN2_NAOET', 'CC[C@H](Br)CC');
    expectMajor(r, ['CCC=CC']);
    expect(r.major[0]!.bonds.every((b) => b.ez === undefined)).toBe(true);
    expect(r.warnings).not.toContain(WARN.ezAssumedTrans);
  });
});
