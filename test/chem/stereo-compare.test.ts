import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { buildGraph, withoutStereoTags } from '@/chem/graph';
import { findIsomorphisms } from '@/chem/isomorphism';
import { compareStereo, permSign } from '@/chem/stereo-compare';
import type { StereoCompareResult } from '@/chem/stereo-compare';
import { tagsFromPositions } from '@/chem/stereo';
import { manhattan } from '@/util/vec3';
import { cellKey, pairKey } from '@/world/types';
import type { PairKey } from '@/world/types';
import type { MoleculeGraph, Vec3, WorldAtom, WorldGraph } from '@/chem/types';

// ---------------------------------------------------------------------------
// Helpers (same lattice legality rule as stereo.test.ts; 03 §6.4, 09 §2.3)
// ---------------------------------------------------------------------------

function grid(smiles: string, pos: readonly Vec3[], hPos: Readonly<Record<number, readonly Vec3[]>> = {}): WorldGraph {
  const g = withoutStereoTags(parseSmiles(smiles).graph);
  if (pos.length !== g.atoms.length) throw new Error(`grid: ${smiles} has ${g.atoms.length} atoms, ${pos.length} positions given`);
  const atoms: WorldAtom[] = g.atoms.map((a, i) => ({
    id: a.id, el: a.el, charge: a.charge, explicitH: null, aromatic: a.aromatic, pos: pos[i]!, hPos: hPos[i] ?? [],
  }));
  return buildGraph(atoms, g.bonds);
}

const hyd = (g: MoleculeGraph): number[] => implicitHydrogens(g).hydrogens;
const cellOf = (p: Vec3) => cellKey(p[0], p[1], p[2]);

function suppressedOf(g: WorldGraph, pairs: readonly (readonly [number, number])[]): Set<PairKey> {
  return new Set(pairs.map(([a, b]) => pairKey(cellOf(g.atoms[a]!.pos), cellOf(g.atoms[b]!.pos))));
}

function assertBuildable(g: WorldGraph, suppressed: ReadonlySet<PairKey> = new Set()): void {
  const cells: { pos: Vec3; atom: number; h: boolean }[] = [];
  for (const a of g.atoms) {
    cells.push({ pos: a.pos, atom: a.id, h: false });
    for (const h of a.hPos) cells.push({ pos: h, atom: a.id, h: true });
  }
  const bonded = new Set<string>();
  for (const b of g.bonds) if (!b.diagonal) bonded.add(`${b.a},${b.b}`);
  const used = new Set<PairKey>();
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const p = cells[i]!;
      const q = cells[j]!;
      if (p.pos[0] === q.pos[0] && p.pos[1] === q.pos[1] && p.pos[2] === q.pos[2]) throw new Error(`fixture: cells ${p.pos} and ${q.pos} coincide`);
      const touching = manhattan(p.pos, q.pos) === 1;
      let isBonded: boolean;
      if (!p.h && !q.h) {
        isBonded = bonded.has(`${Math.min(p.atom, q.atom)},${Math.max(p.atom, q.atom)}`);
        if (touching && !isBonded) {
          const key = pairKey(cellOf(p.pos), cellOf(q.pos));
          if (suppressed.has(key)) { used.add(key); continue; }
        }
      } else if (p.h && q.h) {
        isBonded = false;
      } else {
        isBonded = p.atom === q.atom;
      }
      if (touching && !isBonded) throw new Error(`fixture not buildable: cells ${p.pos} and ${q.pos} are face-adjacent but unbonded`);
      if (!touching && isBonded) throw new Error(`fixture not buildable: cells ${p.pos} and ${q.pos} are bonded but not face-adjacent`);
    }
  }
  for (const key of suppressed) if (!used.has(key)) throw new Error(`fixture: suppressed pair ${key} is not a touching unbonded pair`);
}

const RANK: Record<StereoCompareResult['verdict'], number> = { SAME: 0, ENANTIOMER: 1, DIASTEREOMER: 2, UNSPECIFIED: 3, INVALID_GEOMETRY: 4 };

/** Best verdict over every isomorphism (the rule of 03 §6.3 step 3). */
function best(target: MoleculeGraph, student: MoleculeGraph): StereoCompareResult {
  const maps = findIsomorphisms(target, student);
  expect(maps.length).toBeGreaterThan(0);
  let b: StereoCompareResult | null = null;
  for (const m of maps) {
    const r = compareStereo(target, student, m);
    if (b === null || RANK[r.verdict] < RANK[b.verdict]) b = r;
  }
  return b!;
}

/** A grid build as a tagged target (what sameMolecule does for a target with positions). */
const asTarget = (g: WorldGraph): MoleculeGraph => tagsFromPositions(g, hyd(g));

const BUTANOL = 'CC(O)CC';
const DBB = 'CC(Br)C(Br)C';
const BUTENE = 'CC=CC';

