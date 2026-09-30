# 06 — Engine: world, player, input, rendering, game loop

Covers `src/world/*` (WP-06, pure), `src/player/*` and `src/input/*` (WP-07), `src/render/*` (WP-08), and the `src/app/Game.ts` composition root and loop (WP-11). Every name below is taken from `src/world/types.ts`, `src/chem/types.ts`, `src/content/types.ts`, `src/app/events.ts` and `docs/design/00-contracts.md`; anything not in those files is declared in section 1 and nowhere else.

Sources reconciled: `docs/research/voxel-engine.md` (all), `docs/research/d2l-hosting.md` (iframe, pointer lock, keyboard, layout, accessibility), `DESIGN-draft.md` §2.4, §3, §6, §9.2, `critic-round1.md` items 2.4 (framed layout), 4.5 (grid geometry: inner-vertex placement is legal and flagged `cage`), 6.4/6.6 (instanceColor is a diffuse multiplier, pick mesh `visible = false`, orders live in `MoleculeIndex`). Three.js r186 facts were re-checked in `node_modules/three/src` while writing (`InstancedMesh.setColorAt` initialises `instanceColor` to all-ones; `InstancedMesh.raycast` uses a cached `boundingSphere`; `Raycaster` tests `layers`, never `visible`).

## 0. Files, ownership, dependency direction

| file | package | pure | imports allowed |
|---|---|---|---|
| `src/world/blocks.ts` | WP-06 | yes | `world/types` |
| `src/world/chunk.ts` | WP-06 | yes | `world/types` |
| `src/world/world.ts` | WP-06 | yes | `world/types`, `world/chunk`, `world/molecule-index` |
| `src/world/worldgen.ts` | WP-06 | yes | `world/*`, `util/prng`, `util/noise` |
| `src/world/mesher.ts` | WP-06 | yes | `world/types`, `world/blocks` |
| `src/world/raycast.ts` | WP-06 | yes | `world/types` |
| `src/world/molecule-index.ts`, `src/world/extract.ts` | WP-06 | yes | specified in `02-chemistry-core.md` §12; not repeated here |
| `src/util/prng.ts`, `src/util/noise.ts` | WP-06 | yes | — |
| `src/player/physics.ts` | WP-07 | yes | `world/types` |
| `src/input/keymap.ts` | WP-07 | yes | `import type` from `app/Settings` (`KeyAction`) only — no runtime import |
| `src/player/camera.ts` | WP-07 | no | `three`, `world/types` |
| `src/input/InputManager.ts`, `src/input/pointerlock.ts`, `src/input/look-modes.ts` | WP-07 | no | DOM, `input/keymap`, `app/events` |
| `src/render/*` | WP-08 | no | `three`, `world/*`, `chem/types` |
| `src/app/Game.ts` | WP-11 | no | everything |

Rule (00-contracts §0): pure files never import `three`, `document`, `window`, `localStorage`; `test/pure-imports.test.ts` enforces it. Everything that touches the DOM or WebGL is exercised only by the Playwright smoke test (section 15).

