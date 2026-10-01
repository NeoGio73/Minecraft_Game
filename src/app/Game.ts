/**
 * Composition root (DOM/WebGL): renderer, world, player, input, HUD, LMS
 * adapter and the fixed-step frame loop. Wires World -> MoleculeIndex ->
 * extract -> analyze -> State -> panels, the tool actions of 06 §10, the
 * bench flow (04/09 §3.2), locked molecules (06 §10.6), context loss (06 §14.7)
 * and the DebugApi on window.__orgocraft (06 §1, §14.8). docs/design/06-engine.md §14.
 */
import { Raycaster, Vector3 } from 'three';
import type { MoleculeGraph, Vec3, WorldGraph } from '../chem/types';
import { TARGET_VALENCE } from '../chem/types';
import { analyze } from '../chem/analyze';
import { embedOnLattice } from '../chem/embed';
import type { Challenge, ChallengeRule } from '../content/types';
import { loadConfig, loadFullRoster, rosterInfo } from '../content/challenges';
import { entryBySmiles, layoutOf, loadLibrary, parseEntry } from '../content/library';
import { ScormAdapter, browserDeps } from '../lms/ScormAdapter';
import type { ProgressState } from '../lms/types';
import { emptyState } from '../lms/Progress';
import { World } from '../world/world';
import { generate } from '../world/worldgen';
import { extractAll, extractComponentDetailed, suppressedPairsOfComponent } from '../world/extract';
import { validateBondChange, validateChargeChange, validatePlacement } from '../world/molecule-index';
import { raycastVoxels } from '../world/raycast';
import {
  Block, BLOCK_ELEMENTS, ORE_YIELD, PICK_DISTANCE, PLAYER, REFUSAL_TEXT, WORLD_SEED, atomBlockOf, cellIndex, cellKey, elementOf,
  isAtom, isBreakable, isOre, pairKey, parseCellKey, splitPairKey, zoneOf,
} from '../world/types';
import type {
  BlockElement, BondChangeResult, CellKey, ComponentId, PairKey, PlacementContext, PlacementResult, PlayerState, VoxelHit,
  Zone,
} from '../world/types';
import { createPlayer, eyePosition, lookDirection, stepPlayer } from '../player/physics';
import { FirstPersonCamera } from '../player/camera';
import { InputManager } from '../input/InputManager';
import { LookModes } from '../input/look-modes';
import type { LookMode, LookSettings } from '../input/look-modes';
import type { InputAction } from '../input/keymap';
import { Renderer, detectLowGfx } from '../render/Renderer';
import { ChunkRenderer } from '../render/ChunkRenderer';
import { AtomRenderer } from '../render/AtomRenderer';
import type { HydrogenMode } from '../render/AtomRenderer';
import { BondRenderer } from '../render/BondRenderer';
import { GhostRenderer } from '../render/GhostRenderer';
import { Highlight } from '../render/Highlight';
import { StereoOverlay, warnPairsOf } from '../render/StereoOverlay';
import { createElementTextures, markTexturesNeedUpdate } from '../render/element-texture';
import { addLights } from '../render/lights';
import { mountHud } from '../ui/hud';
import type { Hud, RenderHooks } from '../ui/hud';
import { ENGINE_TEXT, STRINGS } from '../ui/strings';
import { effectiveKeys, loadInventory, loadSettings, reducedMotionActive, saveSettings, wasStored } from './Settings';
import type { Settings } from './Settings';
import type { Emitter, GameEvents, HoverInfo } from './events';
import {
  HOTBAR, LOCKED_ORIGINS, PRODUCT_MIN, REACTANT_MAX, REACTANT_MIN, State, lockedCells,
} from './State';
import type { HotbarTool, LockedPlacement, UiState } from './State';
import { Interval, RollingMean } from '../util/throttle';

// ---------------------------------------------------------------------------
// Contract additions declared here (06 §1)
// ---------------------------------------------------------------------------

export type Tool =
  | { readonly kind: 'atom'; readonly el: BlockElement }
  | { readonly kind: 'bond' }
  | { readonly kind: 'charge' }
  | { readonly kind: 'select' };

export function toolOf(entry: BlockElement | HotbarTool): Tool {
  if (entry === 'bond-wand') return { kind: 'bond' };
  if (entry === 'charge-tool') return { kind: 'charge' };
  if (entry === 'select-tool') return { kind: 'select' };
  return { kind: 'atom', el: entry };
}

export interface DebugApi {
  readonly version: string;
  frames: number;
  triangles: number;
  calls: number;
  lookMode: LookMode;
  lowGfx: boolean;
  pixelRatio: number;
  /** true once the first frame rendered (the smoke test waits for it together with `frames`). */
  ready: boolean;
  readonly events: Emitter<GameEvents>;
  getBlock(x: number, y: number, z: number): number;
  // present only when location.search contains debug=1
  teleport?(x: number, y: number, z: number, yaw?: number, pitch?: number): void;
  setBlock?(x: number, y: number, z: number, id: number): void;
  place?(x: number, y: number, z: number, el: BlockElement): PlacementResult;
  wand?(pair: PairKey): BondChangeResult;
  goToChallenge?(id: string): void;
  press?(action: InputAction): void;
  state?(): UiState;
}

declare global {
  interface Window { __orgocraft?: DebugApi }
}

export interface GameOptions {
  readonly stage: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** `?debug=1`: exposes the scripting hooks and starts with a stocked inventory. */
  readonly debug: boolean;
}

/** Analysis time budget per frame (06 §14.2). */
export const ANALYSIS_BUDGET_MS = 4;
/** Nearest-component targeting radius (06 §10.3). */
export const TARGET_RADIUS = 8;
/** Inventory per element when started with ?debug=1 (the smoke test places atoms without mining). */
export const DEBUG_INVENTORY = 99;
/**
 * A bond bar wins over the voxel hit when its pick box is at most this far behind the cell face the ray
 * entered (06 §10.2 says 0.2, but a 0.3-wide pick box centred on the cell boundary starts 0.35 behind the
 * face, so 0.2 could never select a bar between two atoms; 0.6 covers an oblique approach too).
 */
export const BOND_PICK_MARGIN = 0.6;
/** Debug overlay refresh. */
export const DEBUG_REFRESH_MS = 250;

const NO_HOVER: HoverInfo = { kind: 'none' };

function copyPlayer(p: PlayerState): PlayerState {
  return { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, yaw: p.yaw, pitch: p.pitch, onGround: p.onGround };
}

