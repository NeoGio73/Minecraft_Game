/**
 * OrgoCraft world contracts: block ids, chunk constants, cell/pair keys,
 * molecule index, placement validation. PURE MODULE (no three, no DOM).
 */
import type { BondOrder, Charge, Element } from '../chem/types';

// ---------------------------------------------------------------------------
// Block ids (Uint8)
// ---------------------------------------------------------------------------

/** Elements that exist as blocks, in block-id order. Ores exist for the first
 *  eight; hydrogen has no ore (unlimited in the hotbar). */
export const BLOCK_ELEMENTS = ['C', 'N', 'O', 'S', 'F', 'Cl', 'Br', 'I', 'H'] as const;
export type BlockElement = (typeof BLOCK_ELEMENTS)[number];

export const ORE_BASE = 32;
export const ATOM_BASE = 64;

export const Block = {
  Air: 0,
  Bedrock: 1,
  Stone: 2,
  Dirt: 3,
  Grass: 4,
  Sand: 5,
  Glass: 6,
  LabTile: 7,
  LabTileEdge: 8,
  /** Reaction bench console (interact = open bench panel). */
  Bench: 9,
  /** Floor of the locked reactant zone. */
  BenchReactantTile: 10,
  /** Floor of the product zone where the student builds. */
  BenchProductTile: 11,
  OreC: ORE_BASE + 0,
  OreN: ORE_BASE + 1,
  OreO: ORE_BASE + 2,
  OreS: ORE_BASE + 3,
  OreF: ORE_BASE + 4,
  OreCl: ORE_BASE + 5,
  OreBr: ORE_BASE + 6,
  OreI: ORE_BASE + 7,
  AtomC: ATOM_BASE + 0,
  AtomN: ATOM_BASE + 1,
  AtomO: ATOM_BASE + 2,
  AtomS: ATOM_BASE + 3,
  AtomF: ATOM_BASE + 4,
  AtomCl: ATOM_BASE + 5,
  AtomBr: ATOM_BASE + 6,
  AtomI: ATOM_BASE + 7,
  AtomH: ATOM_BASE + 8,
} as const;

export type BlockId = (typeof Block)[keyof typeof Block];

export const ORE_COUNT = 8;
export const ATOM_COUNT = 9;

export function isOre(id: number): boolean {
  return id >= ORE_BASE && id < ORE_BASE + ORE_COUNT;
}
export function isAtom(id: number): boolean {
  return id >= ATOM_BASE && id < ATOM_BASE + ATOM_COUNT;
}
/** Element of an ore or atom block; undefined otherwise. */
export function elementOf(id: number): BlockElement | undefined {
  if (isOre(id)) return BLOCK_ELEMENTS[id - ORE_BASE];
  if (isAtom(id)) return BLOCK_ELEMENTS[id - ATOM_BASE];
  return undefined;
}
export function atomBlockOf(el: BlockElement): BlockId {
  return (ATOM_BASE + BLOCK_ELEMENTS.indexOf(el)) as BlockId;
}
export function oreBlockOf(el: Exclude<BlockElement, 'H'>): BlockId {
  return (ORE_BASE + BLOCK_ELEMENTS.indexOf(el)) as BlockId;
}
/** Opaque blocks hide the faces of their neighbours in the chunk mesh. Atoms
 *  are drawn separately at 0.62 scale, so they are NOT opaque. */
export function isOpaque(id: number): boolean {
  return id !== Block.Air && id !== Block.Glass && !isAtom(id);
}
/** Solid for collision and picking. */
export function isSolid(id: number): boolean {
  return id !== Block.Air;
}
export function isBreakable(id: number): boolean {
  return id !== Block.Air && id !== Block.Bedrock && id !== Block.LabTile && id !== Block.LabTileEdge
    && id !== Block.Bench && id !== Block.BenchReactantTile && id !== Block.BenchProductTile;
}

/** Atoms mined per ore block. */
export const ORE_YIELD = 3;

/** sRGB hex per element for atom textures and the HUD legend. */
export const CPK_HEX: Readonly<Record<Element, number>> = {
  C: 0x3b3b3b, H: 0xf2f2f2, O: 0xe3242b, N: 0x2b5fe3, Cl: 0x1fd11f,
  Br: 0x9e1b1b, S: 0xf2e21f, F: 0x90e050, I: 0x940094, P: 0xff8000,
};
export const CPK_TEXT: Readonly<Record<Element, 'black' | 'white'>> = {
  C: 'white', H: 'black', O: 'white', N: 'white', Cl: 'black',
  Br: 'white', S: 'black', F: 'black', I: 'white', P: 'black',
};

// ---------------------------------------------------------------------------
// Chunks and world dimensions
// ---------------------------------------------------------------------------