const S_but = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 2, 0]]);
const R_but = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 0, -1], [0, 1, 0], [0, 2, 0]]);
const R_elsewhere = grid(BUTANOL, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 0, 2]]);
const S_elsewhere = grid(BUTANOL, [[0, 0, 0], [1, 0, 0], [1, -1, 0], [1, 0, 1], [1, 0, 2]]);
const flat = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]]);
const meso_a = grid(DBB, [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, -1], [1, -1, 0]]);
const meso_b = grid(DBB, [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [1, 0, 1], [1, -1, 0]]);
const rr = grid(DBB, [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [1, -1, 0], [1, 0, 1]]);
const ss = grid(DBB, [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, -1, 0], [1, 0, -1]]);

/** 05 §5.3 cube chair; 1,4-dimethylcyclohexane CC1CCC(C)CC1 (C0 Me, C1 ring, C2, C3, C4 ring, C5 Me, C6, C7). */
const CHAIR: readonly Vec3[] = [[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 0, 1], [1, 0, 0]];
function dimethyl14(me1: Vec3, me4: Vec3, h: Record<number, Vec3[]> = {}): WorldGraph {
  return grid('CC1CCC(C)CC1', [me1, CHAIR[0]!, CHAIR[1]!, CHAIR[2]!, CHAIR[3]!, me4, CHAIR[4]!, CHAIR[5]!], h);
}
const cis14a = dimethyl14([0, 0, -1], [1, 2, 1], { 4: [[1, 1, 2]] });
const cis14b = dimethyl14([-1, 0, 0], [1, 1, 2], { 1: [[0, 0, -1]] });
const trans14a = dimethyl14([0, 0, -1], [1, 1, 2]);
const trans14b = dimethyl14([-1, 0, 0], [1, 2, 1], { 1: [[0, 0, -1]], 4: [[1, 1, 2]] });

describe('permSign', () => {
  it('identity +1, one transposition -1, cyclic 3-cycle +1, 4-cycle -1', () => {
    expect(permSign([0, 1, 2, 'H'], [0, 1, 2, 'H'])).toBe(1);
    expect(permSign([0, 1, 2, 'H'], [1, 0, 2, 'H'])).toBe(-1);
    expect(permSign([0, 1, 2, 'H'], [1, 2, 0, 'H'])).toBe(1);
    expect(permSign([0, 1, 2, 'H'], [1, 2, 'H', 0])).toBe(-1);
    expect(permSign([0, 1, 2, 'H'], ['H', 2, 1, 0])).toBe(1);
  });
  it('L-alanine check of 03 §5: written (N,H,CH3,COOH) to priorities (N,COOH,CH3,H) is one transposition', () => {
    expect(permSign([0, 'H', 2, 3], [0, 3, 2, 'H'])).toBe(-1);
  });
});

describe('compareStereo: verified verdicts (03 §6.4, test3c.py C)', () => {
  it('fixtures are legal builds', () => {
    for (const g of [S_but, R_but, R_elsewhere, S_elsewhere, flat, meso_a, meso_b, rr, ss, cis14a, cis14b, trans14a, trans14b]) assertBuildable(g);
  });
  it('(S)-2-butanol vs the same build: SAME', () => {
    expect(best(asTarget(S_but), S_but).verdict).toBe('SAME');
  });
  it('(S) vs (R) build: ENANTIOMER, differingCenters = [1]', () => {
    const r = best(asTarget(S_but), R_but);
    expect(r.verdict).toBe('ENANTIOMER');
    expect(r.differingCenters).toEqual([1]);
    expect(r.differingBonds).toEqual([]);
  });
  it('(R) vs (R) built at a different place and orientation: SAME', () => {
    expect(best(asTarget(R_but), R_elsewhere).verdict).toBe('SAME');
  });
  it('(R) vs the "built elsewhere" row with O (1,-1,0), which is S: ENANTIOMER', () => {
    expect(best(asTarget(R_but), S_elsewhere).verdict).toBe('ENANTIOMER');
  });
  it('(S) vs the T-shaped flat build: UNSPECIFIED with the offending student atom', () => {
    const r = best(asTarget(S_but), flat);
    expect(r.verdict).toBe('UNSPECIFIED');
    expect(r.offending).toEqual({ atom: 1 });
  });
  it('meso_a vs meso_b (its mirror image): SAME', () => {
    expect(best(asTarget(meso_a), meso_b).verdict).toBe('SAME');
    expect(best(asTarget(meso_b), meso_a).verdict).toBe('SAME');
  });
  it('(2R,3R) vs (2S,3S): ENANTIOMER', () => {
    expect(best(asTarget(rr), ss).verdict).toBe('ENANTIOMER');
  });
  it('meso_a vs rr and meso_b vs ss: DIASTEREOMER', () => {
    expect(best(asTarget(meso_a), rr).verdict).toBe('DIASTEREOMER');
    expect(best(asTarget(meso_b), ss).verdict).toBe('DIASTEREOMER');
  });
  it('cis-1,4-dimethylcyclohexane (no CIP centres): cis vs cis on the other face SAME, trans vs trans SAME, cis vs trans DIASTEREOMER', () => {
    expect(best(asTarget(cis14a), cis14b).verdict).toBe('SAME');
    expect(best(asTarget(trans14a), trans14b).verdict).toBe('SAME');
    expect(best(asTarget(cis14a), trans14a).verdict).toBe('DIASTEREOMER');
    expect(best(asTarget(cis14b), trans14b).verdict).toBe('DIASTEREOMER');
  });
  it('(E)-but-2-ene target vs a Z grid build: DIASTEREOMER with differingBonds = [1]', () => {
    const target = parseSmiles('C/C=C/C').graph;
    const z = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]]);
    assertBuildable(z, suppressedOf(z, [[0, 3]]));
    const r = best(target, z);
    expect(r.verdict).toBe('DIASTEREOMER');
    expect(r.differingBonds).toEqual([1]);
    expect(r.differingCenters).toEqual([]);
    const e = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]]);
    expect(best(target, e).verdict).toBe('SAME');
    expect(best(parseSmiles('C/C=C\\C').graph, z).verdict).toBe('SAME');
  });
  it('(E)-but-2-ene target vs a twisted build: INVALID_GEOMETRY with the offending student bond', () => {
    const target = parseSmiles('C/C=C/C').graph;
    const tw = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]]);
    const r = best(target, tw);
    expect(r.verdict).toBe('INVALID_GEOMETRY');
    expect(r.offending).toEqual({ bond: 1 });
    const col = grid(BUTENE, [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]]);
    expect(best(target, col).verdict).toBe('INVALID_GEOMETRY');
  });
});

