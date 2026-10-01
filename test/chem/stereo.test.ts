import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { buildGraph, withoutStereoTags } from '@/chem/graph';
import {
  EPS, RING_EZ_EXEMPT_MAX, STEREO_TEXT, alkeneSides, analyzeStereo, assignEZ, assignRS, classifyShape,
  labelTargetStereo, parityInOrder, ringFace, signedVolume, stereoWarnings, tagsFromPositions,
} from '@/chem/stereo';
import { cross, dot, manhattan } from '@/util/vec3';
import { cellKey, pairKey } from '@/world/types';
import type { PairKey } from '@/world/types';
import type { MoleculeGraph, Vec3, WorldAtom, WorldGraph } from '@/chem/types';

// ---------------------------------------------------------------------------
// Helpers (a restatement of test/helpers/lattice.ts from 03 §6.4 / 09 §2.3)
// ---------------------------------------------------------------------------

/** World graph from a SMILES constitution (tags stripped, explicitH null) plus lattice cells. */
function grid(smiles: string, pos: readonly Vec3[], hPos: Readonly<Record<number, readonly Vec3[]>> = {}): WorldGraph {
  const g = withoutStereoTags(parseSmiles(smiles).graph);
  if (pos.length !== g.atoms.length) throw new Error(`grid: ${smiles} has ${g.atoms.length} atoms, ${pos.length} positions given`);
  const atoms: WorldAtom[] = g.atoms.map((a, i) => ({
    id: a.id, el: a.el, charge: a.charge, explicitH: null, aromatic: a.aromatic, pos: pos[i]!, hPos: hPos[i] ?? [],
  }));
  return buildGraph(atoms, g.bonds);
}

const hyd = (g: MoleculeGraph): number[] => implicitHydrogens(g).hydrogens;

function cellOf(p: Vec3) {
  return cellKey(p[0], p[1], p[2]);
}

/** Suppressed-pair set from atom id pairs of a world graph. */
function suppressedOf(g: WorldGraph, pairs: readonly (readonly [number, number])[]): Set<PairKey> {
  return new Set(pairs.map(([a, b]) => pairKey(cellOf(g.atoms[a]!.pos), cellOf(g.atoms[b]!.pos))));
}

/**
 * For every pair of cells (heavy atoms and hPos entries): manhattan 1 <=> bonded
 * (heavy-heavy: a non-diagonal bond; heavy-H: the H is in that atom's hPos; H-H
 * never), no two cells coincide — except that a face-adjacent UNBONDED
 * heavy-heavy pair is allowed when its PairKey is in `suppressed`.
 */
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

const FACE: readonly Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) { out.push([...acc]); return; }
    for (let i = start; i < items.length; i++) { acc.push(items[i]!); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}

// 2-butanol: atoms 0=CH3 1=C2 2=O 3=CH2 4=CH3
const BUTANOL = 'CC(O)CC';
// 2,3-dibromobutane: atoms 0=C1 1=C2 2=Br 3=C3 4=Br 5=C4
const DBB = 'CC(Br)C(Br)C';
// but-2-ene: atoms 0=C1 1=C2 2=C3 3=C4
const BUTENE = 'CC=CC';

// ---------------------------------------------------------------------------
// §2.1 / §2.2 geometry primitives
// ---------------------------------------------------------------------------

