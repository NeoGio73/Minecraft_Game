import { describe, it, expect } from 'vitest';
import { PLAYER, SPAWN, WORLD_D, WORLD_W } from '@/world/types';
import type { FrameInput, PlayerState } from '@/world/types';
import {
  PHYSICS_EPS, createPlayer, eyePosition, forward, lookDirection, right, stepPlayer,
} from '@/player/physics';

const DT = PLAYER.fixedDt;
const NONE: FrameInput = { forward: 0, strafe: 0, jump: false, sprint: false };
const floor = (_x: number, y: number, _z: number): boolean => y < 1;

function player(x: number, y: number, z: number, extra: Partial<PlayerState> = {}): PlayerState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false, ...extra };
}

function run(p: PlayerState, input: FrameInput, steps: number, isSolid = floor, each?: (p: PlayerState, i: number) => void): void {
  for (let i = 0; i < steps; i++) {
    stepPlayer(p, input, DT, isSolid);
    each?.(p, i);
  }
}

/** Lets a player placed just above the floor settle on it. */
function settled(x: number, z: number, isSolid = floor): PlayerState {
  const p = player(x, 1.05, z);
  run(p, NONE, 30, isSolid);
  expect(p.onGround).toBe(true);
  expect(p.y).toBeCloseTo(1 + 1e-4, 9);
  return p;
}

describe('createPlayer / eyePosition / basis vectors', () => {
  it('createPlayer starts at SPAWN facing -z, airborne, at rest', () => {
    const p = createPlayer();
    expect([p.x, p.y, p.z]).toEqual([SPAWN[0], SPAWN[1], SPAWN[2]]);
    expect([p.vx, p.vy, p.vz]).toEqual([0, 0, 0]);
    expect(p.yaw).toBe(0);
    expect(p.pitch).toBe(0);
    expect(p.onGround).toBe(false);
  });

  it('eyePosition adds PLAYER.eye to y only', () => {
    expect(eyePosition(player(1, 2, 3))).toEqual([1, 2 + PLAYER.eye, 3]);
  });

  it('forward(0) = (0,0,-1), right(0) = (1,0,0); yaw = pi/2 turns left', () => {
    expect(forward(0)[0]).toBeCloseTo(0, 12);
    expect(forward(0)[2]).toBeCloseTo(-1, 12);
    expect(right(0)[0]).toBeCloseTo(1, 12);
    expect(right(0)[2]).toBeCloseTo(0, 12);
    expect(forward(Math.PI / 2)[0]).toBeCloseTo(-1, 12);
    expect(right(Math.PI / 2)[2]).toBeCloseTo(-1, 12);
  });

  it('PHYSICS_EPS is 1e-4', () => {
    expect(PHYSICS_EPS).toBe(1e-4);
  });
});

