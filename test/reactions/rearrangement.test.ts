import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { sameMolecule } from '@/chem/compare';
import { bondBetween, withBondOrder, withoutBond } from '@/chem/graph';
import type { MoleculeGraph } from '@/chem/types';
import { applyShift, cationClass, checkShift } from '@/reactions/rearrangement';
import { attachFragment, findAlkenes, findCOH, WARN } from '@/reactions/helpers';
import { defaultCard, react } from '@/reactions/react';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;
const same = (g: MoleculeGraph, smiles: string): boolean => sameMolecule(g, parse(smiles), { stereo: 'none' }).same;

/** The lowered graph of an alkene (pi bond -> single) with the cation at the more substituted carbon. */
function lowered(smiles: string): MoleculeGraph {
  const g = parse(smiles);
  return withBondOrder(g, findAlkenes(g)[0]!.bond, 1);
}

describe('04 section 9.5 checkShift', () => {
  it('3-methyl-1-butene: cation at C2 -> hydride from C3, newClass 3', () => {
    const g = lowered('C=CC(C)C');
    expect(checkShift(g, 1)).toEqual({ kind: 'hydride', from: 1, to: 2, newClass: 3 });
    expect(cationClass(g, 1)).toBe(2);
    expect(applyShift(g, checkShift(g, 1)!)).toBe(g);
  });
  it('3,3-dimethyl-1-butene: methyl shift of one CH3 from C3', () => {
    const g = lowered('C=CC(C)(C)C');
    const s = checkShift(g, 1);
    expect(s).toEqual({ kind: 'methyl', from: 1, to: 2, migrating: 3, newClass: 3 });
    const shifted = applyShift(g, s!);
    expect(bondBetween(shifted, 2, 3)).toBeUndefined();
    expect(bondBetween(shifted, 1, 3)).toBeDefined();
    expect(same(attachFragment(shifted, 2, 'Cl').graph, 'CC(C)C(C)(C)Cl')).toBe(true);
  });
  it('2-methylpropene: cation at C2 is already tertiary -> null', () => {
    expect(checkShift(lowered('C=C(C)C'), 1)).toBeNull();
  });
  it('1-methylcyclohexanol cation at C1 -> null', () => {
    const g = parse('CC1(O)CCCCC1');
    const site = findCOH(g)[0]!;
    expect(checkShift(withoutBond(g, site.bond), site.c)).toBeNull();
  });
  it('vinylcyclohexane: hydride to the ring CH, newClass 3', () => {
    const g = lowered('C=CC1CCCCC1');
    expect(checkShift(g, 1)).toEqual({ kind: 'hydride', from: 1, to: 2, newClass: 3 });
  });
  it('1-methyl-1-vinylcyclopentane: no ring-bond migration, only the exocyclic CH3', () => {
    const g = lowered('C=CC1(C)CCCC1');
    const s = checkShift(g, 1);
    expect(s).toEqual({ kind: 'methyl', from: 1, to: 2, migrating: 3, newClass: 3 });
  });
  it('allylic / benzylic bonus: a secondary benzylic cation does not shift to a tertiary alkyl neighbour', () => {
    // cation at the benzylic CH (class 2 + 1 = 3); neighbour CH(CH3)2 would give class 3: not better
    const g = parse('CC(C)C(Br)c1ccccc1');
    const c = 3;
    const noX = withoutBond(g, bondBetween(g, c, 4)!);
    expect(cationClass(noX, c)).toBe(3);
    expect(checkShift(noX, c)).toBeNull();
    // a secondary alkyl cation next to a benzylic CH2 shifts there (deg 2 + benzylic bonus = 3 > 2)
    const h = parse('CC(Br)Cc1ccccc1');
    const noX2 = withoutBond(h, bondBetween(h, 1, 2)!);
    expect(checkShift(noX2, 1)).toEqual({ kind: 'hydride', from: 1, to: 3, newClass: 3 });
  });
  it('ties: hydride wins over methyl, then the lowest neighbour id', () => {
    // cation at C3 of 2,2,4-trimethylpentane-type skeleton: C2 (quaternary, methyl shift) vs C4 (CH, hydride) both give class 3
    const g = parse('CC(C)(C)C(Br)C(C)C');
    const c = 4;
    const noX = withoutBond(g, bondBetween(g, c, 5)!);
    expect(checkShift(noX, c)).toEqual({ kind: 'hydride', from: 4, to: 6, newClass: 3 });
  });
  it('applyShift throws for a methyl shift whose migrating atom is missing', () => {
    expect(() => applyShift(parse('CCC'), { kind: 'methyl', from: 0, to: 1, newClass: 2 })).toThrow();
  });
});

describe('rearrangement policies through react', () => {
  it('warn: two products + mixture; apply: one; ignore: one with no warning', () => {
    const w = react(parse('C=CC(C)C'), defaultCard('HX_HCL'));
    expect(w.major.length).toBe(2);
    expect(w.mixture).toBe(true);
    expect(w.warnings).toEqual([WARN.rearrangement]);
    const a = react(parse('C=CC(C)C'), defaultCard('HX_HCL'), { rearrangement: 'apply' });
    expect(a.major.length).toBe(1);
    expect(same(a.major[0]!, 'CCC(C)(C)Cl')).toBe(true);
    expect(a.warnings).toEqual([WARN.rearrangementApplied]);
    const i = react(parse('C=CC(C)C'), defaultCard('HX_HCL'), { rearrangement: 'ignore' });
    expect(i.major.length).toBe(1);
    expect(same(i.major[0]!, 'CC(C)C(C)Cl')).toBe(true);
    expect(i.warnings).toEqual([]);
  });
  it('HYDRATION rearranges; OXYMERC does not', () => {
    const h = react(parse('C=CC(C)C'), defaultCard('H3O_HYDRATION'));
    expect(h.major.length).toBe(2);
    expect(h.major.some((p) => same(p, 'CCC(C)(C)O'))).toBe(true);
    const o = react(parse('C=CC(C)C'), defaultCard('OXYMERC'));
    expect(o.major.length).toBe(1);
    expect(same(o.major[0]!, 'CC(C)C(C)O')).toBe(true);
    expect(o.warnings).toEqual([]);
  });
  it('ROH_HX SN1 on a secondary alcohol does not rearrange (slow path); tertiary allylic does', () => {
    const r = react(parse('CC(C)C(C)O'), defaultCard('ROH_HX_HBR'));
    expect(r.major.length).toBe(1);
    expect(r.warnings).toContain(WARN.rohSlow);
    const t = react(parse('CC(C)(C)C(C)(C)O'), defaultCard('ROH_HX_HCL'));
    expect(t.major.length).toBe(1);
    expect(same(t.major[0]!, 'CC(C)(C)C(C)(C)Cl')).toBe(true);
  });
});
