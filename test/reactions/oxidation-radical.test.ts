import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { sameMolecule } from '@/chem/compare';
import type { MoleculeGraph, ReactOptions, ReactionResult, StereoPolicy } from '@/chem/types';
import type { ReagentId } from '@/content/types';
import { defaultCard, react } from '@/reactions/react';
import { JUSTIFY, RADICAL_WEIGHTS, WARN } from '@/reactions/helpers';

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

describe('04 section 9.1 cleavage (fragments are a multiset)', () => {
  it('28 O3_ZN isopropylidenecyclohexane -> cyclohexanone + acetone', () => {
    const r = run('O3_ZN', 'CC(C)=C1CCCCC1');
    expectMajor(r, ['O=C1CCCCC1', 'CC(C)=O']);
    expect(r).toMatchObject({ mechanism: 'oxidation', stereo: 'none', mixture: false, justification: JUSTIFY.OZONOLYSIS });
    expect(r.minor).toBeUndefined();
  });
  it('29 O3_ZN 2-methyl-2-butene -> acetone + acetaldehyde', () => {
    const r = run('O3_ZN', 'CC=C(C)C');
    expectMajor(r, ['CC(C)=O', 'CC=O']);
  });
  it('99 O3_ZN 2,3-dimethyl-2-butene -> two acetones kept', () => {
    const r = run('O3_ZN', 'CC(C)=C(C)C');
    expect(r.major.length).toBe(2);
    expectMajor(r, ['CC(C)=O', 'CC(C)=O']);
  });
  it('ozonolysis of a ring C=C gives one dicarbonyl; formaldehyde is built; a diene gives three fragments', () => {
    expectMajor(run('O3_ZN', 'C1=CCCCC1'), ['O=CCCCCC=O']);
    expectMajor(run('O3_ZN', 'C=CCC'), ['C=O', 'CCC=O']);
    expectMajor(run('O3_ZN', 'C=CCC=C'), ['C=O', 'C=O', 'O=CCC=O']);
    expect(run('O3_ZN', 'CCCC').noReaction).toBe(true);
  });
  it('30 KMNO4_HOT 2-methyl-2-butene -> acetone + acetic acid', () => {
    const r = run('KMNO4_HOT', 'CC=C(C)C');
    expectMajor(r, ['CC(C)=O', 'CC(=O)O']);
    expect(r.justification).toBe(JUSTIFY.KMNO4_CLEAVAGE);
    expect(r.warnings).toEqual([]);
  });
  it('31 KMNO4_HOT 3-hexyne -> two propanoic acids', () => {
    const r = run('KMNO4_HOT', 'CCC#CCC');
    expect(r.major.length).toBe(2);
    expectMajor(r, ['CCC(=O)O', 'CCC(=O)O']);
    expect(r.justification).toBe(JUSTIFY.KMNO4_ALKYNE);
  });
  it('32 KMNO4_HOT 1-pentene -> butanoic acid, CO2 lost', () => {
    const r = run('KMNO4_HOT', 'C=CCCC');
    expectMajor(r, ['CCCC(=O)O']);
    expect(r.warnings).toEqual([WARN.co2Lost]);
    const y = run('KMNO4_HOT', 'C#CCCCC');
    expectMajor(y, ['CCCCC(=O)O']);
    expect(y.warnings).toEqual([WARN.co2Lost]);
  });
  it('33 HIO4 cyclohexane-1,2-diol -> hexanedial', () => {
    const r = run('HIO4', 'OC1CCCCC1O');
    expectMajor(r, ['O=CCCCCC=O']);
    expect(r.justification).toBe(JUSTIFY.DIOL_CLEAVAGE);
    expectMajor(run('HIO4', 'CC(O)C(O)C'), ['CC=O', 'CC=O']);
    expect(run('HIO4', 'OCCCO').noReaction).toBe(true);
  });
});

describe('04 section 9.1 radical reactions', () => {
  it('49 NBS_HV cyclohexene -> 3-bromocyclohexene, racemic, single product', () => {
    const r = run('NBS_HV', 'C1=CCCCC1');
    expectMajor(r, ['BrC1CCCC=C1']);
    expect(r).toMatchObject({ mechanism: 'radical', stereo: 'racemic', justification: JUSTIFY.ALLYLIC_BROMINATION });
    expect(r.mixture ?? false).toBe(false);
    expect(r.warnings).toEqual([]);
  });
  it('50 NBS_HV 1-butene -> 3-bromo-1-butene + 1-bromo-2-butene', () => {
    const r = run('NBS_HV', 'C=CCC');
    expectMajor(r, ['C=CC(C)Br', 'CC=CCBr']);
    expect(r.mixture).toBe(true);
    expect(r.stereo).toBe('none');
    expect(r.warnings).toContain(WARN.allylicMixture);
  });
  it('NBS prefers the more substituted allylic C–H; ethylene has none', () => {
    const r = run('NBS_HV', 'CC(C)C=C');
    // 3° allylic C–H wins over the methyls (deg 3 > deg 1)
    expectMajor(r, ['CC(C)(Br)C=C', 'CC(C)=CCBr']);
    expect(run('NBS_HV', 'C=C').noReaction).toBe(true);
  });
  it('51 CL2_HV butane -> 2-chlorobutane 70 % major, 1-chlorobutane 30 % minor', () => {
    const r = run('CL2_HV', 'CCCC');
    expectMajor(r, ['CCC(C)Cl']);
    expectList(r.minor, ['CCCCCl']);
    expect(r.stereo).toBe('racemic');
    expect(r.mixture).toBe(false);
    expect(r.warnings).toEqual([WARN.radicalRatio('Cl', [{ pct: 70, cls: 'secondary' }, { pct: 30, cls: 'primary' }])]);
    expect(r.warnings[0]).toBe('Cl2/hν selectivity: 70% at a secondary C–H, 30% at a primary C–H (McMurry 10.2).');
  });
  it('52 CL2_HV isobutane -> primary 64 % major, tertiary 36 % minor', () => {
    const r = run('CL2_HV', 'CC(C)C');
    expectMajor(r, ['CC(C)CCl']);
    expectList(r.minor, ['CC(C)(C)Cl']);
    expect(r.stereo).toBe('none');
    expect(r.warnings).toEqual([WARN.radicalRatio('Cl', [{ pct: 64, cls: 'primary' }, { pct: 36, cls: 'tertiary' }])]);
  });
  it('53 BR2_HV isobutane -> tert-butyl bromide 99 %', () => {
    const r = run('BR2_HV', 'CC(C)C');
    expectMajor(r, ['CC(C)(C)Br']);
    expectList(r.minor, ['CC(C)CBr']);
    expect(r.warnings).toEqual([WARN.radicalRatio('Br', [{ pct: 99, cls: 'tertiary' }, { pct: 1, cls: 'primary' }])]);
    expect(RADICAL_WEIGHTS.Br[3]).toBe(1640);
  });
  it('methane counts as primary; methylcyclohexane is an alkane; a chloroalkane is not', () => {
    const m = run('CL2_HV', 'C');
    expectMajor(m, ['CCl']);
    expect(m.warnings).toEqual([WARN.radicalRatio('Cl', [{ pct: 100, cls: 'primary' }])]);
    const mc = run('BR2_HV', 'CC1CCCCC1');
    expectMajor(mc, ['CC1(Br)CCCCC1']);
    expect(run('CL2_HV', 'CCCl').noReaction).toBe(true);
    expect(run('CL2_HV', 'CCCl').justification).toBe(JUSTIFY.noSubstrate(defaultCard('CL2_HV')));
  });
});
