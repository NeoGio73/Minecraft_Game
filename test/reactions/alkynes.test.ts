import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { sameMolecule } from '@/chem/compare';
import { embedOnLattice } from '@/chem/embed';
import type { MoleculeGraph, ReactOptions, ReactionResult, StereoPolicy } from '@/chem/types';
import type { ReagentId } from '@/content/types';
import { defaultCard, react } from '@/reactions/react';
import { JUSTIFY, WARN } from '@/reactions/helpers';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;
const same = (g: MoleculeGraph, smiles: string, policy: StereoPolicy = 'none'): boolean => sameMolecule(g, parse(smiles), { stereo: policy }).same;

function run(id: ReagentId, smiles: string, opts: ReactOptions & { readonly rxSmiles?: string } = {}): ReactionResult {
  const { rxSmiles, ...rest } = opts;
  return react(parse(smiles), defaultCard(id), rxSmiles ? { ...rest, rx: parse(rxSmiles) } : rest);
}

function expectMajor(res: ReactionResult, expected: readonly string[], policy: StereoPolicy = 'none'): void {
  expect(res.noReaction ?? false).toBe(false);
  expect(res.major.length).toBe(expected.length);
  const left = [...expected];
  for (const p of res.major) {
    const i = left.findIndex((s) => same(p, s, policy));
    expect(i, `no expected product matches a major product; remaining ${left.join(' ')}`).toBeGreaterThanOrEqual(0);
    left.splice(i, 1);
  }
}

describe('04 section 9.1 HX / X2 / H2 on alkynes', () => {
  it('4 HX_HBR 1-hexyne -> 2-bromo-1-hexene (no E/Z on a =CH2 end)', () => {
    const r = run('HX_HBR', 'C#CCCCC');
    expectMajor(r, ['C=C(Br)CCCC']);
    expect(r.stereo).toBe('none');
    expect(r.justification).toBe(JUSTIFY.HX_ADD_ALKYNE);
    expect(r.major[0]!.bonds.every((b) => b.ez === undefined)).toBe(true);
  });
  it('5 HX_HCL 3-hexyne -> (Z)-3-chlorohex-3-ene, graded ez, embeds with one suppressed pair', () => {
    const r = run('HX_HCL', 'CCC#CCC');
    expectMajor(r, ['CC/C(Cl)=C/CC'], 'ez');
    expect(same(r.major[0]!, 'CC/C(Cl)=C\\CC', 'ez')).toBe(false);
    expect(r.mixture ?? false).toBe(false);
    expect(r.warnings).toEqual([]);
    const e = embedOnLattice(parse('CC/C(Cl)=C/CC'));
    expect(e).not.toBeNull();
    expect(e!.suppressedPairs).toEqual([[3, 5]]);
  });
  it('6 HX_2EQ_HBR 1-hexyne -> geminal dibromide', () => {
    const r = run('HX_2EQ_HBR', 'C#CCCCC');
    expectMajor(r, ['CCCCC(C)(Br)Br']);
    expect(r.justification).toBe(JUSTIFY.HX_ADD_2EQ);
    expect(r.stereo).toBe('none');
  });
  it('7 HX_2EQ_HCL 3-hexyne -> 3,3-dichlorohexane', () => {
    const r = run('HX_2EQ_HCL', 'CCC#CCC');
    expectMajor(r, ['CCCC(Cl)(Cl)CC']);
    expect(r.major[0]!.bonds.every((b) => b.ez === undefined)).toBe(true);
  });
  it('HX_HBR with equiv 2 in free play does the same; tie on an unsymmetrical internal alkyne gives both vinyl halides', () => {
    const r = run('HX_HBR', 'C#CCCCC', { equiv: 2 });
    expectMajor(r, ['CCCCC(C)(Br)Br']);
    const t = run('HX_HBR', 'CC#CCC');
    // both Z: Br cis to the far alkyl on each regioisomer (RDKit: C/C=C(\Br)CC is Z)
    expectMajor(t, ['C/C(Br)=C/CC', 'C/C=C(\\Br)CC'], 'ez');
    expect(t.mixture).toBe(true);
    expect(t.warnings).toContain(WARN.regioMixture);
  });
  it('13 X2_BR2 1-butyne -> (E)-1,2-dibromobut-1-ene, embeds with [[0,4]]', () => {
    const r = run('X2_BR2', 'C#CCC');
    expectMajor(r, ['Br/C=C(/Br)CC'], 'ez');
    expect(same(r.major[0]!, 'Br/C=C(\\Br)CC', 'ez')).toBe(false);
    expect(r.justification).toBe(JUSTIFY.X2_ADD_ALKYNE);
    const e = embedOnLattice(parse('Br/C=C(/Br)CC'));
    expect(e).not.toBeNull();
    expect(e!.suppressedPairs).toEqual([[0, 4]]);
  });
  it('14 X2_BR2 1-butyne, 2 equiv -> tetrabromide', () => {
    const r = run('X2_BR2', 'C#CCC', { equiv: 2 });
    expectMajor(r, ['BrC(Br)C(Br)(Br)CC']);
    expect(r.stereo).toBe('none');
    expect(r.major[0]!.bonds.every((b) => b.ez === undefined)).toBe(true);
  });
  it('22 H2_PD 4-octyne -> octane', () => {
    const r = run('H2_PD', 'CCCC#CCCC');
    expectMajor(r, ['CCCCCCCC']);
    expect(r.mechanism).toBe('reduction');
    expect(r.stereo).toBe('none');
    expect(r.justification).toBe(JUSTIFY.H2_ALKYNE);
  });
});

