/**
 * Voxel picking (Amanatides–Woo) and the player/cell overlap test.
 * PURE MODULE (no three, no DOM). See docs/design/06-engine.md §6.
 */
import { Block, PLAYER } from './types';
import type { PlayerState, VoxelHit } from './types';

/**
 * Walks the ray (origin o, unit direction d) through the voxel grid and
 * returns the first non-Air cell within `maxDist`, with the entered face's
 * normal and the distance `t`. A ray starting inside a block hits it at
 * t = 0 with normal (0,0,0).
 */
export function raycastVoxels(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  get: (x: number, y: number, z: number) => number,
): VoxelHit | null {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const id0 = get(x, y, z);
  if (id0 !== Block.Air) return { x, y, z, nx: 0, ny: 0, nz: 0, t: 0, id: id0 };

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);
  let tMaxX = stepX > 0 ? (x + 1 - ox) / dx : stepX < 0 ? (x - ox) / dx : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) / dy : stepY < 0 ? (y - oy) / dy : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) / dz : stepZ < 0 ? (z - oz) / dz : Infinity;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;
  for (;;) {
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      t = tMaxX;
      x += stepX;
      tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY <= tMaxZ) {
      t = tMaxY;
      y += stepY;
      tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      t = tMaxZ;
      z += stepZ;
      tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
    if (!(t <= maxDist)) return null;
    const id = get(x, y, z);
    if (id !== Block.Air) return { x, y, z, nx, ny, nz, t, id };
  }
}

/** true when the player's AABB intersects the cell box [x,x+1)x[y,y+1)x[z,z+1). */
export function playerOverlapsCell(p: Pick<Readonly<PlayerState>, 'x' | 'y' | 'z'>, x: number, y: number, z: number): boolean {
  const { halfW, height } = PLAYER;
  return x < p.x + halfW && x + 1 > p.x - halfW
    && y < p.y + height && y + 1 > p.y
    && z < p.z + halfW && z + 1 > p.z - halfW;
}
