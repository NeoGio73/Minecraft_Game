/**
 * Engineering review finding 1: `analyze()` on ring-dense lattice builds (every square a 4-ring) must stay bounded.
 * Before the CIP node budget a 5x5 carbon sheet took 16-19 s and a 3x2x3 block ran for minutes; with
 * CIP_NODE_BUDGET each centre gives up quickly and reports CANNOT_ASSIGN ("digraph size cap").
 */
import { describe, it, expect } from 'vitest';
import { analyze } from '@/chem/analyze';
import { buildGraph } from '@/chem/graph';
import { CIP_NODE_BUDGET, cipRank } from '@/chem/cip';
import { implicitHydrogens } from '@/chem/hydrogens';
import { parseSmiles } from '@/chem/smiles';
import type { Vec3, WorldAtom, WorldGraph } from '@/chem/types';
import { manhattan } from '@/util/vec3';

/** World graph of carbon cells bonded wherever two cells touch (what extraction yields for a free-play build). */
function carbonCells(cells: readonly Vec3[]): WorldGraph {
  const atoms: WorldAtom[] = cells.map((pos, id) => ({ id, el: 'C', charge: 0, explicitH: null, aromatic: false, pos, hPos: [] }));
  const bonds: { a: number; b: number; order: 1 }[] = [];
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) if (manhattan(cells[i]!, cells[j]!) === 1) bonds.push({ a: i, b: j, order: 1 });
  }
  return buildGraph(atoms, bonds);
}

function sheet(w: number, d: number): WorldGraph {
  const cells: Vec3[] = [];
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) cells.push([10 + x, 10, 10 + z]);
  return carbonCells(cells);
}

function block(w: number, h: number, d: number): WorldGraph {
  const cells: Vec3[] = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) cells.push([10 + x, 10 + y, 10 + z]);
  return carbonCells(cells);
}

const BUDGET_MS = 2000;

function timed(g: WorldGraph): { ms: number; analysis: ReturnType<typeof analyze> } {
  const t0 = performance.now();
  const analysis = analyze(g);
  return { ms: performance.now() - t0, analysis };
}

describe('analyze on ring-dense lattice builds (finding 1)', () => {
  it('a 5x5 carbon sheet (25 atoms) completes in under 2 s and reports CANNOT_ASSIGN centres', () => {
    const { ms, analysis: a } = timed(sheet(5, 5));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(a.formula).toBe('C25H20');
    expect(a.ringCount).toBe(16);
    const st = a.stereo!;
    const labels = st.centers.map((c) => c.label);
    expect(labels.length).toBe(21);   // every carbon but the four corners is a four-group candidate
    expect(labels).toContain('CANNOT_ASSIGN');
    for (const c of st.centers) {
      expect(['CANNOT_ASSIGN', 'NOT_CENTER', 'UNSPECIFIED']).toContain(c.label);
      if (c.label === 'CANNOT_ASSIGN') expect(c.reason).toBe('digraph size cap');
    }
    expect(st.chiral).toBe(false);
  }, 30_000);

  it('a 3x2x3 carbon block (18 atoms) completes in under 2 s and reports CANNOT_ASSIGN centres', () => {
    const { ms, analysis: a } = timed(block(3, 2, 3));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(a.formula).toBe('C18H8');
    const labels = a.stereo!.centers.map((c) => c.label);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toContain('CANNOT_ASSIGN');
    expect(labels.every((l) => l === 'CANNOT_ASSIGN' || l === 'NOT_CENTER' || l === 'UNSPECIFIED')).toBe(true);
  }, 30_000);

  it('the smaller lattices stay fast too (4x4 sheet, 2x2x2 cube, 3x2x2 block)', () => {
    for (const g of [sheet(4, 4), block(2, 2, 2), block(3, 2, 2)]) {
      const { ms } = timed(g);
      expect(ms).toBeLessThan(BUDGET_MS);
    }
  }, 30_000);

  it('cipRank gives up at CIP_NODE_BUDGET with capHit on the sheet centre and never claims advanced rules', () => {
    const g = sheet(5, 5);
    const { hydrogens } = implicitHydrogens(g);
    const r = cipRank(g, hydrogens, 12);   // the middle carbon (x = 2, z = 2)
    expect(r.capHit).toBe(true);
    expect(r.tieNeedsAdvancedRules).toBe(false);
    expect(r.ligands.length).toBe(4);
    expect(CIP_NODE_BUDGET).toBeGreaterThanOrEqual(1000);
  });

  it('ordinary course molecules are untouched by the budget', () => {
    for (const [smiles, center, expected] of [
      ['CC(O)CC', 1, [2, 3, 0, 'H']],
      ['CC1CCCCC1Br', 6, [7, 1, 5, 'H']],
      ['OC(C(CC)CC)C(C)C(C)C', 1, [0, 7, 2, 'H']],
    ] as const) {
      const g = parseSmiles(smiles).graph;
      const { hydrogens } = implicitHydrogens(g);
      const r = cipRank(g, hydrogens, center);
      expect(r.capHit).toBe(false);
      expect(r.ligands).toEqual(expected);
    }
  });
});
