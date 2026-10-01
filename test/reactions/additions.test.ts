import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { sameMolecule } from '@/chem/compare';
import { implicitHydrogens } from '@/chem/hydrogens';
import type { MoleculeGraph, ReactOptions, ReactionResult, StereoPolicy } from '@/chem/types';
import type { ReagentId } from '@/content/types';
import { REAGENT_IDS } from '@/content/types';
import { defaultCard, react, REAGENT_CARDS, REACTION_RULES, RULES, CARD_RULE, LEGACY_REAGENT_IDS, legacyReagentId, ROH_MECHANISM } from '@/reactions/react';
import {
  WARN, JUSTIFY, addAcross, applyAdditionStereo, attachFragment, findAlkenes, findAlkynes, findCX, findCOH, markovnikov,
  substrateClasses, substrateInfo, isAllylic, isBenzylic, isNeopentyl, substituteInvert, substituteRacemize, eliminate,
  relaxedLayout, splitComponents, isStereocenter, stripExplicitH, ezTag, tautomerize,
} from '@/reactions/helpers';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;
const same = (g: MoleculeGraph, smiles: string, policy: StereoPolicy = 'none'): boolean => sameMolecule(g, parse(smiles), { stereo: policy }).same;

function run(id: ReagentId, smiles: string, opts: ReactOptions = {}): ReactionResult {
  return react(parse(smiles), defaultCard(id), opts);
}

/** `major` matches `expected` as a multiset under `policy`. */
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

describe('registry', () => {
  it('every reagent id has a card whose rule is in RULES; 27 rules', () => {
    expect(Object.keys(RULES).length).toBe(27);
    expect(REACTION_RULES).toBe(RULES);
    for (const id of REAGENT_IDS) {
      const c = REAGENT_CARDS[id];
      expect(c.id).toBe(id);
      expect(RULES[c.rule]).toBeTypeOf('function');
      expect(CARD_RULE[id]).toBe(c.rule);
      if (c.rule === 'SUBST_ELIM') {
        expect(c.nuc).toBeDefined();
        expect(c.solvent).toBeDefined();
        expect(() => parseSmiles(c.nuc!.fragment)).not.toThrow();
      }
      if (['HX_ADD', 'X2_ADD', 'HOX_ADD', 'RADICAL_HBR', 'ALLYLIC_BROMINATION', 'RADICAL_HALOGENATION', 'ROH_TO_RX'].includes(c.rule)) {
        expect(c.halogen).toBeDefined();
      }
      if (c.requiresDiagonalBonds) expect(c.enabledByDefault).toBe(false);
    }
    expect(REAGENT_CARDS.HBR_ROOR.enabledByDefault).toBe(true);
    expect(REAGENT_CARDS.TBUOK.enabledByDefault).toBe(true);
    for (const off of ['MCPBA', 'EPOXIDE_H3O', 'CH2I2_ZNCU', 'CHCL3_KOH', 'KMNO4_COLD', 'HIO4', 'SN2_NAN3', 'SN2_NASH', 'SN2_NH3', 'SN2_NAOAC', 'ROH_HF_PYR', 'HCOOH_H2O', 'MEOH_HEAT'] as const) {
      expect(REAGENT_CARDS[off].enabledByDefault, off).toBe(false);
    }
    expect(ROH_MECHANISM.ROH_PBR3).toBe('SN2');
    expect(ROH_MECHANISM.ROH_HX_HBR).toBe('SN1');
    expect(defaultCard('HX_HBR')).not.toBe(REAGENT_CARDS.HX_HBR);
  });
  it('legacy ids map to canonical ids', () => {
    expect(LEGACY_REAGENT_IDS.hbr).toBe('HX_HBR');
    expect(LEGACY_REAGENT_IDS['hx_ether(hbr)']).toBe('ROH_HX_HBR');
    expect(legacyReagentId('nanh2_then_bromobutane')).toEqual({ id: 'NANH2_THEN_RX', rx: 'bromobutane' });
    expect(legacyReagentId('h2so4_h2o', parse('C=CC'))?.id).toBe('H3O_HYDRATION');
    expect(legacyReagentId('h2so4_h2o', parse('CC(C)(C)O'))?.id).toBe('H2SO4_HEAT_ROH');
    expect(legacyReagentId('mg_ether')).toBeNull();
  });
  it('react throws on a card with an unknown rule and never for chemistry', () => {
    const bad = { ...defaultCard('HX_HBR'), rule: 'NOPE' as never };
    expect(() => react(parse('C=C'), bad)).toThrow();
    expect(() => run('HX_HBR', 'C')).not.toThrow();
  });
});

