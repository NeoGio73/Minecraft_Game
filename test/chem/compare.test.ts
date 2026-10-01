import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { buildGraph, withoutStereoTags } from '@/chem/graph';
import { wlHash } from '@/chem/wlhash';
import { findIsomorphisms } from '@/chem/isomorphism';
import { normalize, sameMolecule } from '@/chem/compare';
import type { Atom, ChemApi, MoleculeGraph, StereoPolicy, Vec3, WorldAtom, WorldGraph } from '@/chem/types';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;

function grid(smiles: string, pos: readonly Vec3[], hPos: Readonly<Record<number, readonly Vec3[]>> = {}): WorldGraph {
  const g = withoutStereoTags(parse(smiles));
  if (pos.length !== g.atoms.length) throw new Error(`grid: ${smiles} has ${g.atoms.length} atoms, ${pos.length} positions given`);
  const atoms: WorldAtom[] = g.atoms.map((a, i) => ({
    id: a.id, el: a.el, charge: a.charge, explicitH: null, aromatic: a.aromatic, pos: pos[i]!, hPos: hPos[i] ?? [],
  }));
  return buildGraph(atoms, g.bonds);
}

const ALL: readonly StereoPolicy[] = ['none', 'relative', 'absolute', 'ez'];

// 2-butanol atoms 0=CH3 1=C2 2=O 3=CH2 4=CH3; 05 §5.3 layouts
const R_but = grid('CC(O)CC', [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [2, 0, 0]]);
const S_but = grid('CC(O)CC', [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [2, 0, 0]]);
const flat = grid('CC(O)CC', [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]]);
const E_but = grid('CC=CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]]);
const Z_but = grid('CC=CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]]);
const twisted = grid('CC=CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]]);

describe('normalize', () => {
  it('Kekulé -> hydrogens -> perceive: both benzene spellings hash alike and keep their hydrogens', () => {
    const a = normalize(parse('c1ccccc1'));
    const b = normalize(parse('C1=CC=CC=C1'));
    expect(a.hydrogens).toEqual([1, 1, 1, 1, 1, 1]);
    expect(b.hydrogens).toEqual(a.hydrogens);
    expect(wlHash(a.graph, a.hydrogens).hash).toBe(wlHash(b.graph, b.hydrogens).hash);
    expect(a.graph.atoms.every((x) => x.aromatic)).toBe(true);
    expect(b.graph.atoms.every((x) => x.aromatic)).toBe(true);
    expect(a.warnings).toEqual([]);
  });
  it('an aromatic-flagged graph whose orders are not Kekulé is re-kekulized', () => {
    const atoms: Atom[] = [0, 1, 2, 3, 4, 5].map((id) => ({ id, el: 'C', charge: 0, explicitH: null, aromatic: true }));
    const g = buildGraph(atoms, [0, 1, 2, 3, 4, 5].map((a) => ({ a, b: (a + 1) % 6, order: 1 as const, aromatic: true })));
    const n = normalize(g);
    expect(n.graph.bonds.filter((b) => b.order === 2).length).toBe(3);
    expect(n.hydrogens).toEqual([1, 1, 1, 1, 1, 1]);
  });
  it('keeps positions, hPos and tags; reports valence warnings', () => {
    const n = normalize(R_but);
    expect(n.graph.atoms[1]!.pos).toEqual([0, 0, 0]);
    const t = normalize(parse('N[C@@H](C)C(=O)O'));
    expect(t.graph.atoms[1]!.tet).toEqual({ order: [0, 'H', 2, 3], sign: 1 });
    const over = normalize(parse('CC(C)(C)(C)C'));
    expect(over.warnings.map((w) => w.kind)).toEqual(['over-valence']);
  });
  it('a graph that cannot be kekulized is used as given', () => {
    const atoms: Atom[] = [0, 1, 2, 3, 4].map((id) => ({ id, el: 'C', charge: 0, explicitH: null, aromatic: true }));
    const g = buildGraph(atoms, [0, 1, 2, 3, 4].map((a) => ({ a, b: (a + 1) % 5, order: 1 as const, aromatic: true })));
    const n = normalize(g);
    expect(n.graph.bonds.every((b) => b.order === 1)).toBe(true);
    expect(n.hydrogens).toEqual([2, 2, 2, 2, 2]);
  });
});

describe('sameMolecule: constitution (policy none)', () => {
  it('the same SMILES written differently is SAME with a valid mapping', () => {
    const pairs: [string, string][] = [
      ['CC(C)O', 'OC(C)C'], ['CCO', 'OCC'], ['C1CCCCC1', 'C%10CCCCC%10'], ['CC(=O)O', 'OC(C)=O'],
      ['N[C@@H](C)C(=O)O', 'C[C@H](N)C(=O)O'], ['CC(C)(C)C', 'C(C)(C)(C)C'], ['C.CC', 'CC.C'],
      ['c1ccccc1', 'C1=CC=CC=C1'], ['Cc1ccccc1', 'CC1=CC=CC=C1'], ['CC1=C(C)C=CC=C1', 'CC1C(C)=CC=CC=1'],
      ['CC(=O)Oc1ccccc1C(=O)O', 'OC(=O)c1ccccc1OC(C)=O'],
    ];
    for (const [a, b] of pairs) {
      const r = sameMolecule(parse(a), parse(b));
      expect(r.same, `${a} vs ${b}`).toBe(true);
      expect(r.verdict).toBe('SAME');
      expect(r.mapping).toBeDefined();
      expect(r.warnings).toEqual([]);
      const maps = findIsomorphisms(normalize(parse(b)).graph, normalize(parse(a)).graph).map((m) => m.join(','));
      expect(maps).toContain(r.mapping!.join(','));
    }
  });
  it('constitutional isomer families: C4H10, C5H12, C4H8, C4H9Br', () => {
    const families: string[][] = [
      ['CCCC', 'CC(C)C'],
      ['CCCCC', 'CCC(C)C', 'CC(C)(C)C'],
      ['C=CCC', 'CC=CC', 'CC(C)=C', 'C1CCC1', 'CC1CC1'],
      ['CCCCBr', 'CCC(C)Br', 'CC(C)CBr', 'CC(C)(C)Br'],
    ];
    for (const f of families) {
      for (let i = 0; i < f.length; i++) {
        for (let j = 0; j < f.length; j++) {
          const r = sameMolecule(parse(f[i]!), parse(f[j]!));
          if (i === j) expect(r.verdict, `${f[i]} vs ${f[j]}`).toBe('SAME');
          else {
            expect(r.verdict, `${f[i]} vs ${f[j]}`).toBe('DIFFERENT_CONSTITUTION');
            expect(r.same).toBe(false);
            expect(r.mapping).toBeUndefined();
          }
        }
      }
    }
  });
  it('a different formula or net charge is DIFFERENT_FORMULA', () => {
    expect(sameMolecule(parse('CCO'), parse('CCCO')).verdict).toBe('DIFFERENT_FORMULA');
    expect(sameMolecule(parse('C[O-]'), parse('CO')).verdict).toBe('DIFFERENT_FORMULA');
    expect(sameMolecule(parse('[NH4+]'), parse('N')).verdict).toBe('DIFFERENT_FORMULA');
    expect(sameMolecule(parse('C=CC'), parse('C1CC1')).verdict).toBe('DIFFERENT_CONSTITUTION');
    expect(sameMolecule(parse('CC'), parse('C.C')).verdict).toBe('DIFFERENT_FORMULA');
  });
  it('charges are compared in every policy: a zwitterion is not the neutral form', () => {
    for (const p of ALL) {
      const r = sameMolecule(parse('[NH3+]CC(=O)[O-]'), parse('NCC(=O)O'), { stereo: p });
      expect(r.verdict).toBe('DIFFERENT_CONSTITUTION');
      expect(r.same).toBe(false);
    }
    expect(sameMolecule(parse('CC(=O)[O-]'), parse('CC([O-])=O')).verdict).toBe('SAME');
  });
  it('WL-collision fixture: cyclohexane and two cyclopropanes hash alike but are different', () => {
    const a = normalize(parse('C1CCCCC1'));
    const b = normalize(parse('C1CC1.C1CC1'));
    expect(wlHash(a.graph, a.hydrogens).hash).toBe(wlHash(b.graph, b.hydrogens).hash);
    const r = sameMolecule(parse('C1CCCCC1'), parse('C1CC1.C1CC1'));
    expect(r.verdict).toBe('DIFFERENT_CONSTITUTION');
    expect(r.same).toBe(false);
  });
  it('Kekulé forms of an arene compare equal only through perception (both inputs normalised)', () => {
    expect(sameMolecule(parse('CC1=C(C)C=CC=C1'), parse('CC1C(C)=CC=CC=1')).verdict).toBe('SAME');
    expect(sameMolecule(parse('Cc1ccccc1C'), parse('Cc1cccc(C)c1')).verdict).toBe('DIFFERENT_CONSTITUTION');
    expect(sameMolecule(parse('c1ccccc1'), parse('C1=CC=CCC1')).verdict).toBe('DIFFERENT_FORMULA');
  });
  it('state cap: a highly symmetric molecule reports an isomorphism-cap warning and stays SAME', () => {
    // 53 heavy atoms, 4!*(3!^4)^4 automorphisms: the search is stopped by DEFAULT_MAX_STATES
    const tBu = 'C(C)(C)C';
    const arm = `C(${tBu})(${tBu})${tBu}`;
    const g = parse(`C(${arm})(${arm})(${arm})${arm}`);
    const r = sameMolecule(g, g);
    expect(r.verdict).toBe('SAME');
    expect(r.same).toBe(true);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toMatchObject({ kind: 'isomorphism-cap' });
    expect((r.warnings[0] as { states: number }).states).toBeGreaterThan(0);
  });
  it('empty graphs are the same molecule', () => {
    const e: MoleculeGraph = { atoms: [], bonds: [], adj: [] };
    expect(sameMolecule(e, e)).toEqual({ same: true, verdict: 'SAME', mapping: [], warnings: [] });
  });
  it('policy none ignores stereo entirely, including bad geometry', () => {
    expect(sameMolecule(S_but, parse('C[C@@H](O)CC')).same).toBe(true);
    expect(sameMolecule(flat, parse('C[C@@H](O)CC')).same).toBe(true);
    expect(sameMolecule(twisted, parse('C/C=C/C')).same).toBe(true);
    expect(sameMolecule(parse('CC=CC'), parse('C/C=C/C'), { stereo: 'none' }).verdict).toBe('SAME');
    expect(sameMolecule(parse('C[C@@H](Br)[C@H](Br)C'), parse('C[C@H](Br)[C@H](Br)C')).same).toBe(true);
  });
  it('library pairs (lib.csv) agree with RDKit canonical equality under policy none', () => {
    const csv = readFileSync(new URL('../../tools/reference/lib.csv', import.meta.url), 'utf8');
    const smiles = csv.split('\n').filter((l) => l.trim()).map((l) => l.split(',')[2]!.replace(/\\\\/g, '\\'));
    const rdkitEqual = new Set(['14,15', '14,16', '15,16']);
    const graphs = smiles.map(parse);
    for (let i = 0; i < graphs.length; i++) {
      for (let j = i + 1; j < graphs.length; j++) {
        expect(sameMolecule(graphs[i]!, graphs[j]!).same, `${smiles[i]} vs ${smiles[j]}`).toBe(rdkitEqual.has(`${i},${j}`));
      }
    }
    // the three but-2-ene rows differ under 'ez': E vs Z
    expect(sameMolecule(graphs[15]!, graphs[16]!, { stereo: 'ez' }).verdict).toBe('DIASTEREOMER');
    expect(sameMolecule(graphs[14]!, graphs[16]!, { stereo: 'ez' }).verdict).toBe('UNSPECIFIED');
    expect(sameMolecule(graphs[16]!, graphs[14]!, { stereo: 'ez' }).verdict).toBe('SAME');
  });
});

describe('sameMolecule: stereo policies with grid students and tagged targets', () => {
  it('(R)-2-butanol target: R build SAME, S build ENANTIOMER (relative accepts, absolute refuses)', () => {
    const target = parse('C[C@@H](O)CC');
    const r = sameMolecule(R_but, target, { stereo: 'absolute' });
    expect(r).toMatchObject({ same: true, verdict: 'SAME', differingCenters: [], differingBonds: [] });
    expect(sameMolecule(R_but, target, { stereo: 'relative' }).same).toBe(true);
    const s = sameMolecule(S_but, target, { stereo: 'absolute' });
    expect(s.verdict).toBe('ENANTIOMER');
    expect(s.same).toBe(false);
    expect(s.differingCenters).toEqual([1]);
    expect(s.mapping).toEqual([0, 1, 2, 3, 4]);
    expect(sameMolecule(S_but, target, { stereo: 'relative' })).toMatchObject({ same: true, verdict: 'ENANTIOMER' });
    expect(sameMolecule(S_but, target, { stereo: 'ez' })).toMatchObject({ same: true, verdict: 'SAME' });
  });
  it('a flat (T) build against a tagged target: UNSPECIFIED, same = false, offendingAtom set', () => {
    for (const p of ['relative', 'absolute'] as const) {
      const r = sameMolecule(flat, parse('C[C@@H](O)CC'), { stereo: p });
      expect(r.verdict).toBe('UNSPECIFIED');
      expect(r.same).toBe(false);
      expect(r.offendingAtom).toBe(1);
    }
    expect(sameMolecule(flat, parse('C[C@@H](O)CC'), { stereo: 'ez' }).same).toBe(true);
  });
  it('a student without positions or tags against a tagged target: UNSPECIFIED for relative/absolute/ez', () => {
    for (const p of ['relative', 'absolute'] as const) {
      const r = sameMolecule(parse('CC(O)CC'), parse('C[C@@H](O)CC'), { stereo: p });
      expect(r).toMatchObject({ same: false, verdict: 'UNSPECIFIED', offendingAtom: 1 });
    }
    const ez = sameMolecule(parse('CC=CC'), parse('C/C=C/C'), { stereo: 'ez' });
    expect(ez).toMatchObject({ same: false, verdict: 'UNSPECIFIED', offendingBond: 1 });
  });
  it('an untagged target accepts any configuration (require-specified-only)', () => {
    for (const p of ALL) {
      expect(sameMolecule(flat, parse('CC(O)CC'), { stereo: p }).same).toBe(true);
      expect(sameMolecule(S_but, parse('CC(O)CC'), { stereo: p }).same).toBe(true);
      expect(sameMolecule(twisted, parse('CC=CC'), { stereo: p }).same).toBe(true);
    }
  });
  it('E/Z: (E)-but-2-ene target vs E grid SAME, Z grid DIASTEREOMER, twisted INVALID_GEOMETRY', () => {
    const target = parse('C/C=C/C');
    expect(sameMolecule(E_but, target, { stereo: 'ez' })).toMatchObject({ same: true, verdict: 'SAME' });
    const z = sameMolecule(Z_but, target, { stereo: 'ez' });
    expect(z).toMatchObject({ same: false, verdict: 'DIASTEREOMER', differingBonds: [1] });
    const tw = sameMolecule(twisted, target, { stereo: 'ez' });
    expect(tw).toMatchObject({ same: false, verdict: 'INVALID_GEOMETRY', offendingBond: 1 });
    expect(sameMolecule(Z_but, parse('C/C=C\\C'), { stereo: 'ez' }).same).toBe(true);
    expect(sameMolecule(Z_but, parse('C/C=C\\C'), { stereo: 'absolute' }).same).toBe(true);
    expect(sameMolecule(E_but, parse('C/C=C\\C'), { stereo: 'relative' }).same).toBe(false);
  });
  it("policy 'ez' ignores tetrahedral tags; 'absolute' needs both", () => {
    const target = parse('C/C=C/[C@H](O)C'); // atoms 0..5: C0 C1=C2 C3(centre) O4 C5
    // E zigzag in the xy plane, the centre C3 octant (C2 +y, O +z, C5 +x); the mirror puts O at -z
    const pos: Vec3[] = [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [1, -1, 1], [2, -1, 0]];
    const g = grid('CC=CC(O)C', pos);
    const mirror = grid('CC=CC(O)C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [1, -1, -1], [2, -1, 0]]);
    const a = sameMolecule(g, target, { stereo: 'absolute' });
    const m = sameMolecule(mirror, target, { stereo: 'absolute' });
    expect([a.verdict, m.verdict].sort()).toEqual(['ENANTIOMER', 'SAME']);
    expect(sameMolecule(g, target, { stereo: 'ez' })).toMatchObject({ same: true, verdict: 'SAME' });
    expect(sameMolecule(mirror, target, { stereo: 'ez' })).toMatchObject({ same: true, verdict: 'SAME' });
    expect(sameMolecule(g, target, { stereo: 'relative' }).same).toBe(true);
    expect(sameMolecule(mirror, target, { stereo: 'relative' }).same).toBe(true);
  });
  it('meso: the dibromobutane layouts against the library SMILES', () => {
    const meso = parse('C[C@H](Br)[C@H](Br)C');
    const rrT = parse('C[C@@H](Br)[C@H](Br)C');
    const DBB = 'CC(Br)C(Br)C';
    const meso_a = grid(DBB, [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, -1], [1, -1, 0]]);
    const meso_b = grid(DBB, [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [1, 0, 1], [1, -1, 0]]);
    const rr = grid(DBB, [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [1, -1, 0], [1, 0, 1]]);
    const ss = grid(DBB, [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, -1, 0], [1, 0, -1]]);
    expect(sameMolecule(meso_a, meso, { stereo: 'absolute' }).verdict).toBe('SAME');
    expect(sameMolecule(meso_b, meso, { stereo: 'absolute' }).verdict).toBe('SAME');
    expect(sameMolecule(rr, meso, { stereo: 'absolute' }).verdict).toBe('DIASTEREOMER');
    expect(sameMolecule(rr, meso, { stereo: 'relative' }).same).toBe(false);
    expect(sameMolecule(rr, rrT, { stereo: 'absolute' }).verdict).toBe('SAME');
    expect(sameMolecule(ss, rrT, { stereo: 'absolute' })).toMatchObject({ same: false, verdict: 'ENANTIOMER' });
    expect(sameMolecule(ss, rrT, { stereo: 'relative' })).toMatchObject({ same: true, verdict: 'ENANTIOMER' });
  });
  it('the 09 §2.1 Z/tri-substituted layouts match their SMILES under ez and absolute', () => {
    const rows: [string, Vec3[]][] = [
      ['C/C=C\\C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]]],
      ['C/C=C(\\Cl)C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, -1, 0]]],
      ['C/C=C(/Cl)C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [1, 1, 0]]],
      ['Br/C=C(/Br)CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [1, 1, 0], [2, 1, 0]]],
      ['CC/C=C\\CC', [[-1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0]]],
    ];
    for (const [smiles, pos] of rows) {
      const g = grid(smiles, pos);
      expect(sameMolecule(g, parse(smiles), { stereo: 'ez' }).same, smiles).toBe(true);
      expect(sameMolecule(g, parse(smiles), { stereo: 'absolute' }).same, smiles).toBe(true);
    }
    // Lindlar product: (Z)-hex-3-ene expected `CC/C=C\\CC`; an E build fails with DIASTEREOMER
    const eHex = grid('CC/C=C/CC', [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0]]);
    expect(sameMolecule(eHex, parse('CC/C=C\\CC'), { stereo: 'ez' })).toMatchObject({ same: false, verdict: 'DIASTEREOMER' });
  });
  it('two builds: a world-graph target is tagged from its positions', () => {
    expect(sameMolecule(R_but, R_but, { stereo: 'absolute' }).verdict).toBe('SAME');
    expect(sameMolecule(S_but, R_but, { stereo: 'absolute' })).toMatchObject({ same: false, verdict: 'ENANTIOMER' });
    expect(sameMolecule(flat, R_but, { stereo: 'absolute' }).verdict).toBe('UNSPECIFIED');
    expect(sameMolecule(R_but, flat, { stereo: 'absolute' }).verdict).toBe('SAME'); // a flat target has no tags
    expect(sameMolecule(Z_but, E_but, { stereo: 'ez' }).verdict).toBe('DIASTEREOMER');
    expect(sameMolecule(E_but, E_but, { stereo: 'ez' }).verdict).toBe('SAME');
  });
  it('students with tags and no positions (reaction output) are graded through the tag branch', () => {
    const target = parse('Br[C@H]1CCCC[C@@H]1Br');
    expect(sameMolecule(parse('Br[C@H]1CCCC[C@@H]1Br'), target, { stereo: 'relative' }).verdict).toBe('SAME');
    expect(sameMolecule(parse('Br[C@@H]1CCCC[C@H]1Br'), target, { stereo: 'relative' })).toMatchObject({ same: true, verdict: 'ENANTIOMER' });
    expect(sameMolecule(parse('Br[C@@H]1CCCC[C@H]1Br'), target, { stereo: 'absolute' }).same).toBe(false);
    expect(sameMolecule(parse('Br[C@H]1CCCC[C@H]1Br'), target, { stereo: 'relative' })).toMatchObject({ same: false, verdict: 'DIASTEREOMER' });
    expect(sameMolecule(parse('BrC1CCCCC1Br'), target, { stereo: 'relative' })).toMatchObject({ same: false, verdict: 'UNSPECIFIED' });
    // SN2 inversion: (S)-2-bromobutane -> (R)-butan-2-ol written from either end
    expect(sameMolecule(parse('CC[C@@H](C)O'), parse('C[C@@H](O)CC'), { stereo: 'absolute' }).verdict).toBe('SAME');
    expect(sameMolecule(parse('CC[C@H](C)O'), parse('C[C@@H](O)CC'), { stereo: 'absolute' }).verdict).toBe('ENANTIOMER');
    // alkyne-derived alkenes under 'ez'
    expect(sameMolecule(parse('CC/C=C\\CC'), parse('CC\\C=C/CC'), { stereo: 'ez' }).verdict).toBe('SAME');
    expect(sameMolecule(parse('CC/C=C/CC'), parse('CC/C=C\\CC'), { stereo: 'ez' }).verdict).toBe('DIASTEREOMER');
  });
  it('best verdict over all mappings: a symmetric molecule picks the mapping that makes the stereo agree', () => {
    // 2,3-butanediol: `C[C@@H](O)[C@@H](O)C` is the meso (R,S) form, `C[C@H](O)[C@@H](O)C` is (S,S) (RDKit)
    const meso = parse('C[C@@H](O)[C@@H](O)C');
    const r = sameMolecule(parse('C[C@@H](O)[C@@H](O)C'), meso, { stereo: 'absolute' });
    expect(r.verdict).toBe('SAME');
    expect(findIsomorphisms(meso, meso).length).toBe(2);
    // the meso form equals its mirror image: only the end-swapping automorphism makes both centres agree
    expect(sameMolecule(parse('C[C@H](O)[C@H](O)C'), meso, { stereo: 'absolute' }).verdict).toBe('SAME');
    const rrDiol = parse('C[C@@H](O)[C@H](O)C');
    expect(sameMolecule(rrDiol, meso, { stereo: 'absolute' }).verdict).toBe('DIASTEREOMER');
    expect(sameMolecule(rrDiol, parse('C[C@H](O)[C@@H](O)C'), { stereo: 'absolute' }).verdict).toBe('ENANTIOMER');
    expect(sameMolecule(rrDiol, parse('C[C@H](O)[C@@H](O)C'), { stereo: 'relative' }).same).toBe(true);
  });
  it('the result satisfies the ChemApi signature', () => {
    const api: Pick<ChemApi, 'sameMolecule'> = { sameMolecule };
    expect(api.sameMolecule(parse('C'), parse('C')).same).toBe(true);
  });
});
