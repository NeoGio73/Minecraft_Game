/**
 * WebGLRenderer wrapper: graphics profiles (normal / low), low-graphics
 * detection, resize inside the D2L iframe, context loss, frame stats, and the
 * shared InstancedMesh pool used by every other renderer.
 * DOM/WebGL package (imports three). docs/design/06-engine.md §11.1, §11.4, §14.7.
 */
import {
  Color, DynamicDrawUsage, Fog, InstancedMesh, Matrix4, Scene, Sphere, Vector3, WebGLRenderer,
} from 'three';
import type { BufferGeometry, Material, Object3D, PerspectiveCamera } from 'three';
import type { Emitter, GameEvents } from '../app/events';
import { setMaxAnisotropy } from './element-texture';

// ---------------------------------------------------------------------------
// Profiles and constants (06 §11.1)
// ---------------------------------------------------------------------------

export interface GfxProfile {
  antialias: boolean;
  maxPixelRatio: number;
  fogNear: number;
  fogFar: number;
  cameraFar: number;
  chunkRebuildsPerFrame: number;
}

export const GFX_NORMAL: GfxProfile = { antialias: true, maxPixelRatio: 1.5, fogNear: 40, fogFar: 110, cameraFar: 120, chunkRebuildsPerFrame: 2 };
export const GFX_LOW: GfxProfile = { antialias: false, maxPixelRatio: 1.0, fogNear: 28, fogFar: 64, cameraFar: 72, chunkRebuildsPerFrame: 1 };
export const CLEAR_COLOR = 0x9fc5e8;

/** Layer for meshes that are drawn but never picked (implicit-H studs, 06 §12.3). The pick raycasters use layer 0. */
export const LAYER_NO_PICK = 1;

/** Runtime low-graphics rule (06 §11.1): after this many rendered frames, a mean frame time above SLOW_FRAME_MS downgrades. */
export const TIMING_CHECK_FRAMES = 120;
export const SLOW_FRAME_MS = 22;

/** The events this module emits; they live in `GameEvents` (src/app/events.ts) since the integration contracts revision. */
export type GfxEvents = Pick<GameEvents, 'gfx:context' | 'gfx:changed'>;
export type GfxEmitter = Emitter<GameEvents>;

// ---------------------------------------------------------------------------
// Low-graphics start-up heuristic (06 §11.1)
// ---------------------------------------------------------------------------

/** Unmasked GPU renderer string from a throw-away WebGL context, or '' when unavailable. */
export function unmaskedRendererString(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return name;
  } catch {
    return '';
  }
}