describe('site helpers and substrate classes', () => {
  it('finders', () => {
    expect(findAlkenes(parse('C=CC=C')).map((p) => [p.a, p.b])).toEqual([[0, 1], [2, 3]]);
    expect(findAlkenes(parse('c1ccccc1C=C')).length).toBe(1);
    expect(findAlkynes(parse('CC#CC'))[0]).toMatchObject({ a: 1, b: 2, order: 3 });
    expect(findCX(parse('CCBr'))[0]).toMatchObject({ c: 1, x: 2, halogen: 'Br' });
    expect(findCX(parse('CC[Br-]')).length).toBe(0);
    expect(findCOH(parse('CCO'))[0]).toMatchObject({ c: 1, o: 2 });
    expect(findCOH(parse('COC')).length).toBe(0);
    expect(findCOH(parse('CC(=O)O')).length).toBe(1);
  });
  it('substrate classes', () => {
    const cls = (s: string) => [...substrateClasses(parse(s))].sort();
    expect(cls('C=CC')).toEqual(['alkene', 'allylic-alkene']);
    expect(cls('C=C')).toEqual(['alkene']);
    expect(cls('C#CCC')).toEqual(['alkyne', 'terminal-alkyne']);
    expect(cls('CC#CC')).toEqual(['alkyne']);
    expect(cls('CCCCBr')).toEqual(['alkyl-halide']);
    expect(cls('CCC(Br)C(Br)CC')).toEqual(['alkyl-halide', 'vicinal-dihalide']);
    expect(cls('C=C(Br)CC')).toEqual(['alkene', 'allylic-alkene', 'vicinal-dihalide']);
    expect(cls('CCO')).toEqual(['alcohol']);
    expect(cls('OC1CCCCC1O')).toEqual(['alcohol', 'diol']);
    expect(cls('C1CCC2OC2C1')).toEqual(['epoxide']);
    expect(cls('CCCC')).toEqual(['alkane']);
    expect(cls('CC(C)C')).toEqual(['alkane']);
    expect(cls('c1ccccc1')).toEqual([]);
    expect(cls('C=Cc1ccccc1')).toEqual(['alkene']);
    expect(cls('Oc1ccccc1')).toEqual([]);
  });
  it('allylic / benzylic / neopentyl and substrateInfo', () => {
    const allyl = parse('C=CCBr');
    expect(isAllylic(allyl, 2, 3)).toBe(true);
    expect(isAllylic(parse('CCCBr'), 2, 3)).toBe(false);
    expect(isBenzylic(parse('BrCc1ccccc1'), 1, 0)).toBe(true);
    expect(isNeopentyl(parse('CC(C)(C)CBr'), 4, 5)).toBe(true);
    expect(isNeopentyl(parse('CC(C)CBr'), 3, 4)).toBe(false);
    const info = substrateInfo(parse('O=CCCBr'), findCX(parse('O=CCCBr'))[0]!);
    expect(info).toMatchObject({ cls: 1, betaH: 1, betaCarbonyl: true, sp2: false });
    const vinyl = parse('C=CCl');
    expect(substrateInfo(vinyl, findCX(vinyl)[0]!).sp2).toBe(true);
    const aryl = parse('Clc1ccccc1');
    expect(substrateInfo(aryl, findCX(aryl)[0]!).sp2).toBe(true);
    const tert = parse('CCC(C)(C)Br');
    expect(substrateInfo(tert, findCX(tert)[0]!)).toMatchObject({ cls: 3, betaH: 3 });
  });
  it('markovnikov', () => {
    const g = parse('C=C(C)C');
    expect(markovnikov(g, findAlkenes(g)[0]!)).toEqual({ more: 1, less: 0, tie: false });
    const sym = parse('CC=CC');
    expect(markovnikov(sym, findAlkenes(sym)[0]!).tie).toBe(true);
    const sty = parse('C=Cc1ccccc1');
    expect(markovnikov(sty, findAlkenes(sty)[0]!)).toMatchObject({ more: 1, less: 0, tie: false });
    const allylic = parse('C=CC=C');
    // C1 has 0 alkyl groups; C2 is allylic (+1) with 1 alkyl group -> more
    expect(markovnikov(allylic, findAlkenes(allylic)[0]!)).toMatchObject({ more: 1, less: 0 });
  });
});

