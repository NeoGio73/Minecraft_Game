import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { aromaticRings, perceiveAromaticity } from '@/chem/aromatic';
import { atomLabel, bondLabel, fnv1a64, wlHash } from '@/chem/wlhash';
import { isIsomorphic } from '@/chem/isomorphism';
import { buildGraph, bondBetween } from '@/chem/graph';
import type { MoleculeGraph, WorldAtom } from '@/chem/types';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;
const perceived = (s: string) => perceiveAromaticity(parse(s));
const hashOf = (s: string) => {
  const g = perceived(s);
  return wlHash(g, implicitHydrogens(g).hydrogens).hash;
};
const classesOf = (s: string) => {
  const g = perceived(s);
  return wlHash(g, implicitHydrogens(g).hydrogens).classes;
};

describe('perceiveAromaticity', () => {
  it('A1 benzene in both forms', () => {
    expect(hashOf('c1ccccc1')).toBe(hashOf('C1=CC=CC=C1'));
    expect(aromaticRings(perceived('c1ccccc1'))).toHaveLength(1);
    expect(aromaticRings(perceived('C1=CC=CC=C1'))).toEqual([[0, 1, 2, 3, 4, 5]]);
    const g = perceived('C1=CC=CC=C1');
    expect(g.atoms.every((a) => a.aromatic)).toBe(true);
    expect(g.bonds.every((b) => b.aromatic)).toBe(true);
    expect(g.bonds.filter((b) => b.order === 2)).toHaveLength(3);
  });
  it('A2-A4 Kekulé forms of substituted arenes collide', () => {
    expect(hashOf('CC1=C(C)C=CC=C1')).toBe(hashOf('CC1C(C)=CC=CC=1'));
    expect(hashOf('CC(=O)Oc1ccccc1C(=O)O')).toBe(hashOf('CC(=O)OC1C(C(=O)O)=CC=CC=1'));
    expect(hashOf('OC(=O)C1=CC=CC=C1O')).toBe(hashOf('OC(=O)C1C(O)=CC=CC=1'));
  });
  it('A5 naphthalene has two aromatic rings in both forms', () => {
    expect(hashOf('c1ccc2ccccc2c1')).toBe(hashOf('C1=CC=C2C=CC=CC2=C1'));
    expect(aromaticRings(perceived('c1ccc2ccccc2c1'))).toHaveLength(2);
    expect(aromaticRings(perceived('C1=CC=C2C=CC=CC2=C1'))).toHaveLength(2);
  });
  it('A6 pyridine', () => {
    expect(hashOf('c1ccncc1')).toBe(hashOf('C1=CC=NC=C1'));
    expect(aromaticRings(perceived('C1=CC=NC=C1'))).toHaveLength(1);
  });
  it('A7 non-aromatic six-carbon systems', () => {
    expect(hashOf('c1ccccc1')).not.toBe(hashOf('C1=CC=CCC1'));
    expect(hashOf('c1ccccc1')).not.toBe(hashOf('C=CC=CC=C'));
    expect(aromaticRings(perceived('C1=CC=CCC1'))).toHaveLength(0);
    expect(aromaticRings(perceived('C=CC=CC=C'))).toHaveLength(0);
  });
  it('A8 benzoquinone is not aromatic', () => {
    const g = perceived('O=C1C=CC(=O)C=C1');
    expect(aromaticRings(g)).toHaveLength(0);
    expect(g.atoms.some((a) => a.aromatic)).toBe(false);
  });
  it('A9 styrene: ring aromatic, vinyl bond not', () => {
    const g = perceived('C=Cc1ccccc1');
    expect(aromaticRings(g)).toHaveLength(1);
    expect(g.bonds[bondBetween(g, 0, 1)!]!.aromatic).toBe(false);
    expect(g.bonds[bondBetween(g, 1, 2)!]!.aromatic).toBe(false);
    expect(g.atoms[0]!.aromatic).toBe(false);
    expect(g.atoms[2]!.aromatic).toBe(true);
  });
  it('A10 xylene isomers differ', () => {
    const o = hashOf('Cc1ccccc1C');
    const m = hashOf('Cc1cccc(C)c1');
    const p = hashOf('Cc1ccc(C)cc1');
    expect(o).not.toBe(m);
    expect(o).not.toBe(p);
    expect(m).not.toBe(p);
  });
  it('A11 five-membered rings lose their parser flags', () => {
    const g = perceived('c1cc[nH]c1');
    expect(g.atoms.every((a) => !a.aromatic)).toBe(true);
    expect(g.bonds.every((b) => !b.aromatic)).toBe(true);
  });
  it('A12 perception keeps pos / hPos / tet / ez', () => {
    const atoms: WorldAtom[] = [
      { id: 0, el: 'C', charge: 0, explicitH: null, aromatic: false, pos: [0, 0, 0], hPos: [[0, -1, 0]], tet: { order: [1, 'H', 2, 3], sign: 1 } },
      { id: 1, el: 'C', charge: 0, explicitH: null, aromatic: false, pos: [1, 0, 0], hPos: [] },
      { id: 2, el: 'O', charge: 0, explicitH: null, aromatic: false, pos: [0, 1, 0], hPos: [] },
      { id: 3, el: 'F', charge: 0, explicitH: null, aromatic: false, pos: [0, 0, 1], hPos: [] },
      { id: 4, el: 'C', charge: 0, explicitH: null, aromatic: false, pos: [2, 0, 0], hPos: [] },
    ];
    const g = buildGraph(atoms, [
      { a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }, { a: 0, b: 3, order: 1, diagonal: true },
      { a: 1, b: 4, order: 2, ez: { refA: 0, refB: 'H', cis: false } },
    ]);
    const p = perceiveAromaticity(g);
    expect(p.atoms).toEqual(g.atoms);
    expect(p.bonds).toEqual(g.bonds);
    expect(p.bonds[2]!.diagonal).toBe(true);
    expect(p.bonds[3]!.ez).toEqual({ refA: 0, refB: 'H', cis: false });
  });
});

