import { describe, it, expect } from 'vitest';
import { Block, PICK_DISTANCE, PLAYER } from '@/world/types';
import { raycastVoxels, playerOverlapsCell } from '@/world/raycast';

function worldWith(cells: readonly (readonly [number, number, number])[]): (x: number, y: number, z: number) => number {
  const set = new Set(cells.map((c) => c.join(',')));
  return (x, y, z) => (set.has(`${x},${y},${z}`) ? Block.Stone : Block.Air);
}

describe('raycastVoxels (06 §6.2)', () => {
  it('hits Stone at (3,0,0) along +x with normal -x and t = 2.5', () => {
    const h = raycastVoxels(0.5, 0.5, 0.5, 1, 0, 0, PICK_DISTANCE, worldWith([[3, 0, 0]]));
    expect(h).not.toBeNull();
    expect([h!.x, h!.y, h!.z]).toEqual([3, 0, 0]);
    expect([h!.nx, h!.ny, h!.nz]).toEqual([-1, 0, 0]);
    expect(h!.t).toBeCloseTo(2.5, 9);
    expect(h!.id).toBe(Block.Stone);
  });

  it('returns null when the block is beyond maxDist', () => {
    expect(raycastVoxels(0.5, 0.5, 0.5, 1, 0, 0, PICK_DISTANCE, worldWith([[8, 0, 0]]))).toBeNull();
  });

  it('starting inside a block hits it at t = 0 with normal (0,0,0)', () => {
    const h = raycastVoxels(3.5, 0.5, 0.5, 1, 0, 0, PICK_DISTANCE, worldWith([[3, 0, 0]]));
    expect(h).not.toBeNull();
    expect([h!.x, h!.y, h!.z]).toEqual([3, 0, 0]);
    expect([h!.nx, h!.ny, h!.nz]).toEqual([0, 0, 0]);
    expect(h!.t).toBe(0);
  });

  it('diagonal ray uses the tie rule (x before z) and hits (2,0,2) from -z', () => {
    const s = Math.SQRT1_2;
    const h = raycastVoxels(0.5, 0.5, 0.5, s, 0, s, PICK_DISTANCE, worldWith([[2, 0, 2]]));
    expect(h).not.toBeNull();
    expect([h!.x, h!.y, h!.z]).toEqual([2, 0, 2]);
    expect([h!.nx, h!.ny, h!.nz]).toEqual([0, 0, -1]);
    expect(h!.t).toBeCloseTo(2.1213, 3);
  });

  it('looking down hits the top face', () => {
    const h = raycastVoxels(0.5, 5.5, 0.5, 0, -1, 0, PICK_DISTANCE, worldWith([[0, 2, 0]]));
    expect(h).not.toBeNull();
    expect([h!.x, h!.y, h!.z]).toEqual([0, 2, 0]);
    expect([h!.nx, h!.ny, h!.nz]).toEqual([0, 1, 0]);
    expect(h!.t).toBeCloseTo(2.5, 9);
  });

  it('returns null after leaving the world when get always returns Air', () => {
    expect(raycastVoxels(0.5, 0.5, 0.5, 0, 0, -1, PICK_DISTANCE, () => Block.Air)).toBeNull();
  });
});

describe('playerOverlapsCell', () => {
  it('overlaps the cells the player stands in and not the ones beside', () => {
    const p = { x: 64.5, y: 9, z: 64.5 };
    expect(playerOverlapsCell(p, 64, 9, 64)).toBe(true);
    expect(playerOverlapsCell(p, 64, 10, 64)).toBe(true); // height 1.8 spans y 9..10.8
    expect(playerOverlapsCell(p, 64, 11, 64)).toBe(false);
    expect(playerOverlapsCell(p, 65, 9, 64)).toBe(false); // halfW 0.3: 64.8 < 65
    expect(playerOverlapsCell(p, 64, 8, 64)).toBe(false);
    expect(PLAYER.halfW).toBe(0.3);
  });
});