describe('graph operations', () => {
  it('attachFragment keeps existing ids and appends the fragment', () => {
    const g = parse('CC');
    const r = attachFragment(g, 1, 'OCC');
    expect(r.attached).toBe(2);
    expect(r.graph.atoms.length).toBe(5);
    expect(same(r.graph, 'CCOCC')).toBe(true);
    const az = attachFragment(parse('CCCC'), 3, 'N=[N+]=[N-]').graph;
    expect(same(az, 'CCCCN=[N+]=[N-]')).toBe(true);
    expect(same(az, 'CCCCN=N=N')).toBe(false);
  });
  it('addAcross lowers the bond, drops ez and attaches', () => {
    const g = parse('C/C=C/C');
    const pi = findAlkenes(g)[0]!;
    const r = addAcross(g, pi, 'Br', 'H');
    expect(r.graph.bonds[pi.bond]!.order).toBe(1);
    expect(r.graph.bonds[pi.bond]!.ez).toBeUndefined();
    expect(r.newA).toBe(4);
    expect(r.newB).toBe('H');
    expect(same(r.graph, 'CC(Br)CC')).toBe(true);
    const y = parse('CC#CC');
    const s = addAcross(y, findAlkynes(y)[0]!, 'H', 'Cl');
    expect(s.graph.bonds[1]!.order).toBe(2);
  });
  it('substituteInvert flips the sign in the same slot; racemize drops the tag; eliminate makes the alkene', () => {
    const g = parse('C[C@H](Br)CC');
    const site = findCX(g)[0]!;
    const inv = substituteInvert(g, site, 'O');
    expect(same(inv, 'C[C@@H](O)CC', 'absolute')).toBe(true);
    expect(same(inv, 'C[C@H](O)CC', 'absolute')).toBe(false);
    expect(inv.atoms[1]!.tet).toEqual({ order: [0, 'H', 4, 2], sign: 1 });
    const rac = substituteRacemize(g, site, 'O');
    expect(rac.atoms.every((a) => a.tet === undefined)).toBe(true);
    expect(same(rac, 'CC(O)CC')).toBe(true);
    const e = eliminate(parse('CCC(C)Br'), 2, 1, 4);
    expect(e).toMatchObject({ a: 1, b: 2 });
    expect(e.graph.bonds[e.bond]!.order).toBe(2);
    expect(same(e.graph, 'CC=CC')).toBe(true);
  });
  it('tautomerize gives the keto form; splitComponents densifies; stripExplicitH clears bracket counts', () => {
    const enol = parse('CC(O)=C');
    const keto = tautomerize(enol, 1, 3, 2);
    expect(same(keto, 'CC(C)=O')).toBe(true);
    const parts = splitComponents(parse('CC.O'));
    expect(parts.length).toBe(2);
    expect(parts[0]!.atoms.map((a) => a.id)).toEqual([0, 1]);
    expect(parts[1]!.atoms.length).toBe(1);
    const stripped = stripExplicitH(parse('C[C@H](Br)CC'));
    expect(stripped.atoms.every((a) => a.explicitH === null)).toBe(true);
    expect(stripped.atoms[1]!.tet).toBeDefined();
  });
  it('isStereocenter: gem-dimethyl ring carbon is not a centre; dibromide carbons are', () => {
    const g = parse('CC1(Br)CCCCC1');
    expect(isStereocenter(g, implicitHydrogens(g).hydrogens, 1)).toBe(false);
    const d = parse('BrC1CCCCC1Br');
    const h = implicitHydrogens(d).hydrogens;
    expect(isStereocenter(d, h, 1)).toBe(true);
    expect(isStereocenter(d, h, 6)).toBe(true);
    const p = parse('CC(Br)CBr');
    expect(isStereocenter(p, implicitHydrogens(p).hydrogens, 1)).toBe(true);
  });
  it('ezTag prefers heavy refs and skips =CH2 ends', () => {
    const g = parse('CC=CC');
    const tagged = ezTag(g, findAlkenes(g)[0]!, 'H', 3, true);
    expect(tagged.bonds[1]!.ez).toEqual({ refA: 0, refB: 3, cis: false });
    const t = parse('C=CC');
    expect(ezTag(t, findAlkenes(t)[0]!, 'H', 2, true).bonds[0]!.ez).toBeUndefined();
  });
  it('relaxedLayout places every atom, bonded pairs distinct, components apart', () => {
    const g = parse('C1CC1');
    const pos = relaxedLayout(g);
    expect(pos.length).toBe(3);
    const keys = new Set(pos.map((p) => p.join(',')));
    expect(keys.size).toBe(3);
    for (const b of g.bonds) {
      const d = Math.abs(pos[b.a]![0] - pos[b.b]![0]) + Math.abs(pos[b.a]![1] - pos[b.b]![1]) + Math.abs(pos[b.a]![2] - pos[b.b]![2]);
      expect(d).toBeGreaterThanOrEqual(1);
    }
    const two = relaxedLayout(parse('CC.CC'));
    expect(new Set(two.map((p) => p.join(','))).size).toBe(4);
    expect(Math.min(two[2]![0], two[3]![0]) - Math.max(two[0]![0], two[1]![0])).toBeGreaterThanOrEqual(4);
    const big = relaxedLayout(parse('CC(C)(C)C(C)(C)C'));
    expect(new Set(big.map((p) => p.join(','))).size).toBe(8);
  });
});

