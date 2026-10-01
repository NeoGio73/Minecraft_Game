/**
 * The voxel world: 8x8 chunks plus the molecule index. `setBlock` is the only
 * writer of atom cells and keeps the index in sync; bond orders, suppressed
 * pairs and charges are written only through the dedicated methods.
 * PURE MODULE (no three, no DOM). See docs/design/06-engine.md §1, §2.3, §4
 * and 09-amendment-no-bond.md §1.2.
 */
import type { BondOrder, Charge } from '../chem/types';
import {
  Block, CHUNK_D, CHUNK_W, FACE_DIRS, WORLD_CX, WORLD_CZ, WORLD_D, WORLD_H, WORLD_W, cellKey, elementOf, isAtom,
  isSolid as isSolidId, splitPairKey,
} from './types';
import type { BlockElement, CellKey, PairKey } from './types';
import { Chunk, chunkIndex } from './chunk';
import { createMoleculeIndex } from './molecule-index';
import type { MoleculeIndexExt } from './molecule-index';

/** Air and atom blocks: neither contributes a face to the chunk mesh nor hides a neighbour's (06 §2.2, §5.2). */
function isMeshless(id: number): boolean {
  return id === Block.Air || isAtom(id);
}

export interface WorldEdit {
  readonly kind: 'block' | 'bond' | 'charge';
  /** Cells whose component may have changed. */
  readonly cells: readonly CellKey[];
}

export class World {
  readonly chunks: readonly Chunk[];
  readonly index: MoleculeIndexExt;
  /** Incremented by every mutation; Game compares it to decide whether to re-derive components. */
  editVersion = 0;
  private edits: WorldEdit[] = [];

  constructor(index?: MoleculeIndexExt) {
    const chunks: Chunk[] = [];
    for (let cz = 0; cz < WORLD_CZ; cz++) {
      for (let cx = 0; cx < WORLD_CX; cx++) chunks.push(new Chunk(cx, cz));
    }
    this.chunks = chunks;
    this.index = index ?? createMoleculeIndex();
    this.getBlock = this.getBlock.bind(this);
    this.isSolid = this.isSolid.bind(this);
  }

  /** Block.Air outside x/z bounds or y >= WORLD_H; Block.Bedrock for y < 0. */
  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return Block.Bedrock;
    if (x < 0 || x >= WORLD_W || z < 0 || z >= WORLD_D || y >= WORLD_H) return Block.Air;
    const chunk = this.chunks[chunkIndex(x >> 4, z >> 4)] as Chunk;
    return chunk.get(x & 15, y, z & 15);
  }

  private inBounds(x: number, y: number, z: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
      && x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H && z >= 0 && z < WORLD_D;
  }

  /** No validation; updates the index for atom blocks; marks chunks dirty; records an edit. */
  setBlock(x: number, y: number, z: number, id: number): void {
    if (!this.inBounds(x, y, z)) throw new RangeError('setBlock out of bounds');
    const old = this.getBlock(x, y, z);
    if (old === id) return;
    const key = cellKey(x, y, z);
    if (isAtom(old)) this.index.removeAtom(key);
    if (isAtom(id)) {
      this.index.addAtom({ key, el: elementOf(id) as BlockElement, x, y, z, charge: 0 });
    }
    const cx = x >> 4;
    const cz = z >> 4;
    const lx = x & 15;
    const lz = z & 15;
    const chunk = this.chunks[chunkIndex(cx, cz)] as Chunk;
    if (isMeshless(old) && isMeshless(id)) {
      // Atom placement / removal never changes a chunk mesh (atoms are instanced, not meshed, and not opaque):
      // write the cell and bump the version, but mark nothing dirty (engineering review finding 10).
      chunk.setUnmeshed(lx, y, lz, id);
    } else {
      chunk.set(lx, y, lz, id);
      if (lx === 0 && cx > 0) this.markDirty(cx - 1, cz);
      if (lx === CHUNK_W - 1 && cx < WORLD_CX - 1) this.markDirty(cx + 1, cz);
      if (lz === 0 && cz > 0) this.markDirty(cx, cz - 1);
      if (lz === CHUNK_D - 1 && cz < WORLD_CZ - 1) this.markDirty(cx, cz + 1);
    }
    this.editVersion++;
    const cells: CellKey[] = [key];
    for (const d of FACE_DIRS) {
      const nk = cellKey(x + d[0], y + d[1], z + d[2]);
      if (this.index.atoms.has(nk)) cells.push(nk);
    }
    this.edits.push({ kind: 'block', cells });
  }

  private markDirty(cx: number, cz: number): void {
    const c = this.chunks[chunkIndex(cx, cz)];
    if (c) c.dirty = true;
  }

  /** isSolid(getBlock(...)); true for y < 0. */
  isSolid(x: number, y: number, z: number): boolean {
    return isSolidId(this.getBlock(x, y, z));
  }

  setBondOrder(key: PairKey, order: BondOrder): void {
    this.index.setBondOrder(key, order);
    this.editVersion++;
    const [a, b] = splitPairKey(key);
    this.edits.push({ kind: 'bond', cells: [a, b] });
  }

  /** "No bond": moves the pair into index.suppressed (09 §1.2). */
  suppressBond(key: PairKey): void {
    this.index.suppressBond(key);
    this.editVersion++;
    const [a, b] = splitPairKey(key);
    this.edits.push({ kind: 'bond', cells: [a, b] });
  }

  /** Bonds a suppressed pair again with order 1. */
  restoreBond(key: PairKey): void {
    this.index.restoreBond(key);
    this.editVersion++;
    const [a, b] = splitPairKey(key);
    this.edits.push({ kind: 'bond', cells: [a, b] });
  }

  setCharge(key: CellKey, charge: Charge): void {
    this.index.setCharge(key, charge);
    this.editVersion++;
    this.edits.push({ kind: 'charge', cells: [key] });
  }

  /** Removes an atom block and every explicit-H block that would be orphaned by it. Returns the removed cells (atom first). */
  removeAtomBlock(x: number, y: number, z: number): CellKey[] {
    const key = cellKey(x, y, z);
    const removed: CellKey[] = [key];
    this.setBlock(x, y, z, Block.Air);
    for (const d of FACE_DIRS) {
      const nx = x + d[0];
      const ny = y + d[1];
      const nz = z + d[2];
      if (this.getBlock(nx, ny, nz) !== Block.AtomH) continue;
      const nKey = cellKey(nx, ny, nz);
      const heavy = this.index.neighbours(nKey).filter((a) => a.el !== 'H').length;
      if (heavy === 0) {
        this.setBlock(nx, ny, nz, Block.Air);
        removed.push(nKey);
      }
    }
    return removed;
  }

  /** Chunks whose `dirty` flag is set, ordered by squared distance from (px, pz) to the chunk centre. */
  dirtyChunks(px: number, pz: number): Chunk[] {
    const out = this.chunks.filter((c) => c.dirty);
    const d2 = (c: Chunk): number => {
      const dx = c.cx * CHUNK_W + CHUNK_W / 2 - px;
      const dz = c.cz * CHUNK_D + CHUNK_D / 2 - pz;
      return dx * dx + dz * dz;
    };
    return out.sort((a, b) => d2(a) - d2(b));
  }

  /** Edits since the last call (cleared by the call). */
  drainEdits(): WorldEdit[] {
    const e = this.edits;
    this.edits = [];
    return e;
  }
}
