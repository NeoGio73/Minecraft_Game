/**
 * Extraction of molecule graphs from the index: explicit H blocks are
 * collapsed into `hPos`, suppressed pairs never reach the graph.
 * PURE MODULE (no three, no DOM); depends only on `src/chem/types.ts`.
 * See docs/design/02-chemistry-core.md §12.3, 09-amendment-no-bond.md §1.7,
 * 06-engine.md §1 (`implicitHCell`).
 */
import { TARGET_VALENCE } from '../chem/types';
import type { Bond, BondOrder, Vec3, Warning, WorldAtom, WorldGraph } from '../chem/types';
import { Block, H_FILL_ORDER, cellIndex, parseCellKey, splitPairKey, zoneOf } from './types';
import type { CellKey, ComponentId, IndexedAtom, IndexedBond, MoleculeIndex, PairKey, Zone } from './types';
import type { MoleculeIndexExt } from './molecule-index';

export interface ExtractedComponent {
  readonly id: ComponentId;
  readonly graph: WorldGraph;
  /** cells[atomId] = cell of that heavy atom. */
  readonly cells: readonly CellKey[];
  /** hCells[atomId][k] = cell of graph.atoms[atomId].hPos[k]. */
  readonly hCells: readonly (readonly CellKey[])[];
  readonly warnings: readonly Warning[];
  /** Common zone of every atom; 'world' when atoms disagree. */
  readonly zone: Zone;
}

export interface Extraction {
  readonly components: readonly ExtractedComponent[];
  readonly orphanHydrogens: readonly CellKey[];
}

function cellIndexOf(a: IndexedAtom): number {
  return cellIndex(a.x, a.y, a.z);
}

function buildWorldGraph(atoms: readonly WorldAtom[], bonds: readonly Bond[]): WorldGraph {
  const adj: number[][] = atoms.map(() => []);
  bonds.forEach((b, k) => {
    (adj[b.a] as number[]).push(k);
    (adj[b.b] as number[]).push(k);
  });
  return { atoms, bonds, adj };
}

function extractOne(index: MoleculeIndex, id: ComponentId, cells: readonly CellKey[], orphans: CellKey[]): ExtractedComponent | null {
  const members = cells.map((k) => index.atoms.get(k)).filter((a): a is IndexedAtom => a !== undefined);
  const heavy = members.filter((a) => a.el !== 'H').sort((p, q) => cellIndexOf(p) - cellIndexOf(q));
  const hs = members.filter((a) => a.el === 'H').sort((p, q) => cellIndexOf(p) - cellIndexOf(q));
  if (heavy.length === 0) {
    for (const h of hs) orphans.push(h.key);
    return null;
  }
  const idOf = new Map<CellKey, number>();
  heavy.forEach((a, i) => idOf.set(a.key, i));
  const warnings: Warning[] = [];
  const hPos: Vec3[][] = heavy.map(() => []);
  const hCells: CellKey[][] = heavy.map(() => []);

  // 3. H blocks
  for (const h of hs) {
    const parents = index.bondsOf(h.key)
      .map((b) => (b.a === h.key ? b.b : b.a))
      .map((k) => index.atoms.get(k))
      .filter((a): a is IndexedAtom => a !== undefined && a.el !== 'H')
      .sort((p, q) => cellIndexOf(p) - cellIndexOf(q));
    if (parents.length === 0) {
      orphans.push(h.key);
      continue;
    }
    const p0 = parents[0] as IndexedAtom;
    const pid = idOf.get(p0.key) as number;
    (hPos[pid] as Vec3[]).push([h.x, h.y, h.z]);
    (hCells[pid] as CellKey[]).push(h.key);
    if (parents.length >= 2) warnings.push({ kind: 'h-block-valence', atom: pid, bonds: parents.length });
  }

  // 2. atoms
  const atoms: WorldAtom[] = heavy.map((a, i) => {
    if (TARGET_VALENCE[a.el][a.charge] === undefined) {
      warnings.push({ kind: 'charge-unsupported', atom: i, charge: a.charge });
    }
    return {
      id: i,
      el: a.el,
      charge: a.charge,
      explicitH: null,
      aromatic: false,
      pos: [a.x, a.y, a.z] as Vec3,
      hPos: hPos[i] as readonly Vec3[],
    };
  });

  // 4. bonds between heavy cells, ordered by (min id, max id)
  const seen = new Set<PairKey>();
  const raw: { a: number; b: number; bond: IndexedBond }[] = [];
  for (const a of heavy) {
    for (const b of index.bondsOf(a.key)) {
      if (seen.has(b.key)) continue;
      const ia = idOf.get(b.a);
      const ib = idOf.get(b.b);
      if (ia === undefined || ib === undefined) continue;
      seen.add(b.key);
      raw.push({ a: Math.min(ia, ib), b: Math.max(ia, ib), bond: b });
    }
  }
  raw.sort((p, q) => (p.a - q.a) || (p.b - q.b));
  const bonds: Bond[] = raw.map((r) => {
    const base = { a: r.a, b: r.b, order: r.bond.order as BondOrder, aromatic: false };
    return r.bond.diagonal ? { ...base, diagonal: true } : base;
  });

  const graph = buildWorldGraph(atoms, bonds);

  // 5. zone
  let zone: Zone | null = null;
  let agree = true;
  for (const a of [...heavy, ...hs]) {
    if (a.el === 'H' && !hCells.some((list) => list.includes(a.key))) continue; // orphan H not part of this molecule
    const zi = zoneOf(a.x, a.y, a.z);
    if (zone === null) zone = zi;
    else if (zone !== zi) agree = false;
  }
  return { id, graph, cells: heavy.map((a) => a.key), hCells, warnings, zone: agree && zone ? zone : 'world' };
}