describe('compareStereo: 09 §2.1 layouts against their SMILES tags', () => {
  const rows: [string, string, Vec3[]][] = [
    ['C/C=C\\C', 'C/C=C/C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]]],
    ['CC/C=C\\CC', 'CC/C=C/CC', [[-1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0]]],
    ['C/C=C(\\Cl)C', 'C/C=C(/Cl)C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, -1, 0]]],
    ['C/C=C(/Cl)C', 'C/C=C(\\Cl)C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [1, 1, 0]]],
    ['C/C=C(\\C)CC', 'C/C=C(/C)CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, -1, 0], [2, -1, 0]]],
    ['C/C=C(/C)CC', 'C/C=C(\\C)CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [1, 1, 0], [2, 1, 0]]],
    ['Cl/C=C\\Cl', 'Cl/C=C/Cl', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]]],
    ['Br/C=C(/Br)CC', 'Br/C=C(\\Br)CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [1, 1, 0], [2, 1, 0]]],
    ['CCC/C=C\\CCC', 'CCC/C=C/CCC', [[-2, 1, 0], [-1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0]]],
    ['CC/C(Cl)=C/CC', 'CC/C(Cl)=C\\CC', [[-1, 1, 0], [0, 1, 0], [0, 0, 0], [0, -1, 0], [1, 0, 0], [1, -1, 0], [2, -1, 0]]],
  ];
  for (const [smiles, other, pos] of rows) {
    it(`${smiles}: SAME; ${other} is DIASTEREOMER`, () => {
      const student = grid(smiles, pos);
      expect(best(parseSmiles(smiles).graph, student).verdict).toBe('SAME');
      expect(best(parseSmiles(other).graph, student).verdict).toBe('DIASTEREOMER');
    });
  }
});

describe('compareStereo: students with tags and no positions (reaction output)', () => {
  it('alanine written two ways: SAME under the one isomorphism; the mirror: ENANTIOMER', () => {
    const target = parseSmiles('N[C@@H](C)C(=O)O').graph;
    const same = parseSmiles('C[C@H](N)C(=O)O').graph;
    const maps = findIsomorphisms(target, same);
    expect(maps).toEqual([[2, 1, 0, 3, 4, 5]]);
    expect(compareStereo(target, same, maps[0]!).verdict).toBe('SAME');
    const mirror = parseSmiles('C[C@@H](N)C(=O)O').graph;
    const r = compareStereo(target, mirror, maps[0]!);
    expect(r.verdict).toBe('ENANTIOMER');
    expect(r.differingCenters).toEqual([1]);
  });
  it('an untagged student atom under a tagged target centre: UNSPECIFIED', () => {
    const target = parseSmiles('N[C@@H](C)C(=O)O').graph;
    const student = parseSmiles('NC(C)C(=O)O').graph;
    const r = compareStereo(target, student, [0, 1, 2, 3, 4, 5]);
    expect(r.verdict).toBe('UNSPECIFIED');
    expect(r.offending).toEqual({ atom: 1 });
  });
  it('ez tags: E vs E written with backslashes SAME; E vs Z DIASTEREOMER; untagged student UNSPECIFIED', () => {
    const e = parseSmiles('C/C=C/C').graph;
    expect(compareStereo(e, parseSmiles('C\\C=C\\C').graph, [0, 1, 2, 3]).verdict).toBe('SAME');
    expect(compareStereo(e, parseSmiles('C/C=C\\C').graph, [0, 1, 2, 3]).verdict).toBe('DIASTEREOMER');
    // reversed mapping (the automorphism swapping the ends) gives the same answers
    expect(compareStereo(e, parseSmiles('C\\C=C\\C').graph, [3, 2, 1, 0]).verdict).toBe('SAME');
    expect(compareStereo(e, parseSmiles('C/C=C\\C').graph, [3, 2, 1, 0]).verdict).toBe('DIASTEREOMER');
    const r = compareStereo(e, parseSmiles('CC=CC').graph, [0, 1, 2, 3]);
    expect(r.verdict).toBe('UNSPECIFIED');
    expect(r.offending).toEqual({ bond: 1 });
  });
  it('trisubstituted ez tags with a different reference neighbour still agree', () => {
    // (Z)-2-chlorobut-2-ene written from the methyl side and from the chlorine side
    const a = parseSmiles('C/C=C(\\Cl)C').graph;
    const b = parseSmiles('C/C=C(/C)Cl').graph; // RDKit canonical form of the same Z isomer
    const maps = findIsomorphisms(a, b);
    expect(maps.length).toBeGreaterThan(0);
    expect(maps.some((m) => compareStereo(a, b, m).verdict === 'SAME')).toBe(true);
    const c = parseSmiles('C/C=C(\\C)Cl').graph; // the E isomer
    expect(maps.every((m) => compareStereo(a, c, m).verdict === 'DIASTEREOMER')).toBe(true);
  });
  it('a target with both a centre and an alkene: one flipped centre with the bond agreeing is ENANTIOMER', () => {
    const target = parseSmiles('C/C=C/[C@H](O)C').graph;
    const same = parseSmiles('C/C=C/[C@H](O)C').graph;
    const mirror = parseSmiles('C/C=C/[C@@H](O)C').graph;
    const zmirror = parseSmiles('C/C=C\\[C@@H](O)C').graph;
    const id = [0, 1, 2, 3, 4, 5];
    expect(compareStereo(target, same, id).verdict).toBe('SAME');
    expect(compareStereo(target, mirror, id)).toMatchObject({ verdict: 'ENANTIOMER', differingCenters: [3], differingBonds: [] });
    expect(compareStereo(target, zmirror, id)).toMatchObject({ verdict: 'DIASTEREOMER', differingCenters: [3], differingBonds: [1] });
  });
  it('meso and chiral dibromobutanes from SMILES tags', () => {
    const meso = parseSmiles('C[C@H](Br)[C@H](Br)C').graph;
    const mesoMirror = parseSmiles('C[C@@H](Br)[C@@H](Br)C').graph;
    const rrS = parseSmiles('C[C@@H](Br)[C@H](Br)C').graph;
    const ssS = parseSmiles('C[C@H](Br)[C@@H](Br)C').graph;
    expect(best(meso, mesoMirror).verdict).toBe('SAME');
    expect(best(rrS, ssS).verdict).toBe('ENANTIOMER');
    expect(best(meso, rrS).verdict).toBe('DIASTEREOMER');
    expect(best(rrS, rr).verdict).toBe('SAME');
    expect(best(rrS, ss).verdict).toBe('ENANTIOMER');
    expect(best(meso, meso_a).verdict).toBe('SAME');
    expect(best(meso, meso_b).verdict).toBe('SAME');
    expect(best(meso, rr).verdict).toBe('DIASTEREOMER');
  });
  it('an untagged target is SAME for every mapping, whatever the student is', () => {
    const target = parseSmiles('CC(O)CC').graph;
    for (const student of [S_but, R_but, flat, parseSmiles('C[C@H](O)CC').graph]) {
      for (const m of findIsomorphisms(target, student)) expect(compareStereo(target, student, m)).toEqual({ verdict: 'SAME', differingCenters: [], differingBonds: [] });
    }
  });
  it('a target centre with an explicit H on the student side uses the H block cell', () => {
    const target = parseSmiles('C[C@@H](O)CC').graph; // R
    const rh = grid(BUTANOL, [[1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 2, 0]], { 1: [[-1, 0, 0]] });
    assertBuildable(rh);
    expect(best(target, rh).verdict).toBe('SAME');
    const sq = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]], { 1: [[0, -1, 0]] });
    expect(best(target, sq).verdict).toBe('UNSPECIFIED');
  });
});