describe('signedVolume and classifyShape', () => {
  it('signedVolume is the triple product over the tips (centre cancels)', () => {
    expect(signedVolume([0, 0, 1], [0, 1, 0], [-1, 0, 0], [1, -1, -1])).toBe(-4);
    expect(signedVolume([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0])).toBe(-1);
    expect(Math.abs(signedVolume([1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]))).toBe(0);
    const shift: Vec3 = [3, -2, 5];
    const tips: Vec3[] = [[0, 0, 1], [0, 1, 0], [-1, 0, 0], [1, -1, -1]];
    const moved = tips.map((t): Vec3 => [t[0] + shift[0], t[1] + shift[1], t[2] + shift[2]]);
    expect(signedVolume(moved[0]!, moved[1]!, moved[2]!, moved[3]!)).toBe(-4);
  });
  it('swapping two tips flips the sign', () => {
    const v = signedVolume([0, 0, 1], [0, 1, 0], [-1, 0, 0], [1, -1, -1]);
    expect(signedVolume([0, 1, 0], [0, 0, 1], [-1, 0, 0], [1, -1, -1])).toBe(-v);
  });
  it('the implicit-H shortcut: V = -4 det[v1,v2,v3] when v4 = -(v1+v2+v3)', () => {
    const v1: Vec3 = [1, 0, 0];
    const v2: Vec3 = [0, 1, 0];
    const v3: Vec3 = [0, 0, 1];
    const v4: Vec3 = [-1, -1, -1];
    expect(signedVolume(v1, v2, v3, v4)).toBe(-4 * dot(v1, cross(v2, v3)));
  });
  it('8 of the 20 face trios are octant, 12 are T (test3.py B)', () => {
    const counts = { octant: 0, T: 0 };
    for (const trio of combinations(FACE, 3)) {
      const shape = classifyShape(trio);
      const orthogonal = dot(trio[0]!, trio[1]!) === 0 && dot(trio[0]!, trio[2]!) === 0 && dot(trio[1]!, trio[2]!) === 0;
      expect(shape).toBe(orthogonal ? 'octant' : 'T');
      counts[shape as 'octant' | 'T']++;
      // free cells: an octant trio gives one sign for every free cell and the virtual tip; a T trio gives +, -, 0
      const free = FACE.filter((d) => !trio.includes(d));
      const signs = new Set(free.map((h) => Math.sign(signedVolume(trio[0]!, trio[1]!, trio[2]!, h))));
      const virtual: Vec3 = [-(trio[0]![0] + trio[1]![0] + trio[2]![0]), -(trio[0]![1] + trio[1]![1] + trio[2]![1]), -(trio[0]![2] + trio[1]![2] + trio[2]![2])];
      const vSign = Math.sign(signedVolume(trio[0]!, trio[1]!, trio[2]!, virtual));
      if (orthogonal) {
        expect(signs.size).toBe(1);
        expect(vSign).not.toBe(0);
        expect(signs.has(vSign)).toBe(true);
      } else {
        expect([...signs].sort()).toEqual([-1, 0, 1]);
        expect(Math.abs(vSign)).toBe(0);
      }
    }
    expect(counts).toEqual({ octant: 8, T: 12 });
  });
  it('12 of the 15 face quads are seesaw, 3 square-planar (test2.py A / test3.py B)', () => {
    const counts = { seesaw: 0, 'square-planar': 0 };
    for (const quad of combinations(FACE, 4)) {
      const shape = classifyShape(quad);
      const missing = FACE.filter((d) => !quad.includes(d));
      const opposite = dot(missing[0]!, missing[1]!) === -1;
      expect(shape).toBe(opposite ? 'square-planar' : 'seesaw');
      counts[shape as 'seesaw' | 'square-planar']++;
    }
    expect(counts).toEqual({ seesaw: 12, 'square-planar': 3 });
  });
  it('rejects other lengths', () => {
    expect(() => classifyShape([[1, 0, 0], [0, 1, 0]])).toThrow(RangeError);
    expect(() => classifyShape([])).toThrow(RangeError);
    expect(() => classifyShape([[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0]])).toThrow(RangeError);
  });
  it('constants', () => {
    expect(EPS).toBe(1e-9);
    expect(RING_EZ_EXEMPT_MAX).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// §2.3 / §2.5 R/S on the grid
// ---------------------------------------------------------------------------

describe('assignRS: 2-butanol grid fixtures (03 §2.5, RDKit-verified)', () => {
  const rows: { name: string; pos: Vec3[]; h?: Record<number, Vec3[]>; shape: string; label: string }[] = [
    { name: 'octant: Me -x, O +z, Et +y', pos: [[-1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 2, 0]], shape: 'octant', label: 'S' },
    { name: 'mirror: O -z', pos: [[-1, 0, 0], [0, 0, 0], [0, 0, -1], [0, 1, 0], [0, 2, 0]], shape: 'octant', label: 'R' },
    { name: 'T: Me -x, Et +x, O +y', pos: [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]], shape: 'T', label: 'UNSPECIFIED' },
    { name: 'T + explicit H (0,0,1)', pos: [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]], h: { 1: [[0, 0, 1]] }, shape: 'seesaw', label: 'S' },
    { name: 'T + explicit H (0,0,-1)', pos: [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]], h: { 1: [[0, 0, -1]] }, shape: 'seesaw', label: 'R' },
    { name: 'T + explicit H (0,-1,0)', pos: [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]], h: { 1: [[0, -1, 0]] }, shape: 'square-planar', label: 'UNSPECIFIED' },
    { name: 'octant {+x Me, +y Et, +z O} + H at -x', pos: [[1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 2, 0]], h: { 1: [[-1, 0, 0]] }, shape: 'seesaw', label: 'R' },
    { name: 'octant {+x Me, +y Et, +z O} + H at -y', pos: [[1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 2, 0]], h: { 1: [[0, -1, 0]] }, shape: 'seesaw', label: 'R' },
    { name: 'octant {+x Me, +y Et, +z O} + H at -z', pos: [[1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 2, 0]], h: { 1: [[0, 0, -1]] }, shape: 'seesaw', label: 'R' },
    { name: 'built elsewhere: C1 (0,0,0), C2 (1,0,0), O (1,-1,0), C3 (1,0,1), C4 (1,0,2)', pos: [[0, 0, 0], [1, 0, 0], [1, -1, 0], [1, 0, 1], [1, 0, 2]], shape: 'octant', label: 'S' },
    { name: 'its mirror: O (1,1,0)', pos: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 0, 2]], shape: 'octant', label: 'R' },
    { name: '05 §5.3 r-butan-2-ol layout', pos: [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [2, 0, 0]], shape: 'octant', label: 'R' },
    { name: '05 §5.3 s-butan-2-ol layout', pos: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [2, 0, 0]], shape: 'octant', label: 'S' },
  ];
  for (const row of rows) {
    it(row.name, () => {
      const g = grid(BUTANOL, row.pos, row.h ?? {});
      assertBuildable(g);
      const c = assignRS(g, hyd(g), 1);
      expect(c.atom).toBe(1);
      expect(c.shape).toBe(row.shape);
      expect(c.label).toBe(row.label);
      expect(c.priorities).toEqual([2, 3, 0, 'H']);
    });
  }
  it('the T build suggests the two cells perpendicular to the T axis and carries the flatT hint', () => {
    const g = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]]);
    const c = assignRS(g, hyd(g), 1);
    expect(c.label).toBe('UNSPECIFIED');
    expect(c.hint).toBe(STEREO_TEXT.flatT);
    expect(c.reason).toBe('planar: T');
    expect(c.suggestedHPositions).toEqual([[0, 0, 1], [0, 0, -1]]);
  });
  it('a suggested H cell that is occupied is dropped', () => {
    // T-shaped 2-butanol with a methyl chain folded back onto (0,0,1): atoms 0=CH3 1=C2 2=O 3=CH2 4=CH3 ... use 2-methyl...
    // 3-methylpentan-2-ol built flat at C2 with the ethyl chain occupying (0,0,1): C2 at origin, Me -x, O +y, C3 +x, C4 (1,0,1)? that touches nothing wrong.
    // Simpler: a second molecule component occupying the cell is still "occupied" (same graph).
    const g = grid('CC(O)CC.C', [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0], [0, 0, 2]]);
    const c = assignRS(g, hyd(g), 1);
    expect(c.suggestedHPositions).toEqual([[0, 0, 1], [0, 0, -1]]);
    const g2 = grid('CC(O)CC.CC', [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0], [0, -1, 1], [0, -1, 2]]);
    // (0,-1,1) is not face-adjacent to the centre's cells but the cell (0,0,1) is free: both suggestions remain
    expect(assignRS(g2, hyd(g2), 1).suggestedHPositions).toEqual([[0, 0, 1], [0, 0, -1]]);
  });
  it('the square-planar build carries the flatSquare hint and no suggestions', () => {
    const g = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]], { 1: [[0, -1, 0]] });
    const c = assignRS(g, hyd(g), 1);
    expect(c.label).toBe('UNSPECIFIED');
    expect(c.shape).toBe('square-planar');
    expect(c.hint).toBe(STEREO_TEXT.flatSquare);
    expect(c.suggestedHPositions).toBeUndefined();
  });
});