describe('04 section 9.1 additions', () => {
  it('1 HX_HCL 2-methylpropene', () => {
    const r = run('HX_HCL', 'C=C(C)C');
    expectMajor(r, ['CC(C)(C)Cl']);
    expect(r).toMatchObject({ mechanism: 'addition', stereo: 'none', reagentId: 'HX_HCL', justification: JUSTIFY.HX_ADD });
    expect(r.warnings).toEqual([]);
  });
  it('2 HX_HBR 1-methylcyclohexene', () => {
    const r = run('HX_HBR', 'CC1=CCCCC1');
    expectMajor(r, ['CC1(Br)CCCCC1']);
    expect(r.stereo).toBe('none');
  });
  it('3 HX_HI 1-pentene -> racemic 2-iodopentane', () => {
    const r = run('HX_HI', 'C=CCCC');
    expectMajor(r, ['CCCC(C)I']);
    expect(r.stereo).toBe('racemic');
  });
  it('8 HX_2EQ_HBR on an alkene: no reaction', () => {
    const r = run('HX_2EQ_HBR', 'C=C(C)C');
    expect(r.noReaction).toBe(true);
    expect(r.justification).toBe(JUSTIFY.twoEquivAlkene);
    expect(r.major).toEqual([]);
    expect(r.mechanism).toBe('none');
  });
  it('9 HBR_ROOR anti-Markovnikov', () => {
    const r = run('HBR_ROOR', 'C=C(C)C');
    expectMajor(r, ['CC(C)CBr']);
    expect(r.mechanism).toBe('radical');
    expect(r.stereo).toBe('none');
  });
  it('10 X2_BR2 cyclohexene -> trans-1,2-dibromocyclohexane (relative)', () => {
    const r = run('X2_BR2', 'C1=CCCCC1');
    expectMajor(r, ['Br[C@H]1CCCC[C@@H]1Br'], 'relative');
    expect(r.stereo).toBe('relative');
    expect(same(r.major[0]!, 'Br[C@H]1CCCC[C@H]1Br', 'relative')).toBe(false);
    expect(same(r.major[0]!, 'Br[C@@H]1CCCC[C@H]1Br', 'relative')).toBe(true);
  });
  it('11 X2_BR2 (E)-but-2-ene -> meso (absolute)', () => {
    const r = run('X2_BR2', 'C/C=C/C');
    expectMajor(r, ['C[C@H](Br)[C@H](Br)C'], 'absolute');
    expect(r.stereo).toBe('relative');
    expect(same(r.major[0]!, 'C[C@@H](Br)[C@H](Br)C', 'relative')).toBe(false);
  });
  it('12 X2_CL2 propene -> racemic', () => {
    const r = run('X2_CL2', 'C=CC');
    expectMajor(r, ['CC(Cl)CCl']);
    expect(r.stereo).toBe('racemic');
    expect(r.major[0]!.atoms.every((a) => a.tet === undefined)).toBe(true);
  });
  it('15 HOX_BR2_H2O 2-methylpropene', () => {
    const r = run('HOX_BR2_H2O', 'C=C(C)C');
    expectMajor(r, ['CC(C)(O)CBr']);
    expect(r.stereo).toBe('none');
    expect(r.justification).toBe(JUSTIFY.HOX_ADD);
  });
  it('16 HOX_CL2_H2O propene -> racemic', () => {
    const r = run('HOX_CL2_H2O', 'C=CC');
    expectMajor(r, ['CC(O)CCl']);
    expect(r.stereo).toBe('racemic');
  });
  it('17 H3O_HYDRATION 1-methylcyclohexene', () => {
    const r = run('H3O_HYDRATION', 'CC1=CCCCC1');
    expectMajor(r, ['CC1(O)CCCCC1']);
    expect(r.stereo).toBe('none');
    expect(r.warnings).toEqual([]);
  });
  it('18 OXYMERC 2-methyl-2-pentene', () => {
    const r = run('OXYMERC', 'CCC=C(C)C');
    expectMajor(r, ['CCCC(C)(C)O']);
    expect(r.stereo).toBe('none');
  });
  it('19 HYDROBORATION 2-methyl-2-pentene -> racemic', () => {
    const r = run('HYDROBORATION', 'CCC=C(C)C');
    expectMajor(r, ['CCC(O)C(C)C']);
    expect(r.stereo).toBe('racemic');
  });
  it('20 HYDROBORATION 1-methylcyclohexene -> trans (relative)', () => {
    const r = run('HYDROBORATION', 'CC1=CCCCC1');
    expectMajor(r, ['C[C@@H]1CCCC[C@H]1O'], 'relative');
    expect(r.stereo).toBe('relative');
    expect(same(r.major[0]!, 'C[C@@H]1CCCC[C@@H]1O', 'relative')).toBe(false);
  });
  it('21 H2_PD 1,2-dimethylcyclohexene -> cis (meso)', () => {
    const r = run('H2_PD', 'CC1=C(C)CCCC1');
    expectMajor(r, ['C[C@H]1CCCC[C@H]1C'], 'relative');
    expect(r.stereo).toBe('relative');
    expect(r.mechanism).toBe('reduction');
    expect(same(r.major[0]!, 'C[C@H]1CCCC[C@@H]1C', 'relative')).toBe(false);
  });
  it('23 MCPBA cyclohexene -> cyclohexene oxide (diagonal bond, relative)', () => {
    const r = run('MCPBA', 'C1=CCCCC1');
    expectMajor(r, ['C1CCC2OC2C1']);
    expect(r.stereo).toBe('relative');
    expect(r.major[0]!.bonds.some((b) => b.diagonal === true)).toBe(true);
  });
  it('24 EPOXIDE_H3O cyclohexene oxide -> trans diol (relative)', () => {
    const r = run('EPOXIDE_H3O', 'C1CCC2OC2C1');
    expectMajor(r, ['O[C@H]1CCCC[C@@H]1O'], 'relative');
    expect(r.stereo).toBe('relative');
  });
  it('EPOXIDE_H3O reads the configuration from a tagged epoxide; opens at the more substituted carbon', () => {
    const r = run('MCPBA', 'C1=CCCCC1');
    const opened = react(r.major[0]!, defaultCard('EPOXIDE_H3O'));
    expectMajor(opened, ['O[C@H]1CCCC[C@@H]1O'], 'relative');
    const me = run('EPOXIDE_H3O', 'CC1(C)OC1');
    expectMajor(me, ['CC(C)(O)CO']);
    expect(me.stereo).toBe('none');
  });
  it('25 ANTI_DIHYDROXYLATION cyclohexene -> trans diol', () => {
    const r = run('ANTI_DIHYDROXYLATION', 'C1=CCCCC1');
    expectMajor(r, ['O[C@H]1CCCC[C@@H]1O'], 'relative');
    expect(r.stereo).toBe('relative');
  });
  it('26 OSO4 cyclohexene -> cis diol', () => {
    const r = run('OSO4', 'C1=CCCCC1');
    expectMajor(r, ['O[C@H]1CCCC[C@H]1O'], 'relative');
    expect(r.stereo).toBe('relative');
    expect(same(r.major[0]!, 'O[C@H]1CCCC[C@@H]1O', 'relative')).toBe(false);
  });
  it('27 KMNO4_COLD cyclohexene -> cis diol', () => {
    const r = run('KMNO4_COLD', 'C1=CCCCC1');
    expectMajor(r, ['O[C@H]1CCCC[C@H]1O'], 'relative');
  });
  it('34 CH2I2_ZNCU cyclohexene -> norcarane', () => {
    const r = run('CH2I2_ZNCU', 'C1=CCCCC1');
    expectMajor(r, ['C1CCC2CC2C1']);
    expect(r.stereo).toBe('relative');
  });
  it('35 CHCL3_KOH cyclohexene -> dichloronorcarane', () => {
    const r = run('CHCL3_KOH', 'C1=CCCCC1');
    // 04 row 35 lists `ClC1(Cl)CC2CCCCC12` (C8H12Cl2); cyclohexene + CCl2 is C7H10Cl2 (RDKit-checked).
    expectMajor(r, ['ClC1(Cl)C2CCCCC12']);
    expect(r.stereo).toBe('relative');
  });
  it('88 HX_HCL 3-methyl-1-butene (warn): hydride shift mixture', () => {
    const r = run('HX_HCL', 'C=CC(C)C');
    expectMajor(r, ['CC(C)C(C)Cl', 'CCC(C)(C)Cl']);
    expect(same(r.major[0]!, 'CC(C)C(C)Cl')).toBe(true);
    expect(same(r.major[1]!, 'CCC(C)(C)Cl')).toBe(true);
    expect(r.mixture).toBe(true);
    expect(r.stereo).toBe('none');
    expect(r.warnings).toContain(WARN.rearrangement);
  });
  it('89 HX_HCL 3-methyl-1-butene (apply)', () => {
    const r = run('HX_HCL', 'C=CC(C)C', { rearrangement: 'apply' });
    expectMajor(r, ['CCC(C)(C)Cl']);
    expect(r.warnings).toContain(WARN.rearrangementApplied);
    expect(r.mixture ?? false).toBe(false);
    const ign = run('HX_HCL', 'C=CC(C)C', { rearrangement: 'ignore' });
    expectMajor(ign, ['CC(C)C(C)Cl']);
    expect(ign.warnings).toEqual([]);
  });
  it('90 HX_HCL 3,3-dimethyl-1-butene: methyl shift mixture', () => {
    const r = run('HX_HCL', 'C=CC(C)(C)C');
    expectMajor(r, ['CC(Cl)C(C)(C)C', 'CC(C)C(C)(C)Cl']);
    expect(r.mixture).toBe(true);
    expect(r.warnings).toContain(WARN.rearrangement);
  });
  it('91 HX_HBR 2-pentene: regio mixture, racemic', () => {
    const r = run('HX_HBR', 'CC=CCC');
    expectMajor(r, ['CCCC(C)Br', 'CCC(Br)CC']);
    expect(r.mixture).toBe(true);
    // 3-bromopentane has no centre, so the weakest of (racemic, none) is none (04 section 3.1 tie rule; row 91 says racemic).
    expect(r.stereo).toBe('none');
    expect(r.warnings).toContain(WARN.regioMixture);
  });
  it('92 HX_HBR 2-butene: symmetric, single product, no warning', () => {
    const r = run('HX_HBR', 'CC=CC');
    expectMajor(r, ['CCC(C)Br']);
    expect(r.mixture ?? false).toBe(false);
    expect(r.stereo).toBe('racemic');
    expect(r.warnings).toEqual([]);
  });
  it('93 HYDROBORATION 4-methyl-2-hexene: two alcohols', () => {
    const r = run('HYDROBORATION', 'CCC(C)C=CC');
    expectMajor(r, ['CCC(C)C(O)CC', 'CCC(C)CC(C)O']);
    expect(r.mixture).toBe(true);
    expect(r.stereo).toBe('racemic');
    expect(r.warnings).toContain(WARN.regioMixture);
  });
  it('94 X2_BR2 styrene: ring untouched, racemic', () => {
    const r = run('X2_BR2', 'c1ccccc1C=C');
    expectMajor(r, ['BrCC(Br)c1ccccc1']);
    expect(r.stereo).toBe('racemic');
  });
  it('95 H2_PD benzene: no substrate', () => {
    const r = run('H2_PD', 'c1ccccc1');
    expect(r.noReaction).toBe(true);
    expect(r.justification).toBe(JUSTIFY.noSubstrate(defaultCard('H2_PD')));
    expect(r.justification).toContain('needs a C=C or a C≡C');
  });
  it('H2 on a chiral reactant keeps the centre: absolute', () => {
    const r = run('H2_PD', 'C=CC[C@H](C)Br');
    expectMajor(r, ['CCC[C@H](C)Br'], 'absolute');
    expect(r.stereo).toBe('absolute');
  });
  it('multiple sites: regiochemical rules react the first and warn; symmetric rules react all', () => {
    const r = run('HX_HBR', 'C=CCCC=C');
    expect(r.warnings).toContain(WARN.multipleSites(2, 'C=C'));
    expectMajor(r, ['CC(Br)CCC=C']);
    const h = run('H2_PD', 'C=CCCC=C');
    expectMajor(h, ['CCCCCC']);
    const b = run('X2_BR2', 'C=CCCC=C');
    expectMajor(b, ['BrCC(Br)CCC(Br)CBr']);
    const y = run('HX_HBR', 'C=CCC#C');
    expect(y.warnings).toContain(WARN.multipleSites(2, 'C=C'));
    expectMajor(y, ['CC(Br)CC#C']);
  });
  it('X2 on a reactant with two new centres and a retained one: no tags, facialSelectivity, absolute', () => {
    const r = run('X2_BR2', 'C[C@H](Br)C=CCC');
    expect(r.stereo).toBe('absolute');
    expect(r.warnings).toContain(WARN.facialSelectivity);
    expectMajor(r, ['C[C@H](Br)C(Br)C(Br)CC'], 'absolute');
    expect(r.major[0]!.atoms.filter((a) => a.tet !== undefined).length).toBe(1);
    // one new centre next to a retained one: absolute, no warning
    const one = run('X2_BR2', 'C[C@H](Br)C=CC');
    expect(one.stereo).toBe('absolute');
    expect(one.warnings).toEqual([]);
  });
  it('untagged CC=CC + Br2: geometryUnspecified, no tags, stereo none', () => {
    const r = run('X2_BR2', 'CC=CC');
    expectMajor(r, ['CC(Br)C(Br)C']);
    expect(r.stereo).toBe('none');
    expect(r.warnings).toContain(WARN.geometryUnspecified);
    expect(r.major[0]!.atoms.every((a) => a.tet === undefined)).toBe(true);
  });
  it('two new centres with no syn/anti control: diastereomerMixture (template, mode none)', () => {
    const g = parse('CCC(C)=CC');
    const pi = findAlkenes(g)[0]!;
    const added = addAcross(g, pi, 'Br', 'Cl');
    const r = applyAdditionStereo(added.graph, pi, added.newA, added.newB, 'none', g);
    expect(r.stereo).toBe('none');
    expect(r.warnings).toEqual([WARN.diastereomerMixture]);
    expect(r.graph.atoms.every((a) => a.tet === undefined)).toBe(true);
    const d = run('HOX_BR2_H2O', 'CCC(C)=CC');
    expect(d.warnings).toContain(WARN.geometryUnspecified);
    expect(d.stereo).toBe('none');
    const none = run('HX_HBR', 'CC=C(C)CC');
    expect(none.stereo).toBe('none');
    expectMajor(none, ['CCC(C)(Br)CC']);
    const one = run('HX_HBR', 'CC=C(C)CCC');
    expect(one.stereo).toBe('racemic');
    expectMajor(one, ['CCC(C)(Br)CCC']);
  });
});

