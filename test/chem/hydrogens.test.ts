import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { buildGraph } from '@/chem/graph';
import { lonePairs, maxValence, targetValence } from '@/chem/valence';
import type { Element } from '@/chem/types';

const H = (s: string) => implicitHydrogens(parseSmiles(s).graph);

describe('implicitHydrogens', () => {
  it('H1-H8 neutral and charged molecules', () => {
    expect(H('C').hydrogens).toEqual([4]);
    expect(H('CC(=O)O').hydrogens).toEqual([3, 0, 0, 1]);
    expect(H('CC#N').hydrogens).toEqual([3, 0, 0]);
    expect(H('ClC(Cl)Cl').hydrogens).toEqual([0, 1, 0, 0]);
    expect(H('C[NH3+]').hydrogens).toEqual([3, 3]);
    expect(H('C[C+](C)C').hydrogens).toEqual([3, 0, 3, 3]);
    expect(H('[C-]#C').hydrogens).toEqual([0, 1]);
    expect(H('C[S+](C)[O-]').hydrogens).toEqual([3, 0, 3, 0]);
    for (const s of ['C', 'CC(=O)O', 'CC#N', 'ClC(Cl)Cl', 'C[NH3+]', 'C[C+](C)C', '[C-]#C', 'C[S+](C)[O-]']) {
      expect(H(s).warnings).toEqual([]);
    }
  });
  it('H9 five-bonded carbon', () => {
    const r = H('CC(C)(C)(C)C');
    expect(r.hydrogens[1]).toBe(0);
    expect(r.warnings).toEqual([{ kind: 'over-valence', atom: 1, have: 5, max: 4 }]);
  });
  it('H10 four-bonded neutral nitrogen', () => {
    const r = H('CN(C)(C)C');
    expect(r.hydrogens[1]).toBe(0);
    expect(r.warnings).toEqual([{ kind: 'over-valence', atom: 1, have: 4, max: 3 }]);
  });
  it('H11 neutral sulfone', () => {
    const r = H('CS(=O)(=O)C');
    expect(r.hydrogens[1]).toBe(0);
    expect(r.warnings).toEqual([{ kind: 'over-valence', atom: 1, have: 6, max: 2 }]);
  });
  it('H12 bracket H count plus heavy bonds', () => {
    const r = H('[CH3](C)C');
    expect(r.hydrogens[0]).toBe(3);
    expect(r.warnings).toEqual([{ kind: 'over-valence', atom: 0, have: 5, max: 4 }]);
  });
  it('H13 unsupported charge on a hand-built world atom', () => {
    const g = buildGraph([{ id: 0, el: 'Cl', charge: 1, explicitH: null, aromatic: false, pos: [0, 0, 0], hPos: [] }], []);
    const r = implicitHydrogens(g);
    expect(r.hydrogens).toEqual([0]);
    expect(r.warnings).toEqual([{ kind: 'charge-unsupported', atom: 0, charge: 1 }]);
  });
  it('H14 lone heteroatoms', () => {
    expect(H('O').hydrogens).toEqual([2]);
    expect(H('N').hydrogens).toEqual([3]);
    expect(H('Cl').hydrogens).toEqual([1]);
  });
  it('an H element atom (tolerated) gets 1 - s', () => {
    const g = buildGraph([{ id: 0, el: 'H', charge: 0, explicitH: null, aromatic: false }], []);
    expect(implicitHydrogens(g).hydrogens).toEqual([1]);
  });
  it('world atoms with explicitH null get tv - heavy sum (methanol with a collapsed H block)', () => {
    const g = buildGraph([
      { id: 0, el: 'C', charge: 0, explicitH: null, aromatic: false, pos: [10, 10, 10], hPos: [[10, 11, 10]] },
      { id: 1, el: 'O', charge: 0, explicitH: null, aromatic: false, pos: [11, 10, 10], hPos: [] },
    ], [{ a: 0, b: 1, order: 1 }]);
    expect(implicitHydrogens(g).hydrogens).toEqual([3, 1]);
  });
});

describe('valence.ts', () => {
  it('V1-V7 target valences', () => {
    expect(targetValence('C', 0)).toBe(4);
    expect(targetValence('C', 1)).toBe(3);
    expect(targetValence('N', -1)).toBe(2);
    expect(targetValence('O', 1)).toBe(3);
    expect(targetValence('S', 1)).toBe(3);
    expect(targetValence('Cl', -1)).toBe(0);
    expect(targetValence('P', -1)).toBeUndefined();
    expect(targetValence('F', 1)).toBeUndefined();
    expect(targetValence('H', 1)).toBeUndefined();
  });
  it('V8 lone pairs', () => {
    expect(lonePairs('O', 0)).toBe(2);
    expect(lonePairs('O', -1)).toBe(3);
    expect(lonePairs('N', 1)).toBe(0);
    expect(lonePairs('C', -1)).toBe(1);
    expect(lonePairs('Cl', -1)).toBe(4);
    expect(lonePairs('S', 1)).toBe(1);
    expect(lonePairs('P', 0)).toBe(1);
    expect(lonePairs('P', -1)).toBe(0);
  });
  it('V9 maxValence', () => {
    const expected: Record<Element, number> = { C: 4, N: 3, O: 2, S: 2, P: 3, F: 1, Cl: 1, Br: 1, I: 1, H: 1 };
    for (const el of Object.keys(expected) as Element[]) expect(maxValence(el)).toBe(expected[el]);
  });
});