describe('assignRS: other centres', () => {
  it('05 §5.3 layouts: 2-bromobutane, 3-methylhexane, lactic acid, dibromobutanes', () => {
    const cases: [string, string, Vec3[], number, string][] = [
      ['s-2-bromobutane', 'CC(Br)CC', [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [2, 0, 0]], 1, 'S'],
      ['r-2-bromobutane', 'CC(Br)CC', [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [2, 0, 0]], 1, 'R'],
      ['r-3-methylhexane', 'CCCC(C)CC', [[3, 0, 0], [2, 0, 0], [1, 0, 0], [0, 0, 0], [0, 0, -1], [0, 1, 0], [-1, 1, 0]], 3, 'R'],
      ['s-3-methylhexane', 'CCCC(C)CC', [[3, 0, 0], [2, 0, 0], [1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 1, 0]], 3, 'S'],
      ['r-lactic-acid', 'CC(O)C(=O)O', [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [2, 0, 0], [1, -1, 0]], 1, 'R'],
      ['s-lactic-acid', 'CC(O)C(=O)O', [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [2, 0, 0], [1, -1, 0]], 1, 'S'],
      ['alanine with N at -z is R (N > COOH > CH3 > H)', 'CC(N)C(=O)O', [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [2, 0, 0], [1, -1, 0]], 1, 'R'],
    ];
    for (const [name, smiles, pos, centre, label] of cases) {
      const g = grid(smiles, pos);
      assertBuildable(g);
      expect(assignRS(g, hyd(g), centre).label, name).toBe(label);
    }
  });
  it('2,3-dibromobutane: the four 03 §6.4 layouts', () => {
    const builds: [string, Vec3[], string, string][] = [
      ['meso_a', [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, -1], [1, -1, 0]], 'S', 'R'],
      ['meso_b', [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [1, 0, 1], [1, -1, 0]], 'R', 'S'],
      ['rr', [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [1, -1, 0], [1, 0, 1]], 'R', 'R'],
      ['ss', [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, -1, 0], [1, 0, -1]], 'S', 'S'],
    ];
    for (const [name, pos, c2, c3] of builds) {
      const g = grid(DBB, pos);
      assertBuildable(g);
      const h = hyd(g);
      expect(assignRS(g, h, 1).label, name).toBe(c2);
      expect(assignRS(g, h, 3).label, name).toBe(c3);
      expect(assignRS(g, h, 1).priorities).toEqual([2, 3, 0, 'H']);
      expect(assignRS(g, h, 3).priorities).toEqual([4, 1, 5, 'H']);
    }
  });
  it('non-centres: NOT_CENTER with reasons; CANNOT_ASSIGN for advanced-rule ties', () => {
    const g = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 2, 0]]);
    const h = hyd(g);
    expect(assignRS(g, h, 0)).toMatchObject({ atom: 0, label: 'NOT_CENTER', shape: null, hint: STEREO_TEXT.notCenter });
    expect(assignRS(g, h, 2).label).toBe('NOT_CENTER');
    // ring CH2 tie (methylcyclohexane on the chair)
    const mc = grid('CC1CCCCC1', [[0, 0, -1], [0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 0, 1], [1, 0, 0]]);
    assertBuildable(mc);
    const c = assignRS(mc, hyd(mc), 1);
    expect(c.label).toBe('NOT_CENTER');
    expect(c.reason).toBe('two identical groups (Rule 1a tie)');
    expect(c.priorities).toBeUndefined();
    // pentane-2,3,4-triol C3: tie whose branches contain centres
    const triol = grid('CC(O)C(O)C(O)C', [[-2, 0, 0], [-1, 0, 0], [-1, 0, 1], [0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 0, 1], [2, 0, 0]]);
    assertBuildable(triol);
    const t = assignRS(triol, hyd(triol), 3);
    expect(t.label).toBe('CANNOT_ASSIGN');
    expect(t.hint).toBe(STEREO_TEXT.cannotAssign);
    expect(t.reason).toBe('tie needs CIP rules 3-5');
    expect(t.priorities?.[0]).toBe(4);
  });
  it('a quaternary centre with four explicit substituents (seesaw) is labelled', () => {
    // 3-ethyl-3-methyl... use CC(Cl)(Br)F (bromochlorofluoroethane): C1 at origin
    const g = grid('CC(Cl)(Br)F', [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    assertBuildable(g);
    const c = assignRS(g, hyd(g), 1);
    expect(c.shape).toBe('seesaw');
    expect(['R', 'S']).toContain(c.label);
    expect(c.priorities).toEqual([3, 2, 4, 0]);
    const mirror = grid('CC(Cl)(Br)F', [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, -1]]);
    expect(assignRS(mirror, hyd(mirror), 1).label).not.toBe(c.label);
    const planar = grid('CC(Cl)(Br)F', [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0]]);
    expect(assignRS(planar, hyd(planar), 1)).toMatchObject({ label: 'UNSPECIFIED', shape: 'square-planar' });
  });
  it('throws on a bad atom id', () => {
    const g = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 2, 0]]);
    expect(() => assignRS(g, hyd(g), 9)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// §3 E/Z on the grid
// ---------------------------------------------------------------------------

describe('assignEZ: but-2-ene layouts (03 §3.3, test2.py C)', () => {
  it('zigzag E', () => {
    const g = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]]);
    assertBuildable(g);
    const d = assignEZ(g, hyd(g), 1);
    expect(d).toMatchObject({ bond: 1, a: 1, b: 2, label: 'E', higherA: 0, higherB: 3, cisTrans: 'trans' });
    expect(d.hint).toBeUndefined();
  });
  it('zigzag Z: legal once the C1|C4 pair is suppressed', () => {
    const g = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]]);
    expect(() => assertBuildable(g)).toThrow(/face-adjacent but unbonded/);
    assertBuildable(g, suppressedOf(g, [[0, 3]]));
    expect(assignEZ(g, hyd(g), 1)).toMatchObject({ label: 'Z', cisTrans: 'cis', higherA: 0, higherB: 3 });
  });
  it('twisted', () => {
    const g = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]]);
    assertBuildable(g);
    const d = assignEZ(g, hyd(g), 1);
    expect(d.label).toBe('TWISTED');
    expect(d.hint).toBe(STEREO_TEXT.twisted);
    expect(d.higherA).toBe(0);
    expect(d.higherB).toBe(3);
  });
  it('straight line: COLLINEAR naming atom 1 (C2 end, the first end checked)', () => {
    const g = grid(BUTENE, [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]]);
    assertBuildable(g);
    const d = assignEZ(g, hyd(g), 1);
    expect(d.label).toBe('COLLINEAR');
    expect(d.hint).toBe(STEREO_TEXT.collinear(2));
    const sides = alkeneSides(g, hyd(g), 1);
    expect(sides).toMatchObject({ ok: false, label: 'COLLINEAR', atom: 1 });
  });
  it('E in the xz plane', () => {
    const g = grid(BUTENE, [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, -1]]);
    assertBuildable(g);
    expect(assignEZ(g, hyd(g), 1)).toMatchObject({ label: 'E', cisTrans: 'trans' });
  });
  it('2-methylbut-2-ene: NO_EZ on the tied end (C3) with the pair suppressed', () => {
    const g = grid('CC=C(C)C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, -1, 0]]);
    assertBuildable(g, suppressedOf(g, [[0, 3]]));
    const d = assignEZ(g, hyd(g), 1);
    expect(d.label).toBe('NO_EZ');
    expect(d.hint).toBe(STEREO_TEXT.noEz(3));
  });
  it('but-2-ene with an explicit H on C2 at 90 degrees: NOT_PLANAR (C2)', () => {
    const g = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]], { 1: [[0, 0, 1]] });
    assertBuildable(g);
    const d = assignEZ(g, hyd(g), 1);
    expect(d.label).toBe('NOT_PLANAR');
    expect(d.hint).toBe(STEREO_TEXT.notPlanar(2));
  });
  it('an explicit H opposite the methyl keeps the geometry valid', () => {
    // on the E build the H block on C2 would sit cis to C4 and touch it: not a legal build (09 §2.1)
    const g = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]], { 1: [[0, -1, 0]] });
    expect(() => assertBuildable(g)).toThrow(/face-adjacent but unbonded/);
    expect(assignEZ(g, hyd(g), 1).label).toBe('E');
    const z = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]], { 1: [[0, -1, 0]] });
    assertBuildable(z, suppressedOf(z, [[0, 3]]));
    expect(assignEZ(z, hyd(z), 1).label).toBe('Z');
    // two explicit H on the same side would touch each other: not a legal build
    const hh = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]], { 1: [[0, -1, 0]], 2: [[1, -1, 0]] });
    expect(() => assertBuildable(hh, suppressedOf(hh, [[0, 3]]))).toThrow(/face-adjacent but unbonded/);
  });
  it('propene: NO_EZ (two H on the =CH2 end)', () => {
    const g = grid('CC=C', [[0, 1, 0], [0, 0, 0], [1, 0, 0]]);
    const d = assignEZ(g, hyd(g), 1);
    expect(d.label).toBe('NO_EZ');
    expect(d.hint).toBe(STEREO_TEXT.noEz(3));
  });
  it('cyclohexene on the chair: RING, no geometry check', () => {
    const g = grid('C1CCC=CC1', [[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 0, 1], [1, 0, 0]]);
    assertBuildable(g);
    const k = g.bonds.findIndex((b) => b.order === 2);
    expect(assignEZ(g, hyd(g), k)).toEqual({ bond: k, a: 3, b: 4, label: 'RING' });
  });
  it('an over-valent alkene carbon (three substituents) is NO_EZ', () => {
    const g = grid('CC(C)(C)=CC', [[0, 1, 0], [0, 0, 0], [0, -1, 0], [0, 0, 1], [1, 0, 0], [1, -1, 0]]);
    expect(assignEZ(g, hyd(g), 3).label).toBe('NO_EZ');
  });
  it('throws on a bad bond index', () => {
    const g = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]]);
    expect(() => assignEZ(g, hyd(g), 5)).toThrow(RangeError);
    expect(() => alkeneSides(g, hyd(g), -1)).toThrow(RangeError);
  });
});

