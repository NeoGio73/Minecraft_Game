/**
 * World.setBlock and the chunk dirty flag (06 §2.3, §4; engineering review finding 10): atom blocks are drawn by
 * the AtomRenderer and are not opaque, so placing or removing one never changes a chunk mesh and must not mark
 * any chunk dirty; terrain writes still do (including the border neighbour).
 */
import { describe, it, expect } from 'vitest';
import { Block, cellKey } from '@/world/types';
import { World } from '@/world/world';
import { chunkIndex } from '@/world/chunk';

function clean(w: World): void {
  for (const c of w.chunks) c.dirty = false;
}

function dirtyChunks(w: World): [number, number][] {
  return w.chunks.filter((c) => c.dirty).map((c) => [c.cx, c.cz]);
}

describe('World.setBlock remeshing rule (finding 10)', () => {
  it('an atom block over Air marks no chunk dirty but bumps the chunk and edit versions', () => {
    const w = new World();
    clean(w);
    const chunk = w.chunks[chunkIndex(64 >> 4, 64 >> 4)]!;
    const v0 = chunk.version;
    const e0 = w.editVersion;
    w.setBlock(64, 9, 64, Block.AtomC);
    expect(dirtyChunks(w)).toEqual([]);
    expect(chunk.version).toBe(v0 + 1);
    expect(w.editVersion).toBe(e0 + 1);
    expect(w.getBlock(64, 9, 64)).toBe(Block.AtomC);
    expect(w.index.atoms.has(cellKey(64, 9, 64))).toBe(true);
    expect(w.drainEdits()).toEqual([{ kind: 'block', cells: [cellKey(64, 9, 64)] }]);
  });

  it('atom -> Air, atom -> atom and writes on a chunk border stay quiet as well', () => {
    const w = new World();
    w.setBlock(64, 9, 64, Block.AtomC);
    w.setBlock(63, 9, 64, Block.AtomO);   // x = 63 is the last column of chunk 3: a terrain write there marks chunk 4 too
    clean(w);
    w.setBlock(63, 9, 64, Block.AtomH);   // atom -> atom
    expect(dirtyChunks(w)).toEqual([]);
    w.setBlock(64, 9, 64, Block.Air);     // atom -> Air
    expect(dirtyChunks(w)).toEqual([]);
    w.setBlock(63, 9, 64, Block.Air);
    expect(dirtyChunks(w)).toEqual([]);
    expect(w.index.atoms.size).toBe(0);
    expect(w.removeAtomBlock(64, 9, 64)).toEqual([cellKey(64, 9, 64)]);
    expect(dirtyChunks(w)).toEqual([]);
  });

  it('terrain writes mark the chunk dirty, and the neighbour when on the border', () => {
    const w = new World();
    clean(w);
    w.setBlock(64, 5, 64, Block.Stone);   // lx = lz = 0 of chunk (4, 4): chunks (3, 4) and (4, 3) share a face
    expect(dirtyChunks(w)).toEqual([[4, 3], [3, 4], [4, 4]]);
    clean(w);
    w.setBlock(64, 5, 64, Block.AtomC);   // stone -> atom: the stone faces disappear, so a remesh is needed
    expect(dirtyChunks(w)).toEqual([[4, 3], [3, 4], [4, 4]]);
    clean(w);
    w.setBlock(64, 5, 64, Block.Air);     // atom -> Air: quiet again
    expect(dirtyChunks(w)).toEqual([]);
    clean(w);
    w.setBlock(70, 5, 70, Block.Dirt);    // interior write: only its own chunk
    expect(dirtyChunks(w)).toEqual([[4, 4]]);
  });
});
