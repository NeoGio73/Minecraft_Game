import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSmiles } from '@/chem/smiles';
import { perceiveAromaticity } from '@/chem/aromatic';
import { implicitHydrogens } from '@/chem/hydrogens';
import { atomLabel, bondLabel } from '@/chem/wlhash';
import { DEFAULT_MAX_STATES, findIsomorphisms, findIsomorphismsDetailed, isIsomorphic } from '@/chem/isomorphism';
import { bondBetween } from '@/chem/graph';
import type { MoleculeGraph } from '@/chem/types';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;
const perceived = (s: string) => perceiveAromaticity(parse(s));

function isValidMapping(t: MoleculeGraph, s: MoleculeGraph, m: number[]): boolean {
  const hT = implicitHydrogens(t).hydrogens;
  const hS = implicitHydrogens(s).hydrogens;
  if (new Set(m).size !== m.length || m.length !== t.atoms.length) return false;
  for (let i = 0; i < t.atoms.length; i++) {
    if (atomLabel(t.atoms[i]!, hT[i]!) !== atomLabel(s.atoms[m[i]!]!, hS[m[i]!]!)) return false;
  }
  for (const b of t.bonds) {
    const k = bondBetween(s, m[b.a]!, m[b.b]!);
    if (k === undefined || bondLabel(s.bonds[k]!) !== bondLabel(b)) return false;
  }
  return true;
}

describe('findIsomorphisms', () => {
  it('I1 automorphism counts match RDKit uniquify=False', () => {
    const cases: [string, number][] = [
      ['C', 1], ['CC', 2], ['CC(C)C', 6], ['CC(C)(C)C', 24], ['C1CCCCC1', 12], ['c1ccccc1', 12],
      ['C1CCC1', 8], ['CC(C)O', 2], ['CCCCCC', 2], ['CC(C)CC(C)(C)C', 12],
    ];
    for (const [s, count] of cases) {
      const g = perceived(s);
      const maps = findIsomorphisms(g, g);
      expect(maps.length, s).toBe(count);
      for (const m of maps) expect(isValidMapping(g, g, m), s).toBe(true);
      expect(new Set(maps.map((m) => m.join(','))).size).toBe(count);
    }
  });
  it('I2 I4 I6 I7 constitutional isomers and charge differences', () => {
    expect(findIsomorphisms(parse('CCCC'), parse('CC(C)C'))).toEqual([]);
    expect(findIsomorphisms(perceived('Cc1ccccc1C'), perceived('Cc1cccc(C)c1'))).toEqual([]);
    expect(findIsomorphisms(parse('C=CCC'), parse('CC=CC'))).toEqual([]);
    expect(findIsomorphisms(parse('C[O-]'), parse('CO'))).toEqual([]);
  });
  it('I3 Kekulé forms match only after perception', () => {
    const a = parse('CC1=C(C)C=CC=C1');
    const b = parse('CC1C(C)=CC=CC=1');
    expect(findIsomorphisms(a, b)).toEqual([]);
    expect(findIsomorphisms(perceiveAromaticity(a), perceiveAromaticity(b)).length).toBeGreaterThanOrEqual(1);
  });
  it('I5 quick reject on H labels', () => {
    const r = findIsomorphismsDetailed(parse('c1ccccc1'), parse('C1=CC=CCC1'));
    expect(r).toEqual({ mappings: [], states: 0, capped: false });
  });
  it('I8 alanine written two ways: one mapping', () => {
    const maps = findIsomorphisms(parse('N[C@@H](C)C(=O)O'), parse('C[C@H](N)C(=O)O'));
    expect(maps).toEqual([[2, 1, 0, 3, 4, 5]]);
  });
  it('I9 state cap', () => {
    const e = parse('CCO');
    const r = findIsomorphismsDetailed(e, e, 1);
    expect(r.capped).toBe(true);
    expect(r.mappings).toEqual([]);
    const full = findIsomorphismsDetailed(e, e);
    expect(full.capped).toBe(false);
    expect(full.states).toBeGreaterThan(0);
    expect(full.states).toBeLessThan(DEFAULT_MAX_STATES);
  });
  it('firstOnly stops after the first mapping', () => {
    const g = parse('CC(C)(C)C');
    expect(findIsomorphismsDetailed(g, g, DEFAULT_MAX_STATES, true).mappings.length).toBe(1);
    expect(isIsomorphic(g, g)).toBe(true);
    expect(isIsomorphic(g, parse('CCCCC'))).toBe(false);
  });
  it('I11 two-component graphs', () => {
    expect(findIsomorphisms(parse('C.CC'), parse('CC.C')).length).toBe(2);
    expect(findIsomorphisms(parse('C.CC'), parse('CCC'))).toEqual([]);
  });
  it('empty graphs are isomorphic with one empty mapping', () => {
    const e: MoleculeGraph = { atoms: [], bonds: [], adj: [] };
    expect(findIsomorphisms(e, e)).toEqual([[]]);
  });
  it('mappings of a ring-closure rewrite are all valid', () => {
    const t = parse('C1CCCCC1');
    const s = parse('C%10CCCCC%10');
    const maps = findIsomorphisms(t, s);
    expect(maps.length).toBe(12);
    for (const m of maps) expect(isValidMapping(t, s, m)).toBe(true);
  });
  it('I10 agrees with RDKit canonical equality (stereo stripped) on every reference-library pair', () => {
    const csv = readFileSync(new URL('../../tools/reference/lib.csv', import.meta.url), 'utf8');
    const smiles = csv.split('\n').filter((l) => l.trim()).map((l) => l.split(',')[2]!.replace(/\\\\/g, '\\'));
    // RDKit: pairs (i, j) with equal canonical SMILES after RemoveStereochemistry (the three 2-butene rows)
    const rdkitEqual = new Set(['14,15', '14,16', '15,16']);
    const graphs = smiles.map(perceived);
    let disagreements = 0;
    for (let i = 0; i < graphs.length; i++) {
      for (let j = i + 1; j < graphs.length; j++) {
        const same = isIsomorphic(graphs[i]!, graphs[j]!);
        if (same !== rdkitEqual.has(`${i},${j}`)) disagreements++;
      }
    }
    expect(disagreements).toBe(0);
  });
});