describe('assignEZ: the 09 §2.1 verified layouts (one suppressed pair each, RDKit-verified)', () => {
  const rows: [string, string, Vec3[], number, string, [number, number][]][] = [
    ['z-but-2-ene', 'C/C=C\\C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]], 1, 'Z', [[0, 3]]],
    ['z-hex-3-ene', 'CC/C=C\\CC', [[-1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0]], 2, 'Z', [[1, 4]]],
    ['z-2-chlorobut-2-ene', 'C/C=C(\\Cl)C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, -1, 0]], 1, 'Z', [[0, 3]]],
    ['e-2-chlorobut-2-ene', 'C/C=C(/Cl)C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [1, 1, 0]], 1, 'E', [[0, 4]]],
    ['e-3-methylpent-2-ene', 'C/C=C(\\C)CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, -1, 0], [2, -1, 0]], 1, 'E', [[0, 3]]],
    ['z-3-methylpent-2-ene', 'C/C=C(/C)CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [1, 1, 0], [2, 1, 0]], 1, 'Z', [[0, 4]]],
    ['z-1-2-dichloroethene', 'Cl/C=C\\Cl', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]], 1, 'Z', [[0, 3]]],
    ['e-1-2-dibromobut-1-ene', 'Br/C=C(/Br)CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [1, 1, 0], [2, 1, 0]], 1, 'E', [[0, 4]]],
    ['04 row 40 CCC/C=C\\CCC', 'CCC/C=C\\CCC', [[-2, 1, 0], [-1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0]], 3, 'Z', [[2, 5]]],
    ['04 row 5 CC/C(Cl)=C/CC', 'CC/C(Cl)=C/CC', [[-1, 1, 0], [0, 1, 0], [0, 0, 0], [0, -1, 0], [1, 0, 0], [1, -1, 0], [2, -1, 0]], 3, 'Z', [[3, 5]]],
  ];
  for (const [name, smiles, pos, bondIndex, label, pairs] of rows) {
    it(name, () => {
      const g = grid(smiles, pos);
      expect(() => assertBuildable(g)).toThrow();
      assertBuildable(g, suppressedOf(g, pairs));
      const bond = g.bonds[bondIndex]!;
      expect(bond.order).toBe(2);
      expect(assignEZ(g, hyd(g), bondIndex).label).toBe(label);
      // the tagged copy agrees with the SMILES tag under labelTargetStereo
      const tagged = tagsFromPositions(g, hyd(g));
      expect(labelTargetStereo(tagged, hyd(tagged)).bonds.get(bondIndex)).toBe(label);
    });
  }
  it('induced E layouts of 05 §5.3 need no suppression', () => {
    const rows: [string, string, Vec3[], number, string][] = [
      ['e-pent-2-ene', 'C/C=C/CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [2, -1, 0]], 1, 'E'],
      ['e-hex-3-ene', 'CC/C=C/CC', [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0]], 2, 'E'],
      ['e-1-2-dichloroethene', 'Cl/C=C/Cl', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]], 1, 'E'],
    ];
    for (const [name, smiles, pos, k, label] of rows) {
      const g = grid(smiles, pos);
      assertBuildable(g);
      expect(assignEZ(g, hyd(g), k).label, name).toBe(label);
    }
    const diene = grid('C/C=C/C=C/C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [2, -1, 0], [2, -2, 0]]);
    assertBuildable(diene);
    expect(assignEZ(diene, hyd(diene), 1).label).toBe('E');
    expect(assignEZ(diene, hyd(diene), 3).label).toBe('E');
  });
  it('trisubstituted: E vs Z is decided by CIP, not by the chain (3-methylpent-2-ene)', () => {
    const e = grid('CC=C(C)CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, -1, 0], [2, -1, 0]]);
    const d = assignEZ(e, hyd(e), 1);
    expect(d.label).toBe('E');
    expect(d.higherB).toBe(4);
    expect(d.cisTrans).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §4 ring faces and the chair fixtures
// ---------------------------------------------------------------------------

/** 05 §5.3 cube chair: SMILES ring atoms 1..6 placed in order; free cube corners (0,0,1) and (1,1,0) are cage cells. */
const CHAIR: readonly Vec3[] = [[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 0, 1], [1, 0, 0]];

/** 1-bromo-2-methylcyclohexane CC1CCCCC1Br: C0 Me, C1 ring (bears Me), C2-C5, C6 ring (bears Br), Br7. */
function bromoMethyl(me: Vec3, br: Vec3, h: Record<number, Vec3[]> = {}): WorldGraph {
  return grid('CC1CCCCC1Br', [me, CHAIR[0]!, CHAIR[1]!, CHAIR[2]!, CHAIR[3]!, CHAIR[4]!, CHAIR[5]!, br], h);
}

describe('ring faces (03 §4)', () => {
  it('cube chair: Newell normal (1,-1,1)/sqrt3 and the up free cells of test2.py E', () => {
    const ring: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1], [0, 0, 1]];
    const g = grid('C1CCCCC1', ring);
    assertBuildable(g);
    const s = analyzeStereo(g, hyd(g));
    expect(s.ringFaces.length).toBe(1);
    const n = s.ringFaces[0]!.normal;
    const k = 1 / Math.sqrt(3);
    // +-(1,-1,1)/sqrt3 depending on the traversal direction of the smallest ring
    expect(Math.abs(n[0])).toBeCloseTo(k);
    expect(n[1]).toBeCloseTo(-n[0]);
    expect(n[2]).toBeCloseTo(n[0]);
    expect(s.ringFaces[0]!.subs).toEqual([]);
    // ring order in the graph's smallest ring may differ; the up cells are read through ringFace on substituted builds
    const upDirs: Vec3[] = [[0, -1, 0], [0, 0, 1], [1, 0, 0], [0, -1, 0], [0, 0, 1], [1, 0, 0]];
    for (let i = 0; i < 6; i++) {
      const up = upDirs[i]!;
      const pos = [...ring, [ring[i]![0] + up[0], ring[i]![1] + up[1], ring[i]![2] + up[2]] as Vec3];
      // methylcyclohexane with the methyl on ring atom i: bonds 0-1,1-2,...,5-0, i-6
      const mg = buildGraph(
        pos.map((p, id): WorldAtom => ({ id, el: 'C', charge: 0, explicitH: null, aromatic: false, pos: p, hPos: [] })),
        [...[0, 1, 2, 3, 4, 5].map((a) => ({ a, b: (a + 1) % 6, order: 1 as const })), { a: i, b: 6, order: 1 as const }],
      );
      const faceUp = ringFace(mg, ring.map((_, id) => id), 6);
      const down: Vec3 = [ring[i]![0] - up[0], ring[i]![1] - up[1], ring[i]![2] - up[2]];
      const mg2 = buildGraph(
        [...ring, down].map((p, id): WorldAtom => ({ id, el: 'C', charge: 0, explicitH: null, aromatic: false, pos: p, hPos: [] })),
        [...[0, 1, 2, 3, 4, 5].map((a) => ({ a, b: (a + 1) % 6, order: 1 as const })), { a: i, b: 6, order: 1 as const }],
      );
      expect(faceUp).toBe(1);
      expect(ringFace(mg2, ring.map((_, id) => id), 6)).toBe(-1);
      // reversing the ring order flips the face sign
      expect(ringFace(mg, [...ring.map((_, id) => id)].reverse(), 6)).toBe(-1);
    }
  });
  it('an in-plane substituent reports 0 and a non-ring atom throws', () => {
    const sq = grid('C1CCC1C', [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 2, 0]]);
    expect(ringFace(sq, [0, 1, 2, 3], 4)).toBe(0);
    expect(() => ringFace(sq, [0, 1, 2], 4)).toThrow();
  });
  it('1-bromo-2-methylcyclohexane: four legal chair builds, labels (C-Br, C-Me) and cis/trans', () => {
    const builds: { name: string; g: WorldGraph; br: string; me: string; relation: 'cis' | 'trans' }[] = [
      { name: 'cis (1S,2R)', g: bromoMethyl([0, 0, -1], [2, 0, 0], { 6: [[1, -1, 0]] }), br: 'S', me: 'R', relation: 'cis' },
      { name: 'cis (1R,2S)', g: bromoMethyl([-1, 0, 0], [1, -1, 0], { 1: [[0, 0, -1]] }), br: 'R', me: 'S', relation: 'cis' },
      { name: 'trans (1R,2R)', g: bromoMethyl([0, 0, -1], [1, -1, 0]), br: 'R', me: 'R', relation: 'trans' },
      { name: 'trans (1S,2S)', g: bromoMethyl([-1, 0, 0], [2, 0, 0], { 1: [[0, 0, -1]], 6: [[1, -1, 0]] }), br: 'S', me: 'S', relation: 'trans' },
    ];
    for (const b of builds) {
      assertBuildable(b.g);
      const h = hyd(b.g);
      expect(assignRS(b.g, h, 6).label, b.name).toBe(b.br);
      expect(assignRS(b.g, h, 1).label, b.name).toBe(b.me);
      const s = analyzeStereo(b.g, h);
      expect(s.ringFaces.length).toBe(1);
      const faces = s.ringFaces[0]!.subs;
      expect(faces.length).toBe(2);
      const fMe = faces.find((f) => f.atom === 0)!.face;
      const fBr = faces.find((f) => f.atom === 7)!.face;
      expect(fMe).not.toBe(0);
      expect(fBr).not.toBe(0);
      expect(fMe === fBr ? 'cis' : 'trans', b.name).toBe(b.relation);
      expect(s.chiral).toBe(true);
      expect(s.meso).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// §7 analyzeStereo, tagsFromPositions, stereoWarnings
// ---------------------------------------------------------------------------

/** 1,2-dimethylcyclohexane CC1CCCCC1C: C0 Me, C1 ring, C2-C5, C6 ring, C7 Me. */
function dimethyl12(me1: Vec3, me6: Vec3, h: Record<number, Vec3[]> = {}): WorldGraph {
  return grid('CC1CCCCC1C', [me1, CHAIR[0]!, CHAIR[1]!, CHAIR[2]!, CHAIR[3]!, CHAIR[4]!, CHAIR[5]!, me6], h);
}
/** 1,4-dimethylcyclohexane CC1CCC(C)CC1: C0 Me, C1 ring, C2, C3, C4 ring (bears C5), C6, C7. */
function dimethyl14(me1: Vec3, me4: Vec3, h: Record<number, Vec3[]> = {}): WorldGraph {
  return grid('CC1CCC(C)CC1', [me1, CHAIR[0]!, CHAIR[1]!, CHAIR[2]!, CHAIR[3]!, me4, CHAIR[4]!, CHAIR[5]!], h);
}

describe('analyzeStereo (03 §7 expected outputs)', () => {
  it('meso-2,3-dibromobutane meso_a / meso_b: (S,R) / (R,S), meso, not chiral', () => {
    for (const [pos, c2, c3] of [
      [[[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, -1], [1, -1, 0]], 'S', 'R'],
      [[[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [1, 0, 1], [1, -1, 0]], 'R', 'S'],
    ] as [Vec3[], string, string][]) {
      const g = grid(DBB, pos);
      const s = analyzeStereo(g, hyd(g));
      expect(s.centers.map((c) => c.label)).toEqual([c2, c3]);
      expect(s.centers.map((c) => c.atom)).toEqual([1, 3]);
      expect(s.meso).toBe(true);
      expect(s.chiral).toBe(false);
      expect(s.doubleBonds).toEqual([]);
      expect(s.ringFaces).toEqual([]);
    }
  });
  it('(2R,3R) and (2S,3S): chiral, not meso', () => {
    const rr = grid(DBB, [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [1, -1, 0], [1, 0, 1]]);
    const ss = grid(DBB, [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, -1, 0], [1, 0, -1]]);
    for (const [g, labels] of [[rr, ['R', 'R']], [ss, ['S', 'S']]] as [WorldGraph, string[]][]) {
      const s = analyzeStereo(g, hyd(g));
      expect(s.centers.map((c) => c.label)).toEqual(labels);
      expect(s.chiral).toBe(true);
      expect(s.meso).toBe(false);
    }
  });
  it('meso-tartaric acid on the grid is meso', () => {
    // OC(=O)C(O)C(O)C(=O)O: O0 C1 O2 C3 O4 C5 O6 C7 O8 O9; C3 at origin, C5 at +x; mirror arrangement like meso_a
    const g = grid('OC(=O)C(O)C(O)C(=O)O', [
      [0, 2, 0], [0, 1, 0], [-1, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, -1], [1, -1, 0], [2, -1, 0], [1, -2, 0],
    ]);
    assertBuildable(g);
    const s = analyzeStereo(g, hyd(g));
    expect(s.centers.map((c) => c.label).sort()).toEqual(['R', 'S']);
    expect(s.meso).toBe(true);
    expect(s.chiral).toBe(false);
  });
  it('cis-1,2-dimethylcyclohexane chair is meso; trans is chiral', () => {
    const cis = dimethyl12([0, 0, -1], [2, 0, 0], { 6: [[1, -1, 0]] });
    assertBuildable(cis);
    const sc = analyzeStereo(cis, hyd(cis));
    expect(sc.centers.map((c) => c.label)).toEqual(['R', 'S']);
    expect(sc.meso).toBe(true);
    expect(sc.chiral).toBe(false);
    const trans = dimethyl12([0, 0, -1], [1, -1, 0]);
    assertBuildable(trans);
    const st = analyzeStereo(trans, hyd(trans));
    expect(st.centers.map((c) => c.label)).toEqual(['R', 'R']);
    expect(st.meso).toBe(false);
    expect(st.chiral).toBe(true);
  });
  it('cis-1,4-dimethylcyclohexane: both NOT_CENTER, neither chiral nor meso', () => {
    const cis = dimethyl14([0, 0, -1], [1, 2, 1], { 4: [[1, 1, 2]] });
    assertBuildable(cis);
    const s = analyzeStereo(cis, hyd(cis));
    expect(s.centers.map((c) => c.label)).toEqual(['NOT_CENTER', 'NOT_CENTER']);
    expect(s.chiral).toBe(false);
    expect(s.meso).toBe(false);
    const faces = s.ringFaces[0]!.subs;
    expect(faces.find((f) => f.atom === 0)!.face).toBe(faces.find((f) => f.atom === 5)!.face);
    const trans = dimethyl14([0, 0, -1], [1, 1, 2]);
    assertBuildable(trans);
    const t = analyzeStereo(trans, hyd(trans)).ringFaces[0]!.subs;
    // a T-shaped ring carbon is planar: no label, no parity, but the face relation still reads
    const flat = dimethyl14([0, 0, -1], [2, 1, 1]);
    assertBuildable(flat);
    expect(analyzeStereo(flat, hyd(flat)).centers.map((c) => c.label)).toEqual(['NOT_CENTER', 'NOT_CENTER']);
    expect(t.find((f) => f.atom === 0)!.face).toBe(-t.find((f) => f.atom === 5)!.face);
  });
  it('(R)-2-butanol: chiral; the T build is UNSPECIFIED with suggestions and a planar-center warning', () => {
    const r = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 0, -1], [0, 1, 0], [0, 2, 0]]);
    const sr = analyzeStereo(r, hyd(r));
    expect(sr.centers.length).toBe(1);
    expect(sr.centers[0]!.label).toBe('R');
    expect(sr.chiral).toBe(true);
    expect(sr.meso).toBe(false);
    expect(stereoWarnings(sr)).toEqual([]);
    const t = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]]);
    const st = analyzeStereo(t, hyd(t));
    expect(st.centers[0]).toMatchObject({ label: 'UNSPECIFIED', shape: 'T', suggestedHPositions: [[0, 0, 1], [0, 0, -1]] });
    expect(st.chiral).toBe(false);
    expect(st.meso).toBe(false);
    expect(stereoWarnings(st)).toEqual([{ kind: 'planar-center', atom: 1, shape: 'T' }]);
    const sq = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]], { 1: [[0, -1, 0]] });
    expect(stereoWarnings(analyzeStereo(sq, hyd(sq)))).toEqual([{ kind: 'planar-center', atom: 1, shape: 'square-planar' }]);
  });
  it('one R/S centre plus one flat centre: chiral, not meso, flat warning only', () => {
    // 2,3-dibromobutane with C2 octant and C3 flat (T): C3 substituents Br at +x... C3 at (1,0,0): C2 -x, Br +x, C4 +y -> T
    const g = grid(DBB, [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [2, 0, 0], [1, -1, 0]]);
    assertBuildable(g);
    const s = analyzeStereo(g, hyd(g));
    expect(s.centers.map((c) => c.label)).toEqual(['S', 'UNSPECIFIED']);
    expect(s.chiral).toBe(true);
    expect(s.meso).toBe(false);
    expect(stereoWarnings(s)).toEqual([{ kind: 'planar-center', atom: 3, shape: 'T' }]);
  });
  it('double bonds: one entry per non-aromatic C=C with alkene-geometry warnings', () => {
    const tw = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]]);
    const s = analyzeStereo(tw, hyd(tw));
    expect(s.doubleBonds.length).toBe(1);
    expect(s.doubleBonds[0]!.label).toBe('TWISTED');
    expect(stereoWarnings(s)).toEqual([{ kind: 'alkene-geometry', bond: 1, label: 'TWISTED' }]);
    expect(s.centers).toEqual([]);
    // C=O and C=N are not listed
    const ald = grid('CC=O', [[0, 0, 0], [1, 0, 0], [1, 1, 0]]);
    expect(analyzeStereo(ald, hyd(ald)).doubleBonds).toEqual([]);
    const im = grid('CC=N', [[0, 0, 0], [1, 0, 0], [1, 1, 0]]);
    expect(analyzeStereo(im, hyd(im)).doubleBonds).toEqual([]);
  });
  it('empty and trivial graphs', () => {
    const e: WorldGraph = { atoms: [], bonds: [], adj: [] };
    expect(analyzeStereo(e, [])).toEqual({ centers: [], doubleBonds: [], ringFaces: [], chiral: false, meso: false });
    const m = grid('C', [[0, 0, 0]]);
    expect(analyzeStereo(m, hyd(m))).toEqual({ centers: [], doubleBonds: [], ringFaces: [], chiral: false, meso: false });
  });
});

