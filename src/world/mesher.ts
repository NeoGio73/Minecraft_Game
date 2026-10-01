/**
 * Chunk meshing: one quad per exposed face of every opaque/terrain block,
 * flat per-face colour from a linear palette. Never allocates per call.
 * PURE MODULE (no three, no DOM). See docs/design/06-engine.md §5.
 */
import { Block, CHUNK_D, CHUNK_H, CHUNK_W, isAtom, isOpaque } from './types';
import type { MeshBuffers } from './types';
import { GRASS_TOP_HEX, GRASS_TOP_SLOT, PALETTE_SLOTS, blockHex } from './blocks';

export interface Face {
  readonly dir: readonly [number, number, number];
  readonly corners: readonly (readonly [number, number, number])[];
  readonly shade: number;
}

/** Index order = FACE_DIRS; corners counter-clockwise seen from outside. */
export const FACES: readonly Face[] = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.8 },
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.8 },
  { dir: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1.0 },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.7 },
  { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.7 },
];

export const MAX_FACES = CHUNK_W * CHUNK_H * CHUNK_D * 6; // 49152

/** Pooled once per renderer: pos/nor/col hold MAX_FACES*12 floats, idx MAX_FACES*6. */
export function createMeshBuffers(): MeshBuffers {
  return {
    pos: new Float32Array(MAX_FACES * 12),
    nor: new Float32Array(MAX_FACES * 12),
    col: new Float32Array(MAX_FACES * 12),
    idx: new Uint32Array(MAX_FACES * 6),
  };
}

/** PALETTE_SLOTS*3 linear RGB floats: toLinear(blockHex(id)) at id*3; slot 255 is the grass top. */
export function buildPaletteLinear(toLinear: (hex: number) => readonly [number, number, number]): Float32Array {
  const out = new Float32Array(PALETTE_SLOTS * 3);
  for (let id = 0; id < PALETTE_SLOTS; id++) {
    const hex = id === GRASS_TOP_SLOT ? GRASS_TOP_HEX : blockHex(id);
    const [r, g, b] = toLinear(hex);
    out[id * 3] = r;
    out[id * 3 + 1] = g;
    out[id * 3 + 2] = b;
  }
  return out;
}

/** sRGB (0..255 channel) to linear, the standard piecewise curve. */
export function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex: number): readonly [number, number, number] {
  return [srgbToLinear((hex >> 16) & 0xff), srgbToLinear((hex >> 8) & 0xff), srgbToLinear(hex & 0xff)];
}

/**
 * Builds the mesh of the chunk whose world origin is (ox, 0, oz) into `out`.
 * Returns the number of faces written (4 vertices and 6 indices each).
 */
export function buildChunkMesh(
  get: (x: number, y: number, z: number) => number,
  ox: number,
  oz: number,
  paletteLinear: Float32Array,
  out: MeshBuffers,
): number {
  let faces = 0;
  for (let y = 0; y < CHUNK_H; y++) {
    for (let z = 0; z < CHUNK_D; z++) {
      for (let x = 0; x < CHUNK_W; x++) {
        const wx = ox + x;
        const wz = oz + z;
        const id = get(wx, y, wz);
        if (id === Block.Air || isAtom(id)) continue;
        for (let f = 0; f < 6; f++) {
          const face = FACES[f] as Face;
          const d = face.dir;
          const n = get(wx + d[0], y + d[1], wz + d[2]);
          if (isOpaque(n)) continue;
          if (faces >= MAX_FACES) return faces;
          const slot = id === Block.Grass && f === 2 ? GRASS_TOP_SLOT : id;
          const r = (paletteLinear[slot * 3] as number) * face.shade;
          const g = (paletteLinear[slot * 3 + 1] as number) * face.shade;
          const b = (paletteLinear[slot * 3 + 2] as number) * face.shade;
          const v = faces * 4;
          for (let k = 0; k < 4; k++) {
            const c = face.corners[k] as readonly [number, number, number];
            const o = (v + k) * 3;
            out.pos[o] = wx + c[0];
            out.pos[o + 1] = y + c[1];
            out.pos[o + 2] = wz + c[2];
            out.nor[o] = d[0];
            out.nor[o + 1] = d[1];
            out.nor[o + 2] = d[2];
            out.col[o] = r;
            out.col[o + 1] = g;
            out.col[o + 2] = b;
          }
          const i = faces * 6;
          out.idx[i] = v;
          out.idx[i + 1] = v + 1;
          out.idx[i + 2] = v + 2;
          out.idx[i + 3] = v;
          out.idx[i + 4] = v + 2;
          out.idx[i + 5] = v + 3;
          faces++;
        }
      }
    }
  }
  return faces;
}
