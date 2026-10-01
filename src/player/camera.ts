/**
 * First-person camera: a three PerspectiveCamera driven by yaw/pitch and the
 * interpolated player position. DOM/WebGL module (imports three).
 * docs/design/06-engine.md §8.
 */
import { PerspectiveCamera } from 'three';
import { PLAYER } from '../world/types';
import type { PlayerState } from '../world/types';

export const CAMERA = { fov: 70, sprintFov: 76, near: 0.05, far: 120, farLowGfx: 72, pitchLimit: 1.5533 } as const;

/** Sprint zoom easing rate, degrees of field of view per second. */
export const FOV_EASE_DEG_PER_S = 40;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class FirstPersonCamera {
  /** rotation.order = 'YXZ': yaw about world +y, then pitch about the local x. */
  readonly camera: PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  private fovTarget: number = CAMERA.fov;
  private lastFovTick: number | null = null;

  constructor() {
    this.camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(0, 0, 0);
  }

  /** yaw -= dx; pitch -= dy (radians); pitch clamped to ±CAMERA.pitchLimit. */
  addLook(dxRad: number, dyRad: number): void {
    this.setLook(this.yaw - dxRad, this.pitch - dyRad);
  }

  /** Sets both angles directly (teleport, context restore) and applies them to the camera. */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -CAMERA.pitchLimit, CAMERA.pitchLimit);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /** position = lerp(prev, p, alpha) + (0, PLAYER.eye, 0). */
  setFromPlayer(p: Readonly<PlayerState>, prev: Readonly<PlayerState>, alpha: number): void {
    const a = clamp(alpha, 0, 1);
    this.camera.position.set(
      prev.x + (p.x - prev.x) * a,
      prev.y + (p.y - prev.y) * a + PLAYER.eye,
      prev.z + (p.z - prev.z) * a,
    );
  }

  setAspect(w: number, h: number): void {
    if (!(w > 0) || !(h > 0)) return;
    const aspect = w / h;
    if (aspect === this.camera.aspect) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Sprint zoom: target fov 76 when sprinting, 70 otherwise, eased at
   * FOV_EASE_DEG_PER_S unless `reducedMotion`, then set instantly. `dt` is the
   * frame time in seconds; when omitted it is measured between calls.
   */
  setSprinting(on: boolean, reducedMotion: boolean, dt?: number): void {
    this.fovTarget = on ? CAMERA.sprintFov : CAMERA.fov;
    const step = FOV_EASE_DEG_PER_S * (dt ?? this.tickDt());
    const cur = this.camera.fov;
    if (cur === this.fovTarget) return;
    let next: number;
    if (reducedMotion) next = this.fovTarget;
    else if (cur < this.fovTarget) next = Math.min(this.fovTarget, cur + step);
    else next = Math.max(this.fovTarget, cur - step);
    if (next !== cur) {
      this.camera.fov = next;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Far plane for the active graphics profile (CAMERA.far / CAMERA.farLowGfx). */
  setFar(far: number): void {
    if (far === this.camera.far) return;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  private tickDt(): number {
    const now = nowMs();
    const dt = this.lastFovTick === null
      ? PLAYER.fixedDt
      : clamp((now - this.lastFovTick) / 1000, 0, PLAYER.maxFrameDt);
    this.lastFovTick = now;
    return dt;
  }
}