export const CHUNK_W = 16;
export const CHUNK_H = 32;
export const CHUNK_D = 16;
export const WORLD_CX = 8;
export const WORLD_CZ = 8;
export const WORLD_W = CHUNK_W * WORLD_CX; // 128
export const WORLD_H = CHUNK_H;            // 32
export const WORLD_D = CHUNK_D * WORLD_CZ; // 128

/** Index inside a chunk's Uint8Array: x fastest, then z, then y. */
export function cidx(x: number, y: number, z: number): number {
  return x + CHUNK_W * (z + CHUNK_D * y);
}

export const WORLD_SEED = 1337;

/** Lab pad: x, z in [LAB_MIN, LAB_MAX), floor at y = LAB_Y. Pad membership of a
 *  molecule = every atom has x,z in range and y >= LAB_Y + 1. */
export const LAB_MIN = 52;
export const LAB_MAX = 76;
export const LAB_Y = 8;
export const SPAWN: readonly [number, number, number] = [64, 9, 64];

/** Reaction bench: reactant zone (locked) and product zone, south of the pad. */
export const BENCH_Z_MIN = 36;
export const BENCH_Z_MAX = 48;
export const BENCH_REACTANT_X = [52, 64] as const;
export const BENCH_PRODUCT_X = [64, 76] as const;
export const BENCH_BLOCKS: readonly (readonly [number, number, number])[] = [[63, 9, 49], [64, 9, 49]];

export type Zone = 'pad' | 'reactant' | 'product' | 'world';

export function zoneOf(x: number, y: number, z: number): Zone {
  if (y < LAB_Y + 1) return 'world';
  if (x >= LAB_MIN && x < LAB_MAX && z >= LAB_MIN && z < LAB_MAX) return 'pad';
  if (z >= BENCH_Z_MIN && z < BENCH_Z_MAX) {
    if (x >= BENCH_REACTANT_X[0] && x < BENCH_REACTANT_X[1]) return 'reactant';
    if (x >= BENCH_PRODUCT_X[0] && x < BENCH_PRODUCT_X[1]) return 'product';
  }
  return 'world';
}

// ---------------------------------------------------------------------------
// Cell and pair keys (strings; decision recorded in 00-contracts.md)
// ---------------------------------------------------------------------------

/** "x,y,z" with non-negative integers, no spaces. */
export type CellKey = `${number},${number},${number}`;
/** "<cellA>|<cellB>" where cellA has the smaller linear index. */
export type PairKey = `${CellKey}|${CellKey}`;

export function cellKey(x: number, y: number, z: number): CellKey {
  return `${x},${y},${z}`;
}
export function parseCellKey(k: CellKey): [number, number, number] {
  const p = k.split(',');
  return [Number(p[0]), Number(p[1]), Number(p[2])];
}
/** Linear index used to order cells deterministically (x fastest). */
export function cellIndex(x: number, y: number, z: number): number {
  return x + WORLD_W * (z + WORLD_D * y);
}
export function pairKey(a: CellKey, b: CellKey): PairKey {
  const [ax, ay, az] = parseCellKey(a);
  const [bx, by, bz] = parseCellKey(b);
  return cellIndex(ax, ay, az) <= cellIndex(bx, by, bz) ? `${a}|${b}` : `${b}|${a}`;
}
export function splitPairKey(p: PairKey): [CellKey, CellKey] {
  const i = p.indexOf('|');
  return [p.slice(0, i) as CellKey, p.slice(i + 1) as CellKey];
}
export function faceAdjacent(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) === 1;
}

export const FACE_DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Order in which implicit-H studs / H mini-blocks fill free faces. */
export const H_FILL_ORDER: readonly (readonly [number, number, number])[] = [
  [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0],
];

// ---------------------------------------------------------------------------
// Molecule index (derived from the grid; bond orders and charges are
// authoritative here, not in the Uint8 grid)
// ---------------------------------------------------------------------------

export interface IndexedAtom {
  readonly key: CellKey;
  readonly el: BlockElement;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly charge: Charge;
}

export interface IndexedBond {
  readonly key: PairKey;
  readonly a: CellKey;
  readonly b: CellKey;
  readonly order: BondOrder;
  /** Reserved for the v2 diagonal-bond wand; always false in v1. */
  readonly diagonal: boolean;
}

export type ComponentId = number;