describe('04 section 9.1 alkyne hydration, reduction, acetylide', () => {
  it('36 HGSO4_HYDRATION 1-hexyne -> 2-hexanone', () => {
    const r = run('HGSO4_HYDRATION', 'C#CCCCC');
    expectMajor(r, ['CCCCC(C)=O']);
    expect(r).toMatchObject({ mechanism: 'addition', stereo: 'none', justification: JUSTIFY.ALKYNE_HYDRATION_HG });
  });
  it('37 HGSO4_HYDRATION 2-pentyne -> both ketones', () => {
    const r = run('HGSO4_HYDRATION', 'CC#CCC');
    expectMajor(r, ['CCC(=O)CC', 'CC(=O)CCC']);
    expect(same(r.major[0]!, 'CCC(=O)CC')).toBe(true);
    expect(r.mixture).toBe(true);
    expect(r.warnings).toContain(WARN.hydrationMixture);
  });
  it('symmetric internal alkyne hydration gives one ketone', () => {
    const r = run('HGSO4_HYDRATION', 'CCC#CCC');
    expectMajor(r, ['CCCC(=O)CC']);
    expect(r.mixture ?? false).toBe(false);
  });
  it('38 HYDROBORATION_ALKYNE 1-hexyne -> hexanal', () => {
    const r = run('HYDROBORATION_ALKYNE', 'C#CCCCC');
    expectMajor(r, ['CCCCCC=O']);
    expect(r.justification).toBe(JUSTIFY.ALKYNE_HYDROBORATION);
  });
  it('39 HYDROBORATION_ALKYNE 3-hexyne -> 3-hexanone', () => {
    // 04 row 39 prints `CCC(=O)CC` (C5H10O); 3-hexyne + H2O is C6H12O.
    const r = run('HYDROBORATION_ALKYNE', 'CCC#CCC');
    expectMajor(r, ['CCCC(=O)CC']);
  });
  it('40 H2_LINDLAR 4-octyne -> (Z)-4-octene; embeds with [[2,5]]', () => {
    const r = run('H2_LINDLAR', 'CCCC#CCCC');
    expectMajor(r, ['CCC/C=C\\CCC'], 'ez');
    expect(same(r.major[0]!, 'CCC/C=C/CCC', 'ez')).toBe(false);
    expect(r).toMatchObject({ mechanism: 'reduction', stereo: 'none', justification: JUSTIFY.LINDLAR });
    const e = embedOnLattice(parse('CCC/C=C\\CCC'));
    expect(e).not.toBeNull();
    expect(e!.suppressedPairs).toEqual([[2, 5]]);
  });
  it('41 LI_NH3 4-octyne -> (E)-4-octene', () => {
    const r = run('LI_NH3', 'CCCC#CCCC');
    expectMajor(r, ['CCC/C=C/CCC'], 'ez');
    expect(same(r.major[0]!, 'CCC/C=C\\CCC', 'ez')).toBe(false);
    expect(r.justification).toBe(JUSTIFY.DISSOLVING_METAL);
  });
  it('Lindlar on a terminal alkyne: terminal alkene, no tag; content vectors 3-hexyne Z / E', () => {
    const r = run('H2_LINDLAR', 'C#CCC');
    expectMajor(r, ['C=CCC']);
    expect(r.major[0]!.bonds.every((b) => b.ez === undefined)).toBe(true);
    expectMajor(run('H2_LINDLAR', 'CCC#CCC'), ['CC/C=C\\CC'], 'ez');
    expectMajor(run('LI_NH3', 'CCC#CCC'), ['CC/C=C/CC'], 'ez');
  });
  it('42 NANH2_THEN_RX 1-hexyne + 1-bromobutane -> 5-decyne', () => {
    const r = run('NANH2_THEN_RX', 'C#CCCCC', { rxSmiles: 'CCCCBr' });
    expectMajor(r, ['CCCCC#CCCCC']);
    expect(r).toMatchObject({ mechanism: 'SN2', stereo: 'none', justification: JUSTIFY.ACETYLIDE_ALKYLATION });
    expect(r.warnings).toEqual([]);
  });
  it('43 NANH2_THEN_RX acetylene + 1-bromopropane -> 1-pentyne', () => {
    const r = run('NANH2_THEN_RX', 'C#C', { rxSmiles: 'CCCBr' });
    expectMajor(r, ['C#CCCC']);
  });
  it('44 NANH2_THEN_RX 1-hexyne + 2-bromopropane -> E2: propene + unchanged alkyne', () => {
    const r = run('NANH2_THEN_RX', 'C#CCCCC', { rxSmiles: 'CC(C)Br' });
    expectMajor(r, ['C=CC', 'C#CCCCC']);
    expect(same(r.major[0]!, 'C=CC')).toBe(true);
    expect(r.mechanism).toBe('E2');
    expect(r.mixture ?? false).toBe(false);
    expect(r.warnings).toContain(WARN.acetylideElimination);
    expect(r.justification).toBe(JUSTIFY.acetylideE2);
  });
  it('45 NANH2_THEN_RX internal alkyne -> no reaction', () => {
    const r = run('NANH2_THEN_RX', 'CCC#CCC', { rxSmiles: 'CCCCBr' });
    expect(r.noReaction).toBe(true);
    expect(r.justification).toBe(JUSTIFY.noSubstrate(defaultCard('NANH2_THEN_RX')));
  });
  it('46 NANH2_THEN_RX without rx -> rxMissing; rx without C–X -> rxNotHalide; vinyl rx -> R1; chloride warns; fluoride refuses', () => {
    const r = run('NANH2_THEN_RX', 'C#CCCCC');
    expect(r.noReaction).toBe(true);
    expect(r.justification).toBe(JUSTIFY.rxMissing);
    expect(run('NANH2_THEN_RX', 'C#CCCCC', { rxSmiles: 'CCCCO' }).justification).toBe(JUSTIFY.rxNotHalide);
    expect(run('NANH2_THEN_RX', 'C#CCCCC', { rxSmiles: 'C=CBr' }).justification).toBe(JUSTIFY.R1);
    const cl = run('NANH2_THEN_RX', 'C#CCCCC', { rxSmiles: 'CCCCCl' });
    expectMajor(cl, ['CCCCC#CCCCC']);
    expect(cl.warnings).toContain(WARN.chlorideSlower);
    expect(run('NANH2_THEN_RX', 'C#CCCCC', { rxSmiles: 'CCCCF' }).justification).toBe(JUSTIFY.R2);
  });
  it('acetylide SN2 on a chiral primary halide inverts the centre: absolute', () => {
    const r = run('NANH2_THEN_RX', 'C#CC', { rxSmiles: 'C[C@H](CC)CBr' });
    expectMajor(r, ['CC#CC[C@H](C)CC'], 'absolute');
    expect(r.stereo).toBe('absolute');
    const s = run('NANH2_THEN_RX', 'C#C', { rxSmiles: 'C[C@H](Br)CC' });
    expect(s.mechanism).toBe('E2');
  });
  it('47 NANH2_2EQ_DIHALIDE 3,4-dibromohexane -> 3-hexyne', () => {
    const r = run('NANH2_2EQ_DIHALIDE', 'CCC(Br)C(Br)CC');
    expectMajor(r, ['CCC#CCC']);
    expect(r).toMatchObject({ mechanism: 'E2', stereo: 'none', justification: JUSTIFY.DOUBLE_E2 });
    expect(r.warnings).toEqual([]);
  });
  it('48 NANH2_2EQ_DIHALIDE 1,2-dibromohexane -> 1-hexyne with the workup note; vinylic halide too', () => {
    const r = run('NANH2_2EQ_DIHALIDE', 'CCCCC(Br)CBr');
    expectMajor(r, ['CCCCC#C']);
    expect(r.warnings).toContain(WARN.acetylideWorkup);
    const v = run('NANH2_2EQ_DIHALIDE', 'CC(Br)=CC');
    expectMajor(v, ['CC#CC']);
  });
});
