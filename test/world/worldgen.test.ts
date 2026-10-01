import { describe, it, expect } from 'vitest';
import {
  BENCH_BLOCKS, Block, LAB_MAX, LAB_MIN, SPAWN, WORLD_D, WORLD_H, WORLD_SEED, WORLD_W, cellKey, elementOf, isOre, pairKey,
} from '@/world/types';
import { World } from '@/world/world';
import { chunkIndex } from '@/world/chunk';
import { GEN, ORE_ELEMENTS, OUTCROPS, generate, inFlatRegion, surfaceHeight } from '@/world/worldgen';
import { mulberry32, hash2 } from '@/util/prng';
import { fbm2, valueNoise2 } from '@/util/noise';

function fresh(): World {
  const w = new World();
  generate(w, WORLD_SEED);
  return w;
}

const WORLD = fresh();

describe('prng and noise', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(1337);
    const b = mulberry32(1337);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it('hash2 is a 32-bit unsigned integer and valueNoise2 interpolates in [0,1]', () => {
    const h = hash2(1337, 3, 4);
    expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
    expect(hash2(1337, 3, 4)).toBe(h);
    expect(hash2(1337, 4, 3)).not.toBe(h);
    for (let i = 0; i < 50; i++) {
      const v = valueNoise2(7, i * 0.37, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // at integer corners the value equals the lattice hash
    expect(valueNoise2(7, 5, 9)).toBeCloseTo(hash2(7, 5, 9) / 2 ** 32, 12);
    const f = fbm2(7, 1.5, 2.5, 3, 2, 0.5);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThanOrEqual(1);
  });
});

describe('worldgen (06 §3.6)', () => {
  it('1. two runs produce byte-identical chunk data', () => {
    const other = fresh();
    for (let i = 0; i < WORLD.chunks.length; i++) {
      expect(Buffer.compare(Buffer.from(WORLD.chunks[i]!.data), Buffer.from(other.chunks[i]!.data))).toBe(0);
    }
  });

  it('2. outside F the surface height is in [6,13] and bedrock is at y = 0', () => {
    for (let z = 0; z < WORLD_D; z++) {
      for (let x = 0; x < WORLD_W; x++) {
        expect(WORLD.getBlock(x, 0, z)).toBe(Block.Bedrock);
        if (inFlatRegion(x, z)) {
          expect(surfaceHeight(WORLD_SEED, x, z)).toBe(8);
          continue;
        }
        const h = surfaceHeight(WORLD_SEED, x, z);
        expect(h).toBeGreaterThanOrEqual(GEN.minHeight);
        expect(h).toBeLessThanOrEqual(GEN.maxHeight);
        const top = WORLD.getBlock(x, h, z);
        expect(top === Block.Grass || isOre(top)).toBe(true);
        expect(WORLD.getBlock(x, h - 1, z) === Block.Dirt || isOre(WORLD.getBlock(x, h - 1, z))).toBe(true);
      }
    }
  });

  it('3. pad floor is LabTile with an exact LabTileEdge ring; y = 9 is Air except the glass posts', () => {
    const posts = new Set(['52,52', '75,52', '52,75', '75,75']);
    for (let z = LAB_MIN; z < LAB_MAX; z++) {
      for (let x = LAB_MIN; x < LAB_MAX; x++) {
        const edge = x === LAB_MIN || x === LAB_MAX - 1 || z === LAB_MIN || z === LAB_MAX - 1;
        expect(WORLD.getBlock(x, 8, z)).toBe(edge ? Block.LabTileEdge : Block.LabTile);
        const isPost = posts.has(`${x},${z}`);
        expect(WORLD.getBlock(x, 9, z)).toBe(isPost ? Block.Glass : Block.Air);
        expect(WORLD.getBlock(x, 10, z)).toBe(isPost ? Block.Glass : Block.Air);
        expect(WORLD.getBlock(x, 11, z)).toBe(Block.Air);
      }
    }
  });

  it('4. bench tiles, bench blocks and the spawn column', () => {
    for (let z = 36; z < 48; z++) {
      for (let x = 52; x < 64; x++) expect(WORLD.getBlock(x, 8, z)).toBe(Block.BenchReactantTile);
      for (let x = 64; x < 76; x++) expect(WORLD.getBlock(x, 8, z)).toBe(Block.BenchProductTile);
    }
    for (let z = 48; z < 50; z++) for (let x = 52; x < 76; x++) expect(WORLD.getBlock(x, 8, z)).toBe(Block.LabTile);
    for (const [x, y, z] of BENCH_BLOCKS) expect(WORLD.getBlock(x, y, z)).toBe(Block.Bench);
    expect(WORLD.getBlock(62, 9, 49)).toBe(Block.Air);
    for (let y = 9; y < WORLD_H; y++) expect(WORLD.getBlock(SPAWN[0], y, SPAWN[2])).toBe(Block.Air);
    expect(WORLD.getBlock(SPAWN[0], 8, SPAWN[2])).toBe(Block.LabTile);
    // the apron inside F outside pad/bench is grass at y = 8
    expect(WORLD.getBlock(50, 8, 34)).toBe(Block.Grass);
  });

  it('5. ore counts and outcrops', () => {
    const counts: Record<string, number> = {};
    for (let y = 0; y < WORLD_H; y++) {
      for (let z = 0; z < WORLD_D; z++) {
        for (let x = 0; x < WORLD_W; x++) {
          const id = WORLD.getBlock(x, y, z);
          if (isOre(id)) counts[elementOf(id)!] = (counts[elementOf(id)!] ?? 0) + 1;
        }
      }
    }
    for (const el of ORE_ELEMENTS) {
      expect(counts[el] ?? 0).toBeGreaterThanOrEqual(GEN.ore.targetPerElement);
      const [x, z] = OUTCROPS[el];
      expect(inFlatRegion(x, z)).toBe(false);
      const h = surfaceHeight(WORLD_SEED, x, z);
      const ore = WORLD.getBlock(x, h, z);
      expect(elementOf(ore)).toBe(el);
      expect(isOre(ore)).toBe(true);
      expect(WORLD.getBlock(x, h + 1, z)).toBe(ore);
      expect(WORLD.getBlock(x + 1, h, z)).toBe(ore);
      expect(WORLD.getBlock(x + 1, h, z + 1)).toBe(ore);
      expect(WORLD.getBlock(x, h, z + 1)).toBe(ore);
      expect(WORLD.getBlock(x, h + 2, z)).toBe(Block.Air);
    }
  });

  it('6. no atom blocks are generated', () => {
    expect(WORLD.index.atoms.size).toBe(0);
    expect(WORLD.index.bonds.size).toBe(0);
    expect(WORLD.drainEdits()).toEqual([]);
  });

  it('generates quickly (design budget 50 ms; bound loosened for slow CI)', () => {
    fresh(); // warm up the JIT
    const t0 = performance.now();
    fresh();
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);
  });
});

