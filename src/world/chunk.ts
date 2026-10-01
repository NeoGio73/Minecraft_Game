/**
 * One 16x32x16 chunk of block ids.
 * PURE MODULE (no three, no DOM). See docs/design/06-engine.md §1, §2.1.
 */
import { CHUNK_D, CHUNK_H, CHUNK_W, WORLD_CX, cidx } from './types';

export const CHUNK_CELLS = CHUNK_W * CHUNK_H * CHUNK_D; // 8192

export class Chunk {
  /** CHUNK_W * CHUNK_H * CHUNK_D entries, index cidx(x,y,z). */
  readonly data: Uint8Array;
  /** Needs a mesh rebuild. */
  dirty = true;
  /** Incremented by every write; the renderer stores the version it last built. */
  version = 0;

  constructor(readonly cx: number, readonly cz: number) {
    this.data = new Uint8Array(CHUNK_CELLS);
  }

  get(lx: number, ly: number, lz: number): number {
    return this.data[cidx(lx, ly, lz)] as number;
  }

  /** Writes the cell, marks the chunk dirty and bumps `version`. */
  set(lx: number, ly: number, lz: number, id: number): void {
    this.data[cidx(lx, ly, lz)] = id;
    this.dirty = true;
    this.version++;
  }
}

/** cx + WORLD_CX * cz */
export function chunkIndex(cx: number, cz: number): number {
  return cx + WORLD_CX * cz;
}
