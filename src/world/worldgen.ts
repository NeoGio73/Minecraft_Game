/**
 * Deterministic terrain generation: height map, column fill, lab pad and
 * bench surfaces, ore veins and exposed outcrops.
 * PURE MODULE (no three, no DOM). See docs/design/06-engine.md §3.
 */
import { mulberry32 } from '../util/prng';
import { fbm2 } from '../util/noise';
import {
  BENCH_BLOCKS, BENCH_PRODUCT_X, BENCH_REACTANT_X, BENCH_Z_MAX, BENCH_Z_MIN, BLOCK_ELEMENTS, Block, LAB_MAX, LAB_MIN,
  LAB_Y, WORLD_D, WORLD_H, WORLD_W, isAtom, oreBlockOf,
} from './types';
import type { BlockElement } from './types';
import { chunkIndex } from './chunk';
import type { Chunk } from './chunk';
import type { World } from './world';

export const GEN = {
  seaLevel: 0,
  minHeight: 6,
  maxHeight: 13,
  /** pad + bench + 2-cell apron: surface fixed at y = 8 */
  flat: { xMin: 50, xMax: 78, zMin: 34, zMax: 78, height: 8 },
  blendRadius: 8,
  noise: { octaves: 3, baseFreq: 1 / 32, lacunarity: 2, gain: 0.5 },
  ore: { targetPerElement: 400, maxAttempts: 2000, blobFill: 0.7, depthBelowSurface: [1, 3] as readonly [number, number] },
  glassPostHeight: 2,
} as const;

export type OreElement = Exclude<BlockElement, 'H'>;

export const ORE_ELEMENTS: readonly OreElement[] = BLOCK_ELEMENTS.filter((e): e is OreElement => e !== 'H');

/** (x, z) of the south-west cell of each exposed outcrop (§3.5). */
export const OUTCROPS: Readonly<Record<OreElement, readonly [number, number]>> = {
  C: [80, 66],
  N: [84, 60],
  O: [66, 82],
  S: [60, 84],
  F: [47, 66],
  Cl: [44, 60],
  Br: [72, 82],
  I: [54, 82],
};

/** Walkway rows between the pad and the bench. */
export const WALKWAY_Z_MIN = 48;
export const WALKWAY_Z_MAX = 50;

/** Pad corner glass posts (x, z). */
export const GLASS_POSTS: readonly (readonly [number, number])[] = [
  [LAB_MIN, LAB_MIN], [LAB_MAX - 1, LAB_MIN], [LAB_MIN, LAB_MAX - 1], [LAB_MAX - 1, LAB_MAX - 1],
];

/** true when (x, z) lies in the flat lab region F. */
export function inFlatRegion(x: number, z: number): boolean {
  const f = GEN.flat;
  return x >= f.xMin && x < f.xMax && z >= f.zMin && z < f.zMax;
}

/** §3.2: noise height blended toward the flat lab region. */
export function surfaceHeight(seed: number, x: number, z: number): number {
  const { octaves, baseFreq, lacunarity, gain } = GEN.noise;
  const n = fbm2(seed, x * baseFreq, z * baseFreq, octaves, lacunarity, gain);
  const hNoise = GEN.minHeight + Math.round(n * (GEN.maxHeight - GEN.minHeight));
  const f = GEN.flat;
  const d = Math.max(0, f.xMin - x, x - (f.xMax - 1), f.zMin - z, z - (f.zMax - 1));
  const w = Math.max(0, 1 - d / GEN.blendRadius);
  return Math.round(hNoise * (1 - w) + f.height * w);
}

/** The surface block of a column inside F at y = 8 (§3.3 table). */
export function flatSurfaceBlock(x: number, z: number): number {
  const onPad = x >= LAB_MIN && x < LAB_MAX && z >= LAB_MIN && z < LAB_MAX;
  if (onPad) {
    const edge = x === LAB_MIN || x === LAB_MAX - 1 || z === LAB_MIN || z === LAB_MAX - 1;
    return edge ? Block.LabTileEdge : Block.LabTile;
  }
  if (z >= BENCH_Z_MIN && z < BENCH_Z_MAX) {
    if (x >= BENCH_REACTANT_X[0] && x < BENCH_REACTANT_X[1]) return Block.BenchReactantTile;
    if (x >= BENCH_PRODUCT_X[0] && x < BENCH_PRODUCT_X[1]) return Block.BenchProductTile;
  }
  if (z >= WALKWAY_Z_MIN && z < WALKWAY_Z_MAX && x >= LAB_MIN && x < LAB_MAX) return Block.LabTile;
  return Block.Grass;
}