function sameHover(a: HoverInfo, b: HoverInfo): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'none':
    case 'bench':
      return true;
    case 'block': {
      const o = b as Extract<HoverInfo, { kind: 'block' }>;
      return a.x === o.x && a.y === o.y && a.z === o.z && a.id === o.id && a.face[0] === o.face[0] && a.face[1] === o.face[1] && a.face[2] === o.face[2];
    }
    case 'atom': {
      const o = b as Extract<HoverInfo, { kind: 'atom' }>;
      return a.cell === o.cell && a.charge === o.charge && a.bonds === o.bonds && a.hydrogens === o.hydrogens && a.component === o.component
        && a.face[0] === o.face[0] && a.face[1] === o.face[1] && a.face[2] === o.face[2];
    }
    case 'hydrogen': {
      const o = b as Extract<HoverInfo, { kind: 'hydrogen' }>;
      return a.cell === o.cell && a.slot === o.slot && a.explicit === o.explicit;
    }
    case 'bond': {
      const o = b as Extract<HoverInfo, { kind: 'bond' }>;
      return a.pair === o.pair && a.order === o.order;
    }
    default:
      return false;
  }
}

function isBlockElement(el: string): el is BlockElement {
  return (BLOCK_ELEMENTS as readonly string[]).includes(el);
}

