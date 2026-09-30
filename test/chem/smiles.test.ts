import { describe, it, expect } from 'vitest';
import { parseSmiles, SmilesError } from '@/chem/smiles';
import { kekulize } from '@/chem/kekulize';
import { implicitHydrogens } from '@/chem/hydrogens';
import { perceiveAromaticity } from '@/chem/aromatic';
import { isIsomorphic } from '@/chem/isomorphism';
import {
  buildGraph, bondBetween, bondOrderSum, components, neighborsOf, ringsThrough, smallestRings,
  withBondOrder, withoutAtom, withoutStereoTags, withTet, withEz, withBond, withoutBond, withAtom, setCharge, degree,
} from '@/chem/graph';
import type { Atom, MoleculeGraph } from '@/chem/types';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;
const H = (g: MoleculeGraph) => implicitHydrogens(g).hydrogens;
const doubles = (g: MoleculeGraph) => g.bonds.filter((b) => b.order === 2).length;
const pairs = (g: MoleculeGraph) => g.bonds.map((b) => [b.a, b.b, b.order]);

function expectError(smiles: string, message: string | RegExp, index?: number): void {
  let caught: unknown = null;
  try {
    parseSmiles(smiles);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SmilesError);
  const err = caught as SmilesError;
  if (typeof message === 'string') expect(err.message).toBe(message);
  else expect(err.message).toMatch(message);
  expect(err.smiles).toBe(smiles);
  if (index !== undefined) expect(err.index).toBe(index);
}

describe('parseSmiles: structure', () => {
  it('S1 branches', () => {
    const g = parse('CC(C)C');
    expect(g.atoms.length).toBe(4);
    expect(pairs(g)).toEqual([[0, 1, 1], [1, 2, 1], [1, 3, 1]]);
    expect(g.atoms.every((a) => a.explicitH === null && a.charge === 0 && !a.aromatic)).toBe(true);
  });
  it('S2 ring closures with digits and %nn', () => {
    const forms = ['C1CCCCC1', 'C%10CCCCC%10', 'C2CCCCC2'];
    const gs = forms.map(parse);
    for (const g of gs) {
      expect(g.bonds.length).toBe(6);
      expect(bondBetween(g, 0, 5)).toBeDefined();
    }
    expect(isIsomorphic(gs[0]!, gs[1]!)).toBe(true);
    expect(isIsomorphic(gs[0]!, gs[2]!)).toBe(true);
  });
  it('S3 ring-closure bond order on either side', () => {
    for (const s of ['C=1CCCCC1', 'C1CCCCC=1', 'C=1CCCCC=1']) {
      const g = parse(s);
      expect(g.bonds[bondBetween(g, 0, 5)!]!.order).toBe(2);
    }
  });
  it('S4 disagreeing ring-closure orders', () => {
    expectError('C=1CCCCC-1', 'ring-closure bond orders disagree');
  });
  it('S5 double bond written before or after the ring digit', () => {
    const a = parse('O=C1CCCCC1');
    const b = parse('C1(=O)CCCCC1');
    expect(isIsomorphic(a, b)).toBe(true);
    const o = b.atoms.findIndex((x) => x.el === 'O');
    expect(b.adj[o]!.map((k) => b.bonds[k]!.order)).toEqual([2]);
  });
  it('S6 S7 S8 bracket atoms: charge, H count, isotope, class', () => {
    const a = parse('[NH3+]C').atoms[0]!;
    expect(a).toMatchObject({ el: 'N', charge: 1, explicitH: 3 });
    const o = parse('C[O-]').atoms[1]!;
    expect(o).toMatchObject({ el: 'O', charge: -1, explicitH: 0 });
    expect(parse('[13CH4]').atoms[0]!.explicitH).toBe(4);
    expect(parse('[CH3:7]').atoms[0]!.explicitH).toBe(3);
    expect(H(parse('[13CH4]'))).toEqual([4]);
  });
  it('S9 disconnected components', () => {
    const g = parse('C.C');
    expect(g.atoms.length).toBe(2);
    expect(g.bonds.length).toBe(0);
  });
  it('S21 lowercase benzene is Kekulized and keeps aromatic flags', () => {
    const g = parse('c1ccccc1');
    expect(g.atoms.length).toBe(6);
    expect(g.atoms.every((a) => a.aromatic)).toBe(true);
    expect(g.bonds.every((b) => b.aromatic)).toBe(true);
    expect(doubles(g)).toBe(3);
    // orders alternate around the ring
    const ring = [0, 1, 2, 3, 4, 5];
    const orders = ring.map((i) => g.bonds[bondBetween(g, i, (i + 1) % 6)!]!.order);
    for (let i = 0; i < 6; i++) expect(orders[i]! + orders[(i + 1) % 6]!).toBe(3);
  });
  it('two-letter symbols and P are organic-subset atoms', () => {
    const g = parse('ClCBr');
    expect(g.atoms.map((a) => a.el)).toEqual(['Cl', 'C', 'Br']);
    expect(parse('P').atoms[0]!.el).toBe('P');
    expect(parse('CI').atoms[1]!.el).toBe('I');
  });
});