describe('World (06 §15.1)', () => {
  it('1. setBlock keeps the index in sync', () => {
    const w = new World();
    w.setBlock(10, 10, 10, Block.AtomC);
    expect(w.index.atoms.size).toBe(1);
    expect(w.index.atoms.get(cellKey(10, 10, 10))).toEqual({ key: '10,10,10', el: 'C', x: 10, y: 10, z: 10, charge: 0 });
    w.setBlock(11, 10, 10, Block.AtomO);
    expect(w.index.bonds.size).toBe(1);
    expect(w.index.bonds.get('10,10,10|11,10,10')?.order).toBe(1);
    w.setBlock(11, 10, 10, Block.Air);
    expect(w.index.atoms.size).toBe(1);
    expect(w.index.bonds.size).toBe(0);
    // replacing an atom with another element re-indexes it
    w.setBlock(10, 10, 10, Block.AtomN);
    expect(w.index.atoms.get(cellKey(10, 10, 10))?.el).toBe('N');
    // a terrain block over an atom cell removes the atom
    w.setBlock(10, 10, 10, Block.Stone);
    expect(w.index.atoms.size).toBe(0);
    expect(() => w.setBlock(200, 10, 10, Block.Stone)).toThrow(RangeError);
  });

  it('2. chunk dirty marking at chunk borders', () => {
    const w = new World();
    for (const c of w.chunks) c.dirty = false;
    w.setBlock(16, 5, 5, Block.Stone);
    expect(w.chunks[chunkIndex(1, 0)]!.dirty).toBe(true);
    expect(w.chunks[chunkIndex(0, 0)]!.dirty).toBe(true);
    expect(w.chunks[chunkIndex(2, 0)]!.dirty).toBe(false);
    for (const c of w.chunks) c.dirty = false;
    w.setBlock(17, 5, 5, Block.Stone);
    expect(w.chunks[chunkIndex(1, 0)]!.dirty).toBe(true);
    expect(w.chunks[chunkIndex(0, 0)]!.dirty).toBe(false);
    for (const c of w.chunks) c.dirty = false;
    w.setBlock(15, 5, 31, Block.Stone);
    expect(w.chunks[chunkIndex(0, 1)]!.dirty).toBe(true);
    expect(w.chunks[chunkIndex(1, 1)]!.dirty).toBe(true);
    expect(w.chunks[chunkIndex(0, 2)]!.dirty).toBe(true);
    expect(w.dirtyChunks(100, 100)[0]).toBe(w.chunks[chunkIndex(1, 1)]);
    const v = w.chunks[chunkIndex(1, 1)]!.version;
    w.setBlock(16, 5, 31, Block.Dirt);
    expect(w.chunks[chunkIndex(1, 1)]!.version).toBe(v + 1);
    w.setBlock(16, 5, 31, Block.Dirt);
    expect(w.chunks[chunkIndex(1, 1)]!.version).toBe(v + 1);
  });

  it('3. removeAtomBlock removes orphaned H blocks atom-first and keeps shared ones', () => {
    const w = new World();
    w.setBlock(10, 10, 10, Block.AtomC);
    w.setBlock(10, 11, 10, Block.AtomH);
    w.setBlock(10, 9, 10, Block.AtomH);
    w.setBlock(11, 10, 10, Block.AtomH);
    w.setBlock(12, 10, 10, Block.AtomC); // the H at (11,10,10) is also bonded to this carbon
    const removed = w.removeAtomBlock(10, 10, 10);
    expect(removed[0]).toBe('10,10,10');
    expect(removed.length).toBe(3);
    expect(removed.slice(1).sort()).toEqual(['10,11,10', '10,9,10'].sort());
    expect(w.getBlock(11, 10, 10)).toBe(Block.AtomH);
    expect(w.getBlock(10, 11, 10)).toBe(Block.Air);
    expect(w.index.atoms.size).toBe(2);
  });

  it('4. getBlock out of bounds', () => {
    const w = new World();
    expect(w.getBlock(-1, 5, 5)).toBe(Block.Air);
    expect(w.getBlock(5, -1, 5)).toBe(Block.Bedrock);
    expect(w.getBlock(5, 32, 5)).toBe(Block.Air);
    expect(w.getBlock(128, 5, 5)).toBe(Block.Air);
    expect(w.getBlock(5, 5, 128)).toBe(Block.Air);
    expect(w.isSolid(5, -1, 5)).toBe(true);
    expect(w.isSolid(5, 5, 5)).toBe(false);
  });

  it('5. drainEdits returns the edits once', () => {
    const w = new World();
    w.setBlock(10, 10, 10, Block.AtomC);
    w.setBlock(11, 10, 10, Block.AtomC);
    w.setBondOrder('10,10,10|11,10,10', 2);
    w.setCharge('10,10,10', 1);
    const edits = w.drainEdits();
    expect(edits).toEqual([
      { kind: 'block', cells: ['10,10,10'] },
      { kind: 'block', cells: ['11,10,10', '10,10,10'] },
      { kind: 'bond', cells: ['10,10,10', '11,10,10'] },
      { kind: 'charge', cells: ['10,10,10'] },
    ]);
    expect(w.drainEdits()).toEqual([]);
    expect(w.editVersion).toBe(4);
  });

  it('6. suppressBond / restoreBond bump editVersion and drain a bond edit', () => {
    const w = new World();
    w.setBlock(10, 10, 10, Block.AtomC);
    w.setBlock(11, 10, 10, Block.AtomC);
    w.drainEdits();
    const v = w.editVersion;
    const key = pairKey('10,10,10', '11,10,10');
    w.suppressBond(key);
    expect(w.editVersion).toBe(v + 1);
    expect(w.drainEdits()).toEqual([{ kind: 'bond', cells: ['10,10,10', '11,10,10'] }]);
    expect(w.index.bonds.has(key)).toBe(false);
    expect(w.index.suppressed.has(key)).toBe(true);
    w.restoreBond(key);
    expect(w.editVersion).toBe(v + 2);
    expect(w.drainEdits()).toEqual([{ kind: 'bond', cells: ['10,10,10', '11,10,10'] }]);
    expect(w.index.bonds.get(key)?.order).toBe(1);
    expect(w.index.suppressed.size).toBe(0);
  });

  it('7. removeAtomBlock clears a suppressed pair; re-placing bonds again', () => {
    const w = new World();
    w.setBlock(10, 10, 10, Block.AtomC);
    w.setBlock(11, 10, 10, Block.AtomC);
    const key = pairKey('10,10,10', '11,10,10');
    w.suppressBond(key);
    w.removeAtomBlock(11, 10, 10);
    expect(w.index.suppressed.size).toBe(0);
    w.setBlock(11, 10, 10, Block.AtomC);
    expect(w.index.bonds.get(key)?.order).toBe(1);
    expect(w.index.suppressed.size).toBe(0);
  });
});