/** true when the environment is likely too slow for the normal profile. */
export function detectLowGfx(): boolean {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  } catch { /* matchMedia unavailable: ignore */ }
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  if (typeof cores === 'number' && cores <= 4) return true;
  if (typeof navigator !== 'undefined' && /CrOS/.test(navigator.userAgent)) return true;
  const renderer = unmaskedRendererString();
  return /SwiftShader|llvmpipe/i.test(renderer);
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class Renderer {
  readonly gl: WebGLRenderer;
  readonly scene: Scene;
  profile: GfxProfile;
  contextLost = false;
  /** Set by the ResizeObserver; `render()` applies it (at most once per frame). Game may also call resizeNow() itself. */
  resizePending = true;
  /** Antialias is fixed at construction (changing it needs a reload, 06 §16.5). */
  readonly antialias: boolean;
  readonly canvas: HTMLCanvasElement;
  readonly stage: HTMLElement;
  private readonly emitter: GfxEmitter;
  private readonly fog: Fog;
  private camera: PerspectiveCamera | null = null;
  private observer: ResizeObserver | null = null;
  private readonly restoreHooks = new Set<() => void>();
  private timingFrames = 0;
  private timingSum = 0;
  private timingDone = false;
  private readonly onLost: (e: Event) => void;
  private readonly onRestored: () => void;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, stage: HTMLElement, lowGfx: boolean, emitter: GfxEmitter) {
    this.canvas = canvas;
    this.stage = stage;
    this.emitter = emitter;
    this.profile = lowGfx ? GFX_LOW : GFX_NORMAL;
    this.antialias = !lowGfx;
    // Throws when WebGL is unavailable; main.ts shows the no-WebGL message.
    this.gl = new WebGLRenderer({
      canvas,
      antialias: this.antialias,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
    // outputColorSpace stays at its default (SRGBColorSpace).
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.profile.maxPixelRatio));
    this.gl.setClearColor(CLEAR_COLOR, 1);
    setMaxAnisotropy(this.gl.capabilities.getMaxAnisotropy());

    this.scene = new Scene();
    this.scene.background = new Color(CLEAR_COLOR);
    this.fog = new Fog(CLEAR_COLOR, this.profile.fogNear, this.profile.fogFar);
    this.scene.fog = this.fog;

    this.onLost = (e: Event): void => {
      e.preventDefault();
      this.contextLost = true;
      this.emitter.emit('gfx:context', { state: 'lost' });
    };
    this.onRestored = (): void => {
      this.contextLost = false;
      for (const fn of Array.from(this.restoreHooks)) {
        try {
          fn();
        } catch (err) {
          console.error('[render] context-restore hook threw', err);
        }
      }
      this.resizePending = true;
      this.emitter.emit('gfx:context', { state: 'restored' });
    };
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);

    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        this.resizePending = true;
      });
      this.observer.observe(stage);
    }
    window.addEventListener('resize', this.onWindowResize);
  }

  private readonly onWindowResize = (): void => {
    this.resizePending = true;
  };

  /** Registers the camera whose aspect / far plane this renderer maintains. `render(camera)` does this automatically. */
  attachCamera(camera: PerspectiveCamera): void {
    if (this.camera === camera) return;
    this.camera = camera;
    camera.far = this.profile.cameraFar;
    camera.updateProjectionMatrix();
    if (!camera.layers.isEnabled(LAYER_NO_PICK)) camera.layers.enable(LAYER_NO_PICK);
    this.resizePending = true;
  }

  /** Registers a function run after `webglcontextrestored` (renderers rebuild their GPU state). Returns the unsubscribe. */
  onContextRestored(fn: () => void): () => void {
    this.restoreHooks.add(fn);
    return () => {
      this.restoreHooks.delete(fn);
    };
  }

  /** Applies pixel ratio, fog and camera far; `antialias` needs a reload. Emits nothing (callers emit 'gfx:changed'). */
  applyProfile(p: GfxProfile): void {
    this.profile = p;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.maxPixelRatio));
    this.fog.near = p.fogNear;
    this.fog.far = p.fogFar;
    if (this.camera) {
      this.camera.far = p.cameraFar;
      this.camera.updateProjectionMatrix();
    }
    this.resizePending = true;
  }

  /** Switches to the low profile and emits 'gfx:changed'. No-op when already low. Returns true when it changed. */
  setLowGraphics(on: boolean): boolean {
    const target = on ? GFX_LOW : GFX_NORMAL;
    if (this.profile === target) return false;
    this.applyProfile(target);
    this.emitter.emit('gfx:changed', { lowGfx: on, pixelRatio: this.gl.getPixelRatio(), antialias: this.antialias });
    return true;
  }

  get lowGfx(): boolean {
    return this.profile === GFX_LOW;
  }

  get pixelRatio(): number {
    return this.gl.getPixelRatio();
  }

  /** Sizes the drawing buffer to the stage (never window.innerWidth/innerHeight, 06 §11.4). Returns the size used. */
  resizeNow(): { width: number; height: number } {
    this.resizePending = false;
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.profile.maxPixelRatio));
    this.gl.setSize(w, h, false);
    if (this.camera) {
      const aspect = w / h;
      if (this.camera.aspect !== aspect) {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
      }
    }
    return { width: w, height: h };
  }

  /** Renders the scene; applies a pending resize first; skips while the context is lost. */
  render(camera: PerspectiveCamera): void {
    if (this.disposed) return;
    if (this.camera !== camera) this.attachCamera(camera);
    if (this.resizePending) this.resizeNow();
    if (this.contextLost) return;
    this.gl.render(this.scene, camera);
  }

  stats(): { triangles: number; calls: number } {
    const r = this.gl.info.render;
    return { triangles: r.triangles, calls: r.calls };
  }

  /**
   * Runtime low-graphics rule: feed every frame's dt (seconds). After
   * TIMING_CHECK_FRAMES frames on the normal profile, a mean frame time above
   * SLOW_FRAME_MS switches to GFX_LOW (pixel ratio, fog, far) and emits
   * 'gfx:changed'. Runs once. Returns true on the frame it downgrades.
   */
  timingCheck(dtSeconds: number): boolean {
    if (this.timingDone) return false;
    if (!(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return false;
    this.timingFrames++;
    this.timingSum += dtSeconds * 1000;
    if (this.timingFrames < TIMING_CHECK_FRAMES) return false;
    this.timingDone = true;
    const mean = this.timingSum / this.timingFrames;
    if (mean > SLOW_FRAME_MS && this.profile === GFX_NORMAL) {
      return this.setLowGraphics(true);
    }
    return false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored, false);
    window.removeEventListener('resize', this.onWindowResize);
    this.observer?.disconnect();
    this.observer = null;
    this.restoreHooks.clear();
    this.gl.dispose();
  }
}