describe('parseSmiles: tetrahedral tags (neighbour order and sign)', () => {
  it('S10 alanine', () => {
    const p = parseSmiles('N[C@@H](C)C(=O)O');
    expect(p.tetra).toEqual([{ atom: 1, order: [0, 'H', 2, 3], sign: 1 }]);
    expect(p.graph.atoms[1]!.tet).toEqual({ order: [0, 'H', 2, 3], sign: 1 });
  });
  it('S11 leading chiral atom', () => {
    const p = parseSmiles('[C@@H](F)(Cl)Br');
    expect(p.tetra).toEqual([{ atom: 0, order: ['H', 1, 2, 3], sign: 1 }]);
  });
  it('S12 @ gives sign -1', () => {
    const p = parseSmiles('F[C@H](Cl)Br');
    expect(p.tetra).toEqual([{ atom: 1, order: [0, 'H', 2, 3], sign: -1 }]);
  });
  it('S13 ring-closure partners in digit order', () => {
    const p = parseSmiles('C[C@H]1CCCC[C@H]1Br');
    expect(p.tetra).toEqual([
      { atom: 1, order: [0, 'H', 6, 2], sign: -1 },
      { atom: 6, order: [5, 'H', 1, 7], sign: -1 },
    ]);
  });
  it('E22 chiral atom with the wrong neighbour count', () => {
    expectError('C[C@H](C)', 'chiral atom must have exactly four neighbours (including H)');
  });
});

describe('parseSmiles: double-bond tags', () => {
  it('S14 trans', () => {
    const p = parseSmiles('F/C=C/F');
    expect(p.dbl).toEqual([{ bond: 1, refA: 0, refB: 3, cis: false }]);
    expect(p.graph.bonds[1]!.ez).toEqual({ refA: 0, refB: 3, cis: false });
  });
  it('S15 cis', () => {
    expect(parseSmiles('F/C=C\\F').dbl).toEqual([{ bond: 1, refA: 0, refB: 3, cis: true }]);
  });
  it('S16 substituent in a leading branch', () => {
    expect(parseSmiles('C(\\F)=C/F').dbl[0]!.cis).toBe(false);
  });
  it('S17 conflicting directions', () => {
    expectError('C/C(\\F)=C/F', 'conflicting double-bond directions');
  });
  it('S18 a single / serves both bonds of a diene', () => {
    const p = parseSmiles('C/C=C/C=C/C');
    expect(p.dbl.length).toBe(2);
    expect(p.dbl.every((d) => !d.cis)).toBe(true);
    expect(p.dbl.map((d) => d.bond)).toEqual([1, 3]);
  });
  it('S19 directional ring closure', () => {
    expectError('C/1CCCCC1', 'directional bond on a ring closure is not supported');
  });
  it('one-sided directions give no tag; directions away from a double bond are plain bonds', () => {
    expect(parseSmiles('C/C=CC').dbl).toEqual([]);
    const p = parseSmiles('C/CC');
    expect(p.dbl).toEqual([]);
    expect(p.graph.bonds.every((b) => b.order === 1 && b.ez === undefined)).toBe(true);
  });
  it('S22 ez survives perception', () => {
    const g = perceiveAromaticity(parseSmiles('C/C=C/C').graph);
    expect(g.bonds[1]!.ez).toEqual({ refA: 0, refB: 3, cis: false });
  });
});