describe('04 section 9.3 stereo template fixtures (tags asserted directly)', () => {
  function template(smiles: string, toA: string, toB: string, mode: 'syn' | 'anti') {
    const g = parse(smiles);
    const pi = findAlkenes(g)[0]!;
    const added = addAcross(g, pi, toA, toB);
    return { pi, ...applyAdditionStereo(added.graph, pi, added.newA, added.newB, mode, g) };
  }
  it('cyclohexene + Br2: anti, +1 / +1', () => {
    const r = template('C1=CCCCC1', 'Br', 'Br', 'anti');
    expect(r.graph.atoms[0]!.tet).toEqual({ order: [1, 5, 'H', 6], sign: 1 });
    expect(r.graph.atoms[1]!.tet).toEqual({ order: [0, 2, 'H', 7], sign: 1 });
    expect(same(r.graph, 'Br[C@H]1CCCC[C@@H]1Br', 'relative')).toBe(true);
    expect(r.stereo).toBe('relative');
  });
  it('cyclohexene + OsO4: syn, +1 / -1', () => {
    const r = template('C1=CCCCC1', 'O', 'O', 'syn');
    expect(r.graph.atoms[0]!.tet!.sign).toBe(1);
    expect(r.graph.atoms[1]!.tet!.sign).toBe(-1);
    expect(same(r.graph, 'O[C@H]1CCCC[C@H]1O', 'relative')).toBe(true);
  });
  it('cyclohexene anti-diol: +1 / +1', () => {
    const r = template('C1=CCCCC1', 'O', 'O', 'anti');
    expect(r.graph.atoms[1]!.tet!.sign).toBe(1);
    expect(same(r.graph, 'O[C@H]1CCCC[C@@H]1O', 'relative')).toBe(true);
  });
  it('1-methylcyclohexene + BH3/H2O2: syn, +1 / -1', () => {
    const r = template('CC1=CCCCC1', 'H', 'O', 'syn');
    expect(r.graph.atoms[1]!.tet).toEqual({ order: [2, 6, 0, 'H'], sign: 1 });
    expect(r.graph.atoms[2]!.tet).toEqual({ order: [1, 3, 'H', 7], sign: -1 });
    expect(same(r.graph, 'C[C@@H]1CCCC[C@H]1O', 'relative')).toBe(true);
  });
  it('1,2-dimethylcyclohexene + H2: syn, +1 / -1, meso', () => {
    const r = template('CC1=C(C)CCCC1', 'H', 'H', 'syn');
    expect(r.graph.atoms[1]!.tet!.sign).toBe(1);
    expect(r.graph.atoms[2]!.tet!.sign).toBe(-1);
    expect(same(r.graph, 'C[C@H]1CCCC[C@H]1C', 'relative')).toBe(true);
    expect(sameMolecule(r.graph, parse('C[C@H]1CCCC[C@H]1C'), { stereo: 'absolute' }).same).toBe(true);
  });
  it('(E)-but-2-ene + Br2: anti, +1 / -1, meso', () => {
    const r = template('C/C=C/C', 'Br', 'Br', 'anti');
    expect(r.graph.atoms[1]!.tet).toEqual({ order: [2, 0, 'H', 4], sign: 1 });
    expect(r.graph.atoms[2]!.tet).toEqual({ order: [1, 3, 'H', 5], sign: -1 });
    expect(sameMolecule(r.graph, parse('C[C@H](Br)[C@H](Br)C'), { stereo: 'absolute' }).verdict).toBe('SAME');
  });
  it('(Z)-but-2-ene + Br2: anti, +1 / +1, chiral pair', () => {
    const r = template('C/C=C\\C', 'Br', 'Br', 'anti');
    expect(r.graph.atoms[1]!.tet!.sign).toBe(1);
    expect(r.graph.atoms[2]!.tet!.sign).toBe(1);
    expect(same(r.graph, 'C[C@@H](Br)[C@H](Br)C', 'relative')).toBe(true);
    expect(same(r.graph, 'C[C@H](Br)[C@H](Br)C', 'relative')).toBe(false);
  });
  it('(E)-but-2-ene + OsO4: syn, +1 / +1', () => {
    const r = template('C/C=C/C', 'O', 'O', 'syn');
    expect(r.graph.atoms[1]!.tet!.sign).toBe(1);
    expect(r.graph.atoms[2]!.tet!.sign).toBe(1);
    expect(same(r.graph, 'C[C@@H](O)[C@H](O)C', 'relative')).toBe(true);
  });
  it('propene + Br2: one centre, no tag, racemic', () => {
    const r = template('C=CC', 'Br', 'Br', 'anti');
    expect(r.graph.atoms.every((a) => a.tet === undefined)).toBe(true);
    expect(r.stereo).toBe('racemic');
  });
  it('untagged CC=CC + Br2: geometryUnspecified', () => {
    const r = template('CC=CC', 'Br', 'Br', 'anti');
    expect(r.graph.atoms.every((a) => a.tet === undefined)).toBe(true);
    expect(r.stereo).toBe('none');
    expect(r.warnings).toEqual([WARN.geometryUnspecified]);
  });
});