/**
 * Terrain writer: writes a non-atom block straight into the chunk (marks it
 * dirty, bumps its version). Generation never touches atom cells, so the
 * molecule index needs no update and World.setBlock's edit bookkeeping is
 * skipped; this keeps `generate` well inside its 50 ms budget.
 */
function writeTerrain(world: World, x: number, y: number, z: number, id: number): void {
  if (isAtom(id)) throw new Error('worldgen never writes atom blocks');
  if (isAtom(world.getBlock(x, y, z))) throw new Error('worldgen must not overwrite an atom block');
  (world.chunks[chunkIndex(x >> 4, z >> 4)] as Chunk).set(x & 15, y, z & 15, id);
}

function fillColumns(world: World, seed: number): void {
  for (let z = 0; z < WORLD_D; z++) {
    for (let x = 0; x < WORLD_W; x++) {
      const h = surfaceHeight(seed, x, z);
      const flat = inFlatRegion(x, z);
      writeTerrain(world, x, 0, z, Block.Bedrock);
      for (let y = 1; y <= h - 3 && y < WORLD_H; y++) writeTerrain(world, x, y, z, Block.Stone);
      for (let y = Math.max(1, h - 2); y <= h - 1 && y < WORLD_H; y++) writeTerrain(world, x, y, z, Block.Dirt);
      if (h >= 1 && h < WORLD_H) {
        writeTerrain(world, x, h, z, flat && h === LAB_Y ? flatSurfaceBlock(x, z) : Block.Grass);
      }
    }
  }
}

function placeFixedFeatures(world: World): void {
  for (const [x, y, z] of BENCH_BLOCKS) writeTerrain(world, x, y, z, Block.Bench);
  for (const [x, z] of GLASS_POSTS) {
    for (let y = LAB_Y + 1; y < LAB_Y + 1 + GEN.glassPostHeight; y++) writeTerrain(world, x, y, z, Block.Glass);
  }
}

function placeOreVeins(world: World, seed: number): void {
  const { targetPerElement, maxAttempts, blobFill } = GEN.ore;
  const f = GEN.flat;
  ORE_ELEMENTS.forEach((el, i) => {
    const ore = oreBlockOf(el);
    const rng = mulberry32((seed ^ Math.imul(0x9e3779b9, i + 1)) >>> 0);
    let count = 0;
    let attempts = 0;
    while (count < targetPerElement && attempts < maxAttempts) {
      attempts++;
      const x = Math.floor(rng() * WORLD_W);
      const z = Math.floor(rng() * WORLD_D);
      // skip F expanded by one cell
      if (x >= f.xMin - 1 && x < f.xMax + 1 && z >= f.zMin - 1 && z < f.zMax + 1) continue;
      const h = surfaceHeight(seed, x, z);
      const y0 = h - 1 - Math.floor(rng() * 3);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const cx = x + dx;
            const cy = y0 + dy;
            const cz = z + dz;
            const inBounds = cx >= 0 && cx < WORLD_W && cy >= 0 && cy < WORLD_H && cz >= 0 && cz < WORLD_D;
            if (!inBounds) continue;
            const b = world.getBlock(cx, cy, cz);
            if ((b === Block.Stone || b === Block.Dirt) && rng() < blobFill) {
              writeTerrain(world, cx, cy, cz, ore);
              count++;
            }
          }
        }
      }
    }
  });
}

function placeOutcrops(world: World, seed: number): void {
  for (const el of ORE_ELEMENTS) {
    const [x, z] = OUTCROPS[el];
    const ore = oreBlockOf(el);
    const h = surfaceHeight(seed, x, z);
    writeTerrain(world, x, h, z, ore);
    writeTerrain(world, x + 1, h, z, ore);
    writeTerrain(world, x, h, z + 1, ore);
    writeTerrain(world, x + 1, h, z + 1, ore);
    writeTerrain(world, x, h + 1, z, ore);
  }
}

/** Fills `world` deterministically for `seed`. Writes no atom blocks and
 *  records no WorldEdits (terrain only); every chunk is left dirty. */
export function generate(world: World, seed: number): void {
  fillColumns(world, seed);
  placeFixedFeatures(world);
  placeOreVeins(world, seed);
  placeOutcrops(world, seed);
  world.editVersion++;
}