describe('parseSmiles: errors (S20)', () => {
  it('reports the documented code for each malformed input', () => {
    expectError('C1CCC', 'unclosed ring bond 1', 1);
    expectError('C(C', 'unbalanced parenthesis');
    expectError('CC)', 'unbalanced parenthesis');
    expectError('', 'empty SMILES');
    expectError('C$C', "unexpected character '$'");
    expectError('[Xe]', "unknown element 'Xe'");
    expectError('[H]', /explicit hydrogen atoms are not supported/);
    expectError('[C+2]', 'charge magnitude greater than 1 is not supported');
    expectError('[C++]', 'charge magnitude greater than 1 is not supported');
    expectError('[Cl+]', 'Cl cannot carry charge 1');
    expectError('C11', 'ring closure to the same atom');
    expectError('C1C1', 'duplicate bond');
    expectError('cC', 'cannot kekulize', 0);
    expectError('[C@TH1]', 'unsupported chirality token; use @ or @@');
    expectError('(C)', 'branch has no preceding atom');
    expectError('C==C', 'two bond symbols in a row');
    expectError('1CC1', 'ring-closure digit has no preceding atom');
    expectError('C%1CC', "'%' must be followed by two digits");
    expectError('[CH3', 'unterminated bracket atom');
    expectError('[C@@H2]', 'a chiral atom may carry at most one hydrogen');
    expectError('CC=', 'bond symbol at end of input');
    expectError('[CH3x]', 'unexpected text in bracket atom');
    expectError('B', "unexpected character 'B'");
    expectError('C C', "unexpected character ' '");
  });
});

describe('kekulize', () => {
  it('K1 pyridine', () => {
    const g = parse('c1ccncc1');
    expect(H(g)).toEqual([1, 1, 1, 0, 1, 1]);
    expect(doubles(g)).toBe(3);
  });
  it('K2 pyrrole', () => {
    const g = parse('c1cc[nH]c1');
    expect(H(g)).toEqual([1, 1, 1, 1, 1]);
    expect(doubles(g)).toBe(2);
  });
  it('K3 cyclobutadiene', () => {
    const g = parse('c1ccc1');
    expect(doubles(g)).toBe(2);
    expect(H(g)).toEqual([1, 1, 1, 1]);
  });
  it('K4 furan', () => {
    expect(H(parse('c1ccoc1'))).toEqual([1, 1, 1, 0, 1]);
  });
  it('K5 bracket aromatic n without H is pyridine-type', () => {
    const g = parse('[n]1ccccc1');
    expect(H(g)).toEqual([0, 1, 1, 1, 1, 1]);
    expect(doubles(g)).toBe(3);
  });
  it('K6 toluene', () => {
    expect(H(parse('Cc1ccccc1'))).toEqual([3, 0, 1, 1, 1, 1, 1]);
  });
  it('K7 naphthalene', () => {
    const g = parse('c1ccc2ccccc2c1');
    expect(doubles(g)).toBe(5);
    expect(H(g)).toEqual([1, 1, 1, 0, 1, 1, 1, 1, 0, 1]);
  });
  it('K8 caffeine', () => {
    expect(H(parse('Cn1cnc2c1c(=O)n(C)c(=O)n2C'))).toEqual([3, 0, 1, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 3]);
  });
  it('K9 impossible matchings', () => {
    expectError('cC', 'cannot kekulize');
    expectError('c1cc1', 'cannot kekulize');
  });
  it('K10 a graph without aromatic atoms is returned unchanged', () => {
    const g = parse('CC=O');
    expect(kekulize(g)).toBe(g);
  });
});