// ---------------------------------------------------------------------------
// Shared helpers for the instanced renderers
// ---------------------------------------------------------------------------

/** Centre of cell (x, y, z): (x + 0.5, y + 0.5, z + 0.5). */
export function cellCenter(x: number, y: number, z: number, out = new Vector3()): Vector3 {
  return out.set(x + 0.5, y + 0.5, z + 0.5);
}

export interface InstancedPoolOptions {
  /** false for pick meshes: never drawn, still raycast (the Raycaster ignores `visible`). */
  readonly visible?: boolean;
  /** Sets `layers.set(layer)` (LAYER_NO_PICK for unpickable studs). */
  readonly layer?: number;
  /** Writes an instance colour for every pushed instance (`setColorAt` + needsUpdate). */
  readonly useColor?: boolean;
  readonly renderOrder?: number;
  readonly frustumCulled?: boolean;
  readonly name?: string;
}

/**
 * One InstancedMesh whose capacity doubles on demand (the mesh is recreated and
 * the matrices copied, 06 §13). Usage per update: begin(); push(...)*; end().
 * `end()` sets `count`, flags the attributes and recomputes the bounding sphere
 * (InstancedMesh.raycast and frustum culling read the cached sphere).
 */
export class InstancedPool {
  mesh: InstancedMesh;
  private n = 0;
  private capacity: number;
  private readonly parent: Object3D;
  private readonly geometry: BufferGeometry;
  private readonly material: Material | Material[];
  private readonly opts: InstancedPoolOptions;

  constructor(parent: Object3D, geometry: BufferGeometry, material: Material | Material[], capacity: number, opts: InstancedPoolOptions = {}) {
    this.parent = parent;
    this.geometry = geometry;
    this.material = material;
    this.capacity = Math.max(1, capacity | 0);
    this.opts = opts;
    this.mesh = this.create(this.capacity);
    this.mesh.count = 0;
    this.mesh.computeBoundingSphere();
    parent.add(this.mesh);
  }

  private create(capacity: number): InstancedMesh {
    const m = new InstancedMesh(this.geometry, this.material, capacity);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.matrixAutoUpdate = false;
    m.matrix.identity();
    m.matrixWorld.identity();
    m.visible = this.opts.visible ?? true;
    if (this.opts.layer !== undefined) m.layers.set(this.opts.layer);
    if (this.opts.renderOrder !== undefined) m.renderOrder = this.opts.renderOrder;
    if (this.opts.frustumCulled !== undefined) m.frustumCulled = this.opts.frustumCulled;
    if (this.opts.name) m.name = this.opts.name;
    if (this.opts.useColor) {
      // Allocates instanceColor (all ones) so the attribute exists before the first render.
      m.setColorAt(0, WHITE);
    }
    return m;
  }

  private grow(): void {
    const next = this.create(this.capacity * 2);
    next.instanceMatrix.array.set(this.mesh.instanceMatrix.array.subarray(0, this.n * 16));
    if (this.opts.useColor && this.mesh.instanceColor && next.instanceColor) {
      next.instanceColor.array.set(this.mesh.instanceColor.array.subarray(0, this.n * 3));
    }
    next.visible = this.mesh.visible;
    next.renderOrder = this.mesh.renderOrder;
    next.frustumCulled = this.mesh.frustumCulled;
    next.layers.mask = this.mesh.layers.mask;
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = next;
    this.capacity *= 2;
    this.parent.add(next);
  }

  begin(): void {
    this.n = 0;
  }

  /** Appends one instance; returns its id. `color` is required for pools created with useColor. */
  push(matrix: Matrix4, color?: Color): number {
    if (this.n >= this.capacity) this.grow();
    const id = this.n++;
    this.mesh.setMatrixAt(id, matrix);
    if (this.opts.useColor) this.mesh.setColorAt(id, color ?? WHITE);
    return id;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  get count(): number {
    return this.n;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }

  /** Bounding sphere after the last end() (empty when count is 0). */
  boundingSphere(): Sphere | null {
    return this.mesh.boundingSphere;
  }

  /** Removes the mesh; geometry and material are owned by the caller. */
  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.n = 0;
  }
}

export const WHITE: Color = new Color(1, 1, 1);