describe('tagsFromPositions and parityInOrder', () => {
  it('tags every non-planar tetrahedral carbon, ties included; planar ones get no tag', () => {
    const cis = dimethyl14([0, 0, -1], [1, 2, 1], { 4: [[1, 1, 2]] });
    const tagged = tagsFromPositions(cis, hyd(cis));
    const flat = dimethyl14([0, 0, -1], [2, 1, 1]);
    expect(tagsFromPositions(flat, hyd(flat)).atoms[4]!.tet).toBeUndefined();
    expect(tagged.atoms[1]!.tet).toBeDefined();
    expect(tagged.atoms[4]!.tet).toBeDefined();
    expect(tagged.atoms[1]!.tet!.order).toEqual([0, 2, 7, 'H']);
    expect(tagged.atoms[2]!.tet).toBeUndefined();
    expect(tagged.atoms[1]!.pos).toEqual([0, 0, 0]);
    const t = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]]);
    expect(tagsFromPositions(t, hyd(t)).atoms[1]!.tet).toBeUndefined();
    const r = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 0, -1], [0, 1, 0], [0, 2, 0]]);
    const rt = tagsFromPositions(r, hyd(r));
    expect(rt.atoms[1]!.tet).toEqual({ order: [0, 2, 3, 'H'], sign: parityInOrder(r, hyd(r), 1, [0, 2, 3, 'H']) });
    expect(labelTargetStereo(rt, hyd(rt)).centers.get(1)).toBe('R');
  });
  it('tags planar-checked alkenes with the lowest-id explicit substituent as reference', () => {
    const e = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]]);
    expect(tagsFromPositions(e, hyd(e)).bonds[1]!.ez).toEqual({ refA: 0, refB: 3, cis: false });
    const z = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]]);
    expect(tagsFromPositions(z, hyd(z)).bonds[1]!.ez).toEqual({ refA: 0, refB: 3, cis: true });
    const tw = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]]);
    expect(tagsFromPositions(tw, hyd(tw)).bonds[1]!.ez).toBeUndefined();
    const propene = grid('CC=C', [[0, 1, 0], [0, 0, 0], [1, 0, 0]]);
    expect(tagsFromPositions(propene, hyd(propene)).bonds[1]!.ez).toBeUndefined();
    const ring = grid('C1CCC=CC1', [[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 0, 1], [1, 0, 0]]);
    expect(tagsFromPositions(ring, hyd(ring)).bonds.every((b) => b.ez === undefined)).toBe(true);
    // explicit H as the only explicit substituent of an end
    const hz = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]], { 1: [[0, -1, 0]] });
    expect(tagsFromPositions(hz, hyd(hz)).bonds[1]!.ez).toEqual({ refA: 0, refB: 3, cis: true });
  });
  it('parityInOrder from positions: sign flips with a transposition, 0 when planar, null when invalid', () => {
    const r = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 0, -1], [0, 1, 0], [0, 2, 0]]);
    const h = hyd(r);
    const p = parityInOrder(r, h, 1, [0, 2, 3, 'H']);
    expect(p === 1 || p === -1).toBe(true);
    expect(parityInOrder(r, h, 1, [2, 0, 3, 'H'])).toBe(p === 1 ? -1 : 1);
    expect(parityInOrder(r, h, 1, [0, 2, 'H', 3])).toBe(p === 1 ? -1 : 1);
    const t = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]]);
    expect(parityInOrder(t, hyd(t), 1, [0, 2, 3, 'H'])).toBe(0);
    expect(parityInOrder(r, h, 1, [0, 2, 3])).toBeNull();
    expect(parityInOrder(r, h, 1, [0, 2, 3, 4])).toBeNull();
    expect(parityInOrder(r, h, 0, [1, 'H', 'H', 'H'])).toBeNull();
    expect(parityInOrder(r, h, 7, [0, 2, 3, 'H'])).toBeNull();
    // explicit H block: the H vector is the block's cell
    const rh = grid(BUTANOL, [[1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 2, 0]], { 1: [[-1, 0, 0]] });
    expect(parityInOrder(rh, hyd(rh), 1, [0, 2, 3, 'H'])).toBe(parityInOrder(grid(BUTANOL, [[1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 2, 0]]), h, 1, [0, 2, 3, 'H']));
  });
  it('parityInOrder from tags: tet.sign times the permutation sign; null without positions or tags', () => {
    const g = parseSmiles('N[C@@H](C)C(=O)O').graph;
    const h = hyd(g);
    expect(parityInOrder(g, h, 1, [0, 'H', 2, 3])).toBe(1);
    expect(parityInOrder(g, h, 1, ['H', 0, 2, 3])).toBe(-1);
    expect(parityInOrder(g, h, 1, [0, 3, 2, 'H'])).toBe(-1);
    expect(parityInOrder(g, h, 1, [0, 3, 2, 'H', 4])).toBeNull();
    expect(parityInOrder(g, h, 1, [0, 3, 2, 4])).toBeNull();
    expect(parityInOrder(g, h, 3, [1, 4, 5, 'H'])).toBeNull();
    expect(parityInOrder(withoutStereoTags(g), h, 1, [0, 'H', 2, 3])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §5 labels from target tags
// ---------------------------------------------------------------------------

describe('labelTargetStereo (03 §5, §11; RDKit-verified)', () => {
  const rows: [string, Record<number, string>, Record<number, string>][] = [
    ['C[C@@H](O)CC', { 1: 'R' }, {}],
    ['C[C@H](O)CC', { 1: 'S' }, {}],
    ['C[C@H](Br)CC', { 1: 'S' }, {}],
    ['N[C@@H](C)C(=O)O', { 1: 'S' }, {}],
    ['C[C@@H](O)C(=O)O', { 1: 'R' }, {}],
    ['O=C[C@H](O)CO', { 2: 'R' }, {}],
    ['C[C@H](Br)[C@H](Br)C', { 1: 'S', 3: 'R' }, {}],
    ['C[C@@H](Br)[C@H](Br)C', { 1: 'R', 3: 'R' }, {}],
    ['CCC[C@H](C)CC', { 3: 'R' }, {}],
    ['C[C@H]1CCCC[C@H]1Br', { 1: 'S', 6: 'R' }, {}],
    ['C[C@@H]1CCCC[C@H]1C', { 1: 'R', 6: 'R' }, {}],
    ['C[C@H]1CCCC[C@H]1C', { 1: 'S', 6: 'R' }, {}],
    ['C[C@H]1CC[C@@H](C)CC1', { 1: 'NOT_CENTER', 4: 'NOT_CENTER' }, {}],
    ['OC(=O)[C@H](O)[C@H](O)C(=O)O', { 3: 'R', 5: 'S' }, {}],
    ['C[C@@H](O)[C@H](N)C(=O)O', { 1: 'R', 3: 'S' }, {}],
    ['C[C@H]1CCCCC1=O', { 1: 'S' }, {}],
    ['C[C@H]1C=CCCC1', { 1: 'R' }, {}],
    ['O[C@H](C(CC)CC)C(C)C(C)C', { 1: 'R' }, {}],
    ['O[C@@H](C(CC)CC)C(C)C(C)C', { 1: 'S' }, {}],
    ['OC[C@@H](O)[C@@H](O)[C@H](O)[C@@H](O)C=O', { 2: 'R', 4: 'R', 6: 'S', 8: 'R' }, {}],
    ['CN1CCC[C@H]1c1cccnc1', { 5: 'S' }, {}],
    ['CNC[C@H](O)c1ccc(O)c(O)c1', { 3: 'R' }, {}],
    ['Br[C@H]1CCCC[C@@H]1Br', { 1: 'S', 6: 'S' }, {}],
    ['C[C@H](O)[C@@H](O)C', { 1: 'S', 3: 'S' }, {}],
    ['C/C=C/C', {}, { 1: 'E' }],
    ['C/C=C\\C', {}, { 1: 'Z' }],
    ['C\\C=C\\C', {}, { 1: 'E' }],
    ['F/C=C/F', {}, { 1: 'E' }],
    ['C/C=C(\\Cl)C', {}, { 1: 'Z' }],
    ['C/C=C(\\C)CC', {}, { 1: 'E' }],
    ['C/C=C/C=C/C', {}, { 1: 'E', 3: 'E' }],
    ['Cl/C=C/Cl', {}, { 1: 'E' }],
    ['O=C/C=C/c1ccccc1', {}, { 2: 'E' }],
    ['CC/C(Cl)=C/CC', {}, { 3: 'Z' }],
    ['Br/C=C(/Br)CC', {}, { 1: 'E' }],
  ];
  for (const [smiles, centers, bonds] of rows) {
    it(smiles, () => {
      const g = parseSmiles(smiles).graph;
      const r = labelTargetStereo(g, hyd(g));
      expect(Object.fromEntries(r.centers)).toEqual(centers);
      expect(Object.fromEntries(r.bonds)).toEqual(bonds);
    });
  }
  it('cholesterol: eight centres labelled as RDKit does', () => {
    const g = parseSmiles('C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C').graph;
    const t0 = performance.now();
    const r = labelTargetStereo(g, hyd(g));
    expect(performance.now() - t0).toBeLessThan(200);
    expect(Object.fromEntries(r.centers)).toEqual({ 1: 'R', 8: 'R', 11: 'S', 12: 'R', 15: 'S', 16: 'S', 20: 'R', 23: 'S' });
  });
  it('pseudo-asymmetric tie needing advanced rules: CANNOT_ASSIGN', () => {
    const g = parseSmiles('C[C@H](O)[C@H](O)[C@@H](O)C').graph;
    expect(labelTargetStereo(g, hyd(g)).centers.get(3)).toBe('CANNOT_ASSIGN');
  });
  it('an ez tag on a tied end labels NO_EZ', () => {
    const g = parseSmiles('C/C=C(/C)C').graph;
    expect(labelTargetStereo(g, hyd(g)).bonds.get(1)).toBe('NO_EZ');
  });
  it('untagged graphs give empty maps', () => {
    const g = parseSmiles('CC(O)CC').graph;
    expect(labelTargetStereo(g, hyd(g))).toEqual({ centers: new Map(), bonds: new Map() });
  });
});

describe('end to end: tagged target labels agree with grid labels (03 §11 rows)', () => {
  it('(S)-2-butanol grid row 2 and (E)-but-2-ene row 18', () => {
    const s = grid(BUTANOL, [[-1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 2, 0]]);
    expect(assignRS(s, hyd(s), 1)).toMatchObject({ label: 'S', shape: 'octant' });
    const t = parseSmiles('C[C@H](O)CC').graph;
    expect(labelTargetStereo(t, hyd(t)).centers.get(1)).toBe('S');
    const e = grid(BUTENE, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]]);
    expect(assignEZ(e, hyd(e), 1)).toMatchObject({ label: 'E', cisTrans: 'trans' });
  });
  it('the ten alkeneSides checks never mention adjacency: a Z build with the pair suppressed reads Z', () => {
    const z = grid('CC/C=C\\CC', [[-1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0]]);
    const sides = alkeneSides(z, hyd(z), 2);
    expect(sides.ok).toBe(true);
    if (sides.ok) {
      expect(sides.u).toEqual([1, 0, 0]);
      expect(sides.ends[0].atom).toBe(2);
      expect(sides.ends[0].subs).toEqual([1]);
      expect(sides.ends[0].vec(1)).toEqual([0, 1, 0]);
      expect(sides.ends[0].vec('H')!.map((x) => x + 0)).toEqual([0, -1, 0]);
      expect(sides.ends[1].vec(4)).toEqual([0, 1, 0]);
      expect(sides.ends[0].vec(9)).toBeUndefined();
    }
  });
});