Coordinate conventions used everywhere: cell `(x,y,z)` occupies the half-open box `[x,x+1)×[y,y+1)×[z,z+1)`; its centre is `(x+0.5, y+0.5, z+0.5)`. `+y` is up. The camera looks along `−z` when `yaw = 0`; `yaw` increases turning left (three's `rotation.y`). `forward(yaw) = (−sin yaw, 0, −cos yaw)`, `right(yaw) = (cos yaw, 0, −sin yaw)`. Spawn `(64, 9, 64)` faces `−z` (toward the bench), `yaw = 0`, `pitch = 0`.

## 1. Contract additions

Exact TypeScript declared by this section and absent from the type files. Each block names the module that exports it. Nothing here edits `src/world/types.ts` or `src/app/events.ts`; the event additions are merged into `GameEvents` by the contracts PR (00-contracts §0) and are listed in `EngineEvents` until then. Where 07 already declares a contract (keys and settings: 07 §1.2; State: 07 §1.1; DOM ids: 07 §2.1) this document imports it and declares nothing competing; the blocks below only add what 07 lacks and record which of them 00-contracts §3/§5 must copy.

```ts
// src/world/blocks.ts (pure)
export const TERRAIN_HEX: Readonly<Record<number, number>>;      // §2.2 table, keyed by BlockId
export const GRASS_TOP_SLOT = 255;                                // palette slot for the +y face of Grass
export const PALETTE_SLOTS = 256;
export function oreHex(el: Exclude<BlockElement, 'H'>): number;   // mix(TERRAIN_HEX[Block.Stone], CPK_HEX[el], 0.5), per-channel Math.round
export function blockHex(id: number): number;                     // TERRAIN_HEX[id] ?? oreHex(elementOf(id)) ?? 0xff00ff
export function blockName(id: number): string;                    // §2.2 "name" column (student-facing, used by hover text)
export function placeableFromInventory(id: number): boolean;      // isAtom(id)

// src/world/chunk.ts (pure)
export class Chunk {
  readonly data: Uint8Array;            // CHUNK_W * CHUNK_H * CHUNK_D, index cidx(x,y,z)
  dirty: boolean;                        // needs a mesh rebuild
  version: number;                       // incremented by every write; the renderer stores the version it last built
  constructor(readonly cx: number, readonly cz: number);
  get(lx: number, ly: number, lz: number): number;
  set(lx: number, ly: number, lz: number, id: number): void;   // marks dirty, bumps version
}
export function chunkIndex(cx: number, cz: number): number;    // cx + WORLD_CX * cz

// src/world/world.ts (pure)
export interface WorldEdit {
  readonly kind: 'block' | 'bond' | 'charge';
  readonly cells: readonly CellKey[];   // cells whose component may have changed
}
export class World {
  readonly chunks: readonly Chunk[];     // length WORLD_CX * WORLD_CZ
  readonly index: MoleculeIndexExt;                              // 02 §1 / 09 §1.1: carries the suppressed-pair set
  /** Incremented by every mutation; Game compares it to decide whether to re-derive components. */
  editVersion: number;
  constructor(index?: MoleculeIndex);
  getBlock(x: number, y: number, z: number): number;            // Block.Air outside x/z bounds or y >= WORLD_H; Block.Bedrock for y < 0
  setBlock(x: number, y: number, z: number, id: number): void;   // §2.3: no validation; updates index; marks chunks dirty
  isSolid(x: number, y: number, z: number): boolean;             // isSolid(getBlock(...)); true for y < 0
  setBondOrder(key: PairKey, order: BondOrder): void;            // delegates to index; bumps editVersion
  suppressBond(key: PairKey): void;                              // index.suppressBond ("no bond", 09 §1.2); bumps editVersion; WorldEdit {kind:'bond', cells:[a,b]}
  restoreBond(key: PairKey): void;                               // index.restoreBond (order 1); bumps editVersion; WorldEdit {kind:'bond'}
  setCharge(key: CellKey, charge: Charge): void;                 // delegates to index; bumps editVersion
  /** Removes an atom block and every explicit-H block that would be orphaned by it. Returns the removed cells (atom first). */
  removeAtomBlock(x: number, y: number, z: number): CellKey[];
  /** Chunks whose `dirty` flag is set, ordered by distance to (px, pz) ascending. */
  dirtyChunks(px: number, pz: number): Chunk[];
  /** Edits since the last call (cleared by the call). */
  drainEdits(): WorldEdit[];
}

// src/world/worldgen.ts (pure)
export const GEN = {
  seaLevel: 0, minHeight: 6, maxHeight: 13,
  flat: { xMin: 50, xMax: 78, zMin: 34, zMax: 78, height: 8 },   // pad + bench + 2-cell apron: surface fixed at y = 8
  blendRadius: 8,
  noise: { octaves: 3, baseFreq: 1 / 32, lacunarity: 2, gain: 0.5 },
  ore: { targetPerElement: 400, maxAttempts: 2000, blobFill: 0.7, depthBelowSurface: [1, 3] as readonly [number, number] },
  glassPostHeight: 2,
} as const;
export const OUTCROPS: Readonly<Record<Exclude<BlockElement, 'H'>, readonly [number, number]>>;  // §3.5 table
export function generate(world: World, seed: number): void;
export function surfaceHeight(seed: number, x: number, z: number): number;      // §3.2, exported for tests and the spawn/outcrop rules

// src/util/prng.ts (pure)
export function mulberry32(seed: number): () => number;          // returns floats in [0, 1)
export function hash2(seed: number, x: number, y: number): number; // 32-bit integer hash, §3.1

// src/util/noise.ts (pure)
export function valueNoise2(seed: number, x: number, z: number): number;                // [0, 1], bilinear, smoothstep
export function fbm2(seed: number, x: number, z: number, octaves: number, lacunarity: number, gain: number): number;  // [0, 1]

// src/world/mesher.ts (pure)
export interface Face { readonly dir: readonly [number, number, number]; readonly corners: readonly (readonly [number, number, number])[]; readonly shade: number; }
export const FACES: readonly Face[];                              // §5.1, index order = FACE_DIRS order
export const MAX_FACES = CHUNK_W * CHUNK_H * CHUNK_D * 6;         // 49152
export function createMeshBuffers(): MeshBuffers;                 // pooled once: pos/nor/col MAX_FACES*12 floats, idx MAX_FACES*6
export function buildPaletteLinear(toLinear: (hex: number) => readonly [number, number, number]): Float32Array; // PALETTE_SLOTS*3
export function buildChunkMesh(get: (x: number, y: number, z: number) => number, ox: number, oz: number, paletteLinear: Float32Array, out: MeshBuffers): number;

// src/world/raycast.ts (pure)
export function raycastVoxels(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, get: (x: number, y: number, z: number) => number): VoxelHit | null;
export function playerOverlapsCell(p: Readonly<PlayerState>, x: number, y: number, z: number): boolean;

// src/player/physics.ts (pure)
export const PHYSICS_EPS = 1e-4;
export function stepPlayer(p: PlayerState, input: FrameInput, dt: number, isSolid: (x: number, y: number, z: number) => boolean): void;
export function createPlayer(): PlayerState;                      // at SPAWN, yaw 0, pitch 0, onGround false
export function eyePosition(p: Readonly<PlayerState>): [number, number, number];   // (x, y + PLAYER.eye, z)
export function lookDirection(yaw: number, pitch: number): [number, number, number]; // unit vector §8

// src/input/keymap.ts (pure) — see §9.1; the action names, defaults and Settings schema are 07 §1.2 (`src/app/Settings.ts`)
import type { KeyAction } from '../app/Settings';
export type InputAction = KeyAction | 'pause' | 'debug';       // 'pause' = Escape, 'debug' = F3 (fixed codes, not in DEFAULT_KEYS)
export const FIXED_CODES: Readonly<Record<string, 'pause' | 'debug'>>;
export const HELD_ACTIONS: ReadonlySet<InputAction>;           // forward back left right jump sprint lookLeft lookRight lookUp lookDown
export const RESERVED_CODES: ReadonlySet<string>;              // 'Tab', 'Escape', 'F1'..'F12' (never bindable, never prevented)
export const SCROLL_CODES: ReadonlySet<string>;                // 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'
export function resolveAction(keys: Readonly<Record<KeyAction, string>>, code: string): InputAction | null;
export function shouldPreventDefault(keys: Readonly<Record<KeyAction, string>>, code: string): boolean;   // !RESERVED_CODES.has(code) && (SCROLL_CODES.has(code) || resolveAction(keys, code) !== null)

// src/input/InputManager.ts (DOM)
export interface FrameActions {
  readonly move: FrameInput;
  readonly lookDX: number;               // pixels (locked/drag) accumulated this frame
  readonly lookDY: number;
  readonly keyLook: { readonly yaw: -1 | 0 | 1; readonly pitch: -1 | 0 | 1 };
  readonly pressed: readonly InputAction[];   // edge-triggered actions in press order (deduplicated)
  readonly wheel: number;                // hotbar steps, +1 = next slot, −1 = previous (may be ±n)
  readonly focused: boolean;
}
export class InputManager {
  constructor(canvas: HTMLCanvasElement, getKeys: () => Readonly<Record<KeyAction, string>>, emitter: Emitter);   // getKeys = () => effectiveKeys(settings)
  readonly canvas: HTMLCanvasElement;
  active(): boolean;                     // document.activeElement === canvas || document.pointerLockElement === canvas
  modal: boolean;                        // set by the HUD while a dialog is open (07 §17 focus stack); keys are ignored while true
  inject(action: InputAction): void;     // on-screen touch buttons and the pause menu use this
  consumeFrame(): FrameActions;
  dispose(): void;
}

// src/input/pointerlock.ts (DOM)
export const LOCK_VERIFY_MS = 150;
export const RELOCK_COOLDOWN_MS = 1500;
export const MAX_LOCK_FAILURES = 2;
export type LockOutcome = 'locked' | 'rejected' | 'unverified' | 'unsupported';
export function requestLock(el: HTMLElement): Promise<LockOutcome>;   // §9.3

// src/input/look-modes.ts (DOM)
export type LookMode = 'locked' | 'drag' | 'keys';
export interface LookSettings { sensitivity: number; invertY: boolean; turnRateYaw: number; turnRatePitch: number; }   // derived from Settings (07 §1.2): turnRateYaw = turnRate, turnRatePitch = 0.6 * turnRate
export class LookModes {
  constructor(canvas: HTMLCanvasElement, input: InputManager, emitter: Emitter, settings: () => LookSettings);
  readonly mode: LookMode;
  lockAllowed: boolean;                  // false after MAX_LOCK_FAILURES; Settings "Try mouse capture again" resets it
  onCanvasClick(ev: PointerEvent): void; // §9.4 state machine
  dispose(): void;
}

// src/player/camera.ts (three)
export const CAMERA = { fov: 70, sprintFov: 76, near: 0.05, far: 120, farLowGfx: 72, pitchLimit: 1.5533 } as const;
export class FirstPersonCamera {
  readonly camera: PerspectiveCamera;   // rotation.order = 'YXZ'
  yaw: number; pitch: number;
  addLook(dxRad: number, dyRad: number): void;      // yaw -= dx; pitch -= dy; clamp pitch
  setFromPlayer(p: Readonly<PlayerState>, prev: Readonly<PlayerState>, alpha: number): void;  // lerp position, + PLAYER.eye
  setAspect(w: number, h: number): void;
  setSprinting(on: boolean, reducedMotion: boolean): void;
}

// src/app/State.ts (WP-11) — the State contract is 07 §1.1 (`LockedPlacement`, `HotbarTool`, `HOTBAR`, `TargetState`,
// `StateView`, `StateCommands`, `UiState`, `LOCKED_ORIGINS`), which 00-contracts §5 must record verbatim as the
// `State.ts` row. Additions this document needs in the same file:
export const LOCKED_EXTENT: Vec3 = [8, 20, 8];                       // §10.6 slot box, cells; y range 10..29
export const REACTANT_MIN: Vec3 = [53, 10, 37], REACTANT_MAX: Vec3 = [62, 30, 46];   // 04 §7.2 (declared there "in State.ts")
export const PRODUCT_MIN:  Vec3 = [65, 10, 37], PRODUCT_MAX:  Vec3 = [74, 30, 46];
/** Union of every locked placement's heavy cells and explicit-H cells. Recomputed on challenge:changed / bench:cleared. */
export function lockedCells(s: StateView): ReadonlySet<CellKey>;
/** Engine-side writers (Game.ts only; the HUD never calls them). */
export interface EngineStateCommands {
  setTarget(component: ComponentId | null, cell: CellKey | null, pair: PairKey | null): void;   // emits target:changed on change
  setAnalysis(component: ComponentId, analysis: Analysis | null, zone: Zone, suppressed?: readonly PairKey[]): void;   // null removes; emits molecule:analyzed; `suppressed` = suppressedPairsOfComponent(index, component) → TargetState.suppressed (09 §1.10)
  setLocked(placements: readonly LockedPlacement[]): void;
  addInventory(el: BlockElement, n: number): void;                                             // emits inventory:changed; H ignored
  setLookMode(mode: 'locked' | 'drag' | 'keys'): void;                                         // emits look:mode
  setPlayer(x: number, y: number, z: number, yaw: number): void;                               // no event (mirror reads it)
}
/** What Game.ts reads from and writes to State. */
export type EngineStateView = Pick<StateView, 'events' | 'roster' | 'current' | 'inventory' | 'slot' | 'target' | 'padComponents' | 'locked' | 'selection' | 'bench' | 'lookMode' | 'paused' | 'finished'>
  & Pick<StateCommands, 'submit' | 'selectSlot' | 'cycleSlot' | 'toggleSelection' | 'setSelection' | 'clearSelection' | 'setPaused' | 'setChallenge' | 'nextChallenge' | 'prevChallenge' | 'announce'>
  & EngineStateCommands;

// src/app/Settings.ts (WP-07; 07 §1.2 is the schema) — two additions this document needs:
//   readonly stereoOverlay: boolean;        // default true; the 07 §15 "Stereo overlay" checkbox (missing from 07 §1.2's interface)
//   export function wasStored(key: keyof Settings): boolean;   // true when the last saved record held `key` (§11.1 low-graphics rule)

// src/world/extract.ts (WP-06, pure) — 07 §1.4, made normative here (02 §12.3 should list it too):
/** k-th implicit-hydrogen cell of the atom at (x,y,z): free face cells in H_FILL_ORDER order, where free = get(...) === Block.Air.
 *  Returns null when fewer than k+1 free faces exist. Used by AtomRenderer (§12.3), select-atom.ts (07 §11.1), StereoOverlay ghost H
 *  and validate.ts (V-LOCK). A cell holding an atom, a terrain block (the pad floor) or an H block is never free. */
export function implicitHCell(get: (x: number, y: number, z: number) => number, x: number, y: number, z: number, k: number): Vec3 | null;
// Tests (test/world/extract.test.ts): atom C at (10,10,10) alone -> k = 0..5 give (10,11,10) (10,9,10) (10,10,11) (10,10,9) (11,10,10) (9,10,10), k = 6 null;
// with LabTile at (10,9,10) -> k = 1 gives (10,10,11); with AtomC at (10,11,10) and AtomH at (10,9,10) -> k = 0 gives (10,10,11).

// src/content/validate.ts (WP-09) — obligation V-LOCK added to `validateContent` (05 owns the list): for every enabled
// select-atom molecule, quiz display, bench reactant and rx: place it (in a scratch World) at its §10.6 anchor; fail with
// `challenge:<id>: locked molecule <i> exceeds LOCKED_EXTENT` when any cell leaves the slot box, and with
// `challenge:<id>: hydrogen <slot> of atom <n> has no free cell` when `implicitHCell(get, x, y, z, k)` is null for any
// k < hydrogens[n] − explicit count.

// src/app/Game.ts (WP-11) — engine-internal tool view of HOTBAR (07 §1.1 owns HOTBAR itself)
export type Tool =
  | { readonly kind: 'atom'; readonly el: BlockElement }
  | { readonly kind: 'bond' }
  | { readonly kind: 'charge' }
  | { readonly kind: 'select' };
export function toolOf(entry: BlockElement | HotbarTool): Tool;   // 'bond-wand' -> bond, 'charge-tool' -> charge, 'select-tool' -> select, else atom
export type HoverInfo =
  | { readonly kind: 'none' }
  | { readonly kind: 'block'; readonly x: number; readonly y: number; readonly z: number; readonly id: number; readonly face: readonly [number, number, number] }
  | { readonly kind: 'atom'; readonly cell: CellKey; readonly el: BlockElement; readonly charge: Charge; readonly bonds: number; readonly hydrogens: number; readonly component: ComponentId; readonly face: readonly [number, number, number] }
  | { readonly kind: 'hydrogen'; readonly cell: CellKey; readonly slot: number; readonly explicit: boolean }
  | { readonly kind: 'bond'; readonly pair: PairKey; readonly order: WandOrder }   // 0 = hovering a break marker (suppressed pair), 09 §1.10
  | { readonly kind: 'bench' };
export interface DebugApi {
  readonly version: string; frames: number; triangles: number; calls: number; lookMode: LookMode; lowGfx: boolean; pixelRatio: number;
  readonly events: Emitter;                     // State's emitter (smoke step 10 subscribes to quiz:answer)
  getBlock(x: number, y: number, z: number): number;
  // present only when location.search contains debug=1
  teleport?(x: number, y: number, z: number, yaw?: number, pitch?: number): void;
  setBlock?(x: number, y: number, z: number, id: number): void;
  place?(x: number, y: number, z: number, el: BlockElement): PlacementResult;
  wand?(pair: PairKey): BondChangeResultExt;    // runs the real validateBondChange + apply path (09 §1.3) and emits the bond events
  goToChallenge?(id: string): void;
  press?(action: InputAction): void;
  state?(): UiState;                            // the live State instance (07 §1.1)
}
declare global { interface Window { __orgocraft?: DebugApi } }

// src/app/events.ts — additions to GameEvents (merged into the closed map by the contracts PR; until then State.ts creates
// `createEmitter<GameEvents & EngineEvents>()` and every DOM module subscribes through that widened emitter type)
export interface EngineEvents {
  'hover:changed': { hover: HoverInfo };
  'bench:open': Record<string, never>;
  'analyze:requested': { component: ComponentId | null };
  'input:focus': { focused: boolean };
  'gfx:context': { state: 'lost' | 'restored' };
  'gfx:changed': { lowGfx: boolean; pixelRatio: number; antialias: boolean };
  'world:ready': { seed: number };
  'bond:suppressed': { pair: PairKey; previous: BondOrder };   // 09 §1.4: the pair is now a no-bond pair
  'bond:restored': { pair: PairKey; order: BondOrder };        // 09 §1.4: the pair is bonded again
}
// Rows 07 §18 must carry for these events (07 owns the wiring table; listed here so both owners see one list):
//   hover:changed      -> target info (#target-info text from HoverInfo; §10.2)
//   bench:open         -> bench panel (open + focus, 07 §12.4)
//   analyze:requested  -> live region (Analyze summary, 07 §16.2)
//   input:focus        -> look hint (`clickToPlay` while unfocused; §9.2 rule 5)
//   gfx:context        -> live region (assertive `contextLost` / polite `contextRestored`)
//   gfx:changed        -> settings panel (Graphics select reflects the runtime downgrade), debug overlay
//   world:ready        -> hud (mount panels; before it the HUD shows nothing but the LMS badge)
//   bond:suppressed    -> molecule panel, target info, mirror (dirty); live region polite STRINGS.bondBroken(a, b)
//   bond:restored      -> molecule panel, target info, mirror (dirty); live region polite STRINGS.bondRestored(a, b)
// Slot changes are `inventory:changed { counts, slot }` (already in GameEvents); there is no `tool:changed`.

// src/ui/strings.ts (owned by 07; Game.ts imports these exact strings)
export const ENGINE_TEXT = {
  lockedMolecule: 'This molecule is part of the challenge and cannot be changed.',
  bondWandPrimary: 'Use E or the right mouse button to change the bond order.',
  noBondHere: 'Point at a bond bar or a break marker and press E.',
  noAtomHere: 'Point at an atom block.',
  notPlaceable: 'Only atoms from the hotbar can be placed.',
  mineNoYield: 'Removed.',
  mined: (el: string, n: number) => `+${n} ${el}`,
  clickToPlay: 'Click the world to play. Esc opens the menu, Tab leaves the game area.',
  dragToLook: 'Drag to look around (mouse capture is not available here).',
  keysToLook: 'Arrow keys look around.',
  lockedHint: 'Mouse captured. Press Esc to release it.',
  contextLost: 'Graphics paused while the browser restores WebGL. Nothing is lost.',
  contextRestored: 'Graphics restored.',
  selectNoHydrogens: 'This atom has no hydrogens.',
  hover: {
    ore: (el: string) => `${el} ore - mine for ${ORE_YIELD} ${el}`,
    atom: (el: string, bonds: number, h: number, q: Charge) => `${el} atom${q ? (q > 0 ? ' (+1)' : ' (-1)') : ''} - ${bonds} bond${bonds === 1 ? '' : 's'}, ${h} H`,
    hydrogen: (explicit: boolean) => explicit ? 'Hydrogen block' : 'Hydrogen',
    bond: (a: string, b: string, order: WandOrder) => order === 0 ? `No bond ${a}-${b}: the atoms touch but are not bonded (E: bond them)` : `Bond ${a}-${b}, order ${order} (E: cycle)`,
    bench: 'Reaction bench (E: open)',
    block: (name: string) => name,
  },
} as const;
```

## 2. World size, chunks, block table

### 2.1 Dimensions (from `src/world/types.ts`)

`WORLD_CX × WORLD_CZ = 8 × 8` chunks of `CHUNK_W × CHUNK_H × CHUNK_D = 16 × 32 × 16`; world `128 × 32 × 128` cells, `524 288` cells, one `Uint8Array(8192)` per chunk. `chunkIndex(cx, cz) = cx + 8·cz`; a world cell `(x,y,z)` lives in chunk `(x >> 4, z >> 4)` at local `cidx(x & 15, y, z & 15) = lx + 16·(lz + 16·y)`. `WORLD_SEED = 1337`. Lab pad `x,z ∈ [52,76)`, floor `y = LAB_Y = 8`, spawn `SPAWN = (64, 9, 64)`. Bench zones `z ∈ [36,48)`, reactant `x ∈ [52,64)`, product `x ∈ [64,76)`; console blocks `BENCH_BLOCKS = (63,9,49), (64,9,49)`.

### 2.2 Block table (complete; `Block` ids from `types.ts`, colours from `blocks.ts`)

| id | name (`blockName`) | opaque | solid | breakable | inventory effect when mined | placeable | `TERRAIN_HEX` (sRGB) |
|---|---|---|---|---|---|---|---|
| 0 | Air | no | no | — | — | — | — |
| 1 | Bedrock | yes | yes | no | — | no | `0x2a2a2e` |
| 2 | Stone | yes | yes | yes | none | no | `0x8a8f96` |
| 3 | Dirt | yes | yes | yes | none | no | `0x6b4a2b` |
| 4 | Grass | yes | yes | yes | none | no | sides `0x7a5a35`; `+y` face uses `GRASS_TOP_SLOT` = `0x5fae45` |
| 5 | Sand | yes | yes | yes | none | no | `0xd9c98a` |
| 6 | Glass | **no** | yes | yes | none | no | `0xbfe6f5` (drawn as a pale cube in the chunk mesh; no transparency in v1; "not opaque" only affects face culling) |
| 7 | LabTile | yes | yes | no | — | no | `0xdde3e8` |
| 8 | LabTileEdge | yes | yes | no | — | no | `0xf2b632` |
| 9 | Bench | yes | yes | no | — | no | `0x4b5a6a` |
| 10 | BenchReactantTile | yes | yes | no | — | no | `0xc9a7a7` |
| 11 | BenchProductTile | yes | yes | no | — | no | `0xa7c9b0` |
| 32–39 | Carbon ore, Nitrogen ore, Oxygen ore, Sulfur ore, Fluorine ore, Chlorine ore, Bromine ore, Iodine ore | yes | yes | yes | `+ORE_YIELD (3)` of the element | no | `oreHex(el)`: C `0x636569`, N `0x5b77bd`, O `0xb75a61`, S `0xbeb95b`, F `0x8db873`, Cl `0x55b05b`, Br `0x945559`, I `0x8f4895` |
| 64–72 | Carbon atom … Iodine atom, Hydrogen atom | **no** | yes | yes | `+1` of the element (H: no change, unlimited) | yes (from the hotbar) | not in the chunk mesh; §12.3 textures use `CPK_HEX` |

`oreHex` fixtures above are `Math.round((stone + cpk) / 2)` per channel with Stone `(138,143,150)`. Ores carry no letter in 3D; the hover line (`ENGINE_TEXT.hover.ore`) and the Help legend name them (WCAG 1.4.1). `blockName` returns the "name" column; for atoms `"<Element name> atom"`, e.g. `Chlorine atom`.

Element names: C Carbon, N Nitrogen, O Oxygen, S Sulfur, F Fluorine, Cl Chlorine, Br Bromine, I Iodine, H Hydrogen.

### 2.3 `World`

- `getBlock(x,y,z)`: `y < 0 → Block.Bedrock`; `x,z` outside `[0,128)` or `y ≥ 32 → Block.Air`; else `chunks[chunkIndex(x>>4, z>>4)].get(x&15, y, z&15)`.
- `setBlock(x,y,z,id)`:
  1. `old = getBlock(x,y,z)`; if out of bounds throw `RangeError('setBlock out of bounds')`; if `old === id` return.
  2. If `isAtom(old)`: `index.removeAtom(cellKey(x,y,z))`. If `isAtom(id)`: `index.addAtom({ key, el: elementOf(id), x, y, z, charge: 0 })` (bonds to face neighbours are created by the index).
  3. Write the chunk cell; mark that chunk dirty; also mark chunk `(cx−1,cz)` when `(x & 15) === 0`, `(cx+1,cz)` when `=== 15`, same for `z`, when those chunks exist.
  4. `editVersion++`; push `{ kind: 'block', cells: [key, ...face-neighbour keys that are atoms] }`.
- `setBondOrder` / `setCharge`: delegate; `editVersion++`; push `{ kind: 'bond' | 'charge', cells }`.
- `removeAtomBlock(x,y,z)`: `removed = [key]`; for each face neighbour `n` with `getBlock(n) === Block.AtomH`: if after removing the atom `n` has no neighbour with `el !== 'H'` (`index.neighbours(nKey).filter(a => a.el !== 'H').length === 0`, evaluated after step 1's `setBlock(x,y,z,Air)`), `setBlock(n, Air)` and push `n`. Returns `removed`. Game returns orphaned H to the unlimited H slot (no count change) and emits one `block:removed` per removed cell.
- `dirtyChunks(px,pz)`: chunks with `dirty`, sorted by squared distance from `(px,pz)` to the chunk centre `(cx·16+8, cz·16+8)`.

## 3. Terrain generation (`worldgen.ts`)

Deterministic for a given seed; `generate(world, WORLD_SEED)` runs once at startup in < 50 ms.

### 3.1 PRNG and hashing (`util/prng.ts`)

`mulberry32(seed)` (standard: `a += 0x6D2B79F5; t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296`). `hash2(seed, x, y)`: `h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); return (h ^ (h >>> 15)) >>> 0`.

### 3.2 Height map (`util/noise.ts`, `surfaceHeight`)

1. `valueNoise2(seed, x, z)`: lattice values `hash2(seed, ix, iz) / 2^32` at the four integer corners, bilinear with `smoothstep(f) = f²(3 − 2f)` weights.
2. `fbm2(seed, x, z, 3, 2, 0.5)` = `Σ_{o<3} gain^o · valueNoise2(seed + o·1013, x·baseFreq·lacunarity^o, z·baseFreq·lacunarity^o)` divided by `Σ gain^o` (1.75) → `[0,1]`.
3. `hNoise = GEN.minHeight + Math.round(fbm2(...) · (GEN.maxHeight − GEN.minHeight))` ∈ `[6,13]`.
4. Blend toward the flat lab region `F = [50,78) × [34,78)` (x × z): `d = max(0, 50−x, x−77, 34−z, z−77)` (Chebyshev distance to `F`), `w = max(0, 1 − d / GEN.blendRadius)`, `h = Math.round(hNoise·(1−w) + GEN.flat.height·w)`. Inside `F`, `h = 8`.
5. `surfaceHeight(seed, x, z) = h`.

### 3.3 Column fill (for every `x, z`)

`y = 0 → Bedrock`; `1 ≤ y ≤ h−3 → Stone`; `h−2 ≤ y ≤ h−1 → Dirt`; `y = h → Grass`; above → Air. Inside `F` the surface block at `y = 8` is instead:

| cell `(x,z)` | block at `y = 8` |
|---|---|
| pad `x,z ∈ [52,76)` and (`x ∈ {52,75}` or `z ∈ {52,75}`) | LabTileEdge |
| pad interior | LabTile |
| `z ∈ [36,48)`, `x ∈ [52,64)` | BenchReactantTile |
| `z ∈ [36,48)`, `x ∈ [64,76)` | BenchProductTile |
| `z ∈ [48,50)`, `x ∈ [52,76)` | LabTile (walkway between pad and bench) |
| otherwise in `F` | Grass |

Fixed features placed after the column fill: `Block.Bench` at each `BENCH_BLOCKS` cell; Glass posts at the four pad corners `(52,y,52), (75,y,52), (52,y,75), (75,y,75)` for `y ∈ [9, 9 + GEN.glassPostHeight)`.

### 3.4 Ore veins

For element index `i` (0..7 over `BLOCK_ELEMENTS` without H): `rng = mulberry32((seed ^ Math.imul(0x9e3779b9, i + 1)) >>> 0)`; `count = 0; attempts = 0`. While `count < 400 && attempts < 2000`: `attempts++`; `x = floor(rng()·128)`, `z = floor(rng()·128)`; skip if `(x,z) ∈ F` expanded by 1 (`x ∈ [49,79)`, `z ∈ [33,79)`); `h = surfaceHeight(seed,x,z)`; `y0 = h − 1 − floor(rng()·3)` (so the blob centre is 1..3 below the surface); for `dx,dy,dz ∈ {−1,0,1}`: `c = (x+dx, y0+dy, z+dz)`; if in bounds, `getBlock(c) ∈ {Stone, Dirt}` and `rng() < 0.7`: `setBlock(c, oreBlockOf(el))`, `count++`. Blobs may overlap earlier veins of other elements (last write wins). Test asserts `count ≥ 400` per element with seed 1337.

### 3.5 Exposed outcrops (no digging for the first challenges)

`OUTCROPS` (x, z of the south-west cell), all outside `F` and within 8 cells of the pad edge:

| element | (x, z) |
|---|---|
| C | (80, 66) |
| N | (84, 60) |
| O | (66, 82) |
| S | (60, 84) |
| F | (47, 66) |
| Cl | (44, 60) |
| Br | (72, 82) |
| I | (54, 82) |

For each: `h = surfaceHeight(seed, x, z)`; set `(x,h,z), (x+1,h,z), (x,h,z+1), (x+1,h,z+1)` and `(x, h+1, z)` to the ore (5 blocks = 15 atoms). Outcrops are written last so nothing overwrites them.

### 3.6 Tests (`test/world/worldgen.test.ts`)

1. Two `generate` runs into fresh worlds produce byte-identical chunk data.
2. Every `(x,z)` outside `F`: surface height ∈ `[6,13]`; `getBlock(x,0,z) === Bedrock`.
3. Every pad cell: `getBlock(x,8,z) ∈ {LabTile, LabTileEdge}` with the edge ring exact; `getBlock(x,9,z) === Air` except the 8 glass-post cells.
4. Bench tiles and both `Block.Bench` cells exact; `SPAWN` column `(64,9..31,64)` is Air.
5. Ore count ≥ 400 per element; every `OUTCROPS` entry has ore at `(x,h,z)` and `(x,h+1,z)` with Air above.
6. `world.index.atoms.size === 0` after generation (no atom blocks are generated).

## 4. World edits and the molecule index

`MoleculeIndex`, `validatePlacement`, `validateBondChange`, `validateChargeChange`, `extractMolecules`, `extractComponent` are specified in `02-chemistry-core.md` §12 and are called from `Game.ts` as written there. Engine-side obligations:

- `World.setBlock` is the only writer of atom cells; it calls `index.addAtom/removeAtom` itself so the grid and the index never diverge.
- Orders, suppressed pairs and charges live only in the index (R9, 09 §1.6). `World.setBondOrder`/`suppressBond`/`restoreBond`/`setCharge` are the only writers; nothing in the renderer reads them from anywhere else. A suppressed pair is a touching atom pair with no bond: it contributes nothing to valence, connectivity or the extracted graph, and `removeAtomBlock` clears it (re-placing re-bonds).
- Context restore (§12.9) never rebuilds the index; the index survives a GPU context loss untouched. `rebuildFromGrid` is used only by tests and by the debug `setBlock` hook (which bypasses validation and then calls `index.rebuildFromGrid(get, currentOrders, currentCharges, index.suppressed)`).

## 5. Mesher (`mesher.ts`)

### 5.1 `FACES` (index order = `FACE_DIRS`; corners counter-clockwise seen from outside, so `(c1−c0)×(c2−c0)` points along `dir`; triangle indices `[0,1,2, 0,2,3]`)

| i | dir | corners (offsets from the cell origin) | shade |
|---|---|---|---|
| 0 | `+x` | `(1,0,0) (1,1,0) (1,1,1) (1,0,1)` | 0.8 |
| 1 | `−x` | `(0,0,0) (0,0,1) (0,1,1) (0,1,0)` | 0.8 |
| 2 | `+y` | `(0,1,0) (0,1,1) (1,1,1) (1,1,0)` | 1.0 |
| 3 | `−y` | `(0,0,0) (1,0,0) (1,0,1) (0,0,1)` | 0.5 |
| 4 | `+z` | `(0,0,1) (1,0,1) (1,1,1) (0,1,1)` | 0.7 |
| 5 | `−z` | `(0,0,0) (0,1,0) (1,1,0) (1,0,0)` | 0.7 |

### 5.2 `buildChunkMesh(get, ox, oz, paletteLinear, out): number`

`ox = cx·16`, `oz = cz·16`. `faces = 0`. For `y` in `0..31`, `z` in `0..15`, `x` in `0..15`:
1. `id = get(ox+x, y, oz+z)`; skip if `id === Block.Air || isAtom(id)`.
2. For `f` in `0..5`: `n = get(ox+x+dir.x, y+dir.y, oz+z+dir.z)` (the callback is `World.getBlock`, so cross-chunk and out-of-world lookups are correct: below `y=0` is Bedrock, so no `−y` face is emitted for bedrock); skip if `isOpaque(n)`.
3. `slot = (id === Block.Grass && f === 2) ? GRASS_TOP_SLOT : id`; `r,g,b = paletteLinear[slot·3..] · FACES[f].shade`.
4. `v = faces·4`; for `k` in `0..3`: `out.pos[(v+k)·3..] = (ox+x, y, oz+z) + corners[k]`; `out.nor[...] = dir`; `out.col[...] = (r,g,b)`.
5. `i = faces·6`; `out.idx[i..i+5] = v, v+1, v+2, v, v+2, v+3`. `faces++`.
Return `faces`. Never allocates. Vertices per chunk ≤ `MAX_FACES·4 = 196 608`, so the index buffer must be `Uint32Array` (a checkerboard chunk exceeds 65 535 vertices).

`buildPaletteLinear(toLinear)`: for every id `0..255` with a `blockHex`, write `toLinear(hex)` at `id·3`; slot 255 gets `toLinear(0x5fae45)`. `toLinear` is supplied by `render/palette.ts` (`new Color(hex)` → `.r .g .b`, which converts sRGB to linear); the pure test uses an explicit sRGB→linear function and checks that `0x808080` maps to `≈0.2158` per channel.

### 5.3 Tests (`test/world/mesher.test.ts`)

| fixture (all other cells Air, world bounds as `World.getBlock`) | faces | vertices | indices |
|---|---|---|---|
| one Stone at (5,5,5) | 6 | 24 | 36 |
| Stone at (5,5,5) and (6,5,5) | 10 | 40 | 60 |
| Stone at (5,5,5), AtomC at (6,5,5) | 6 (the atom cell emits nothing; the stone's `+x` face is still emitted) | 24 | 36 |
| Stone at (5,5,5), Glass at (6,5,5) | 11 (stone 6, glass 5) | 44 | 66 |
| Bedrock at (5,0,5) | 5 (no `−y` face: `get(5,−1,5)` is Bedrock) | 20 | 30 |
| Grass at (5,5,5): `+y` colour | `= paletteLinear[255]·1.0`; `−y` colour `= paletteLinear[4]·0.5` | | |
| Stone at (15,5,5) with Stone at (16,5,5) in the next chunk | the `+x` face of (15,5,5) is **not** emitted | | |
| chunk (0,0) filled with Stone (8192 cells), rest of the world Air | 2304 faces: top 256 + four sides 4·(16·32) = 2048; the 256 bottom faces are culled because `get(x,−1,z)` is Bedrock | 9216 | 13824 |

## 6. Picking (`raycast.ts`)

### 6.1 `raycastVoxels(ox,oy,oz, dx,dy,dz, maxDist, get)` — Amanatides–Woo

```
1. (x,y,z) = (floor(ox), floor(oy), floor(oz))
2. id = get(x,y,z); if id !== Block.Air: return { x,y,z, nx:0,ny:0,nz:0, t:0, id }   // started inside a block
3. per axis a ∈ {x,y,z}, with d = direction component and o = origin component:
     step_a  = d > 0 ? 1 : d < 0 ? −1 : 0
     tDelta_a = step_a === 0 ? Infinity : Math.abs(1 / d)
     tMax_a   = step_a > 0 ? (a + 1 − o) / d : step_a < 0 ? (a − o) / d : Infinity
4. (nx,ny,nz) = (0,0,0); t = 0
5. loop:
     if tMax_x <= tMax_y && tMax_x <= tMax_z:       // ties: x, then y, then z
         t = tMax_x; x += step_x; tMax_x += tDelta_x; (nx,ny,nz) = (−step_x, 0, 0)
     else if tMax_y <= tMax_z:
         t = tMax_y; y += step_y; tMax_y += tDelta_y; (nx,ny,nz) = (0, −step_y, 0)
     else:
         t = tMax_z; z += step_z; tMax_z += tDelta_z; (nx,ny,nz) = (0, 0, −step_z)
     if t > maxDist: return null
     id = get(x,y,z); if id !== Block.Air: return { x,y,z, nx,ny,nz, t, id }
```
The direction must be unit length so `t` is a world distance. The ray for the crosshair is `origin = eyePosition(player)`, `dir = lookDirection(yaw, pitch)` (§8), `maxDist = PICK_DISTANCE (6)`. A hit with normal `(0,0,0)` (started inside a block — cannot happen with a valid player position but happens with the debug teleport) disables placement.

`playerOverlapsCell(p, x,y,z)`: `x < p.x + halfW && x + 1 > p.x − halfW && y < p.y + height && y + 1 > p.y && z < p.z + halfW && z + 1 > p.z − halfW`.

### 6.2 Tests (`test/world/raycast.test.ts`)

| origin | dir | blocks | expect |
|---|---|---|---|
| (0.5,0.5,0.5) | (1,0,0) | Stone at (3,0,0) | hit (3,0,0), normal (−1,0,0), `t = 2.5` |
| (0.5,0.5,0.5) | (1,0,0) | Stone at (8,0,0) | `null` (t would be 7.5 > 6) |
| (3.5,0.5,0.5) | (1,0,0) | Stone at (3,0,0) | hit (3,0,0), normal (0,0,0), `t = 0` |
| (0.5,0.5,0.5) | normalize(1,0,1) | Stone at (2,0,2) only | hit (2,0,2), normal (0,0,−1), `t ≈ 2.1213` (path (0,0,0)→(1,0,0)→(1,0,1)→(2,0,1)→(2,0,2) by the tie rule) |
| (0.5,5.5,0.5) | (0,−1,0) | Stone at (0,2,0) | hit (0,2,0), normal (0,1,0), `t = 2.5` |
| (0.5,0.5,0.5) | (0,0,−1) | nothing; `get` returns Air | `null` after leaving the world |

## 7. Player physics (`player/physics.ts`)

Constants are `PLAYER` from `types.ts`: `halfW 0.3, height 1.8, eye 1.62, speed 4.3, sprint 6.5, jumpVel 8.5, gravity −28, maxFall −40, fixedDt 1/60, maxFrameDt 0.1, maxAxisStep 0.5`. `PHYSICS_EPS = 1e-4`.

### 7.1 `stepPlayer(p, input, dt, isSolid)` (one fixed step)

```
1. speed = input.sprint ? PLAYER.sprint : PLAYER.speed
   f = forward(p.yaw); r = right(p.yaw)
   wx = f.x·input.forward + r.x·input.strafe; wz = f.z·input.forward + r.z·input.strafe
   len = hypot(wx, wz); if len > 1: wx /= len; wz /= len
   p.vx = wx·speed; p.vz = wz·speed                       // no acceleration; instant stop
2. if input.jump && p.onGround: p.vy = PLAYER.jumpVel; p.onGround = false
   p.vy = max(PLAYER.maxFall, p.vy + PLAYER.gravity·dt)
3. moveAxis('x', p.vx·dt); moveAxis('z', p.vz·dt); p.onGround = false; moveAxis('y', p.vy·dt)
4. p.x = clamp(p.x, PLAYER.halfW, WORLD_W − PLAYER.halfW); p.z = clamp(p.z, PLAYER.halfW, WORLD_D − PLAYER.halfW)
   if p.y < 0: p.y = 0; p.vy = 0; p.onGround = true        // cannot happen (bedrock) but keeps the function total

moveAxis(axis, delta):
   if delta === 0: return
   n = ceil(|delta| / PLAYER.maxAxisStep); step = delta / n
   repeat n times:
       p[axis] += step
       if collide(axis, step): return              // stop the remaining sub-steps
collide(axis, step): 
   minX = floor(p.x − halfW), maxX = floor(p.x + halfW − 1e-6)   // same for z with halfW, for y with [p.y, p.y + height]
   for each cell (cx,cy,cz) in the box: if isSolid(cx,cy,cz):
       if axis === 'x': p.x = step > 0 ? cx − halfW − EPS : cx + 1 + halfW + EPS; p.vx = 0
       if axis === 'z': p.z = step > 0 ? cz − halfW − EPS : cz + 1 + halfW + EPS; p.vz = 0
       if axis === 'y': if step > 0: p.y = cy − height − EPS else: p.y = cy + 1 + EPS; p.onGround = true
                        p.vy = 0
       return true
   return false
```
Atom blocks are solid full cells although drawn at 0.62 scale (placement validation refuses cells overlapping the player, so the player is never inside one). `Game.ts` runs `while (acc >= fixedDt) { prev = copy(p); stepPlayer(p, move, fixedDt, world.isSolid); acc -= fixedDt }` with `acc += min(frameDt, maxFrameDt)` and interpolates the camera with `alpha = acc / fixedDt` (§14.2).

### 7.2 Tests (`test/player/physics.test.ts`, `isSolid = y < 1` floor unless stated)

1. Free fall from `y = 5`, no input, 120 steps: `y = 1 + 1e-4 ± 1e-6`, `vy = 0`, `onGround = true`.
2. Walk `forward = 1`, `yaw = 0` from `(2, 1.0001, 5)`: after 60 steps `z ≈ 5 − 4.3` (±0.01), `x` unchanged; with `sprint` → `5 − 6.5`.
3. Wall at cell `x = 3` (all y): start `x = 2.0`, strafe `+1` at `yaw = 0` (right = `+x`): stops at `x = 3 − 0.3 − 1e-4`.
4. Jump from ground: apex `y_max − y_0 ∈ [1.2, 1.35]` (analytic `8.5² / 56 = 1.29`); a second `jump` while airborne changes nothing.
5. Ceiling at `y = 3`, floor `y < 1`, jump: `y + height ≤ 3` at all times, `vy` becomes 0 at the bump.
6. Tunnelling: `vy = −40`, thin floor at `y = 1` only: lands on it (sub-steps: `40/60 = 0.667 → 2 steps`).
7. Clamp: strafe into `x < 0.3` stays at `0.3`.
8. `lookDirection(0, 0) = (0,0,−1)`; `lookDirection(π/2, 0) ≈ (−1,0,0)`; `lookDirection(0, −π/2) ≈ (0,−1,0)`.

## 8. Camera (`player/camera.ts`)

`FirstPersonCamera`: `camera = new PerspectiveCamera(70, 1, 0.05, 120)`, `camera.rotation.order = 'YXZ'`. `addLook(dx, dy)`: `yaw −= dx`, `pitch −= dy`, `pitch = clamp(pitch, −1.5533, 1.5533)`, then `camera.rotation.set(pitch, yaw, 0)`. `setFromPlayer(p, prev, alpha)`: `position = lerp(prev, p, alpha) + (0, PLAYER.eye, 0)`. `lookDirection(yaw, pitch) = (−sin yaw·cos pitch, sin pitch, −cos yaw·cos pitch)` (pure, in `physics.ts`, equals `camera.getWorldDirection`). `setSprinting(on, reducedMotion)`: target fov `76 : 70`; eased at `40°/s` unless `reducedMotion`, then set instantly; `updateProjectionMatrix()` when it changes. `setAspect(w,h)`: `camera.aspect = w/h; updateProjectionMatrix()`.

## 9. Input

### 9.1 Keymap (`input/keymap.ts`, pure)

07 §1.2 (`KEY_ACTIONS`, `KeyAction`, `DEFAULT_KEYS`, `Settings.keys`, `effectiveKeys`, `keyConflict`, all in `src/app/Settings.ts`) is the single source of default bindings, action names and validation. This file adds only the resolution used by `InputManager` and imports `KeyAction` as a type (no runtime import of `Settings.ts`, so the file stays pure). The defaults, restated from 07 §1.2 for reference only (07 wins on any difference):

| `KeyAction` | `DEFAULT_KEYS` code | held/edge | engine use |
|---|---|---|---|
| `forward` / `back` / `left` / `right` | KeyW / KeyS / KeyA / KeyD | held | `FrameInput.forward/strafe` |
| `jump` / `sprint` | Space / ShiftLeft | held | |
| `lookLeft` / `lookRight` | ArrowLeft / ArrowRight | held | yaw ±`turnRate` (2.5 rad/s) |
| `lookUp` / `lookDown` | ArrowUp / ArrowDown | held | pitch ±`0.6·turnRate` (1.5 rad/s) |
| `mine` | KeyQ | edge | also mouse button 0 (not remappable); §10.4 |
| `place` | KeyE | edge | also mouse button 2; place / cycle bond / cycle charge / open bench / select |
| `slot1`..`slot9` | Digit1..Digit9 | edge | C N O S F Cl Br I H |
| `bondWand` / `chargeTool` / `selectTool` | KeyB / KeyC / KeyV | edge | slots 9, 10, 11 |
| `slotPrev` / `slotNext` | BracketLeft / BracketRight | edge | in select mode these cycle candidates instead (07 §11.3) |
| `analyze` | KeyF | edge | §14.4 |
| `submit` | Enter | edge | |
| `nextChallenge` / `prevChallenge` | Period / Comma | edge | |
| `hint` / `roster` / `help` / `bench` | KeyI / KeyL / KeyH / KeyR | edge | forwarded to the HUD (07 §3) |
| `toggleHydrogens` | KeyT | edge | flips `Settings.showHydrogens` |
| `clearSelection` | Backspace | edge | select mode |
| *(fixed, not in the map)* `'pause'` / `'debug'` | Escape / F3 | edge | never remappable, never prevented (07 §3) |
| *(fixed)* Tab | Tab | — | leaves the canvas; never handled |

```ts
// src/input/keymap.ts (pure; `import type { KeyAction } from '../app/Settings'` only)
export type InputAction = KeyAction | 'pause' | 'debug';
export const FIXED_CODES: Readonly<Record<string, 'pause' | 'debug'>> = { Escape: 'pause', F3: 'debug' };
export const HELD_ACTIONS: ReadonlySet<InputAction>;   // forward back left right jump sprint lookLeft lookRight lookUp lookDown
export const RESERVED_CODES: ReadonlySet<string>;      // 'Tab', 'Escape', 'F1' .. 'F12' (never bindable, never prevented; same set keyConflict reports as 'reserved')
export const SCROLL_CODES: ReadonlySet<string>;        // 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'
/** FIXED_CODES[code] ?? the first action whose bound code equals `code` (KEY_ACTIONS order) ?? null. */
export function resolveAction(keys: Readonly<Record<KeyAction, string>>, code: string): InputAction | null;
/** !RESERVED_CODES.has(code) && (SCROLL_CODES.has(code) || resolveAction(keys, code) !== null). */
export function shouldPreventDefault(keys: Readonly<Record<KeyAction, string>>, code: string): boolean;
```

There is no `validateKeymap` and no `SETTINGS_DEFAULTS` here: 07's `keyConflict` validates one change at a time in the settings panel (07 §15.1), and `DEFAULT_SETTINGS` (07 §1.2) holds the defaults, with `showHydrogens: false` (studs by default; 07 §11.1), `sensitivity: 0.002` (range `0.0005..0.006`), `turnRate: 2.5`, `invertY: false`, `lowGraphics: false` (start-up heuristic in §11.1), `reducedMotion: 'auto'`.

`test/input/keymap.test.ts` (node; imports `DEFAULT_KEYS` from `src/app/Settings.ts`, which must touch `localStorage` only inside `loadSettings`/`saveSettings` so the import is side-effect free): `resolveAction(DEFAULT_KEYS, 'KeyW') === 'forward'`; `'KeyB' → 'bondWand'`; `'KeyT' → 'toggleHydrogens'`; `'Escape' → 'pause'` and `'F3' → 'debug'` for any map; `'KeyZ' → null`; with the override `{ ...DEFAULT_KEYS, forward: 'KeyZ' }`: `'KeyZ' → 'forward'` and `'KeyW' → null`; `shouldPreventDefault` true for `Space`, `ArrowUp`, `KeyW`, `Digit1`, `Period`, `PageDown`; false for `Tab`, `Escape`, `KeyZ`, `F5`, `F3`; `HELD_ACTIONS.size === 10`.

### 9.2 `InputManager` (DOM) — focus policy

Canvas markup (07 §2.1 owns `index.html`; the engine relies on it): `<canvas id="canvas" tabindex="0" role="application" aria-label="OrgoCraft 3D world. Press H for controls, Escape to open the menu, Tab to leave the world. Arrow keys look, W A S D move.">` (the `aria-label` is regenerated by 07 when keys are remapped).

Listeners and rules:
1. `canvas pointerdown` → `canvas.focus()` (so keys work after the first click); `preventDefault()` so the click does not select page text. `canvas contextmenu` → `preventDefault()`.
2. `window keydown/keyup` (capture phase): ignore unless `active()` and `!modal` and `event.target` is not an `input | textarea | select | button | [contenteditable]`. Then `code = event.code`, `keys = getKeys()`; if `shouldPreventDefault(keys, code)` → `event.preventDefault()`. Never prevent `Tab`, `Escape`, `F1`–`F12` (`RESERVED_CODES`). `a = resolveAction(keys, code)`; `HELD_ACTIONS.has(a)` → add/remove `a` in `held`. Edge actions: on `keydown` with `!event.repeat` push `a` to `pressed`. `'pause'` (Escape) is pushed even when pointer lock is held (the browser releases the lock; the pause menu opens on the same key).
3. `wheel` on the canvas, `{ passive: false }`: `preventDefault()`; if `performance.now() − lastWheel ≥ 60 ms` and `|deltaY| ≥ 1`: `wheelSteps += sign(deltaY)`, `lastWheel = now`.
4. `keys.clear()` on canvas `blur`, window `blur`, `visibilitychange` (hidden), `pointerlockchange` (either direction) — no stuck movement after clicking the D2L chrome.
5. `focus`/`blur` on the canvas emit `'input:focus'` `{ focused }` (the HUD shows `ENGINE_TEXT.clickToPlay` while unfocused).
6. Mouse buttons: `mousedown` on the canvas with `button === 0` → `'mine'`, `button === 2` → `'place'`, but only in `locked` mode (in `drag` mode `LookModes` decides, §9.4). `pointermove` while locked: `lookDX += movementX`, `lookDY += movementY`.
7. `consumeFrame()`: builds `move` from `held` (`forward = (held.has('forward')?1:0) − (held.has('back')?1:0)`, `strafe = (held.has('right')?1:0) − (held.has('left')?1:0)`, `jump = held.has('jump')`, `sprint = held.has('sprint')`), `keyLook` from `lookLeft/lookRight/lookUp/lookDown` (`yaw = left − right`, `pitch = up − down`), returns and resets `lookDX/DY`, `pressed`, `wheelSteps`. Remapped keys therefore work everywhere without a second lookup table.

Single-character shortcuts are therefore active only while the canvas has focus (WCAG 2.1.4); Tab leaves the canvas normally (2.1.2, stated in the aria-label and Help).

### 9.3 Pointer lock (`input/pointerlock.ts`)

```
async function requestLock(el):
  if (!('requestPointerLock' in el)) return 'unsupported'
  try { await el.requestPointerLock({ unadjustedMovement: true }) }
  catch (e) {
    if (e is DOMException && e.name === 'NotSupportedError') { try { await el.requestPointerLock() } catch { return 'rejected' } }
    else return 'rejected'
  }
  await sleep(LOCK_VERIFY_MS)                       // 150 ms: engines that return undefined instead of a promise
  return document.pointerLockElement === el ? 'locked' : 'unverified'
```
Must be called synchronously inside the click handler (transient activation). `pointerlockchange` and `pointerlockerror` on `document` are the ground truth and are handled by `LookModes`; the returned promise only decides the fallback.

### 9.4 Look modes (`input/look-modes.ts`)

State: `mode: LookMode` (initial `'keys'`), `lockAllowed = true`, `failures = 0`, `lastUnlockAt = −Infinity`, `drag: { active, startX, startY, startT, pointerId } | null`, `longPress: timer | null`.

Events:
- **Canvas click (`pointerdown`, `button 0`, `pointerType 'mouse'`)**: if `mode === 'locked'` → return (the button is already handled by `InputManager` rule 6; no second `mine`). Else if `lockAllowed && now − lastUnlockAt ≥ RELOCK_COOLDOWN_MS`: call `requestLock(canvas)`; meanwhile start a drag (so the click still works if the lock fails). On `'locked'` → nothing more (the `pointerlockchange` handler switches the mode). On `'rejected' | 'unverified' | 'unsupported'` → `failures++`; if `failures ≥ MAX_LOCK_FAILURES` → `lockAllowed = false`; set `mode = 'drag'`; emit `'look:mode'` and `'live:announce'` with `ENGINE_TEXT.dragToLook` (once). Else (cooldown) → drag only.
- **`pointerlockchange`**: `document.pointerLockElement === canvas` → `mode = 'locked'`, emit `'look:mode' {mode:'locked'}`; the HUD shows `ENGINE_TEXT.lockedHint` for 3 s. Otherwise (Esc, tab switch): `lastUnlockAt = now`, `mode = 'drag'` (never auto-relock; the next click re-attempts after the cooldown), emit `'look:mode'`.
- **`pointerlockerror`**: same as a rejected promise.
- **Drag** (`pointerType 'mouse'`, `mode !== 'locked'`): `pointerdown 0` → `setPointerCapture(pointerId)`, `drag = {…}`; `pointermove` → `lookDX += movementX; lookDY += movementY` (`movementX/Y` are valid unlocked); `pointerup` → if `now − startT < 250 ms` and `hypot(dx,dy) < 5 px` → inject `'mine'`; release capture. `pointerdown 2` → inject `'place'`.
- **Touch** (`pointerType 'touch'`): one-finger drag = look (`sensitivity × 1.5`); tap (< 250 ms, < 10 px) = `'mine'`; press ≥ 500 ms without moving 10 px = `'place'` (vibrate 20 ms if available). The on-screen D-pad/Jump/Mine/Place buttons (07, shown when `matchMedia('(pointer: coarse)')`) call `input.inject` (button ids `#tc-forward`, `#tc-back`, `#tc-left`, `#tc-right`, `#tc-jump`, `#tc-mine`, `#tc-place`, 07 §21.9).
- **Keys**: the arrow keys always feed `keyLook`, in every mode, so the game is fully playable when pointer lock is refused inside a sandboxed frame.

Per frame `Game.ts` applies `camera.addLook(lookDX·sensitivity, lookDY·sensitivity·(invertY ? −1 : 1))` and `camera.addLook(−keyLook.yaw·turnRate·dt, −keyLook.pitch·0.6·turnRate·dt)` with `sensitivity`, `invertY`, `turnRate` from `Settings` (07 §1.2) (arrow-left turns left = yaw increases; arrow-up pitches up).

## 10. Tools, hotbar, targeting

### 10.1 Hotbar model

`HOTBAR` is declared once, in `src/app/State.ts` (07 §1.1): `['C','N','O','S','F','Cl','Br','I','H','bond-wand','charge-tool','select-tool']`; `State.slot` indexes it. Game derives its tool union with `toolOf(entry: BlockElement | HotbarTool): Tool` (§1):

| slot | key (`DEFAULT_KEYS`) | `HOTBAR[slot]` | `toolOf` | count badge |
|---|---|---|---|---|
| 0–7 | `slot1`..`slot8` = Digit1–Digit8 | `'C' 'N' 'O' 'S' 'F' 'Cl' 'Br' 'I'` | `{kind:'atom', el}` | `inventory[el]` (starts at 0; ore yields 3) |
| 8 | `slot9` = Digit9 | `'H'` | `{kind:'atom', el:'H'}` | `∞` (`inventory.H = Infinity`) |
| 9 | `bondWand` = KeyB | `'bond-wand'` | `{kind:'bond'}` | — |
| 10 | `chargeTool` = KeyC | `'charge-tool'` | `{kind:'charge'}` | — |
| 11 | `selectTool` = KeyV | `'select-tool'` | `{kind:'select'}` | — |

`slotNext`/`slotPrev` (`]` / `[`) and the wheel call `state.cycleSlot(±1)` (modulo 12; except in select mode, §10.5). Changing the slot emits `'inventory:changed' { counts, slot }` (there is no separate tool event; the HUD reads `HOTBAR[slot]`). Inventory persists to `localStorage[STORAGE_KEY_INVENTORY]` (07 `Settings.ts` writes it; Game reads it at start); the persisted record omits `H` (`Infinity` does not survive JSON) and Game restores `inventory.H = Infinity`.

### 10.2 Hover resolution (every frame, §14.3)

1. `eye = eyePosition(p)`, `dir = lookDirection(yaw, pitch)`.
2. `vh = raycastVoxels(eye…, dir…, PICK_DISTANCE, world.getBlock)`.
3. Bond pick (only when `tool.kind === 'bond'`): `Raycaster.set(eye, dir).intersectObject(bondRenderer.pickMesh)`; `bh` = nearest with `distance ≤ PICK_DISTANCE`. If `bh && (!vh || bh.distance < vh.t + 0.2)` → hover is `{ kind: 'bond', pair: bondRenderer.pairOf(bh.instanceId), order: index.wandOrder(pair) }`; the pick mesh carries one instance per bond and one per suppressed pair (break marker), so `order` is 0 when a break marker is hovered (09 §5.1).
4. Hydrogen pick (only when `tool.kind === 'select'`): `intersectObject(atomRenderer.hydrogenMesh)` (the mini-block mesh, visible in select mode); nearest with `distance ≤ PICK_DISTANCE` and `< vh.t` → `{ kind:'hydrogen', cell, slot, explicit:false }`. An explicit H block is an ordinary atom cell and is reported as `{ kind:'hydrogen', cell, slot, explicit:true }` with `slot` = its index in the parent's `hPos` order (ascending `cellIndex`).
5. Otherwise from `vh`: `null → 'none'`; `id === Block.Bench → 'bench'`; `isAtom(id) → 'atom'` with `bonds = index.bondsOf(key).length`, `hydrogens = max(0, targetValence(el, charge) − index.bondOrderSum(key))`, `component = index.componentOf(key)`; else `'block'`.
6. Emit `'hover:changed'` only when the value differs from the previous frame (structural comparison).

### 10.3 Targeted molecule

`target = hover.kind === 'atom' | 'hydrogen'(explicit) ? component of that cell : nearest component`; nearest = the component whose closest atom centre to `eye` is within 8 blocks, ties by lower id; else `null`. Emit `'target:changed' { component, cell: hovered atom cell | null, pair: hovered bond | null }` when any field changes. The panel (07) shows `State.analyses.get(target)`.

### 10.4 `mine` / `place` semantics

`lockedCells(state)` (§10.6) are checked first: any `mine` on a locked cell, any `place` that would create a bond to a locked cell (placement whose `newBonds` touch one), any bond change whose pair touches one, or any charge change on one is refused with `REFUSAL_TEXT.lockedZone` (07 §1.1 step 2 reuses it verbatim until 07 §21.3's `lockedMolecule` entry lands; `ENGINE_TEXT.lockedMolecule` is the requested text), emitted as `'block:refused'` with the cell.

| tool (`toolOf(HOTBAR[slot])`) | hover | `mine` (LMB / Q) | `place` (RMB / E) |
|---|---|---|---|
| atom | block, breakable | mine: `world.setBlock(Air)`; if ore → `inventory[el] += 3`, live text `ENGINE_TEXT.mined(el, 3)`; emit `block:removed` | place: `cell = hit + normal`; if `normal = (0,0,0)` → nothing; `r = validatePlacement(index, cell, el, ctx)`; ok → `world.setBlock(cell, atomBlockOf(el))`, `inventory[el]−−` (not H), emit `block:placed { …, el, zone }`; refused → emit `block:refused { message }` and flash the outline (§12.6) |
| atom | block, unbreakable | nothing | place (as above) |
| atom | atom | mine: `world.removeAtomBlock` → `inventory[el] += 1` for the atom (H: none); emit `block:removed` per cell; also `selection` entries on removed cells are dropped | place |
| atom | hydrogen (explicit block) | mine the H block (`setBlock(Air)`) | place against it (the H block already has its one bond, so `validatePlacement` refuses with `'valence'` `H would have 2 bonds…`) |
| atom | bench | nothing | emit `'bench:open'` |
| atom | none | nothing | nothing |
| bond | bond (bar or break marker) | live text `ENGINE_TEXT.bondWandPrimary` | `r = validateBondChange(index, pair, ctx)` (cycle `1 → 2 → 3 → 0 → 1`, 09 §1.3); refused → `block:refused` (flash, §12.6); `r.order === 0` → `world.suppressBond(pair)`, emit `bond:suppressed { pair, previous }`; `r.previous === 0` → `world.restoreBond(pair)` (+ `setBondOrder` when `r.order > 1`), emit `bond:restored { pair, order }`; else `world.setBondOrder(pair, r.order)`, emit `bond:changed { pair, order, previous }` |
| bond | atom / block / none | nothing (no accidental mining with the wand) | bench → `'bench:open'`; else live text `ENGINE_TEXT.noBondHere` |
| charge | atom (not H) | cycle `0 → +1 → −1 → 0`: try `next(q)`, then `next(next(q))`; first `validateChargeChange` ok wins → `world.setCharge`, emit `charge:changed`; none ok → `block:refused` with the first refusal message | cycle in reverse `0 → −1 → +1 → 0` |
| charge | hydrogen | `block:refused` with `REFUSAL_TEXT` from the `'h-block'` refusal | same |
| charge | other | live text `ENGINE_TEXT.noAtomHere` | bench → `'bench:open'` |
| select | atom | `item = itemOf(cell)` (locked: `{ molecule, atom }` from `locked[i].cellToAtom`; otherwise `{ molecule: 0, atom: target.cellToAtom.get(cell) }`); rule `match:'any'` → `state.setSelection([item])`, else `state.toggleSelection(item)`; for a `'hydrogens'` rule State's `normalizeSelection` expands the heavy atom to all its hydrogens (05 §7.6) and returns `'no-hydrogens'` when it has none → live text `ENGINE_TEXT.selectNoHydrogens` (toast, no attempt consumed) | same as `mine` |
| select | hydrogen | `item = { ...itemOf(parent), hSlot: slot }` → `setSelection`/`toggleSelection` as above | same |
| select | other | nothing | bench → `'bench:open'` |

Every selection change is emitted by State as `'selection:changed' { cells, hydrogens }` (the event keeps the cell shape of `src/app/events.ts`: State maps items back to cells through `locked[i].atomToCell` / `target.atomToCell`). Mining a Glass block yields nothing (`ENGINE_TEXT.mineNoYield`). Placement context: `ctx = { getBlock: world.getBlock, player: p, lockedZones: new Set(['reactant']), inventory }`.

Other pressed actions (`handlePressed`, §14.2): `slot1..slot9`, `bondWand`, `chargeTool`, `selectTool` → `state.selectSlot(0..8, 9, 10, 11)`; `slotPrev`/`slotNext` → `state.cycleSlot(∓1)` (or candidate cycling in select mode, §10.5); `toggleHydrogens` → `saveSettings({ ...settings, showHydrogens: !settings.showHydrogens })` and emit `'settings:changed' { key: 'showHydrogens', value }` (ignored while select mode forces `'select'`); `analyze` → force an immediate analysis of `target` (§14.4) then emit `'analyze:requested' { component: target }`; `submit` → `state.submit()`; `nextChallenge`/`prevChallenge` → `state.nextChallenge()`/`prevChallenge()`; `clearSelection` → `state.clearSelection()`; `hint`, `roster`, `help`, `bench` → forwarded to the HUD (07 §3: hint text, roster drawer, help dialog, bench panel — `bench` also emits `'bench:open'`); `'pause'` (Escape) → `state.setPaused(true)` and the pause menu; `'debug'` (F3) → §14.8.

### 10.5 Select mode

While `HOTBAR[state.slot] === 'select-tool'` or a `select-atom` challenge is current: hydrogens are forced visible as pickable mini-blocks (`setHydrogenMode('select')`, §12.3) when the rule targets hydrogens, `slotPrev`/`slotNext` and the wheel are handed to `ui/select-atom.ts` (07 §11.3) which cycles the candidate list of 07 §11.1 (locked molecules in rule order; heavy atoms in atom-id order for `'atoms'` rules; per atom explicit H blocks then `implicitHCell` cells in slot order for `'hydrogens'` rules); the cycled candidate is treated as the hover for mine/place and is shown with the hover shell. Leaving the select tool (and the challenge) restores hotbar cycling.

### 10.6 Locked molecules (placed by Game from content)

`placeLockedMolecule(g: MoleculeGraph, emb: Embedding, anchorMin: Vec3, zone: Zone, molecule: number): LockedPlacement` (07 §1.1 shape):
1. Positions: `emb = layoutOf(entry)` (05 §1; `embedOnLattice` fallback inside it); a `null` embedding throws (content validation guarantees buildability, 05 R13).
2. Translate `emb.pos ∪ emb.hPos` so the bounding-box minimum equals `anchorMin`.
3. For every atom in id order: `world.setBlock(pos, atomBlockOf(el))`; then `world.suppressBond(pairKey(cell(a), cell(b)))` for every `[a, b]` of `emb.suppressedPairs` (09 §3.3: touching atoms the target does not bond); then `world.setCharge` for non-zero charges; then `world.setBondOrder` for every bond with `order > 1`; then explicit H blocks from `hPos` (after the heavy atoms so each H has its parent). Locked cells refuse the wand, so a locked suppression cannot be undone by the student.
4. Return `{ molecule, cellToAtom, atomToCell, hCells, analysis: analyze(g), zone }`; `State.locked` is the list of placements and `lockedCells(state) = ∪ locked[i].cellToAtom.keys() ∪ hCells values` (helper in State.ts, §1). Locked cells are removed with `world.setBlock(Air)` (no inventory change) when the challenge changes or the bench is cleared (`bench:cleared`).

Anchor table (the only one; 00-contracts §3 mirrors it; every anchor is at `y = 10` so the `−y` face of every atom in the bottom layer is Air and `implicitHCell` can use it, and so rings have a free row under them, R15):

| placement | anchor (`anchorMin`) | extent | zone |
|---|---|---|---|
| select-atom molecule `i` (0..2), quiz `display` (`i = 0`) | `LOCKED_ORIGINS[i]` = `[55,10,55]`, `[65,10,55]`, `[55,10,66]` (07 §1.1) | `LOCKED_EXTENT = [8, 20, 8]`: cells `x ∈ [ox, ox+7]`, `y ∈ [10, 29]`, `z ∈ [oz, oz+7]` | `pad` |
| bench reactant | `REACTANT_MIN = [53,10,37]` (04 §7.2) | to `REACTANT_MAX = [62,30,46]` | `reactant` |
| bench `rx` | `[reactant max x + 3, 10, 37]` (04 §7.2) | inside `REACTANT_MAX` | `reactant` |
| ghost preview (§12.5) | `PRODUCT_MIN = [65,10,37]` (04 §7.2) | to `PRODUCT_MAX = [74,30,46]` | `product` |

Slot boxes leave two empty columns between `LOCKED_ORIGINS[0]` and `[1]` (`x = 63, 64`) and three empty rows between `[0]` and `[2]` (`z = 63..65`), so no phantom bonds form between locked molecules and the player's spawn cells (`x, z ∈ {63, 64}` at `SPAWN`) are never occupied. Content validation (`src/content/validate.ts`, obligation V-LOCK in §1) checks that every placement fits its extent and that every implicit-H candidate cell of every locked atom is Air after placement.

## 11. Rendering: renderer, palette, lights

### 11.1 `render/Renderer.ts`

```ts
export interface GfxProfile { antialias: boolean; maxPixelRatio: number; fogNear: number; fogFar: number; cameraFar: number; chunkRebuildsPerFrame: number; }
export const GFX_NORMAL: GfxProfile = { antialias: true,  maxPixelRatio: 1.5, fogNear: 40, fogFar: 110, cameraFar: 120, chunkRebuildsPerFrame: 2 };
export const GFX_LOW:    GfxProfile = { antialias: false, maxPixelRatio: 1.0, fogNear: 28, fogFar: 64,  cameraFar: 72,  chunkRebuildsPerFrame: 1 };
export const CLEAR_COLOR = 0x9fc5e8;
export function detectLowGfx(): boolean;       // startup heuristic below
export class Renderer {
  constructor(canvas: HTMLCanvasElement, stage: HTMLElement, lowGfx: boolean, emitter: Emitter);
  readonly gl: WebGLRenderer; readonly scene: Scene; profile: GfxProfile; contextLost: boolean;
  applyProfile(p: GfxProfile): void;           // pixel ratio, fog, camera.far (antialias needs a reload)
  resizeNow(): void;                           // §11.4
  render(camera: PerspectiveCamera): void;
  stats(): { triangles: number; calls: number };
  dispose(): void;
}
```

`new WebGLRenderer({ canvas, antialias: !lowGfx, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false })`; `outputColorSpace` left at its default (`SRGBColorSpace`); `setPixelRatio(min(devicePixelRatio, profile.maxPixelRatio))`; `scene.background = new Color(CLEAR_COLOR)`; `scene.fog = new Fog(CLEAR_COLOR, fogNear, fogFar)`. If `WebGLRenderer` construction throws, `main.ts` shows the no-WebGL message and stops.

`detectLowGfx()`: true when `matchMedia('(prefers-reduced-motion: reduce)').matches`, or `navigator.hardwareConcurrency <= 4`, or `/CrOS/.test(navigator.userAgent)`, or the unmasked renderer string (`gl.getExtension('WEBGL_debug_renderer_info')`, `UNMASKED_RENDERER_WEBGL`) contains `SwiftShader` or `llvmpipe`. Start-up value: `lowGfx = wasStored('lowGraphics') ? settings.lowGraphics : detectLowGfx()` (`wasStored` declared in §1; once the student has saved the Graphics select, the heuristic never overrides it). Runtime check: after 120 rendered frames, if the mean frame time > 22 ms and the profile is normal → `applyProfile(GFX_LOW)` (pixel ratio, fog, far only; `antialias` stays until reload) and emit `'gfx:changed'`.

### 11.2 `render/palette.ts`

`toLinear(hex): [r,g,b]` = `const c = new Color(hex); return [c.r, c.g, c.b]` (sRGB → linear by three's colour management). `PALETTE_LINEAR = buildPaletteLinear(toLinear)`. Vertex colours are consumed linear (`color_vertex.glsl` multiplies without conversion). Every `CanvasTexture` sets `texture.colorSpace = SRGBColorSpace`. `test/render/palette.test.ts` (node, if the pure conversion is isolated as `srgbToLinear(c) = c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`): `0x808080 → 0.2158 ± 0.001`.

### 11.3 `render/lights.ts`

`HemisphereLight(0xdfe9ff, 0x6b6b6b, 1.0)` and `DirectionalLight(0xffffff, 1.2)` with `position.set(0.5, 1, 0.3)` (target at the origin, no shadows). All lit materials are `MeshLambertMaterial`.

### 11.4 Resize inside the D2L iframe (R16, critic 2.4)

- `framed = window.self !== window.top`.
- CSS (07 `styles.css`, values fixed here): `html, body { margin:0; overflow:hidden; }`, `#stage { position:relative; width:100%; }`; framed → `#stage { height:100vh; }` (100vh is the iframe's own height, which D2L sizes to the document; there is no auto-height feedback because the stage does not grow with its content); top-level → `#stage { aspect-ratio:16/9; max-height:100dvh; min-height:480px; }`; `#stage:fullscreen { width:100vw; height:100vh; aspect-ratio:auto; max-height:none; }`; `canvas#canvas { display:block; position:absolute; inset:0; width:100%; height:100%; }`. The canvas focus ring is 07 §2.3's two-tone inset rule (`#canvas:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; box-shadow: inset 0 0 0 5px #000; }`), which smoke step 13 checks; nothing here overrides it.
- `ResizeObserver` on `#stage` → `resizePending = true`; the loop calls `resizeNow()` at most once per frame: `w = stage.clientWidth`, `h = stage.clientHeight`; skip when either is 0; `gl.setPixelRatio(min(devicePixelRatio, maxPixelRatio))`; `gl.setSize(w, h, false)` (CSS size stays 100%); `camera.setAspect(w, h)`. Never reads `window.innerWidth/innerHeight`.
- Fullscreen: the toolbar button (07) calls `stage.requestFullscreen()` inside its click handler; hidden when `!document.fullscreenEnabled`; `fullscreenchange` triggers a resize through the observer. Pointer lock is requested before fullscreen when both are wanted (spec order); in practice the lock is (re)acquired by the next canvas click.
- Visibility: `document.hidden` or an `IntersectionObserver` on the canvas reporting `intersectionRatio === 0` → `Game.paused = true` (loop keeps running but skips physics and rendering; `last` timestamp is reset on resume so the clamp does not produce a jump).

## 12. Rendering: chunks, atoms, bonds, overlays

### 12.1 `render/ChunkRenderer.ts`

One `Mesh` per chunk, created on first build at the scene origin with `matrixAutoUpdate = false` (the mesher emits **world-space** vertices through `ox/oz`, so no per-chunk matrix is needed and `computeBoundingSphere()` yields the correct cull volume directly), `frustumCulled = true`, shared `MeshLambertMaterial({ vertexColors: true })`. `rebuildDirty(world, p, maxPerFrame)`: for each chunk in `world.dirtyChunks(p.x, p.z).slice(0, maxPerFrame)`: `faces = buildChunkMesh(world.getBlock, cx·16, cz·16, PALETTE_LINEAR, buffers)`; then `applyChunkMesh(chunk, buffers, faces)`:
1. `chunk.mesh?.geometry.dispose()`.
2. `g = new BufferGeometry()`; `g.setAttribute('position', new BufferAttribute(buffers.pos.slice(0, faces·12), 3))`, same for `normal` and `color`; `g.setIndex(new BufferAttribute(buffers.idx.slice(0, faces·6), 1))`; `g.computeBoundingSphere()` (without it frustum culling pops chunks in and out).
3. `faces === 0` → remove the mesh from the scene; else `chunk.mesh.geometry = g` (create and add the mesh on first use).
4. `chunk.dirty = false`.
`markAllDirty()` for context restore.

### 12.2 `render/element-texture.ts`

`makeElementTexture(symbol, bgHex, fg, size = 128): CanvasTexture`: fill `#bg`; border 6 px in `bg × 0.6` (per-channel); text `symbol` in `700 ${round(size·0.7·(symbol.length === 1 ? 1 : 0.72))}px system-ui, Arial, sans-serif`, `textAlign center`, `textBaseline middle`, colour `fg` (`'white'`/`'black'` from `CPK_TEXT`), at `(size/2, size/2 + size·0.03)`; `texture.colorSpace = SRGBColorSpace`, `generateMipmaps = true`, `minFilter = LinearMipmapLinearFilter`, `magFilter = LinearFilter`, `anisotropy = min(4, gl.capabilities.getMaxAnisotropy())`. All six faces share the texture (BoxGeometry default UVs). Also `makeGlyphTexture(text, bgHex, fgHex, size = 64)` (round disc background) for badges and sprite labels; textures are cached by `(text, bg, fg)`.

### 12.3 `render/AtomRenderer.ts`

```ts
export const ATOM_SCALE = 0.62, EXPLICIT_H_SCALE = 0.55, STUD_SIZE = 0.16, STUD_OFFSET = 0.40, H_BLOCK_SCALE = 0.4;
export const INITIAL_CAPACITY = 1024;   // per element; doubled (mesh recreated) when exceeded
export interface AtomView { hydrogenMode: 'studs' | 'blocks' | 'select'; dimCells: ReadonlySet<CellKey>; }   // hydrogenMode from hooks.setHydrogenMode (07 §1.3): 'studs' when !Settings.showHydrogens, 'blocks' when true, 'select' forced by select-atom rules
export class AtomRenderer {
  constructor(scene: Scene, textures: ElementTextures);
  readonly hydrogenMesh: InstancedMesh;     // mini-blocks (select mode); pickable
  update(index: MoleculeIndex, view: AtomView): void;
  hydrogenOf(instanceId: number): { cell: CellKey; slot: number } | null;
  dispose(): void;
}
```
- One `InstancedMesh(BoxGeometry(ATOM_SCALE), MeshLambertMaterial({ map: texture(el), color: 0xffffff }), capacity)` per element in `BLOCK_ELEMENTS` (9 meshes; the H mesh uses `EXPLICIT_H_SCALE`). Instance matrix = translation to the cell centre. `count = n`, `instanceMatrix.needsUpdate = true`, and `computeBoundingSphere()` after each update (`InstancedMesh.raycast` and frustum culling read the cached sphere).
- Order: iterate `index.atoms` sorted by `cellIndex` so instance ids are stable between frames for equal content.
- **Dim tint (the only use of `instanceColor` on atoms)**: `setColorAt(i, cell ∈ dimCells ? GREY_DIM : WHITE)` for every instance (including reused slots, because the attribute persists), `instanceColor.needsUpdate = true`. `GREY_DIM = Color(0.72,0.72,0.72)` (linear). `dimCells` = the cells of `State.locked` placements whose `zone === 'reactant'`. `instanceColor` is a diffuse multiplier: it can darken, never brighten, so the targeted/hover/selected states are drawn by `Highlight.ts` shells (§12.6), never by `setColorAt`.
- **Implicit-H studs** (`hydrogenMode:'studs'`): a separate `InstancedMesh(BoxGeometry(STUD_SIZE), MeshLambertMaterial({ color: CPK_HEX.H }))`, capacity 4096 (doubling). Per heavy atom: `nH = max(0, targetValence(el, charge) − index.bondOrderSum(key))` (implicit only: explicit H blocks are counted in `bondOrderSum`); for `k` in `0..nH−1`: `c = implicitHCell(world.getBlock, x, y, z, k)` (§1; free = `Block.Air`, in `H_FILL_ORDER`); `c === null` → stop (no free face left); stud centre = cell centre `+ (c − cell)·STUD_OFFSET`. Not pickable (`layers.set(1)`, the pick raycasters use layer 0). Because the floor tile under an atom at `y = 9` is not Air, `implicitHCell` never puts a hydrogen inside the pad; locked molecules sit at `y = 10` (§10.6) so their `−y` face is always free.
- **H mini-blocks** (`hydrogenMode:'blocks'` at 65 % opacity, `'select'` at 100 %; 07 §1.3 `setHydrogenMode`): `hydrogenMesh = InstancedMesh(BoxGeometry(H_BLOCK_SCALE), MeshLambertMaterial({ map: texture('H'), transparent: true }))`; same `implicitHCell` cells but centred on the neighbour cell centre `c + 0.5`; `hydrogenOf(instanceId) = { cell: parentKey, slot: explicitCount + k }` where `k` is the stud index and `explicitCount = index.neighbours(parentKey).filter(a => a.el === 'H').length` (contract: explicit blocks come first in `slot` order, ascending `cellIndex`; the renderer never needs `hPos`). This is exactly the cell 07 §11.1 computes for candidate `slot − explicit.length`, so picking and drawing agree by construction. In `'studs'` mode the mesh is `visible = false` and `count = 0`.
- **Charge badges**: `Sprite(SpriteMaterial({ map: glyph('+'|'−', 0xef5350|0x4a7bff, white), depthWrite: false }))`, scale `0.28`, at cell centre `+ (0, 0.5, 0)`; one sprite per charged atom, pooled.
- Rebuild policy: `update()` runs on the frame after any world edit (`world.editVersion` changed) or view change; it iterates the index, never the grid.

### 12.4 `render/BondRenderer.ts`

```ts
export const BAR_W = 0.11, BAR_W_MULTI = 0.08, BAR_LEN = 1.0, OFFSET_2 = 0.13, OFFSET_3 = 0.17, PICK_W = 0.3;
export const BOND_GREY = 0x9a9a9a, BOND_WARN = 0xef5350;
export const BREAK_SIZE = 0.44, BREAK_THICK = 0.04, BREAK_RED = 0xd32f2f;   // break marker (09 §5.2)
export class BondRenderer {
  constructor(scene: Scene);
  readonly pickMesh: InstancedMesh;         // visible = false; one instance per bond (not per bar)
  update(index: MoleculeIndex, warnPairs: ReadonlySet<PairKey>, showGlyphs: boolean): void;
  pairOf(instanceId: number): PairKey | null;
  dispose(): void;
}
```
- Bars: `InstancedMesh(BoxGeometry(1, 1, BAR_LEN), MeshLambertMaterial({ color: 0xffffff }), capacity 4096)`; per bar the matrix is `compose(mid + perp·offset, quaternion.setFromUnitVectors(+Z, axis), (w, w, 1))` with `axis = (b − a)` (unit), `mid` = midpoint of the two cell centres, `w = order === 1 ? BAR_W : BAR_W_MULTI`, offsets `order 1: [0]`, `2: [−0.13, +0.13]`, `3: [−0.17, 0, +0.17]`, `perp = axis is ±y ? +x : +y`. Bar colour via `setColorAt` (correct use: base white × grey): `BOND_GREY` normally, `BOND_WARN` for pairs in `warnPairs` (double bonds whose `DoubleBondStereo.label ∈ {COLLINEAR, NOT_PLANAR, TWISTED}`); `instanceColor.needsUpdate = true`.
- Order glyphs: sprites `"2"`/`"3"` (glyph texture, dark disc `0x101418`, white text) at `mid + (0, 0.32, 0)`, scale 0.22, shown only when `showGlyphs` (bond wand active) so the order is readable without colour or bar counting. Bonds are `bondsOf` order-independent: iterate `index.bonds` sorted by `PairKey`.
- Pick mesh: `InstancedMesh(BoxGeometry(PICK_W, PICK_W, BAR_LEN), MeshBasicMaterial(), capacity)`, `visible = false` (the `Raycaster` ignores `visible`, and an invisible mesh costs no draw call and no transparent sorting — critic 6.4b), one instance per bond at `mid` with the bond quaternion; `instanceId → PairKey` array rebuilt in `update`; `computeBoundingSphere()` after every update (the cached sphere is what `InstancedMesh.raycast` tests first).
- **Break marker** (09 §5.2; one per pair in `index.suppressed`, iterated after the bonds, sorted by `PairKey`): one `InstancedMesh(BoxGeometry(BREAK_SIZE, BREAK_SIZE, BREAK_THICK), materials, capacity 256, doubling)` — a thin square plate whose normal is the pair axis, centred at the midpoint of the two cell centres (0.19 clear of each 0.62-scale atom face), matrix `compose(mid, quaternion.setFromUnitVectors(+Z, axis), (1,1,1))`. Materials: the two `±z` faces `MeshLambertMaterial({ map: breakTexture() })`, the four edge faces `MeshLambertMaterial({ color: BREAK_RED })`; `breakTexture()` (`element-texture.ts`) is a 64×64 canvas filled `BREAK_RED` with a 4-px white border and a white "×" of two 8-px diagonals (the glyph and the missing bar are the non-colour cues), `NearestFilter`, sRGB, shared with the ghost variant. A suppressed pair draws **no** bar and no order glyph. The marker is visible whenever the pair is suppressed, for every tool and every distance (frustum culling only), independent of `showGlyphs` and of every setting. The pick mesh gets one instance per suppressed pair (same pick box at `mid` with the pair quaternion), listed after the bond instances, so `pairOf` resolves both kinds.
- Aromatic bonds are not distinguished in 3D (no v1 content); orders stay editable Kekulé orders.

### 12.5 `render/GhostRenderer.ts`

Translucent previews; nothing here is pickable or solid.
- **Ghost blocks** (bench `preview:'ghost'`, buildable embeddings): per element an `InstancedMesh(BoxGeometry(ATOM_SCALE), MeshLambertMaterial({ map, transparent: true, opacity: 0.35, depthWrite: false }))`; positions = `preview.pos` translated so the bounding-box minimum is `PRODUCT_MIN = [65, 10, 37]` (04 §7.2; the same translation 04's `previewFor` applies, so the ghost and the acceptance zone agree); if the extent exceeds `PRODUCT_MAX − PRODUCT_MIN + 1 = 10 × 21 × 10` the preview falls back to sticks. Ghost bonds: same bar geometry, opacity 0.35. **Ghost break markers** (09 §5.3): for every `preview.suppressedPairs` entry an instance of a ghost plate mesh (the §12.4 break-marker geometry and texture with `transparent: true, opacity: 0.35, depthWrite: false`) at the translated midpoint; hovering a ghost cell that is an endpoint of such a pair shows `STRINGS.targetGhostBreak(el)`.
- **Sticks** (`preview:'sticks'`, `relaxedLayout` from 04): spheres `SphereGeometry(0.22, 12, 8)` (instanced, CPK colour, opaque) and bars, layout scaled ×0.9 and centred at `(70, 12, 42)`, slowly rotating about `y` at `0.3 rad/s` unless `reducedMotion`.
- **Mirror ghost** (enantiomer feedback): the targeted component's cells reflected through `x' = 2·maxX + 3 − x`, drawn as ghost blocks for 8 s or until `target:changed`.
- API: `showGhost(previews, anchor)` (each preview carries `pos`, `hPos`, `suppressedPairs`), `showSticks(graph, pos)`, `showMirror(cells: {cell, el}[])`, `clear()`.

### 12.6 `render/Highlight.ts`

```ts
export const SHELL = { hover: 0xffd54f, target: 0xf4f6f8, selected: 0x4dd0e1, correct: 0x66bb6a, wrong: 0xef5350 } as const;
export const SHELL_SIZE = { target: 0.70, hover: 0.74, selected: 0.74, result: 0.76 } as const;
export const FLASH_MS = 300;
```
- Block outline: `LineSegments(EdgesGeometry(BoxGeometry(1.002)), LineBasicMaterial({ color: 0xffffff }))` plus a second `LineSegments` at `1.008` in `0x101418` behind it (3:1 against any terrain colour); positioned at the hovered cell (block or atom); hidden when `hover.kind ∈ {none, bond, hydrogen}`. Bond hover: one `Mesh(BoxGeometry(0.2, 0.2, 1.0), MeshBasicMaterial({ color: SHELL.hover, transparent, opacity: 0.6, depthWrite: false }))` at the bond's mid/quaternion; when the hovered pair is suppressed (a break marker, `hover.order === 0`) a frame `Mesh(BoxGeometry(BREAK_SIZE + 0.14, BREAK_SIZE + 0.14, BREAK_THICK + 0.12), same material)` at the plate's mid/quaternion is shown instead (09 §5.4). Hydrogen hover: a `0.5` shell around the mini-block.
- Atom shells: one `InstancedMesh(BoxGeometry(1), MeshBasicMaterial({ side: BackSide, transparent: true, opacity: 0.85, depthWrite: false }), 2048)`; instance scale from `SHELL_SIZE`, colour via `setColorAt` (correct: base white). Layers: target shells (all atoms of `State.target`), selected shells (the cells of every `State.selection` item, resolved through `locked[i].atomToCell` / `target.atomToCell`; items with `hSlot` additionally shell the H block or the `implicitHCell` mini-block at 0.5), hover shell, result shells. Priority when one atom has several: result > selected > hover > target.
- Refused placement: outline colour set to `SHELL.wrong` and faded back to white over `FLASH_MS` (one fade, no strobe; with `reducedMotion` the colour is held for `FLASH_MS` then reset). A refused wand action flashes the bond hover box / break-marker frame the same way.
- Submission result (from `'challenge:submitted'`): correct set pulses `SHELL.correct` twice (each pulse a `FLASH_MS` fade in and out, total 1.2 s, well under 3 Hz); a wrong pick holds `SHELL.wrong` for 1.2 s while the correct set (if revealed) shows `SHELL.correct`.

### 12.7 `render/StereoOverlay.ts`

Shown for the targeted component only when `settings.stereoOverlay` (07 §15 "Stereo overlay" checkbox, field declared in §1; `hooks.setStereoOverlay` toggles the same flag) and `analysis.stereo !== null`; rebuilt on `'molecule:analyzed'` for the target and on `'target:changed'`.

| element | rule | geometry | colour / text |
|---|---|---|---|
| R/S label | `centers[i].label ∈ {R,S}` | sprite (glyph texture, disc + letter), scale 0.5, at atom centre + `(0, 0.9, 0)` | R: disc `0x4a7bff` white "R"; S: disc `0xff9f43` white "S" |
| halo | same | `Mesh(TorusGeometry(0.55, 0.04, 8, 24))` rotated `x = π/2` (ring lies in the xz plane), `MeshBasicMaterial({ transparent, opacity: 0.8, depthWrite: false })` | R `0x4a7bff`, S `0xff9f43` |
| flat-centre warning | `label === 'UNSPECIFIED'` | "?" sprite (disc `0xffd166`, black "?") at + `(0, 0.9, 0)`; halo `0xffd166`; for `shape === 'T'` two ghost H mini-blocks (`H_BLOCK_SCALE`, texture "?", opacity 0.35) at `suggestedHPositions` | text "?" plus the panel hint (`STEREO_TEXT.flatT/flatSquare`, shown by 07) |
| cannot assign | `label === 'CANNOT_ASSIGN'` | halo `0x9e9e9e`, no sprite | |
| not a centre | `NOT_CENTER` | nothing | |
| E/Z label | `doubleBonds[j].label ∈ {E,Z}` | sprite at bond midpoint + `(0, 0.45, 0)`, scale 0.45 | E: disc `0x2e7d32` white "E"; Z: disc `0x6a1b9a` white "Z" |
| geometry warning | `label ∈ {COLLINEAR, NOT_PLANAR, TWISTED}` | "!" sprite (disc `0xef5350`, white "!") at the midpoint; the bond's bars are tinted `BOND_WARN` (§12.4 `warnPairs`) | panel hint from `STEREO_TEXT` |
| ring / no E/Z | `RING`, `NO_EZ` | nothing | |
| ring face disc | every `ringFaces[k]` with at least one `subs` entry with `face ≠ 0` | `Mesh(CircleGeometry(1.0, ring.length), MeshBasicMaterial({ color: 0x4dd0e1, transparent, opacity: 0.18, side: DoubleSide, depthWrite: false }))` at the ring centroid, oriented so its normal equals `ringFace.normal` | per substituent a "▲" (`face = 1`) or "▼" (`face = −1`) sprite (disc `0x101418`, white glyph, scale 0.3) at the substituent atom centre + `0.55·normal·face` |

Sprites use `SpriteMaterial({ map, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: true })`, pooled and reused.

## 13. Draw-call and capacity budget

≤ 64 chunk meshes (frustum-culled, typically ~20 visible) + 9 atom meshes + 1 stud mesh + 1 H mini-block mesh + 1 bar mesh + 1 break-marker mesh + 0 for the invisible pick mesh + 1 shell mesh + 2 outlines + ghosts (≤ 11) + sprites (≤ 64 for a targeted molecule) ≈ 100–150 calls worst case, ~40 typical. Instance capacities double on demand (mesh recreated, matrices copied), so no hard atom limit exists below the 1024-atom index guidance of R8.

## 14. `src/app/Game.ts` — composition and loop

### 14.1 Start-up (`Game.start()`)

1. `renderer = new Renderer(canvas, stage, lowGfx, emitter)` (throws → `main.ts` no-WebGL message); `world = new World()`; `generate(world, WORLD_SEED)`; emit `'world:ready'`.
2. `player = createPlayer()`; `camera = new FirstPersonCamera()`; `settings = loadSettings()` (07 §1.2); `input = new InputManager(canvas, () => effectiveKeys(settings), emitter)`; `look = new LookModes(canvas, input, emitter, () => lookSettings(settings))` with `lookSettings(s) = { sensitivity: s.sensitivity, invertY: s.invertY, turnRateYaw: s.turnRate, turnRatePitch: 0.6 * s.turnRate }`. `'settings:changed'` replaces `settings` with `loadSettings()` before the next frame.
3. Renderers: chunk, atom, bond, ghost, highlight, stereo overlay; lights; `chunkRenderer.markAllDirty()` (initial build is spread over frames at `chunkRebuildsPerFrame`; the loop starts rendering immediately — the pad's chunks are nearest and build first).
4. `window.__orgocraft = debugApi()` (with the debug-only methods when `new URLSearchParams(location.search).get('debug') === '1'`).
5. Subscribe: `'challenge:changed'` → place/remove locked molecules; `'bench:reacted'`/`'bench:cleared'` → ghost previews; `'settings:changed'` → view flags, profile; `'challenge:submitted'` → result shells.
6. `requestAnimationFrame(frame)`.

### 14.2 Frame (fixed step, accumulator)

```
frame(tNow):
  raf = requestAnimationFrame(frame)
  if renderer.contextLost or paused: last = tNow; return
  dt = min((tNow − last) / 1000, PLAYER.maxFrameDt); last = tNow
  if resizePending: renderer.resizeNow(); resizePending = false
  in = input.consumeFrame()
  handlePressed(in.pressed, in.wheel)                 // §10: every action except mine/place (before physics)
  camera.addLook(in.lookDX·settings.sensitivity, in.lookDY·settings.sensitivity·(settings.invertY ? −1 : 1))
  camera.addLook(−in.keyLook.yaw·settings.turnRate·dt, −in.keyLook.pitch·0.6·settings.turnRate·dt)   // 07 §1.2: pitch rate = 0.6·turnRate
  player.yaw = camera.yaw; player.pitch = camera.pitch
  acc += dt
  while acc ≥ fixedDt: prev = copy(player); stepPlayer(player, in.move, fixedDt, world.isSolid); acc −= fixedDt
  camera.setFromPlayer(player, prev, acc / fixedDt); camera.setSprinting(in.move.sprint && moving, reducedMotionActive(settings))
  hover = resolveHover()                              // §10.2 (uses the interpolated eye)
  applyActions(hover, in.pressed)                     // only mine / place, against the fresh hover
  updateTarget(hover)                                 // §10.3
  syncComponents()                                    // §14.3
  analysisScheduler.run(ANALYSIS_BUDGET_MS)           // §14.4
  chunkRenderer.rebuildDirty(world, player, profile.chunkRebuildsPerFrame)
  if sceneDirty: atomRenderer.update(...); bondRenderer.update(...); highlight.update(...); stereoOverlay.update(...); sceneDirty = false
  renderer.render(camera.camera)
  frames++; stats = renderer.stats(); __orgocraft.{frames, triangles, calls} = …; lowGfxTimingCheck(dt)
```
`ANALYSIS_BUDGET_MS = 4`. `sceneDirty` is set by any world edit, selection/target/hover change, settings change, or analysis result.

### 14.3 World edits → components (`syncComponents`)

Runs only when `world.editVersion !== seenVersion`:
1. `edits = world.drainEdits()`; `comps = world.index.components()`.
2. For each `[id, cells]`: `sig = cells.join(';') + '#' + cells.map(c => index.bondsOf(c).map(b => b.key + ':' + b.order).join(',')).join('|') + '#' + cells.map(c => index.atoms.get(c).charge).join(',')`; if `analysisCache.get(id)?.sig !== sig` → `analysisCache.set(id, { sig, analysis: null })`, `queue.add(id)`.
3. Delete cache entries and `State.analyses` entries for ids not in `comps`; drop `selection` entries whose cells no longer exist; if `State.target` is gone → `target = null` and emit `target:changed`.
4. `seenVersion = world.editVersion`; `sceneDirty = true`.

### 14.4 Analysis scheduler → events → UI

`run(budgetMs)`: `t0 = performance.now()`; while `queue` non-empty and `performance.now() − t0 < budgetMs`: take `State.target` first if queued, else the smallest id; `g = extractComponent(index, id)`; `zone` = common `zoneOf` of its cells or `'world'`; `analysis = analyze(g)`; store in `analysisCache` and `State.analyses` via `setAnalysis(id, analysis, zone, suppressedPairsOfComponent(index, id))` (09 §5.9); emit `'molecule:analyzed' { component: id, analysis, zone }`. A suppress/restore changes `bondsOf` and therefore the §14.3 signature, so re-analysis needs no extra key. `analyze` (F) calls `runOne(target)` synchronously (ignoring the budget) before emitting `'analyze:requested'`. The UI (07) subscribes: the molecule panel renders the targeted analysis (`≤ 4 Hz` throttle on its side), the scene-description mirror lists pad molecules, the live region announces on `'analyze:requested'` and submissions. Nothing in the engine formats student text beyond `ENGINE_TEXT`.

Per-atom hydrogens for the panel come from `analysis.hydrogens`; the renderer's stud count (§12.3) is computed from the index and equals it by construction (`tv − heavyOrderSum − hBlocks`).

### 14.5 Submission context

On `submit` (or the panel button, which calls `state.submit()` directly): `Game.buildContext(rule): SubmissionContext`:
- `zone = rule.type === 'predict-product' ? 'product' : 'pad'`; `graphs = extractMolecules(index, zone)` (for `select-atom` the rule's parsed molecules in rule order are used instead, as 05 §7.6 requires; `State.locked[i].cellToAtom` maps cells to those graphs because `placeLockedMolecule` wrote them in atom-id order at `layout` positions).
- `targeted` = the graph whose cells include the targeted component's cells (identity match by cell set), else `null`.
- `selection` = `State.selection` unchanged (it is already `SelectionItem[]`: Game converts a hovered cell into an item at toggle time, §10.4 — locked cells through `locked[i].cellToAtom`, other cells through `target.cellToAtom`, which is the extraction order: atom id = rank of the cell among the component's heavy cells by `cellIndex`).
- `isomersDone`, `attempt`, `chosenReagent`, `quizAnswer`, `diagonalBondsEnabled: false` from `State`.
`State.submit()` (pure) runs `evaluate` and emits `challenge:submitted` / `challenge:passed` / `score:changed`.

### 14.6 Bench flow (engine part; the pure part is 04, the panel is 07)

`'challenge:changed'` to a `predict-product`/`choose-reagent` challenge: remove previous locked cells; `placeLockedMolecule(parseSmiles(rule.reactant).graph, layoutOf(entry), REACTANT_MIN, 'reactant', 0)` (04 §7.2: `REACTANT_MIN = [53, 10, 37]`; `rx`, when present, is placed with its min `x` = reactant max `x` + 3, same `y`, `z`, as `molecule: 1`); `State.bench.reactant` set. `'bench:reacted' { result }`: for each `result.major[k]`: `emb = embedOnLattice(major[k])`; buildable → ghost blocks at `PRODUCT_MIN` (`previews[k].buildable = true`), else sticks from `relaxedLayout`. `'bench:cleared'`: product-zone atoms are returned to inventory (`world.removeAtomBlock` per cell, counts credited) and ghosts cleared. Product-zone builds are ordinary edits; `predict-product` acceptance extracts zone `'product'`.

### 14.7 Context loss

`canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); renderer.contextLost = true; emit('gfx:context', { state: 'lost' }); emit('live:announce', { text: ENGINE_TEXT.contextLost, priority: 'assertive' }) })`. `'webglcontextrestored'`: `renderer.contextLost = false`; `chunkRenderer.markAllDirty()`; every `CanvasTexture.needsUpdate = true`; `atomRenderer`, `bondRenderer`, `highlight`, `stereoOverlay`, `ghost` rebuild from the index/state (their `update` functions are idempotent); `last = performance.now()`; emit `'gfx:context' { state: 'restored' }`. The molecule index, world grid, inventory and progress are untouched (nothing chemical lives on the GPU).

### 14.8 Debug overlay and hooks

F3 (fixed code, `'debug'`) toggles `#debug` (07 provides the element): `fps`, `frame ms (mean of 60)`, `calls`, `triangles`, `lookMode`, `lowGraphics`, `pixelRatio`, `player x y z yaw pitch`, `target id`, `hover kind`, `analysis queue length`. `__orgocraft.teleport(x,y,z,yaw,pitch)` sets the player and camera and zeroes velocity; `setBlock` bypasses validation then rebuilds the index (§4); `place` runs the real placement path and returns the `PlacementResult`; `goToChallenge(id)` calls `state.setChallenge(index of id)`; `press(action)` calls `input.inject`; `wand(pair)` runs the §10.4 wand path against `pair` without hovering (09 §1.10) and returns its `BondChangeResultExt`; `state()` returns the `UiState` instance; `events` is `state.events`.

## 15. Tests

### 15.1 Vitest (pure)

Listed with their fixtures in §3.6 (worldgen), §5.3 (mesher), §6.2 (raycast), §7.2 (physics), §9.1 (keymap), plus `test/world/world.test.ts`:
1. `setBlock` of an atom adds it to `index.atoms`; two face-adjacent atoms create one bond of order 1; `setBlock(Air)` removes atom and bond.
2. `setBlock` at `x = 16` marks chunks `(1,0)` and `(0,0)` dirty; at `x = 17` only `(1,0)`.
3. `removeAtomBlock` on a carbon with two explicit H blocks removes all three cells and returns them atom-first; an H block also bonded to another heavy atom survives.
4. `getBlock(−1, 5, 5) === Air`, `getBlock(5, −1, 5) === Bedrock`, `getBlock(5, 32, 5) === Air`.
5. `drainEdits` returns the edits once.
6. `suppressBond` on a bond of two touching carbons bumps `editVersion`, drains one `{kind:'bond'}` edit naming both cells, removes the pair from `index.bonds` and adds it to `index.suppressed`; `restoreBond` reverses it with order 1 (09 §1.2).
7. `removeAtomBlock` on an endpoint of a suppressed pair clears the pair from `index.suppressed`; `setBlock` of a carbon back into that cell creates an ordinary order-1 bond.

### 15.2 Playwright smoke (`scripts/smoke.mjs`, `npm run smoke`, WP-11) — the single smoke specification

This list is the one ordered smoke specification: 07 §20's "Smoke adds" items are merged here (marked `[07-n]`), and 08 §12 (which owns CI) runs exactly this script; neither document keeps its own step list.

Environment: `playwright-core` with `executablePath = process.env.CHROME_PATH ?? first glob of $PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux*/chrome` (here `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`); headless; viewport `1280×720` (step 21 re-runs at `1100×580`); `args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']`. Static server: a Node `http` server that serves `dist/` under `/content/enforced/12345-ORGO/orgocraft-v1/` (relative-base proof) and `wrapper.html` at `/scorm/wrapper.html` that iframes the same page and defines a fake `window.API` recording every `LMSSetValue`/`LMSFinish`. Any `pageerror` or console `error` fails the run. `page.goto(url + 'index.html?debug=1')`. The whole list runs twice: top-level (standalone mode) and inside the wrapper (LMS mode); steps marked *(lms)* / *(standalone)* run in that mode only.

DOM hooks (07 §2.1, §5, §8.1, §9.1, §13.1, §16 are normative; this table only lists what the script selects):

| hook | selector | defined in |
|---|---|---|
| stage | `#stage` | 07 §2.1 |
| canvas | `canvas#canvas` (`role="application"`) | 07 §2.1 |
| hotbar slot n (0..11) | `#hotbar [data-slot="n"]` | 07 §6 |
| molecule name | `#molecule-panel .mp-name` | 07 §8.1 |
| molecule formula (plain text) | `#molecule-panel .mp-facts dd[aria-label]` first entry; read the `aria-label` | 07 §8.1 |
| challenge title | `#cp-title` | 07 §9.1 |
| challenge name / status / feedback | `#challenge-panel .cp-name`, `.cp-status`, `.cp-feedback` | 07 §9.1 |
| polite live region | `#status` (`role="status"`) | 07 §2.1, §16.1 |
| assertive live region / toast | `#toast` (`role="alert"`) | 07 §2.1, §16.1 |
| pause menu / resume button | `#pause`, `#pm-resume` | 07 §13.1 |
| look hint | `#look-hint` | 07 §2.1 |
| LMS badge | `#lms-badge` | 07 §5 |
| bench panel parts | `#bench-panel`, `.bp-mech`, `.bp-minor`, `#bp-submit` | 07 §12.1 |
| debug overlay | `#debug` | 07 §2.1 |
| script hooks | `window.__orgocraft` (`DebugApi`, §1): `frames`, `triangles`, `lookMode`, `getBlock`, `teleport`, `goToChallenge`, `state()`, `events` | §1, §14.8 |

Steps (each with a 20 s timeout; a step's number is its id in CI logs):
1. `waitForFunction(() => window.__orgocraft?.frames > 10 && window.__orgocraft.triangles > 0)`.
2. `expect(await page.evaluate(() => window.__orgocraft.getBlock(64, 8, 64))).toBe(7)` (LabTile); `getBlock(63,9,49) === 9` (Bench).
3. Focus: `page.click('canvas#canvas')`; `expect(document.activeElement === canvas)`; in headless SwiftShader pointer lock is refused → `#look-hint` text contains `Drag` (`STRINGS.dragToLook`) within 1 s and `__orgocraft.lookMode === 'drag'`.
4. `[07-1]` `#lms-badge` reads `Connected to course gradebook` *(lms)* / `Progress saved on this device - not connected to the gradebook` *(standalone)*.
5. Methane: `__orgocraft.goToChallenge('ch1-build-methane')`; `__orgocraft.teleport(64.5, 9, 62.5, 0, -0.6)` (eye at `(64.5, 10.62, 62.5)` looking down at pitch −0.6: the ray reaches `y = 9` after `t = 1.62 / sin 0.6 = 2.869` at `z = 62.5 − 2.869·cos 0.6 = 60.13`, i.e. the top face of LabTile `(64, 8, 60)`); `keyboard.press('Digit1')`; `keyboard.press('KeyE')`; expect `getBlock(64, 9, 60) === 64` (AtomC); `#molecule-panel .mp-name` reads `Methane` and the formula `dd`'s `aria-label` is `CH4` within 2 s.
6. `[07-3]` `keyboard.press('Enter')`; `.cp-feedback` text starts with `Correct:`; `.cp-status` contains `Solved`; `#status` text contains `Solved:` within `LIVE_POLITE_MS + 500 ms`; *(lms)* the fake API received `cmi.core.score.raw` with a value `> 0` and `cmi.suspend_data` starting with `v2|`.
7. `[07-2]` Scroll/keys: `keyboard.press('Space')`, `ArrowDown`, `PageDown` do not change `window.scrollY` of the wrapper page *(lms)* nor of the top-level page.
8. `[07-4]` Select-H: `goToChallenge('ch2-select-most-acidic-h-ethanol')`; wait for `__orgocraft.state().locked.length === 1 && locked[0].atomToCell.length === 3`; press `KeyV`; the rule targets hydrogens, so the candidate list (07 §11.1) is hydrogens only in atom-id order of the rule graph `CCO`: C0 slots 0–2, C1 slots 0–1, O2 slot 0 → the O–H hydrogen is candidate index 5; the first `BracketRight` selects index 0, so press `BracketRight` six times, then `KeyE`; expect `__orgocraft.state().selection` to deep-equal `[{ molecule: 0, atom: 2, hSlot: 0 }]`; then `Enter`; expect `.cp-feedback` to start with `Correct:`.
9. `[07-4]` Heavy-atom fallback: `goToChallenge('ch2-select-most-acidic-h-dimethyl-ether')` (or the first enabled select-H challenge whose molecule has an O without hydrogens); teleport to look at the O cell (`state().locked[0].atomToCell[<O id>]`) and press `KeyE` → `#toast` text starts with `That atom has no hydrogens` and `state().selection` is `[]`.
10. `[07-5]` Quiz: `goToChallenge` to the first enabled `quiz` challenge; the dialog opens (`#dialogs [role="dialog"]` visible); press `Digit2`, then `Digit2` again (select, submit) → `.quiz-feedback` non-empty; `quiz:answer` observed through a listener registered on `window.__orgocraft.events` before the presses.
11. `[07-6]` Keyboard only: focus the canvas; `keyboard.press('Escape')` → `#pause` visible and `document.activeElement.id === 'pm-resume'`; `Tab` cycles inside `#pause` (focus never leaves the dialog); `Escape` closes it and focus returns to `canvas#canvas`; `Enter` on `#pm-resume` also resumes.
12. `[07-2]` `Tab` from the focused canvas lands on the first focusable control inside `#molecule-panel` (no trap).
13. `[07-11]` Focus the canvas with the keyboard (`Tab` from `#challenge-panel`'s last control) → `getComputedStyle(canvas).outlineOffset` parses to a negative number and `outlineWidth` is `3px` (07 §2.3 two-tone inset ring).
14. `[07-10]` With `#pause` open, `page.evaluate(() => window.__orgocraft.state().announce('x', 'assertive'))` → `#toast` text is `x`, `#toast.closest('[inert]') === null`, `#toast` has no `aria-hidden`; the same for `#status` with `'polite'` after `LIVE_POLITE_MS`.
15. `[07-8]` `page.emulateMedia({ reducedMotion: 'reduce' })` + reload → `html[data-reduced-motion="true"]` and `document.getAnimations().length === 0` inside `#stage`.
16. `[07-9]` axe-core (`@axe-core/playwright` is not installed; the script injects `node_modules/axe-core/axe.min.js` if present, else skips this step with a warning) on the page with `#pause` open: no `serious`/`critical` violations and no `aria-allowed-role` violation for `canvas[role="application"]`.
17. `[07-12]` `goToChallenge('ch11-predict-e2-2-bromobutane')`; press `KeyR` → `#bench-panel` visible; press React → `.bp-mech` non-empty, `.bp-minor` empty, and `#bench-panel.textContent` contains neither `but-1-ene` nor `2-ethoxybutane` while `state().bench.mode === 'predict'` and the challenge is unsolved; build E-but-2-ene in the product zone: `__orgocraft.place` at `(65,10,37)`, `(66,10,37)`, `(66,10,38)`, `(67,10,38)` (all `'C'`; a planar zigzag with C2=C3 along `+z`), then `teleport(66.5, 10, 41.5, 0, -0.35)` (looking at the C2–C3 bar from `+z`), press `KeyB`, then `KeyE` once (order 1 → 2; `__orgocraft.state().padComponents[0].analysis.name === 'E-but-2-ene'` — 05's name for `C/C=C/C`), then click `#bp-submit` → `.cp-feedback` starts with `Correct:` and `.bp-minor` lists `Minor product: but-1-ene`.
17a. No bond (09 §5.10): `goToChallenge('ch7-build-z-but-2-ene')`; `__orgocraft.place` `'C'` at `(60,9,60)`, `(60,9,61)`, `(61,9,61)`, `(61,9,60)` (a 2×2 square; the unwanted C1–C4 pair is bonded too); press `Enter` → `.cp-feedback` starts with `Not yet:` and contains `break marker`; `__orgocraft.wand('60,9,60|61,9,60')` three times → `order` 2, 3, 0; `__orgocraft.wand('60,9,61|61,9,61')` → `order` 2; expect `state().target.suppressed` to deep-equal `['60,9,60|61,9,60']`, `#status` to contain `removed: the atoms touch` within `LIVE_POLITE_MS + 500 ms`, `#molecule-panel .mp-name` to read `(Z)-but-2-ene`; `Enter` → `.cp-feedback` starts with `Correct:`.
18. `[07-7]` *(lms)* Save & Exit: open `#pause`, click `#pm-exit`, confirm → finished overlay text contains `Progress saved`; the fake API saw `LMSFinish` exactly once and `cmi.core.exit !== 'logout'`.
19. `[07-13]` *(lms)* After step 18, `document.activeElement` is the finished overlay (`[role="dialog"][tabindex="-1"]`) and `#toast` contains `Progress saved`.
20. Debug overlay: `keyboard.press('F3')` on a fresh page → `#debug` not hidden and its text contains `fps`; `F3` again hides it.
21. Short-frame layout (08 §7): re-run steps 1–3 at viewport `1100×580`; the bounding boxes of `#challenge-panel` and `#hotbar` do not intersect (`a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left`), with both panels expanded and collapsed.
22. `page.screenshot({ path: 'test-results/smoke.png' })`; exit code 0 only if every step passed.

CI (08 §12) installs the full `playwright@1.63.0` and runs `npx playwright install --with-deps chromium` so `executablePath` resolves without `CHROME_PATH`; it uploads `test-results/`.

## 16. Unresolved questions

1. Resolved: 07 §1.2 (`KEY_ACTIONS`, `DEFAULT_KEYS`, `Settings`, `effectiveKeys`, `keyConflict`) is the single key/settings schema; this document imports it (§1, §9.1). The hydrogen toggle is `T`, the bond wand `B`, Analyze `F`; `Tab` stays the focus-exit key (WCAG 2.1.2). Nothing here may re-declare a default binding.
2. Select-atom molecules are placed on the pad (05 wording) and locked through `State.locked` (`lockedCells(state)`), refused before `validatePlacement` runs; 07 §1.1 reuses `REFUSAL_TEXT.lockedZone` ("reactant zone") for that refusal, which is slightly wrong text for pad locks — 07 §21.3 requests a `REFUSAL_TEXT.lockedMolecule` entry; `ENGINE_TEXT.lockedMolecule` (§1) is the proposed wording and Game switches to it when the contract lands. If 02/05 prefer zone-level locking, `validatePlacement`'s `ctx` needs a `lockedCells` field.
3. `slotPrev`/`slotNext` are overloaded in select mode (candidate cycling, 07 §11.3). If 07 wants both at once, add `candPrev`/`candNext` to `KEY_ACTIONS` bound to `Semicolon`/`Quote` (07 §21.6).
4. The chunk meshes emit world-space vertices and sit at the origin (§12.1); the research brief placed meshes at the chunk origin with `matrixAutoUpdate = false`. Either is fine; this document fixes world-space so the smoke test's triangle count and the culling volume need no matrix.
5. `antialias` cannot change without recreating the `WebGLRenderer`; the Low-graphics toggle applies pixel ratio/fog/far immediately and antialias on the next load. 07's settings text should say so.
6. Locked-molecule anchors are the single table in §10.6 (`LOCKED_ORIGINS` from 07 §1.1, `REACTANT_MIN`/`PRODUCT_MIN` from 04 §7.2, all at `y = 10`); 00-contracts §3 should carry the same table so 04, 05, 06 and 07 read one source. Each slot is `LOCKED_EXTENT = [8, 20, 8]` cells; content wider than 8 cells (none today) needs a fourth origin, not a second row.
7. Ore veins may overwrite each other (last element wins) — counts stay ≥ 400 with seed 1337 per the test; if a future seed change breaks it, raise `maxAttempts`.