export interface MoleculeIndex {
  readonly atoms: ReadonlyMap<CellKey, IndexedAtom>;
  readonly bonds: ReadonlyMap<PairKey, IndexedBond>;
  /** Face neighbours that are atoms (v1: no diagonals). */
  neighbours(key: CellKey): IndexedAtom[];
  bondsOf(key: CellKey): IndexedBond[];
  /** Sum of bond orders on the cell (explicit H blocks count 1 each). */
  bondOrderSum(key: CellKey): number;
  /** Connected component id per atom; ids are dense 0..n-1 assigned by
   *  ascending minimum cellIndex so extraction is deterministic. */
  componentOf(key: CellKey): ComponentId;
  components(): ReadonlyMap<ComponentId, readonly CellKey[]>;
  /** Mutations (called only by World.setBlock / bond wand / charge tool). */
  addAtom(atom: IndexedAtom): void;
  removeAtom(key: CellKey): void;
  setBondOrder(key: PairKey, order: BondOrder): void;
  setCharge(key: CellKey, charge: Charge): void;
  /** Rebuild atoms and adjacency from the grid, PRESERVING existing bond orders
   *  and charges for pairs/cells that still exist. */
  rebuildFromGrid(get: (x: number, y: number, z: number) => number, keepOrders: ReadonlyMap<PairKey, BondOrder>, keepCharges: ReadonlyMap<CellKey, Charge>): void;
}

// ---------------------------------------------------------------------------
// Validation results (refuse instead of silently dropping bonds)
// ---------------------------------------------------------------------------

export type PlacementRefusal =
  | { readonly reason: 'out-of-bounds' }
  | { readonly reason: 'occupied' }
  | { readonly reason: 'player-overlap' }
  | { readonly reason: 'locked-zone'; readonly zone: Zone }
  | { readonly reason: 'valence'; readonly cell: CellKey; readonly el: BlockElement; readonly have: number; readonly max: number }
  | { readonly reason: 'h-block-needs-parent' }
  | { readonly reason: 'inventory-empty'; readonly el: BlockElement };

export type PlacementResult =
  | { readonly ok: true; readonly newBonds: readonly PairKey[]; readonly cage: boolean }
  | { readonly ok: false; readonly refusal: PlacementRefusal; readonly message: string };

export type BondChangeRefusal =
  | { readonly reason: 'not-adjacent' }
  | { readonly reason: 'valence'; readonly cell: CellKey; readonly el: BlockElement; readonly have: number; readonly max: number }
  | { readonly reason: 'locked-zone'; readonly zone: Zone }
  | { readonly reason: 'h-block'; readonly cell: CellKey };

export type BondChangeResult =
  | { readonly ok: true; readonly order: BondOrder }
  | { readonly ok: false; readonly refusal: BondChangeRefusal; readonly message: string };

export type ChargeChangeRefusal =
  | { readonly reason: 'unsupported'; readonly el: BlockElement; readonly charge: Charge }
  | { readonly reason: 'valence'; readonly cell: CellKey; readonly el: BlockElement; readonly have: number; readonly max: number }
  | { readonly reason: 'locked-zone'; readonly zone: Zone }
  | { readonly reason: 'h-block' };

export type ChargeChangeResult =
  | { readonly ok: true; readonly charge: Charge }
  | { readonly ok: false; readonly refusal: ChargeChangeRefusal; readonly message: string };

/** Student-facing refusal strings (single source; UI never invents text). */
export const REFUSAL_TEXT = {
  outOfBounds: 'You cannot build outside the world.',
  occupied: 'That cell is already occupied.',
  playerOverlap: 'You are standing there. Step back first.',
  lockedZone: 'The reactant zone is locked. Build your product in the product zone.',
  valence: (el: string, have: number, max: number) => `${el} would have ${have} bonds but can only have ${max}. Place it somewhere with fewer neighbours.`,
  hBlockNeedsParent: 'A hydrogen block must touch exactly one heavy atom.',
  inventoryEmpty: (el: string) => `You have no ${el} left. Mine ${el} ore.`,
  bondNotAdjacent: 'Only touching atoms can be bonded.',
  bondValence: (el: string, max: number) => `Valence full: ${el} can only have ${max} bonds.`,
  bondHBlock: 'A bond to hydrogen is always single.',
  chargeUnsupported: (el: string, q: number) => `${el} cannot carry charge ${q > 0 ? '+' : ''}${q} in this game.`,
  chargeValence: (el: string, q: number, max: number) => `Remove a bond first: ${el}${q > 0 ? '+' : q < 0 ? '-' : ''} allows ${max} bonds.`,
} as const;

// ---------------------------------------------------------------------------
// Meshing, picking, physics (pure signatures shared with render/player)
// ---------------------------------------------------------------------------

export interface MeshBuffers {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  idx: Uint32Array;
}

export interface VoxelHit {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly t: number;
  readonly id: number;
}

export const PICK_DISTANCE = 6;

export const PLAYER = {
  halfW: 0.3, height: 1.8, eye: 1.62, speed: 4.3, sprint: 6.5, jumpVel: 8.5, gravity: -28, maxFall: -40,
  fixedDt: 1 / 60, maxFrameDt: 0.1, maxAxisStep: 0.5,
} as const;

export interface PlayerState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  onGround: boolean;
}

export interface FrameInput {
  forward: number;   // -1..1
  strafe: number;    // -1..1
  jump: boolean;
  sprint: boolean;
}