describe('graph.ts', () => {
  const atom = (id: number, el: Atom['el'] = 'C'): Atom => ({ id, el, charge: 0, explicitH: null, aromatic: false });
  it('G1 stores bonds with a < b and lists them on both endpoints', () => {
    const g = buildGraph([atom(0), atom(1), atom(2), atom(3)], [{ a: 3, b: 1, order: 1 }]);
    expect(g.bonds[0]).toMatchObject({ a: 1, b: 3, order: 1, aromatic: false });
    expect(g.bonds[0]!.diagonal).toBeUndefined();
    expect(g.adj[1]).toEqual([0]);
    expect(g.adj[3]).toEqual([0]);
    expect(g.adj[0]).toEqual([]);
  });
  it('G2 swaps ez refs when endpoints are swapped', () => {
    const g = buildGraph([atom(0), atom(1), atom(2), atom(3)], [{ a: 3, b: 1, order: 2, ez: { refA: 2, refB: 0, cis: true } }]);
    expect(g.bonds[0]!.ez).toEqual({ refA: 0, refB: 2, cis: true });
  });
  it('G3 structural misuse throws', () => {
    expect(() => buildGraph([atom(0), atom(1)], [{ a: 0, b: 1, order: 1 }, { a: 1, b: 0, order: 1 }])).toThrow('duplicate bond');
    expect(() => buildGraph([atom(0), atom(1)], [{ a: 1, b: 1, order: 1 }])).toThrow('bad bond endpoints');
    expect(() => buildGraph([atom(0), atom(2)], [])).toThrow('atom ids must be dense and in order');
    expect(() => buildGraph([atom(0)], [{ a: 0, b: 1, order: 1 }])).toThrow('bad bond endpoints');
  });
  it('G4 components', () => {
    expect(components(parse('C.CC.O'))).toEqual([[0], [1, 2], [3]]);
  });
  it('G5 smallest rings', () => {
    expect(smallestRings(parse('C1CCCCC1')).map((r) => r.length)).toEqual([6]);
    expect(smallestRings(parse('c1ccc2ccccc2c1')).map((r) => r.length)).toEqual([6, 6]);
    expect(smallestRings(parse('C1CCC1')).map((r) => r.length)).toEqual([4]);
    expect(smallestRings(parse('CCCCCC'))).toEqual([]);
  });
  it('G6 chair plus inner-vertex carbon has three 4-rings', () => {
    const rings = smallestRings(parse('C12C3CC1CC2C3'));
    expect(rings.map((r) => r.length)).toEqual([4, 4, 4]);
  });
  it('G7 rings through the naphthalene fusion bond', () => {
    expect(ringsThrough(parse('c1ccc2ccccc2c1'), 3, 8).length).toBe(2);
  });
  it('G8 withoutAtom renumbers', () => {
    const g = withoutAtom(parse('CC(C)O'), 0);
    expect(g.atoms.map((a) => a.el)).toEqual(['C', 'C', 'O']);
    expect(g.atoms.map((a) => a.id)).toEqual([0, 1, 2]);
    expect(g.bonds.length).toBe(2);
    expect(bondBetween(g, 0, 2)).toBeDefined();
  });
  it('G9 withoutAtom drops a tet that referenced the removed atom', () => {
    const g = withoutAtom(parse('N[C@@H](C)C(=O)O'), 0);
    expect(g.atoms[0]!.tet).toBeUndefined();
    const g2 = withoutAtom(parse('N[C@@H](C)C(=O)O'), 5);
    expect(g2.atoms[1]!.tet).toEqual({ order: [0, 'H', 2, 3], sign: 1 });
    const g3 = withoutAtom(parse('F/C=C/F'), 0);
    expect(g3.bonds.find((b) => b.order === 2)!.ez).toBeUndefined();
    const g4 = withoutAtom(parse('CF/C=C/F'), 0);
    expect(g4.bonds.find((b) => b.order === 2)!.ez).toEqual({ refA: 0, refB: 3, cis: false });
  });
  it('G10 withBondOrder raises the endpoint sums by one', () => {
    const g = parse('CCO');
    const k = bondBetween(g, 0, 1)!;
    const g2 = withBondOrder(g, k, 2);
    expect(bondOrderSum(g2, 0)).toBe(bondOrderSum(g, 0) + 1);
    expect(bondOrderSum(g2, 1)).toBe(bondOrderSum(g, 1) + 1);
    expect(g2.bonds[k]!.aromatic).toBe(false);
  });
  it('withAtom / withBond / withoutBond / setCharge / withTet / withEz / withoutStereoTags', () => {
    let g = parse('CC');
    g = withAtom(g, { el: 'O', charge: 0, explicitH: null, aromatic: false });
    expect(g.atoms[2]).toMatchObject({ id: 2, el: 'O' });
    g = withBond(g, 2, 1, 1);
    expect(g.bonds[1]).toMatchObject({ a: 1, b: 2, order: 1 });
    expect(() => withBond(g, 1, 2, 1)).toThrow('duplicate bond');
    expect(neighborsOf(g, 1)).toEqual([0, 2]);
    expect(degree(g, 1)).toBe(2);
    g = withoutBond(g, 0);
    expect(g.bonds).toHaveLength(1);
    expect(g.bonds[0]).toMatchObject({ a: 1, b: 2 });
    g = setCharge(g, 2, -1);
    expect(g.atoms[2]!.charge).toBe(-1);
    expect(() => setCharge(g, 7, 1)).toThrow(RangeError);
    g = withTet(g, 1, { order: [0, 'H', 2, 'H'], sign: 1 });
    expect(g.atoms[1]!.tet).toBeDefined();
    g = withEz(g, 0, { refA: 0, refB: 'H', cis: true });
    expect(g.bonds[0]!.ez).toBeDefined();
    const bare = withoutStereoTags(g);
    expect(bare.atoms.every((a) => a.tet === undefined)).toBe(true);
    expect(bare.bonds.every((b) => b.ez === undefined)).toBe(true);
    expect(bare.atoms.length).toBe(g.atoms.length);
    expect(withTet(g, 1, undefined).atoms[1]!.tet).toBeUndefined();
    expect(withEz(g, 0, undefined).bonds[0]!.ez).toBeUndefined();
  });
});
