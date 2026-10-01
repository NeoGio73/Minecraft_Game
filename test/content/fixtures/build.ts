/**
 * Test helpers for WP-05: place an embedding (or a hand layout) in the world
 * through `World.setBlock`, suppress the required pairs, set bond orders and
 * charges, and extract the resulting world graphs (05 §11 B3).
 */
import { World } from '@/world/world';
import { atomBlockOf, cellKey, pairKey, zoneOf } from '@/world/types';
import type { BlockElement, CellKey, Zone } from '@/world/types';
import { extractMolecules } from '@/world/extract';
import { buildGraph, withoutStereoTags } from '@/chem/graph';
import type { LatticeEmbedding } from '@/chem/embed';
import type { MoleculeGraph, Vec3, WorldAtom, WorldGraph } from '@/chem/types';

/** Lab-pad origin (x,z inside [52,76), y = 10 so an H block below stays on the pad) and the product zone origin (04 §7.2). */
export const PAD_ORIGIN: Vec3 = [58, 10, 58];
export const PRODUCT_ORIGIN: Vec3 = [65, 10, 37];

export interface BuildOptions {
  /** Suppress the embedding's touching unbonded pairs (default true). */
  readonly suppress?: boolean;
  /** Reflect through the yz plane before placing (every tetrahedral parity flips, E/Z kept). */
  readonly mirror?: boolean;
  /** Extra H-block cells (relative, same frame as `pos`) keyed by parent atom id; merged with the embedding's hPos. */
  readonly extraH?: Readonly<Record<number, readonly Vec3[]>>;
  /** Bond orders to set on top of the graph's own (pairs [a, b, order]). */
  readonly overrideOrders?: readonly (readonly [number, number, 1 | 2 | 3])[];
}

export interface Built {
  readonly world: World;
  /** Cell of every heavy atom, by atom id. */
  readonly cells: readonly CellKey[];
  readonly origin: Vec3;
}

function translateAll(pos: readonly Vec3[], hPos: ReadonlyMap<number, readonly Vec3[]>, origin: Vec3, mirror: boolean): { pos: Vec3[]; hPos: Map<number, Vec3[]> } {
  const flip = (p: Vec3): Vec3 => (mirror ? [-p[0], p[1], p[2]] : p);
  const all: Vec3[] = [...pos.map(flip)];
  for (const list of hPos.values()) for (const h of list) all.push(flip(h));
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const p of all) for (let k = 0; k < 3; k++) min[k] = Math.min(min[k]!, p[k]!);
  const t = (p: Vec3): Vec3 => {
    const q = flip(p);
    return [q[0] - min[0] + origin[0], q[1] - min[1] + origin[1], q[2] - min[2] + origin[2]];
  };
  const hOut = new Map<number, Vec3[]>();
  for (const [k, list] of hPos) hOut.set(k, list.map(t));
  return { pos: pos.map(t), hPos: hOut };
}

/** Places `g` laid out by `emb` into `world` at `origin`. Returns the heavy-atom cells. */
export function placeInWorld(world: World, g: MoleculeGraph, emb: LatticeEmbedding, origin: Vec3, opts: BuildOptions = {}): CellKey[] {
  const hPosIn = new Map<number, Vec3[]>();
  for (const [k, list] of emb.hPos) hPosIn.set(k, [...list]);
  for (const [k, list] of Object.entries(opts.extraH ?? {})) {
    const id = Number(k);
    hPosIn.set(id, [...(hPosIn.get(id) ?? []), ...list]);
  }
  const { pos, hPos } = translateAll(emb.pos, hPosIn, origin, opts.mirror === true);
  const cells: CellKey[] = [];
  g.atoms.forEach((a, i) => {
    const p = pos[i]!;
    world.setBlock(p[0], p[1], p[2], atomBlockOf(a.el as BlockElement));
    cells.push(cellKey(p[0], p[1], p[2]));
  });
  for (const list of hPos.values()) for (const h of list) world.setBlock(h[0], h[1], h[2], atomBlockOf('H'));
  if (opts.suppress !== false) {
    for (const [a, b] of emb.suppressedPairs) world.suppressBond(pairKey(cells[a]!, cells[b]!));
  }
  for (const b of g.bonds) {
    if (b.order !== 1) world.setBondOrder(pairKey(cells[b.a]!, cells[b.b]!), b.order);
  }
  for (const [a, b, order] of opts.overrideOrders ?? []) world.setBondOrder(pairKey(cells[a]!, cells[b]!), order);
  g.atoms.forEach((a, i) => {
    if (a.charge !== 0) world.setCharge(cells[i]!, a.charge);
  });
  return cells;
}

/** A fresh world with `g` built from `emb` at `origin`. */
export function build(g: MoleculeGraph, emb: LatticeEmbedding, origin: Vec3 = PAD_ORIGIN, opts: BuildOptions = {}): Built {
  const world = new World();
  const cells = placeInWorld(world, g, emb, origin, opts);
  return { world, cells, origin };
}

/** The molecules of a zone and the one containing `cell` (the "targeted" molecule). */
export function moleculesOf(world: World, zone: Zone, cell?: CellKey): { molecules: WorldGraph[]; targeted: WorldGraph | null } {
  const molecules = extractMolecules(world.index, zone);
  let targeted: WorldGraph | null = null;
  if (cell !== undefined) {
    const [x, y, z] = cell.split(',').map(Number);
    targeted = molecules.find((m) => m.atoms.some((a) => a.pos[0] === x && a.pos[1] === y && a.pos[2] === z)) ?? null;
  }
  return { molecules, targeted };
}

/** An embedding record from a hand layout (positions in SMILES atom order, optional H cells, no suppressed pairs unless given). */
export function layoutEmbedding(pos: readonly Vec3[], hPos: Readonly<Record<number, readonly Vec3[]>> = {}, suppressedPairs: readonly (readonly [number, number])[] = []): LatticeEmbedding {
  const map = new Map<number, readonly Vec3[]>();
  for (const [k, list] of Object.entries(hPos)) map.set(Number(k), list);
  return { pos: [...pos], hPos: map, nodesVisited: 0, suppressedPairs: [...suppressedPairs] };
}

/** World graph straight from a SMILES constitution plus cells (no world needed; tags stripped). */
export function grid(g: MoleculeGraph, pos: readonly Vec3[], hPos: Readonly<Record<number, readonly Vec3[]>> = {}): WorldGraph {
  const flat = withoutStereoTags(g);
  const atoms: WorldAtom[] = flat.atoms.map((a, i) => ({
    id: a.id, el: a.el, charge: a.charge, explicitH: null, aromatic: a.aromatic, pos: pos[i]!, hPos: hPos[i] ?? [],
  }));
  return buildGraph(atoms, flat.bonds);
}

export function zoneOfCell(cell: CellKey): Zone {
  const [x, y, z] = cell.split(',').map(Number);
  return zoneOf(x!, y!, z!);
}