/** Every component (ascending id) as a WorldGraph with explicit H collapsed; with `zone`, only those whose zone equals it. */
export function extractAll(index: MoleculeIndex, zone?: Zone): Extraction {
  const components: ExtractedComponent[] = [];
  const orphanHydrogens: CellKey[] = [];
  const ids = Array.from(index.components().keys()).sort((a, b) => a - b);
  for (const id of ids) {
    const cells = index.components().get(id) ?? [];
    const c = extractOne(index, id, cells, orphanHydrogens);
    if (!c) continue;
    if (zone !== undefined && c.zone !== zone) continue;
    components.push(c);
  }
  return { components, orphanHydrogens };
}

export function extractMolecules(index: MoleculeIndex, zone?: Zone): WorldGraph[] {
  return extractAll(index, zone).components.map((c) => c.graph);
}

/** The graph of one component. Throws when the id is unknown or the component holds no heavy atom. */
export function extractComponent(index: MoleculeIndex, id: ComponentId): WorldGraph {
  const cells = index.components().get(id);
  if (!cells) throw new Error('no such component: ' + id);
  const c = extractOne(index, id, cells, []);
  if (!c) throw new Error('component has no heavy atom: ' + id);
  return c.graph;
}

/** The full ExtractedComponent record of one component (cells, hCells, warnings, zone). */
export function extractComponentDetailed(index: MoleculeIndex, id: ComponentId): ExtractedComponent {
  const cells = index.components().get(id);
  if (!cells) throw new Error('no such component: ' + id);
  const c = extractOne(index, id, cells, []);
  if (!c) throw new Error('component has no heavy atom: ' + id);
  return c;
}

/** Suppressed pairs touching any cell of component `id`, sorted by PairKey
 *  (may include pairs whose other endpoint is in another component). */
export function suppressedPairsOfComponent(index: MoleculeIndexExt, id: ComponentId): PairKey[] {
  const cells = index.components().get(id);
  if (!cells) return [];
  const set = new Set(cells);
  const out: PairKey[] = [];
  for (const key of index.suppressed) {
    const [a, b] = splitPairKey(key);
    if (set.has(a) || set.has(b)) out.push(key);
  }
  return out.sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
}

/**
 * k-th implicit-hydrogen cell of the atom at (x,y,z): free face cells in
 * H_FILL_ORDER order, where free = get(...) === Block.Air. Returns null when
 * fewer than k+1 free faces exist.
 */
export function implicitHCell(get: (x: number, y: number, z: number) => number, x: number, y: number, z: number, k: number): Vec3 | null {
  if (k < 0) return null;
  let seen = 0;
  for (const d of H_FILL_ORDER) {
    const cx = x + d[0];
    const cy = y + d[1];
    const cz = z + d[2];
    if (get(cx, cy, cz) !== Block.Air) continue;
    if (seen === k) return [cx, cy, cz];
    seen++;
  }
  return null;
}

/** Convenience for callers holding a CellKey. */
export function implicitHCellOfKey(get: (x: number, y: number, z: number) => number, key: CellKey, k: number): Vec3 | null {
  const [x, y, z] = parseCellKey(key);
  return implicitHCell(get, x, y, z, k);
}