describe('stepPlayer (06 §7.2)', () => {
  it('1. free fall from y = 5 lands on the floor at 1 + EPS with vy = 0 and onGround', () => {
    const p = player(2, 5, 5);
    run(p, NONE, 120);
    expect(Math.abs(p.y - (1 + 1e-4))).toBeLessThan(1e-6);
    expect(p.vy).toBe(0);
    expect(p.onGround).toBe(true);
    expect(p.x).toBe(2);
    expect(p.z).toBe(5);
  });

  it('2. walking forward at yaw 0 for one second moves z by -speed; sprint by -sprint', () => {
    const p = player(2, 1.0001, 5);
    run(p, { ...NONE, forward: 1 }, 60);
    expect(Math.abs(p.z - (5 - 4.3))).toBeLessThan(0.01);
    expect(p.x).toBe(2);
    expect(p.onGround).toBe(true);

    // Start far enough from the world edge that 6.5 cells of travel stay inside the clamp.
    const s = player(2, 1.0001, 10);
    run(s, { ...NONE, forward: 1, sprint: true }, 60);
    expect(Math.abs(s.z - (10 - 6.5))).toBeLessThan(0.01);
    expect(s.x).toBe(2);
  });

  it('2b. diagonal input is normalised, never faster than speed; releasing the keys stops instantly', () => {
    const p = player(10, 1.0001, 10);
    run(p, { ...NONE, forward: 1, strafe: 1 }, 60);
    const dist = Math.hypot(p.x - 10, p.z - 10);
    expect(Math.abs(dist - 4.3)).toBeLessThan(0.01);
    expect(p.x).toBeGreaterThan(10);
    expect(p.z).toBeLessThan(10);
    const x = p.x;
    const z = p.z;
    run(p, NONE, 10);
    expect(p.x).toBe(x);
    expect(p.z).toBe(z);
    expect(p.vx).toBe(0);
    expect(p.vz).toBe(0);
  });

  it('3. strafing right into a wall at x = 3 stops at 3 - halfW - EPS', () => {
    const wall = (x: number, y: number, _z: number): boolean => y < 1 || x === 3;
    const p = player(2.0, 1.0001, 5);
    run(p, { ...NONE, strafe: 1 }, 60, wall);
    expect(p.x).toBeCloseTo(3 - 0.3 - 1e-4, 9);
    expect(p.vx).toBe(0);
    expect(p.z).toBe(5);
  });

  it('3b. walking backward into a wall behind (+z) stops at the far side of the cell', () => {
    const wall = (_x: number, y: number, z: number): boolean => y < 1 || z === 7;
    const p = player(5, 1.0001, 6.5);
    run(p, { ...NONE, forward: -1 }, 60, wall);
    expect(p.z).toBeCloseTo(7 - 0.3 - 1e-4, 9);
    expect(p.vz).toBe(0);
  });

  it('4. a jump from the ground rises 1.2..1.35 cells; a second jump while airborne changes nothing', () => {
    const held = settled(5, 5);
    const y0 = held.y;
    let yMax = y0;
    const trajectory: number[] = [];
    run(held, { ...NONE, jump: true }, 120, floor, (q) => {
      yMax = Math.max(yMax, q.y);
      trajectory.push(q.y);
    });
    expect(yMax - y0).toBeGreaterThanOrEqual(1.2);
    expect(yMax - y0).toBeLessThanOrEqual(1.35);
    // jump is held, so the player lands and immediately jumps again (bunny hop): it must have
    // touched the floor at least once and then left it again.
    const landing = trajectory.findIndex((y, i) => i > 0 && Math.abs(y - (1 + 1e-4)) < 1e-9);
    expect(landing).toBeGreaterThan(10);
    expect(trajectory.slice(landing + 1).some((y) => y > 1.01)).toBe(true);

    // Same jump, but the key is released after the first step: identical trajectory until landing,
    // and the player then stays on the ground. Holding jump while airborne changes nothing.
    const once = settled(5, 5);
    const trajectoryOnce: number[] = [];
    stepPlayer(once, { ...NONE, jump: true }, DT, floor);
    trajectoryOnce.push(once.y);
    run(once, NONE, 119, floor, (q) => trajectoryOnce.push(q.y));
    expect(trajectoryOnce.slice(0, landing + 1)).toEqual(trajectory.slice(0, landing + 1));
    expect(once.onGround).toBe(true);
    expect(once.y).toBeCloseTo(1 + 1e-4, 9);
  });

  it('5. a ceiling at y = 3 caps the jump: y + height <= 3 always and vy becomes 0 at the bump', () => {
    const roomy = (_x: number, y: number, _z: number): boolean => y < 1 || y >= 3;
    const p = settled(5, 5, roomy);
    let bumped = false;
    run(p, { ...NONE, jump: true }, 120, roomy, (q) => {
      expect(q.y + PLAYER.height).toBeLessThanOrEqual(3);
      if (!bumped && q.vy === 0 && q.y > 1.1) bumped = true;
    });
    expect(bumped).toBe(true);
  });

  it('6. a fall at maxFall does not tunnel through a one-cell floor', () => {
    const thin = (_x: number, y: number, _z: number): boolean => y === 1;
    const p = player(5, 5, 5, { vy: -40 });
    let minY = p.y;
    run(p, NONE, 120, thin, (q) => {
      minY = Math.min(minY, q.y);
    });
    expect(minY).toBeGreaterThanOrEqual(2);
    expect(p.y).toBeCloseTo(2 + 1e-4, 9);
    expect(p.onGround).toBe(true);
    expect(p.vy).toBe(0);
  });

  it('6b. vy never drops below maxFall and reaches it; the y < 0 guard keeps the step total', () => {
    const open = (): boolean => false;
    const p = player(5, 30, 5);
    let minVy = 0;
    run(p, NONE, 200, open, (q) => {
      expect(q.vy).toBeGreaterThanOrEqual(PLAYER.maxFall);
      minVy = Math.min(minVy, q.vy);
    });
    expect(minVy).toBe(PLAYER.maxFall);
    // no bedrock in this fixture: the guard parks the player at y = 0
    expect(p.y).toBe(0);
    expect(p.vy).toBe(0);
    expect(p.onGround).toBe(true);
  });

  it('7. the world clamp keeps x in [halfW, WORLD_W - halfW] and z likewise', () => {
    const p = player(0.5, 1.0001, 5);
    run(p, { ...NONE, strafe: -1 }, 60);
    expect(p.x).toBe(0.3);

    const q = player(5, 1.0001, WORLD_D - 0.5);
    run(q, { ...NONE, forward: -1 }, 60);
    expect(q.z).toBe(WORLD_D - 0.3);

    const r = player(WORLD_W - 0.5, 1.0001, 5);
    run(r, { ...NONE, strafe: 1 }, 60);
    expect(r.x).toBe(WORLD_W - 0.3);
  });

  it('8. lookDirection: (0,0) -> (0,0,-1); (pi/2,0) -> (-1,0,0); (0,-pi/2) -> (0,-1,0)', () => {
    const a = lookDirection(0, 0);
    expect(a[0]).toBeCloseTo(0, 12);
    expect(a[1]).toBeCloseTo(0, 12);
    expect(a[2]).toBeCloseTo(-1, 12);
    const b = lookDirection(Math.PI / 2, 0);
    expect(b[0]).toBeCloseTo(-1, 12);
    expect(b[1]).toBeCloseTo(0, 12);
    expect(b[2]).toBeCloseTo(0, 12);
    const c = lookDirection(0, -Math.PI / 2);
    expect(c[0]).toBeCloseTo(0, 12);
    expect(c[1]).toBeCloseTo(-1, 12);
    expect(c[2]).toBeCloseTo(0, 12);
    // unit length for an arbitrary pair
    const d = lookDirection(0.7, -0.4);
    expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 12);
  });

  it('walking direction follows yaw: yaw = pi/2 walks along -x', () => {
    const p = player(10, 1.0001, 10, { yaw: Math.PI / 2 });
    run(p, { ...NONE, forward: 1 }, 60);
    expect(Math.abs(p.x - (10 - 4.3))).toBeLessThan(0.01);
    expect(Math.abs(p.z - 10)).toBeLessThan(1e-9);
  });

  it('the player is never left overlapping a solid cell after a step against a corner', () => {
    const corner = (x: number, y: number, z: number): boolean => y < 1 || (x === 3 && z <= 3);
    const p = player(2.5, 1.0001, 2.5);
    run(p, { ...NONE, forward: 1, strafe: 1 }, 120, corner, (q) => {
      const minX = Math.floor(q.x - PLAYER.halfW);
      const maxX = Math.floor(q.x + PLAYER.halfW - 1e-6);
      const minZ = Math.floor(q.z - PLAYER.halfW);
      const maxZ = Math.floor(q.z + PLAYER.halfW - 1e-6);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) expect(corner(cx, Math.floor(q.y), cz)).toBe(false);
      }
    });
  });
});