describe('wlhash.ts', () => {
  it('W1 fnv1a64 vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
    expect(fnv1a64('C/4/0/k')).toBe('4b894161bdb29000');
    expect(fnv1a64('hello world')).toBe('779a65e7023cd2e7');
  });
  it('labels', () => {
    expect(atomLabel({ id: 0, el: 'C', charge: 0, explicitH: null, aromatic: false }, 3)).toBe('C/3/0/k');
    expect(atomLabel({ id: 0, el: 'N', charge: 1, explicitH: null, aromatic: false }, 0)).toBe('N/0/1/k');
    expect(atomLabel({ id: 0, el: 'C', charge: 0, explicitH: null, aromatic: true }, 1)).toBe('C/1/0/a');
    expect(bondLabel({ a: 0, b: 1, order: 2, aromatic: false })).toBe('2');
    expect(bondLabel({ a: 0, b: 1, order: 2, aromatic: true })).toBe('ar');
  });
  it('W2 rewritten SMILES hash equal', () => {
    expect(hashOf('CCCCC(C)')).toBe(hashOf('CCCCCC'));
    expect(hashOf('OCCCC')).toBe(hashOf('CCCCO'));
    expect(hashOf('O=C1CCCCC1')).toBe(hashOf('C1(=O)CCCCC1'));
    expect(hashOf('C1CCCCC1')).toBe(hashOf('C%10CCCCC%10'));
  });
  it('W3 isomer families are pairwise different', () => {
    const families = [
      ['CCCC', 'CC(C)C'],
      ['CCCCC', 'CCC(C)C', 'CC(C)(C)C'],
      ['CCCCCC', 'CCCCC(C)', 'CCCC(C)CC', 'CC(C)CC(C)', 'CCC(C)(C)C'].slice(0, 5),
      ['CCCO', 'CC(C)O', 'COCC'],
      ['CCCCO', 'CCC(C)O', 'CC(C)CO', 'CC(C)(C)O', 'CCOCC', 'COCCC', 'COC(C)C'],
      ['C=CCC', 'CC=CC', 'C=C(C)C', 'C1CCC1', 'CC1CC1'],
      ['CCCC=O', 'CC(C)C=O', 'CCC(C)=O'],
    ];
    // C6H14: five distinct constitutional isomers
    families[2] = ['CCCCCC', 'CCCC(C)C', 'CCC(C)CC', 'CCC(C)(C)C', 'CC(C)C(C)C'];
    for (const fam of families) {
      const hashes = fam.map(hashOf);
      expect(new Set(hashes).size).toBe(fam.length);
    }
  });
  it('W4 charge and H are in the label', () => {
    expect(hashOf('CCO')).not.toBe(hashOf('CC[O-]'));
    expect(hashOf('CN')).not.toBe(hashOf('C[NH3+]'));
  });
  it('W5 equivalence classes', () => {
    const distinct = (s: string) => new Set(classesOf(s)).size;
    expect(distinct('CCO')).toBe(3);
    expect(distinct('CCC')).toBe(2);
    expect(distinct('CC(C)(C)C')).toBe(2);
    expect(distinct('c1ccccc1')).toBe(1);
    expect(distinct('CC(C)O')).toBe(3);
    expect(distinct('CC(C)CC(C)(C)C')).toBe(5);
    expect(classesOf('CCC')).toEqual([classesOf('CCC')[2], classesOf('CCC')[1], classesOf('CCC')[0]]);
  });
  it('W6 empty graph', () => {
    expect(wlHash({ atoms: [], bonds: [], adj: [] }, []).hash).toBe(fnv1a64('0|0|'));
  });
  it('W7 positions are ignored', () => {
    const atoms: WorldAtom[] = [
      { id: 0, el: 'C', charge: 0, explicitH: null, aromatic: false, pos: [0, 0, 0], hPos: [] },
      { id: 1, el: 'O', charge: 0, explicitH: null, aromatic: false, pos: [1, 0, 0], hPos: [[1, 1, 0]] },
    ];
    const world = buildGraph(atoms, [{ a: 0, b: 1, order: 1 }]);
    expect(wlHash(world, implicitHydrogens(world).hydrogens).hash).toBe(hashOf('CO'));
  });
  it('W8 stereo is ignored', () => {
    expect(hashOf('C[C@@H](O)CC')).toBe(hashOf('C[C@H](O)CC'));
  });
  it('W9 no false positives on the reference library (and molecules.json when present)', () => {
    const csv = readFileSync(new URL('../../tools/reference/lib.csv', import.meta.url), 'utf8');
    const smiles = csv.split('\n').filter((l) => l.trim()).map((l) => l.split(',')[2]!.replace(/\\\\/g, '\\'));
    const json = new URL('../../src/content/molecules.json', import.meta.url);
    if (existsSync(json)) {
      for (const e of JSON.parse(readFileSync(json, 'utf8')) as { smiles: string }[]) smiles.push(e.smiles);
    }
    const graphs = smiles.map((s) => perceived(s));
    const hashes = graphs.map((g) => wlHash(g, implicitHydrogens(g).hydrogens).hash);
    let collisions = 0;
    for (let i = 0; i < graphs.length; i++) {
      for (let j = i + 1; j < graphs.length; j++) {
        if (hashes[i] !== hashes[j]) continue;
        collisions++;
        expect(isIsomorphic(graphs[i]!, graphs[j]!), `${smiles[i]} vs ${smiles[j]}`).toBe(true);
      }
    }
    expect(collisions).toBeGreaterThanOrEqual(3); // 2-butene written three ways in lib.csv
  });
});