function lookSettingsOf(s: Settings): LookSettings {
  return { sensitivity: s.sensitivity, invertY: s.invertY, turnRateYaw: s.turnRate, turnRatePitch: 0.6 * s.turnRate };
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

export class Game {
  readonly state: State;
  readonly world: World;
  readonly renderer: Renderer;
  readonly adapter: ScormAdapter;
  readonly debugApi: DebugApi;
  private readonly stage: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly debug: boolean;
  private readonly events: Emitter<GameEvents>;
  private settings: Settings;
  private settingsStale = false;
  private readonly player: PlayerState;
  private prev: PlayerState;
  private readonly camera: FirstPersonCamera;
  private readonly input: InputManager;
  private readonly look: LookModes;
  private readonly chunks: ChunkRenderer;
  private readonly atoms: AtomRenderer;
  private readonly bonds: BondRenderer;
  private readonly ghost: GhostRenderer;
  private readonly highlight: Highlight;
  private readonly stereo: StereoOverlay;
  private hud: Hud | null = null;
  private readonly raycaster = new Raycaster();
  private readonly tmpOrigin = new Vector3();
  private readonly tmpDir = new Vector3();

  private raf = 0;
  private last = 0;
  private acc = 0;
  private frames = 0;
  private sceneDirty = true;
  private hover: HoverInfo = NO_HOVER;
  private voxelHit: VoxelHit | null = null;
  private seenVersion = -1;
  private readonly analysisSig = new Map<ComponentId, string>();
  private readonly queue = new Set<ComponentId>();
  private hydrogenMode: HydrogenMode = 'studs';
  private reducedMotion = false;
  private selectedCells: readonly CellKey[] = [];
  private selectedHydrogens: readonly { cell: CellKey; slot: number }[] = [];
  private lockedZones: readonly Zone[] = [];
  private lastBench: unknown = null;
  private debugVisible = false;
  private readonly debugTick = new Interval(DEBUG_REFRESH_MS);
  private readonly frameMs = new RollingMean(60);
  private disposed = false;

  constructor(opts: GameOptions) {
    this.stage = opts.stage;
    this.canvas = opts.canvas;
    this.debug = opts.debug;

    // 1. content, state, adapter
    const config = loadConfig();
    const fullRoster = loadFullRoster();
    const info = rosterInfo(fullRoster, config);
    loadLibrary();
    const storedInventory = loadInventory();
    const inventory: Partial<Record<BlockElement, number>> = {};
    for (const el of BLOCK_ELEMENTS) {
      if (el === 'H') continue;
      inventory[el] = opts.debug ? DEBUG_INVENTORY : storedInventory?.[el] ?? 0;
    }
    let adapter: ScormAdapter | null = null;
    const sink = {
      update: (s: ProgressState): void => adapter?.update(s),
      milestone: (s: ProgressState): ProgressState => (adapter ? adapter.milestone(s) : s),
      save: (): void => {
        if (!adapter) return;
        if (adapter.mode === 'lms') adapter.flush();
        else adapter.commit();
      },
      saveAndExit: (): Promise<void> => (adapter ? adapter.saveAndExit() : Promise.resolve()),
    };
    this.state = new State({
      fullRoster, rosterInfo: info, config, progress: emptyState(''), mode: 'discovering', studentId: null, sink, inventory,
    });
    this.events = this.state.events;
    adapter = new ScormAdapter(browserDeps(info, this.events));
    this.adapter = adapter;

    // 2. settings and renderer (throws without WebGL: main.ts shows the message)
    this.settings = loadSettings();
    const lowGfx = wasStored('lowGraphics') ? this.settings.lowGraphics : detectLowGfx();
    this.renderer = new Renderer(this.canvas, this.stage, lowGfx, this.events);

    // 3. world, player, camera, input
    this.world = new World();
    generate(this.world, WORLD_SEED);
    this.player = createPlayer();
    this.prev = copyPlayer(this.player);
    this.camera = new FirstPersonCamera();
    this.renderer.attachCamera(this.camera.camera);
    this.input = new InputManager(this.canvas, () => effectiveKeys(this.settings), this.events);
    this.look = new LookModes(this.canvas, this.input, this.events, () => lookSettingsOf(this.settings));

    // 4. renderers
    const scene = this.renderer.scene;
    const textures = createElementTextures();
    this.chunks = new ChunkRenderer(scene, this.world);
    this.atoms = new AtomRenderer(scene, textures);
    this.bonds = new BondRenderer(scene);
    this.ghost = new GhostRenderer(scene, textures);
    this.highlight = new Highlight(scene);
    this.stereo = new StereoOverlay(scene);
    addLights(scene);
    this.chunks.markAllDirty();
    this.renderer.onContextRestored(() => {
      this.chunks.markAllDirty();
      markTexturesNeedUpdate();
      this.sceneDirty = true;
      this.last = performance.now();
    });

    // 5. engine hooks and subscriptions (before the HUD mounts, so locked molecules exist when panels refresh)
    this.state.attachEngine({ molecules: (zone) => this.moleculesOf(zone), clearZone: (zone) => this.clearZone(zone) });
    this.reducedMotion = reducedMotionActive(this.settings);
    this.subscribe();

    // 6. debug api
    this.debugApi = this.makeDebugApi(config.version);
    window.__orgocraft = this.debugApi;
  }

  /** Mounts the HUD, places the first challenge, starts the adapter and the frame loop. */
  start(): void {
    this.hud = mountHud(this.stage, this.state, this.hooks(), this.settings);
    this.onChallengeChanged();
    this.events.emit('world:ready', { seed: WORLD_SEED });
    void this.adapter.start().then((mode) => {
      if (this.disposed) return;
      const resumed = this.adapter.state;
      this.state.setLms(mode, this.adapter.studentId, resumed);
      const bookmark = this.state.roster.findIndex((c) => c.id === resumed.currentChallengeId);
      if (bookmark >= 0 && bookmark !== this.state.current.index) this.state.setChallenge(bookmark);
    });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.hud?.dispose();
    this.look.dispose();
    this.input.dispose();
    this.adapter.dispose();
    this.chunks.dispose();
    this.atoms.dispose();
    this.bonds.dispose();
    this.ghost.dispose();
    this.highlight.dispose();
    this.stereo.dispose();
    this.renderer.dispose();
    if (window.__orgocraft === this.debugApi) delete window.__orgocraft;
  }

  // ---------------------------------------------------------------------------
  // Frame loop (06 §14.2)
  // ---------------------------------------------------------------------------

  private readonly frame = (tNow: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const hud = this.hud;
    if (!hud) return;
    if (this.settingsStale) {
      this.settingsStale = false;
      this.settings = loadSettings();
      this.reducedMotion = reducedMotionActive(this.settings);
      this.sceneDirty = true;
    }
    hud.tick(tNow);
    if (document.hidden || this.renderer.contextLost) {
      this.last = tNow;
      return;
    }
    const dt = Math.min(Math.max(0, (tNow - this.last) / 1000), PLAYER.maxFrameDt);
    this.last = tNow;
    this.frameMs.push(dt * 1000);
    const inp = this.input.consumeFrame();
    const paused = this.state.paused;
    let deferred: readonly InputAction[] = [];
    if (!paused) {
      deferred = this.handlePressed(inp.pressed, inp.wheel);
      const s = this.settings;
      this.camera.addLook(inp.lookDX * s.sensitivity, inp.lookDY * s.sensitivity * (s.invertY ? -1 : 1));
      this.camera.addLook(-inp.keyLook.yaw * s.turnRate * dt, -inp.keyLook.pitch * 0.6 * s.turnRate * dt);
      this.player.yaw = this.camera.yaw;
      this.player.pitch = this.camera.pitch;
      this.acc += dt;
      let stepped = false;
      while (this.acc >= PLAYER.fixedDt) {
        this.prev = copyPlayer(this.player);
        stepPlayer(this.player, inp.move, PLAYER.fixedDt, this.world.isSolid);
        this.acc -= PLAYER.fixedDt;
        stepped = true;
      }
      if (!stepped) this.prev = copyPlayer(this.prev);
      const moving = inp.move.forward !== 0 || inp.move.strafe !== 0;
      this.camera.setSprinting(inp.move.sprint && moving, this.reducedMotion, dt);
    }
    this.camera.setFromPlayer(this.player, this.prev, Math.min(1, this.acc / PLAYER.fixedDt));
    this.state.setPlayer(this.player.x, this.player.y, this.player.z, this.camera.yaw);
    const hover = this.resolveHover();
    if (!sameHover(hover, this.hover)) {
      this.hover = hover;
      this.sceneDirty = true;
      this.events.emit('hover:changed', { hover });
    }
    if (!paused) this.applyActions(inp.pressed);
    this.updateTarget();
    this.syncComponents();
    this.runAnalyses(ANALYSIS_BUDGET_MS);
    if (deferred.length > 0) this.handleTargetActions(deferred);
    this.syncBench();
    this.chunks.rebuildDirty(this.world, this.player, this.renderer.profile.chunkRebuildsPerFrame);
    if (this.sceneDirty) {
      this.sceneDirty = false;
      this.redrawScene();
    }
    this.highlight.tick(tNow);
    this.ghost.tick(dt, this.reducedMotion);
    this.renderer.render(this.camera.camera);
    this.frames++;
    const stats = this.renderer.stats();
    const api = this.debugApi;
    api.frames = this.frames;
    api.triangles = stats.triangles;
    api.calls = stats.calls;
    api.lookMode = this.look.mode;
    api.lowGfx = this.renderer.lowGfx;
    api.pixelRatio = this.renderer.pixelRatio;
    api.ready = true;
    if (this.renderer.timingCheck(dt)) this.camera.setFar(this.renderer.profile.cameraFar);
    if (this.debugVisible && this.debugTick.due(tNow)) this.refreshDebugOverlay();
  };

  private redrawScene(): void {
    const index = this.world.index;
    const t = this.state.target;
    const dim = new Set<CellKey>();
    for (const lp of this.state.locked) {
      if (lp.zone !== 'reactant') continue;
      for (const c of lp.cellToAtom.keys()) dim.add(c);
      for (const list of lp.hCells.values()) for (const c of list) dim.add(c);
    }
    this.atoms.update(index, { hydrogenMode: this.hydrogenMode, dimCells: dim }, this.world.getBlock);
    const tool = this.tool();
    this.bonds.update(index, warnPairsOf(t.analysis?.stereo, t.atomToCell), tool.kind === 'bond');
    this.highlight.update(index, this.world.getBlock, {
      hover: this.hover,
      targetCells: t.atomToCell,
      selectedCells: this.selectedCells,
      selectedHydrogens: this.selectedHydrogens,
      reducedMotion: this.reducedMotion,
    });
    this.stereo.update(t.analysis ? { analysis: t.analysis, atomToCell: t.atomToCell } : null);
  }

  private tool(): Tool {
    return toolOf(HOTBAR[this.state.slot] ?? 'C');
  }

  // ---------------------------------------------------------------------------
  // Hover and target (06 §10.2, §10.3)
  // ---------------------------------------------------------------------------

  private eyeAndDir(): { eye: [number, number, number]; dir: [number, number, number] } {
    return { eye: eyePosition(this.player), dir: lookDirection(this.camera.yaw, this.camera.pitch) };
  }

  private resolveHover(): HoverInfo {
    const { eye, dir } = this.eyeAndDir();
    const vh = raycastVoxels(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], PICK_DISTANCE, this.world.getBlock);
    this.voxelHit = vh;
    const index = this.world.index;
    const tool = this.tool();
    const selectMode = tool.kind === 'select' || (this.hud?.select.active ?? false);
    if (tool.kind === 'bond') {
      const hit = this.pick(this.bonds.pickMesh, eye, dir);
      if (hit && (!vh || hit.distance < vh.t + BOND_PICK_MARGIN)) {
        const pair = this.bonds.pairOf(hit.instanceId);
        if (pair) return { kind: 'bond', pair, order: index.wandOrder(pair) ?? 1 };
      }
    }
    if (selectMode && this.atoms.hydrogenMode !== 'studs') {
      const hit = this.pick(this.atoms.hydrogenMesh, eye, dir);
      if (hit && (!vh || hit.distance < vh.t)) {
        const ref = this.atoms.hydrogenOf(hit.instanceId);
        if (ref) return { kind: 'hydrogen', cell: ref.cell, slot: ref.slot, explicit: false };
      }
    }
    if (!vh) return NO_HOVER;
    const face: readonly [number, number, number] = [vh.nx, vh.ny, vh.nz];
    if (vh.id === Block.Bench) return { kind: 'bench' };
    if (isAtom(vh.id)) {
      const cell = cellKey(vh.x, vh.y, vh.z);
      const atom = index.atoms.get(cell);
      if (!atom) return { kind: 'block', x: vh.x, y: vh.y, z: vh.z, id: vh.id, face };
      if (atom.el === 'H') {
        const parent = index.neighbours(cell).filter((n) => n.el !== 'H').sort((p, q) => cellIndex(p.x, p.y, p.z) - cellIndex(q.x, q.y, q.z))[0];
        if (parent) {
          const hs = index.neighbours(parent.key).filter((n) => n.el === 'H').sort((p, q) => cellIndex(p.x, p.y, p.z) - cellIndex(q.x, q.y, q.z));
          return { kind: 'hydrogen', cell: parent.key, slot: Math.max(0, hs.findIndex((h) => h.key === cell)), explicit: true };
        }
      }
      const tv = TARGET_VALENCE[atom.el][atom.charge] ?? 0;
      return {
        kind: 'atom', cell, el: atom.el, charge: atom.charge, bonds: index.bondsOf(cell).length,
        hydrogens: Math.max(0, tv - index.bondOrderSum(cell)), component: index.componentOf(cell), face,
      };
    }
    return { kind: 'block', x: vh.x, y: vh.y, z: vh.z, id: vh.id, face };
  }

  private pick(mesh: import('three').Object3D, eye: readonly number[], dir: readonly number[]): { distance: number; instanceId: number } | null {
    this.tmpOrigin.set(eye[0] ?? 0, eye[1] ?? 0, eye[2] ?? 0);
    this.tmpDir.set(dir[0] ?? 0, dir[1] ?? 0, dir[2] ?? -1);
    this.raycaster.set(this.tmpOrigin, this.tmpDir);
    this.raycaster.near = 0;
    this.raycaster.far = PICK_DISTANCE;
    const hits = this.raycaster.intersectObject(mesh, false);
    for (const h of hits) {
      if (h.instanceId === undefined) continue;
      if (h.distance <= PICK_DISTANCE) return { distance: h.distance, instanceId: h.instanceId };
    }
    return null;
  }

  private updateTarget(): void {
    const index = this.world.index;
    const h = this.hover;
    let component: ComponentId | null = null;
    let cell: CellKey | null = null;
    let pair: PairKey | null = null;
    if (h.kind === 'atom') {
      component = h.component;
      cell = h.cell;
    } else if (h.kind === 'hydrogen' && index.atoms.has(h.cell)) {
      component = index.componentOf(h.cell);
    } else {
      if (h.kind === 'bond') {
        pair = h.pair;
        // 09 §1.10, §5.5: a bond bar or break marker is targeted through the molecule that contains the pair -- the
        // previous target when it holds either endpoint (a suppressed pair may join two components), otherwise the
        // lower-cellIndex endpoint's component -- never a nearer, unrelated molecule.
        const [a, b] = splitPairKey(h.pair);
        const ca = index.atoms.has(a) ? index.componentOf(a) : null;
        const cb = index.atoms.has(b) ? index.componentOf(b) : null;
        const prev = this.state.target.component;
        component = prev !== null && (prev === ca || prev === cb) ? prev : (ca ?? cb);
      }
      if (component === null) {
        const { eye } = this.eyeAndDir();
        let best = TARGET_RADIUS * TARGET_RADIUS;
        let bestId: ComponentId | null = null;
        for (const [id, cells] of index.components()) {
          for (const c of cells) {
            const [x, y, z] = parseCellKey(c);
            const dx = x + 0.5 - eye[0];
            const dy = y + 0.5 - eye[1];
            const dz = z + 0.5 - eye[2];
            const d = dx * dx + dy * dy + dz * dz;
            if (d < best || (d === best && bestId !== null && id < bestId)) {
              best = d;
              bestId = id;
            }
          }
        }
        if (bestId !== null) component = bestId;
        else {
          const prev = this.state.target.component;
          component = prev !== null && index.components().has(prev) ? prev : null;
        }
      }
    }
    this.state.setTarget(component, cell, pair);
  }

  // ---------------------------------------------------------------------------
  // World edits -> components -> analyses (06 §14.3, §14.4)
  // ---------------------------------------------------------------------------

  private syncComponents(): void {
    const world = this.world;
    if (world.editVersion === this.seenVersion) return;
    world.drainEdits();
    const index = world.index;
    const comps = index.components();
    const live = new Set<ComponentId>();
    for (const [id, cells] of comps) {
      live.add(id);
      const sig = cells.join(';') + '#' + cells.map((c) => index.bondsOf(c).map((b) => `${b.key}:${b.order}`).join(',')).join('|')
        + '#' + cells.map((c) => index.atoms.get(c)?.charge ?? 0).join(',');
      if (this.analysisSig.get(id) !== sig) {
        this.analysisSig.set(id, sig);
        this.queue.add(id);
      }
    }
    for (const id of Array.from(this.analysisSig.keys())) if (!live.has(id)) { this.analysisSig.delete(id); this.queue.delete(id); }
    this.state.pruneAnalyses(live);
    this.seenVersion = world.editVersion;
    this.sceneDirty = true;
  }

  private runAnalyses(budgetMs: number): void {
    if (this.queue.size === 0) return;
    const t0 = performance.now();
    while (this.queue.size > 0 && performance.now() - t0 < budgetMs) {
      const target = this.state.target.component;
      let id: ComponentId;
      if (target !== null && this.queue.has(target)) id = target;
      else id = Math.min(...this.queue);
      this.queue.delete(id);
      this.runOne(id);
    }
  }

  private runOne(id: ComponentId): void {
    const index = this.world.index;
    if (!index.components().has(id)) return;
    let detail;
    try {
      detail = extractComponentDetailed(index, id);
    } catch {
      return; // a component without a heavy atom (orphan H)
    }
    const analysis = analyze(detail.graph, detail.warnings);
    this.state.setAnalysis(id, analysis, detail.zone, suppressedPairsOfComponent(index, id), { cells: detail.cells, hCells: detail.hCells });
    this.sceneDirty = true;
  }

  private moleculesOf(zone: Zone): readonly { readonly component: ComponentId; readonly graph: WorldGraph }[] {
    return extractAll(this.world.index, zone).components.map((c) => ({ component: c.id, graph: c.graph }));
  }

  // ---------------------------------------------------------------------------
  // Actions (06 §10.4)
  // ---------------------------------------------------------------------------

  private placementContext(): PlacementContext {
    return { getBlock: this.world.getBlock, inventory: this.state.inventory, player: this.player, lockedZones: this.lockedZones };
  }

  private refuse(x: number, y: number, z: number, message: string): void {
    this.events.emit('block:refused', { x, y, z, message });
    this.highlight.flashRefusal();
  }

  /**
   * Every pressed action except mine/place (06 §10.4: those run against the fresh hover in applyActions) and the
   * two target-dependent ones, `analyze` and `submit`, which are returned and run by handleTargetActions once this
   * frame's hover, target, components and analyses are refreshed.
   */
  private handlePressed(pressed: readonly InputAction[], wheel: number): InputAction[] {
    const deferred: InputAction[] = [];
    const hud = this.hud;
    if (!hud) return deferred;
    const state = this.state;
    for (const a of pressed) {
      if (state.finished && a !== 'pause' && a !== 'help' && a !== 'debug') continue;
      switch (a) {
        case 'slot1': case 'slot2': case 'slot3': case 'slot4': case 'slot5': case 'slot6': case 'slot7': case 'slot8': case 'slot9':
          state.selectSlot(Number(a.slice(4)) - 1);
          break;
        case 'bondWand': state.selectSlot(9); break;
        case 'chargeTool': state.selectSlot(10); break;
        case 'selectTool': state.selectSlot(11); break;
        case 'slotPrev': if (!hud.handleAction(a)) state.cycleSlot(-1); break;
        case 'slotNext': if (!hud.handleAction(a)) state.cycleSlot(1); break;
        case 'toggleHydrogens':
          if (!hud.select.forcesHydrogens()) {
            const next = { ...this.settings, showHydrogens: !this.settings.showHydrogens };
            saveSettings(next);
            this.settings = next;
            this.events.emit('settings:changed', { key: 'showHydrogens', value: next.showHydrogens });
          }
          break;
        case 'analyze': case 'submit': deferred.push(a); break;
        case 'nextChallenge': state.nextChallenge(); break;
        case 'prevChallenge': state.prevChallenge(); break;
        case 'clearSelection': state.clearSelection(); break;
        case 'hint': case 'roster': case 'help': case 'bench': hud.handleAction(a); break;
        case 'pause': state.setPaused(true); hud.handleAction('pause'); break;
        case 'debug': this.toggleDebugOverlay(); break;
        default: break; // mine / place run against the fresh hover in applyActions
      }
    }
    if (wheel !== 0) {
      const step = wheel > 0 ? 1 : -1;
      for (let i = 0; i < Math.abs(wheel); i++) {
        if (hud.select.active) hud.select.cycle(step);
        else state.cycleSlot(step);
      }
    }
    return deferred;
  }

  /**
   * `analyze` (F) and `submit` (Enter) judge the molecule the player is looking at in THIS frame: they run after
   * updateTarget / syncComponents / runAnalyses, never against the previous frame's target. Otherwise a target that
   * changed between frames (the player moved, the world was edited -- e.g. through the debug API) is evaluated one
   * frame stale; after a bench challenge that submitted the product-zone molecule to a pad challenge and answered
   * "nothing targeted". The panel's Submit button calls state.submit() directly (06 §14.5) and is unaffected.
   */
  private handleTargetActions(pressed: readonly InputAction[]): void {
    const state = this.state;
    for (const a of pressed) {
      if (a === 'analyze') {
        const t = state.target.component;
        if (t !== null) { this.queue.delete(t); this.runOne(t); }
        this.events.emit('analyze:requested', { component: t });
      } else if (a === 'submit') {
        state.submit();
      }
    }
  }

  private applyActions(pressed: readonly InputAction[]): void {
    for (const a of pressed) {
      if (a === 'mine') this.doMine();
      else if (a === 'place') this.doPlace();
    }
  }

  private isLockedCell(cell: CellKey): boolean {
    return lockedCells(this.state).has(cell);
  }

  private doMine(): void {
    if (this.state.finished) return;
    const h = this.hover;
    const tool = this.tool();
    const hud = this.hud;
    if (hud?.select.active) return;
    switch (tool.kind) {
      case 'atom': {
        if (h.kind === 'block') {
          if (!isBreakable(h.id)) return;
          this.world.setBlock(h.x, h.y, h.z, Block.Air);
          const el = elementOf(h.id);
          if (isOre(h.id) && el && el !== 'H') {
            this.state.addInventory(el, ORE_YIELD);
            this.state.announce(ENGINE_TEXT.mined(el, ORE_YIELD), 'polite');
          } else {
            this.state.announce(ENGINE_TEXT.mineNoYield, 'polite');
          }
          this.events.emit('block:removed', { x: h.x, y: h.y, z: h.z, id: h.id, zone: zoneOf(h.x, h.y, h.z) });
        } else if (h.kind === 'atom' || (h.kind === 'hydrogen' && h.explicit)) {
          const cell = h.kind === 'atom' ? h.cell : this.explicitHCellOf(h.cell, h.slot);
          if (!cell) return;
          this.removeAtomCell(cell);
        }
        return;
      }
      case 'bond':
        if (h.kind === 'bond') this.state.announce(ENGINE_TEXT.bondWandPrimary, 'polite');
        return;
      case 'charge':
        if (h.kind === 'atom') this.cycleCharge(h.cell, false);
        else if (h.kind === 'hydrogen') this.refuseAt(h.cell, REFUSAL_TEXT.chargeUnsupported('H', 1));
        else this.state.announce(ENGINE_TEXT.noAtomHere, 'polite');
        return;
      case 'select':
        this.selectHovered();
        return;
      default:
        return;
    }
  }

  private doPlace(): void {
    if (this.state.finished) return;
    const h = this.hover;
    const hud = this.hud;
    if (hud?.select.active && hud.handleAction('place')) return;
    if (h.kind === 'bench') {
      this.events.emit('bench:open', {});
      return;
    }
    const tool = this.tool();
    switch (tool.kind) {
      case 'atom': {
        const vh = this.voxelHit;
        if (!vh || h.kind === 'none') return;
        if (vh.nx === 0 && vh.ny === 0 && vh.nz === 0) return;
        this.placeAtom(vh.x + vh.nx, vh.y + vh.ny, vh.z + vh.nz, tool.el);
        return;
      }
      case 'bond':
        if (h.kind === 'bond') this.applyWand(h.pair);
        else this.state.announce(ENGINE_TEXT.noBondHere, 'polite');
        return;
      case 'charge':
        if (h.kind === 'atom') this.cycleCharge(h.cell, true);
        else if (h.kind === 'hydrogen') this.refuseAt(h.cell, REFUSAL_TEXT.chargeUnsupported('H', 1));
        else this.state.announce(ENGINE_TEXT.noAtomHere, 'polite');
        return;
      case 'select':
        this.selectHovered();
        return;
      default:
        return;
    }
  }

  private refuseAt(cell: CellKey, message: string): void {
    const [x, y, z] = parseCellKey(cell);
    this.refuse(x, y, z, message);
  }

  /** The k-th explicit H block of `parent` (ascending cellIndex). */
  private explicitHCellOf(parent: CellKey, slot: number): CellKey | null {
    const hs = this.world.index.neighbours(parent).filter((n) => n.el === 'H').sort((p, q) => cellIndex(p.x, p.y, p.z) - cellIndex(q.x, q.y, q.z));
    return hs[slot]?.key ?? null;
  }

  private placeAtom(x: number, y: number, z: number, el: BlockElement): PlacementResult {
    const index = this.world.index;
    const r = validatePlacement(index, x, y, z, el, this.placementContext());
    if (!r.ok) {
      this.refuse(x, y, z, r.message);
      return r;
    }
    for (const p of r.newBonds) {
      const [a, b] = splitPairKey(p);
      if (this.isLockedCell(a) || this.isLockedCell(b)) {
        this.refuse(x, y, z, ENGINE_TEXT.lockedMolecule);
        return { ok: false, refusal: { reason: 'locked-zone', zone: zoneOf(x, y, z) }, message: ENGINE_TEXT.lockedMolecule };
      }
    }
    const id = atomBlockOf(el);
    this.world.setBlock(x, y, z, id);
    this.state.addInventory(el, -1);
    this.events.emit('block:placed', { x, y, z, id, el, zone: zoneOf(x, y, z) });
    return r;
  }

  private removeAtomCell(cell: CellKey): void {
    const [x, y, z] = parseCellKey(cell);
    if (this.isLockedCell(cell)) {
      this.refuse(x, y, z, ENGINE_TEXT.lockedMolecule);
      return;
    }
    const index = this.world.index;
    const before = new Map<CellKey, BlockElement>();
    for (const c of [cell, ...index.neighbours(cell).map((n) => n.key)]) {
      const a = index.atoms.get(c);
      if (a) before.set(c, a.el);
    }
    const removed = this.world.removeAtomBlock(x, y, z);
    for (const c of removed) {
      const el = before.get(c);
      if (!el) continue;
      if (el !== 'H') this.state.addInventory(el, 1);
      const [cx, cy, cz] = parseCellKey(c);
      this.events.emit('block:removed', { x: cx, y: cy, z: cz, id: atomBlockOf(el), el, zone: zoneOf(cx, cy, cz) });
    }
  }

  /** 09 §1.3 apply path. Returns the validation result (the debug hook exposes it). */
  private applyWand(pair: PairKey): BondChangeResult {
    const [a, b] = splitPairKey(pair);
    const [x, y, z] = parseCellKey(a);
    if (this.isLockedCell(a) || this.isLockedCell(b)) {
      this.refuse(x, y, z, ENGINE_TEXT.lockedMolecule);
      return { ok: false, refusal: { reason: 'locked-zone', zone: zoneOf(x, y, z) }, message: ENGINE_TEXT.lockedMolecule };
    }
    const r = validateBondChange(this.world.index, pair, { lockedZones: this.lockedZones });
    if (!r.ok) {
      this.refuse(x, y, z, r.message);
      return r;
    }
    if (r.order === 0) {
      this.world.suppressBond(pair);
      this.events.emit('bond:suppressed', { pair, previous: (r.previous || 1) as 1 | 2 | 3 });
    } else if (r.previous === 0) {
      this.world.restoreBond(pair);
      if (r.order > 1) this.world.setBondOrder(pair, r.order);
      this.events.emit('bond:restored', { pair, order: r.order });
    } else {
      this.world.setBondOrder(pair, r.order);
      this.events.emit('bond:changed', { pair, order: r.order, previous: r.previous });
    }
    return r;
  }

  private cycleCharge(cell: CellKey, reverse: boolean): void {
    const [x, y, z] = parseCellKey(cell);
    if (this.isLockedCell(cell)) {
      this.refuse(x, y, z, ENGINE_TEXT.lockedMolecule);
      return;
    }
    const index = this.world.index;
    const atom = index.atoms.get(cell);
    if (!atom) return;
    const forward = (q: -1 | 0 | 1): -1 | 0 | 1 => (q === 0 ? 1 : q === 1 ? -1 : 0);
    const backward = (q: -1 | 0 | 1): -1 | 0 | 1 => (q === 0 ? -1 : q === -1 ? 1 : 0);
    const step = reverse ? backward : forward;
    const first = step(atom.charge);
    const second = step(first);
    let firstMessage: string | null = null;
    for (const q of [first, second]) {
      const r = validateChargeChange(index, cell, q, { lockedZones: this.lockedZones });
      if (r.ok) {
        this.world.setCharge(cell, q);
        this.events.emit('charge:changed', { cell, charge: q, previous: atom.charge });
        return;
      }
      if (firstMessage === null) firstMessage = r.message;
    }
    this.refuse(x, y, z, firstMessage ?? REFUSAL_TEXT.chargeUnsupported(atom.el, first));
  }

  /** Select tool outside select-atom mode: toggles the hovered atom of the targeted molecule (06 §10.4). */
  private selectHovered(): void {
    const h = this.hover;
    if (h.kind !== 'atom') return;
    const t = this.state.target;
    const atom = t.cellToAtom.get(h.cell);
    if (atom === undefined) return;
    this.state.toggleSelection({ molecule: 0, atom });
  }

  // ---------------------------------------------------------------------------
  // Zones, locked molecules, bench (06 §10.6, §14.6)
  // ---------------------------------------------------------------------------

  private clearZone(zone: Zone): void {
    const index = this.world.index;
    const locked = lockedCells(this.state);
    const heavy: CellKey[] = [];
    for (const a of index.atoms.values()) {
      if (locked.has(a.key) || zoneOf(a.x, a.y, a.z) !== zone) continue;
      if (a.el !== 'H') heavy.push(a.key);
    }
    for (const c of heavy) {
      if (!index.atoms.has(c)) continue;
      this.removeAtomCell(c);
    }
    for (const a of Array.from(index.atoms.values())) {
      if (a.el !== 'H' || locked.has(a.key) || zoneOf(a.x, a.y, a.z) !== zone) continue;
      this.world.setBlock(a.x, a.y, a.z, Block.Air);
      this.events.emit('block:removed', { x: a.x, y: a.y, z: a.z, id: Block.AtomH, el: 'H', zone });
    }
  }

  private placeLocked(smiles: string, anchorMin: Vec3, zone: Zone, molecule: number): LockedPlacement {
    const entry = entryBySmiles(smiles);
    const g: MoleculeGraph = parseEntry(smiles);
    const emb = entry ? layoutOf(entry) : embedOnLattice(g);
    if (!emb) throw new Error(`locked molecule ${smiles} is not buildable on the lattice`);
    const all: Vec3[] = [...emb.pos];
    for (const list of emb.hPos.values()) all.push(...list);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    for (const p of all) for (let k = 0; k < 3; k++) min[k] = Math.min(min[k] as number, p[k] as number);
    const shift = (p: Vec3): [number, number, number] => [p[0] - min[0] + anchorMin[0], p[1] - min[1] + anchorMin[1], p[2] - min[2] + anchorMin[2]];
    const atomToCell: CellKey[] = [];
    const cellToAtom = new Map<CellKey, number>();
    g.atoms.forEach((a, i) => {
      if (!isBlockElement(a.el)) throw new Error(`locked molecule ${smiles}: element ${a.el} has no block`);
      const p = shift(emb.pos[i] as Vec3);
      this.world.setBlock(p[0], p[1], p[2], atomBlockOf(a.el));
      const key = cellKey(p[0], p[1], p[2]);
      atomToCell.push(key);
      cellToAtom.set(key, i);
    });
    for (const [a, b] of emb.suppressedPairs) {
      const ka = atomToCell[a];
      const kb = atomToCell[b];
      if (ka && kb && this.world.index.bonds.has(pairKey(ka, kb))) this.world.suppressBond(pairKey(ka, kb));
    }
    g.atoms.forEach((a, i) => {
      if (a.charge !== 0) this.world.setCharge(atomToCell[i] as CellKey, a.charge);
    });
    for (const b of g.bonds) {
      if (b.order > 1) this.world.setBondOrder(pairKey(atomToCell[b.a] as CellKey, atomToCell[b.b] as CellKey), b.order);
    }
    const hCells = new Map<number, CellKey[]>();
    for (const [id, list] of emb.hPos) {
      const cells: CellKey[] = [];
      for (const hp of list) {
        const p = shift(hp);
        this.world.setBlock(p[0], p[1], p[2], Block.AtomH);
        cells.push(cellKey(p[0], p[1], p[2]));
      }
      hCells.set(id, cells);
    }
    return { molecule, cellToAtom, atomToCell, hCells, analysis: analyze(g), zone };
  }

  private removeLocked(): void {
    for (const lp of this.state.locked) {
      const cells: CellKey[] = [...lp.cellToAtom.keys()];
      for (const list of lp.hCells.values()) cells.push(...list);
      for (const c of cells) {
        const [x, y, z] = parseCellKey(c);
        if (this.world.getBlock(x, y, z) !== Block.Air) this.world.setBlock(x, y, z, Block.Air);
      }
    }
    this.state.setLocked([]);
  }

  private onChallengeChanged(): void {
    this.removeLocked();
    this.ghost.clearMirror();
    this.highlight.clearResult();
    const c: Challenge = this.state.current.challenge;
    const rule: ChallengeRule = c.rule;
    const placements: LockedPlacement[] = [];
    const place = (smiles: string, anchor: Vec3, zone: Zone, molecule: number): void => {
      try {
        placements.push(this.placeLocked(smiles, anchor, zone, molecule));
      } catch (e) {
        console.error('[game] cannot place locked molecule', smiles, e);
      }
    };
    this.lockedZones = [];
    if (rule.type === 'select-atom') {
      rule.molecules.forEach((s, i) => { const o = LOCKED_ORIGINS[i]; if (o) place(s, o, 'pad', i); });
    } else if (rule.type === 'quiz' && rule.display) {
      place(rule.display.smiles, LOCKED_ORIGINS[0] as Vec3, 'pad', 0);
    } else if (rule.type === 'predict-product' || rule.type === 'choose-reagent') {
      this.lockedZones = ['reactant'];
      place(rule.reactant, REACTANT_MIN, 'reactant', 0);
      if (rule.type === 'predict-product' && rule.rx) {
        const first = placements[0];
        let maxX = REACTANT_MIN[0];
        if (first) for (const k of first.cellToAtom.keys()) maxX = Math.max(maxX, parseCellKey(k)[0]);
        const anchor: Vec3 = [Math.min(maxX + 3, REACTANT_MAX[0]), REACTANT_MIN[1], REACTANT_MIN[2]];
        place(rule.rx, anchor, 'reactant', 1);
      }
    }
    this.state.setLocked(placements);
    const first = placements[0]?.atomToCell[0];
    if (first && this.world.index.atoms.has(first)) this.state.setTarget(this.world.index.componentOf(first), null, null);
    this.sceneDirty = true;
    this.lastBench = null;
  }

  private syncBench(): void {
    const b = this.state.bench;
    if (b === this.lastBench) return;
    this.lastBench = b;
    if (b.preview === 'hidden' || b.previews.length === 0) this.ghost.clearPreview();
    else this.ghost.showGhost(b.previews, PRODUCT_MIN);
  }

  // ---------------------------------------------------------------------------
  // Subscriptions (06 §14.1 step 5) and HUD hooks (07 §1.3)
  // ---------------------------------------------------------------------------

  private subscribe(): void {
    const on = this.events.on.bind(this.events);
    on('challenge:changed', () => this.onChallengeChanged());
    on('selection:changed', (e) => {
      this.selectedCells = e.cells;
      this.selectedHydrogens = e.hydrogens;
      this.sceneDirty = true;
    });
    on('target:changed', () => { this.sceneDirty = true; });
    on('molecule:analyzed', () => { this.sceneDirty = true; });
    on('inventory:changed', () => { this.sceneDirty = true; });
    on('settings:changed', (e) => {
      this.settingsStale = true;
      if (e.key === 'lowGraphics') this.camera.setFar(this.renderer.profile.cameraFar);
    });
    on('look:mode', (e) => this.state.setLookMode(e.mode));
    on('challenge:submitted', (e) => {
      const rule = this.state.current.challenge.rule;
      const build = rule.type !== 'quiz' && rule.type !== 'select-atom' && rule.type !== 'choose-reagent';
      const cells = this.state.target.atomToCell;
      if (!build) return;
      if (e.result.passed) this.highlight.showResult(cells, []);
      else if (e.result.kind !== 'nothing-targeted') this.highlight.showResult([], cells);
      if (e.result.kind === 'enantiomer') {
        const index = this.world.index;
        const mirror = cells.map((c) => ({ cell: c, el: index.atoms.get(c)?.el ?? 'C' }));
        this.ghost.showMirror(mirror);
      }
      this.sceneDirty = true;
    });
    on('bench:cleared', () => { this.sceneDirty = true; });
    on('gfx:changed', () => { this.camera.setFar(this.renderer.profile.cameraFar); });
  }

  private hooks(): RenderHooks {
    return {
      setGroupHighlight: (cells) => this.highlight.setGroupHighlight(cells),
      setSelectHighlights: (h) => this.highlight.setSelectHighlights(h),
      setHydrogenMode: (mode) => { if (this.hydrogenMode !== mode) { this.hydrogenMode = mode; this.sceneDirty = true; } },
      setMarkedAtom: (cell) => this.highlight.setMarkedAtom(cell),
      crosshairRay: () => {
        const { eye, dir } = this.eyeAndDir();
        return { origin: eye, dir };
      },
      atomHit: () => {
        const vh = this.voxelHit;
        return vh && isAtom(vh.id) && vh.t <= PICK_DISTANCE ? vh : null;
      },
      setLowGraphics: (on) => {
        this.renderer.setLowGraphics(on);
        this.camera.setFar(this.renderer.profile.cameraFar);
      },
      setReducedMotion: (on) => { this.reducedMotion = on; this.highlight.setReducedMotion(on); this.sceneDirty = true; },
      setStereoOverlay: (on) => this.stereo.setEnabled(on),
      flashCrosshair: () => this.highlight.flashRefusal(),
      requestFullscreen: () => this.stage.requestFullscreen(),
      getBlock: this.world.getBlock,
      wandPreview: (pair) => {
        const [a, b] = splitPairKey(pair);
        if (this.isLockedCell(a) || this.isLockedCell(b)) return null;
        const r = validateBondChange(this.world.index, pair, { lockedZones: this.lockedZones });
        return r.ok ? r.order : null;
      },
      ghostCellInfo: (cell) => {
        const g = this.ghost.ghostCellInfo(cell);
        return g ? { el: g.el, breakEndpoint: g.breakEndpoint } : null;
      },
      touch: { setHeld: (action, down) => this.input.setHeld(action, down), inject: (action) => this.input.inject(action) },
    };
  }

  // ---------------------------------------------------------------------------
  // Debug overlay and hooks (06 §14.8)
  // ---------------------------------------------------------------------------

  private toggleDebugOverlay(): void {
    const el = this.stage.querySelector<HTMLElement>('#debug');
    if (!el) return;
    this.debugVisible = !this.debugVisible;
    if (this.debugVisible) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
    this.debugTick.reset();
    if (this.debugVisible) this.refreshDebugOverlay();
  }

  private refreshDebugOverlay(): void {
    const el = this.stage.querySelector<HTMLElement>('#debug');
    if (!el) return;
    const ms = this.frameMs.mean;
    const fps = ms > 0 ? Math.round(1000 / ms) : 0;
    const p = this.player;
    const stats = this.renderer.stats();
    el.textContent = [
      STRINGS.debug(fps, p.x, p.y, p.z, this.chunks.meshCount, this.look.mode),
      `frame ${ms.toFixed(1)} ms  calls ${stats.calls}  triangles ${stats.triangles}`,
      `lowGraphics ${this.renderer.lowGfx}  pixelRatio ${this.renderer.pixelRatio.toFixed(2)}  yaw ${this.camera.yaw.toFixed(2)} pitch ${this.camera.pitch.toFixed(2)}`,
      `target ${this.state.target.component ?? '-'}  hover ${this.hover.kind}  analysis queue ${this.queue.size}`,
    ].join('\n');
  }

  private makeDebugApi(version: string): DebugApi {
    const api: DebugApi = {
      version,
      frames: 0,
      triangles: 0,
      calls: 0,
      lookMode: 'keys',
      lowGfx: this.renderer.lowGfx,
      pixelRatio: this.renderer.pixelRatio,
      ready: false,
      events: this.events,
      getBlock: this.world.getBlock,
    };
    if (!this.debug) return api;
    api.teleport = (x, y, z, yaw, pitch) => {
      this.player.x = x;
      this.player.y = y;
      this.player.z = z;
      this.player.vx = this.player.vy = this.player.vz = 0;
      this.player.onGround = false;
      this.camera.setLook(yaw ?? this.camera.yaw, pitch ?? this.camera.pitch);
      this.player.yaw = this.camera.yaw;
      this.player.pitch = this.camera.pitch;
      this.prev = copyPlayer(this.player);
      this.acc = 0;
    };
    api.setBlock = (x, y, z, id) => {
      const index = this.world.index;
      const orders = new Map<PairKey, 1 | 2 | 3>();
      for (const [k, b] of index.bonds) orders.set(k, b.order);
      const charges = new Map<CellKey, -1 | 0 | 1>();
      for (const [k, a] of index.atoms) charges.set(k, a.charge);
      const suppressed = new Set(index.suppressed);
      this.world.setBlock(x, y, z, id);
      index.rebuildFromGrid(this.world.getBlock, orders, charges, suppressed);
      this.sceneDirty = true;
    };
    api.place = (x, y, z, el) => this.placeAtom(x, y, z, el);
    api.wand = (pair) => this.applyWand(pair);
    api.goToChallenge = (id) => {
      const i = this.state.roster.findIndex((c) => c.id === id);
      if (i < 0) throw new Error(`no enabled challenge ${id}`);
      this.state.setChallenge(i);
    };
    api.press = (action) => this.input.inject(action);
    api.state = () => this.state;
    return api;
  }
}
