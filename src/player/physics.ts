/**
 * Player physics: fixed-step AABB movement against the voxel grid.
 * PURE MODULE (no three, no DOM). docs/design/06-engine.md §7 and §8.
 *
 * Coordinates: cell (x,y,z) occupies [x,x+1)×[y,y+1)×[z,z+1); +y is up. The
 * player is an axis-aligned box of half-width PLAYER.halfW and height
 * PLAYER.height whose feet are at (p.x, p.y, p.z). `yaw` increases turning
 * left; yaw 0 looks along −z.
 */
import { PLAYER, SPAWN, WORLD_D, WORLD_W } from '../world/types';
import type { FrameInput, PlayerState } from '../world/types';

export const PHYSICS_EPS = 1e-4;

export type IsSolid = (x: number, y: number, z: number) => boolean;

/** Horizontal unit vector the player faces: (−sin yaw, 0, −cos yaw). */
export function forward(yaw: number): [number, number, number] {
  return [-Math.sin(yaw), 0, -Math.cos(yaw)];
}

/** Horizontal unit vector to the player's right: (cos yaw, 0, −sin yaw). */
export function right(yaw: number): [number, number, number] {
  return [Math.cos(yaw), 0, -Math.sin(yaw)];
}

/** A player standing at SPAWN, facing −z, not yet on the ground. */
export function createPlayer(): PlayerState {
  return { x: SPAWN[0], y: SPAWN[1], z: SPAWN[2], vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false };
}

/** (x, y + PLAYER.eye, z): the camera position for the crosshair ray. */
export function eyePosition(p: Readonly<PlayerState>): [number, number, number] {
  return [p.x, p.y + PLAYER.eye, p.z];
}

/** Unit view vector (−sin yaw·cos pitch, sin pitch, −cos yaw·cos pitch); equals
 *  three's `camera.getWorldDirection` for a 'YXZ' camera rotated (pitch, yaw, 0). */
export function lookDirection(yaw: number, pitch: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Resolves the player's box against every solid cell it overlaps after a
 * sub-step along `axis`. Returns true (and zeroes that velocity component)
 * when a solid cell was found; a downward y hit also sets `onGround`.
 */
function collide(p: PlayerState, axis: 'x' | 'y' | 'z', step: number, isSolid: IsSolid): boolean {
  const { halfW, height } = PLAYER;
  const minX = Math.floor(p.x - halfW);
  const maxX = Math.floor(p.x + halfW - 1e-6);
  const minY = Math.floor(p.y);
  const maxY = Math.floor(p.y + height - 1e-6);
  const minZ = Math.floor(p.z - halfW);
  const maxZ = Math.floor(p.z + halfW - 1e-6);
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (!isSolid(cx, cy, cz)) continue;
        if (axis === 'x') {
          p.x = step > 0 ? cx - halfW - PHYSICS_EPS : cx + 1 + halfW + PHYSICS_EPS;
          p.vx = 0;
        } else if (axis === 'z') {
          p.z = step > 0 ? cz - halfW - PHYSICS_EPS : cz + 1 + halfW + PHYSICS_EPS;
          p.vz = 0;
        } else {
          if (step > 0) {
            p.y = cy - height - PHYSICS_EPS;
          } else {
            p.y = cy + 1 + PHYSICS_EPS;
            p.onGround = true;
          }
          p.vy = 0;
        }
        return true;
      }
    }
  }
  return false;
}

/** Moves one axis by `delta` in sub-steps of at most PLAYER.maxAxisStep so a
 *  fast fall cannot tunnel through a one-cell floor. */
function moveAxis(p: PlayerState, axis: 'x' | 'y' | 'z', delta: number, isSolid: IsSolid): void {
  if (delta === 0 || !Number.isFinite(delta)) return;
  const n = Math.ceil(Math.abs(delta) / PLAYER.maxAxisStep);
  const step = delta / n;
  for (let i = 0; i < n; i++) {
    p[axis] += step;
    if (collide(p, axis, step, isSolid)) return;
  }
}

/**
 * One fixed physics step (06 §7.1): instant horizontal velocity from the
 * input, jump + gravity, axis-separated movement with collision (x, z, then
 * y), then the world clamp.
 */
export function stepPlayer(p: PlayerState, input: FrameInput, dt: number, isSolid: IsSolid): void {
  // 1. horizontal velocity, no acceleration
  const speed = input.sprint ? PLAYER.sprint : PLAYER.speed;
  const f = forward(p.yaw);
  const r = right(p.yaw);
  let wx = f[0] * input.forward + r[0] * input.strafe;
  let wz = f[2] * input.forward + r[2] * input.strafe;
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  }
  // `|| 0` folds the -0 that a zero input times a negative basis component produces.
  p.vx = wx * speed || 0;
  p.vz = wz * speed || 0;

  // 2. jump and gravity
  if (input.jump && p.onGround) {
    p.vy = PLAYER.jumpVel;
    p.onGround = false;
  }
  p.vy = Math.max(PLAYER.maxFall, p.vy + PLAYER.gravity * dt);

  // 3. move axis by axis
  moveAxis(p, 'x', p.vx * dt, isSolid);
  moveAxis(p, 'z', p.vz * dt, isSolid);
  p.onGround = false;
  moveAxis(p, 'y', p.vy * dt, isSolid);

  // 4. world clamp
  p.x = clamp(p.x, PLAYER.halfW, WORLD_W - PLAYER.halfW);
  p.z = clamp(p.z, PLAYER.halfW, WORLD_D - PLAYER.halfW);
  if (p.y < 0) {
    p.y = 0;
    p.vy = 0;
    p.onGround = true;
  }
}
