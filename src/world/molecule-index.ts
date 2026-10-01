/**
 * Molecule index: derived from the grid but authoritative for bond orders,
 * suppressed ("no bond") pairs and charges. Also hosts placement / bond /
 * charge validation (refuse, never silently drop a bond).
 * PURE MODULE (no three, no DOM).
 * See docs/design/02-chemistry-core.md §12.1–12.2 and 09-amendment-no-bond.md §1.1, §1.3.
 */
import { TARGET_VALENCE } from '../chem/types';
import type { BondOrder, Charge } from '../chem/types';
import {
  Block, FACE_DIRS, REFUSAL_TEXT, WORLD_D, WORLD_H, WORLD_W, cellIndex, cellKey, elementOf, isAtom, pairKey,
  parseCellKey, splitPairKey, zoneOf,
} from './types';
import type {
  BlockElement, BondChangeRefusal, CellKey, ChargeChangeResult, ComponentId, IndexedAtom, IndexedBond, MoleculeIndex,
  PairKey, PlacementResult, Zone,
} from './types';
import { playerOverlapsCell } from './raycast';

// ---------------------------------------------------------------------------
// Contract additions declared locally (09 §1.1, §1.3; 02 §1)
// ---------------------------------------------------------------------------

/** Bond order as the wand sees it. 0 = "no bond" (a suppressed pair). Never stored in a MoleculeGraph. */
export type WandOrder = BondOrder | 0;

/** The wand cycle 1 -> 2 -> 3 -> 0 -> 1. */
export const WAND_CYCLE: readonly WandOrder[] = [1, 2, 3, 0];

export interface MoleculeIndexExt extends MoleculeIndex {
  /** Touching atom pairs that are NOT bonded. Disjoint from `bonds`. Never contains a pair with an H endpoint. */
  readonly suppressed: ReadonlySet<PairKey>;
  isSuppressed(key: PairKey): boolean;
  /** Suppressed pairs with `key` as an endpoint, sorted by PairKey. */
  suppressedOf(key: CellKey): PairKey[];
  /** bonds.get(key)?.order ?? (suppressed.has(key) ? 0 : undefined); undefined = the cells do not touch. */
  wandOrder(key: PairKey): WandOrder | undefined;
  /** neighbours(key) minus the partners of suppressedOf(key) — the atoms that contribute to bondsOf(key). */
  bondedNeighbours(key: CellKey): IndexedAtom[];
  /** Moves an existing bond record out of `bonds` into `suppressed`. Throws Error('not a bond: ' + key) otherwise. */
  suppressBond(key: PairKey): void;
  /** Moves a suppressed pair back into `bonds` as {order: 1, diagonal: false}. Throws Error('not suppressed: ' + key) otherwise. */
  restoreBond(key: PairKey): void;
  /** As MoleculeIndex.rebuildFromGrid, plus: after atoms and orders are restored, every pair of `keepSuppressed`
   *  whose two cells are atoms and touch (and has no H endpoint) is suppressed; others are dropped silently. */
  rebuildFromGrid(
    get: (x: number, y: number, z: number) => number,
    keepOrders: ReadonlyMap<PairKey, BondOrder>,
    keepCharges: ReadonlyMap<CellKey, Charge>,
    keepSuppressed?: ReadonlySet<PairKey>,
  ): void;
}

export interface PlacementContext {
  readonly getBlock: (x: number, y: number, z: number) => number;
  /** Remaining blocks per element; H is Infinity. */
  readonly inventory: Readonly<Record<BlockElement, number>>;
  /** Player feet position, or null when overlap is not checked (tests). */
  readonly player: { readonly x: number; readonly y: number; readonly z: number } | null;
  /** Zones that refuse mutations right now (['reactant'] while a bench challenge is active). */
  readonly lockedZones: readonly Zone[];
}

export type BondChangeResultExt =
  | { readonly ok: true; readonly order: WandOrder; readonly previous: WandOrder }
  | { readonly ok: false; readonly refusal: BondChangeRefusal; readonly message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function targetValenceOf(el: BlockElement, charge: Charge): number | undefined {
  return TARGET_VALENCE[el][charge];
}

function cellIndexOfKey(key: CellKey): number {
  const [x, y, z] = parseCellKey(key);
  return cellIndex(x, y, z);
}

function comparePairKeys(a: PairKey, b: PairKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function otherCell(key: PairKey, cell: CellKey): CellKey {
  const [a, b] = splitPairKey(key);
  return a === cell ? b : a;
}

function addToSetMap<K, V>(map: Map<K, Set<V>>, k: K, v: V): void {
  let s = map.get(k);
  if (!s) {
    s = new Set();
    map.set(k, s);
  }
  s.add(v);
}

function deleteFromSetMap<K, V>(map: Map<K, Set<V>>, k: K, v: V): void {
  const s = map.get(k);
  if (!s) return;
  s.delete(v);
  if (s.size === 0) map.delete(k);
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

class MoleculeIndexImpl implements MoleculeIndexExt {
  readonly atoms = new Map<CellKey, IndexedAtom>();
  readonly bonds = new Map<PairKey, IndexedBond>();
  readonly suppressed = new Set<PairKey>();
  private readonly adjacency = new Map<CellKey, Set<PairKey>>();
  private readonly suppressedAdjacency = new Map<CellKey, Set<PairKey>>();
  private componentCache: { byCell: Map<CellKey, ComponentId>; list: Map<ComponentId, readonly CellKey[]> } | null = null;

  private invalidate(): void {
    this.componentCache = null;
  }

  // ----- reads -----------------------------------------------------------

  neighbours(key: CellKey): IndexedAtom[] {
    const [x, y, z] = parseCellKey(key);
    const out: IndexedAtom[] = [];
    for (const d of FACE_DIRS) {
      const a = this.atoms.get(cellKey(x + d[0], y + d[1], z + d[2]));
      if (a) out.push(a);
    }
    return out;
  }

  bondsOf(key: CellKey): IndexedBond[] {
    const s = this.adjacency.get(key);
    if (!s) return [];
    const keys = Array.from(s).sort(comparePairKeys);
    return keys.map((k) => this.bonds.get(k) as IndexedBond);
  }

  bondOrderSum(key: CellKey): number {
    let sum = 0;
    const s = this.adjacency.get(key);
    if (!s) return 0;
    for (const k of s) sum += (this.bonds.get(k) as IndexedBond).order;
    return sum;
  }

  isSuppressed(key: PairKey): boolean {
    return this.suppressed.has(key);
  }

  suppressedOf(key: CellKey): PairKey[] {
    const s = this.suppressedAdjacency.get(key);
    if (!s) return [];
    return Array.from(s).sort(comparePairKeys);
  }

  wandOrder(key: PairKey): WandOrder | undefined {
    const b = this.bonds.get(key);
    if (b) return b.order;
    return this.suppressed.has(key) ? 0 : undefined;
  }

  bondedNeighbours(key: CellKey): IndexedAtom[] {
    const sup = this.suppressedAdjacency.get(key);
    if (!sup || sup.size === 0) return this.neighbours(key);
    const partners = new Set<CellKey>();
    for (const p of sup) partners.add(otherCell(p, key));
    return this.neighbours(key).filter((a) => !partners.has(a.key));
  }

  private computeComponents(): { byCell: Map<CellKey, ComponentId>; list: Map<ComponentId, readonly CellKey[]> } {
    const byCell = new Map<CellKey, ComponentId>();
    const list = new Map<ComponentId, readonly CellKey[]>();
    const sorted = Array.from(this.atoms.keys()).sort((a, b) => cellIndexOfKey(a) - cellIndexOfKey(b));
    let next = 0;
    for (const start of sorted) {
      if (byCell.has(start)) continue;
      const id = next++;
      const cells: CellKey[] = [];
      const queue: CellKey[] = [start];
      byCell.set(start, id);
      let head = 0;
      while (head < queue.length) {
        const c = queue[head++] as CellKey;
        cells.push(c);
        const adj = this.adjacency.get(c);
        if (!adj) continue;
        for (const pk of adj) {
          const o = otherCell(pk, c);
          if (!byCell.has(o)) {
            byCell.set(o, id);
            queue.push(o);
          }
        }
      }
      cells.sort((a, b) => cellIndexOfKey(a) - cellIndexOfKey(b));
      list.set(id, cells);
    }
    return { byCell, list };
  }

  private cache(): { byCell: Map<CellKey, ComponentId>; list: Map<ComponentId, readonly CellKey[]> } {
    if (!this.componentCache) this.componentCache = this.computeComponents();
    return this.componentCache;
  }

  componentOf(key: CellKey): ComponentId {
    const id = this.cache().byCell.get(key);
    if (id === undefined) throw new Error('not an atom cell: ' + key);
    return id;
  }

  components(): ReadonlyMap<ComponentId, readonly CellKey[]> {
    return this.cache().list;
  }

  // ----- mutations -------------------------------------------------------

  addAtom(atom: IndexedAtom): void {
    if (this.atoms.has(atom.key)) throw new Error('cell already indexed: ' + atom.key);
    this.atoms.set(atom.key, atom);
    for (const n of this.neighbours(atom.key)) {
      const key = pairKey(atom.key, n.key);
      const [a, b] = splitPairKey(key);
      const bond: IndexedBond = { key, a, b, order: 1, diagonal: false };
      this.bonds.set(key, bond);
      addToSetMap(this.adjacency, a, key);
      addToSetMap(this.adjacency, b, key);
    }
    this.invalidate();
  }

  removeAtom(key: CellKey): void {
    if (!this.atoms.has(key)) return;
    const adj = this.adjacency.get(key);
    if (adj) {
      for (const pk of Array.from(adj)) {
        const o = otherCell(pk, key);
        this.bonds.delete(pk);
        deleteFromSetMap(this.adjacency, o, pk);
      }
      this.adjacency.delete(key);
    }
    const sup = this.suppressedAdjacency.get(key);
    if (sup) {
      for (const pk of Array.from(sup)) {
        const o = otherCell(pk, key);
        this.suppressed.delete(pk);
        deleteFromSetMap(this.suppressedAdjacency, o, pk);
      }
      this.suppressedAdjacency.delete(key);
    }
    this.atoms.delete(key);
    this.invalidate();
  }

  setBondOrder(key: PairKey, order: BondOrder): void {
    const b = this.bonds.get(key);
    if (!b) throw new Error('not a bond: ' + key);
    this.bonds.set(key, { key: b.key, a: b.a, b: b.b, order, diagonal: b.diagonal });
    // adjacency is unchanged, but the bonded structure changed (orders matter to callers' signatures)
  }

  setCharge(key: CellKey, charge: Charge): void {
    const a = this.atoms.get(key);
    if (!a) throw new Error('not an atom cell: ' + key);
    this.atoms.set(key, { key: a.key, el: a.el, x: a.x, y: a.y, z: a.z, charge });
  }

  suppressBond(key: PairKey): void {
    const b = this.bonds.get(key);
    if (!b) throw new Error('not a bond: ' + key);
    this.bonds.delete(key);
    deleteFromSetMap(this.adjacency, b.a, key);
    deleteFromSetMap(this.adjacency, b.b, key);
    this.suppressed.add(key);
    addToSetMap(this.suppressedAdjacency, b.a, key);
    addToSetMap(this.suppressedAdjacency, b.b, key);
    this.invalidate();
  }

  restoreBond(key: PairKey): void {
    if (!this.suppressed.has(key)) throw new Error('not suppressed: ' + key);
    const [a, b] = splitPairKey(key);
    this.suppressed.delete(key);
    deleteFromSetMap(this.suppressedAdjacency, a, key);
    deleteFromSetMap(this.suppressedAdjacency, b, key);
    this.bonds.set(key, { key, a, b, order: 1, diagonal: false });
    addToSetMap(this.adjacency, a, key);
    addToSetMap(this.adjacency, b, key);
    this.invalidate();
  }

  /** Test hook / v2 diagonal wand: replaces a bond record with its `diagonal` flag set. */
  setDiagonal(key: PairKey, diagonal: boolean): void {
    const b = this.bonds.get(key);
    if (!b) throw new Error('not a bond: ' + key);
    this.bonds.set(key, { key: b.key, a: b.a, b: b.b, order: b.order, diagonal });
  }

  /** Test hook / v2 diagonal wand: registers a bond between two non-touching atom cells. */
  addBond(a: CellKey, b: CellKey, order: BondOrder, diagonal: boolean): void {
    if (!this.atoms.has(a) || !this.atoms.has(b)) throw new Error('not an atom cell');
    const key = pairKey(a, b);
    if (this.bonds.has(key)) throw new Error('already a bond: ' + key);
    const [ka, kb] = splitPairKey(key);
    this.bonds.set(key, { key, a: ka, b: kb, order, diagonal });
    addToSetMap(this.adjacency, ka, key);
    addToSetMap(this.adjacency, kb, key);
    this.invalidate();
  }

  rebuildFromGrid(
    get: (x: number, y: number, z: number) => number,
    keepOrders: ReadonlyMap<PairKey, BondOrder>,
    keepCharges: ReadonlyMap<CellKey, Charge>,
    keepSuppressed?: ReadonlySet<PairKey>,
  ): void {
    this.atoms.clear();
    this.bonds.clear();
    this.suppressed.clear();
    this.adjacency.clear();
    this.suppressedAdjacency.clear();
    this.invalidate();
    for (let y = 0; y < WORLD_H; y++) {
      for (let z = 0; z < WORLD_D; z++) {
        for (let x = 0; x < WORLD_W; x++) {
          const id = get(x, y, z);
          if (!isAtom(id)) continue;
          const key = cellKey(x, y, z);
          const el = elementOf(id) as BlockElement;
          this.addAtom({ key, el, x, y, z, charge: keepCharges.get(key) ?? 0 });
        }
      }
    }
    for (const key of Array.from(this.bonds.keys())) {
      const o = keepOrders.get(key);
      if (o !== undefined && o !== 1) this.setBondOrder(key, o);
    }
    if (keepSuppressed) {
      for (const key of keepSuppressed) {
        const b = this.bonds.get(key);
        if (!b) continue;
        const ea = this.atoms.get(b.a);
        const eb = this.atoms.get(b.b);
        if (!ea || !eb || ea.el === 'H' || eb.el === 'H') continue;
        this.suppressBond(key);
      }
    }
  }
}

/** Extended index used by tests and the v2 diagonal wand (adds `addBond` / `setDiagonal`). */
export interface MoleculeIndexTestHooks extends MoleculeIndexExt {
  addBond(a: CellKey, b: CellKey, order: BondOrder, diagonal: boolean): void;
  setDiagonal(key: PairKey, diagonal: boolean): void;
}

/** The only factory; every caller receives the extended index. */
export function createMoleculeIndex(): MoleculeIndexExt {
  return new MoleculeIndexImpl();
}

/** Same object as createMoleculeIndex() with the test-only writers exposed. */
export function createMoleculeIndexWithHooks(): MoleculeIndexTestHooks {
  return new MoleculeIndexImpl();
}

// ---------------------------------------------------------------------------
// Cage detection on the bonded cell graph (02 §12.2 success rule, critic 4.5)
// ---------------------------------------------------------------------------

/**
 * Smallest ring through every bond of one component (cells), each as a list of
 * cell keys in path order; rings larger than `maxSize` are skipped.
 */
function componentRings(index: MoleculeIndex, cells: readonly CellKey[], maxSize = 8): CellKey[][] {
  const inComp = new Set(cells);
  const bondList: IndexedBond[] = [];
  const seen = new Set<PairKey>();
  for (const c of cells) {
    for (const b of index.bondsOf(c)) {
      if (seen.has(b.key)) continue;
      if (!inComp.has(b.a) || !inComp.has(b.b)) continue;
      seen.add(b.key);
      bondList.push(b);
    }
  }
  const found = new Map<string, CellKey[]>();
  for (const bond of bondList) {
    const parent = new Map<CellKey, CellKey | null>();
    parent.set(bond.a, null);
    const queue: CellKey[] = [bond.a];
    let head = 0;
    let reached = false;
    while (head < queue.length && !reached) {
      const u = queue[head++] as CellKey;
      for (const nb of index.bondsOf(u)) {
        if (nb.key === bond.key) continue;
        const v = nb.a === u ? nb.b : nb.a;
        if (parent.has(v)) continue;
        parent.set(v, u);
        if (v === bond.b) {
          reached = true;
          break;
        }
        queue.push(v);
      }
    }
    if (!reached) continue;
    const path: CellKey[] = [];
    for (let v: CellKey | null = bond.b; v !== null; v = parent.get(v) ?? null) path.push(v);
    if (path.length > maxSize) continue;
    const key = [...path].sort().join(';');
    if (!found.has(key)) found.set(key, path.reverse());
  }
  return Array.from(found.values());
}

// ---------------------------------------------------------------------------
// Validation (02 §12.2, 09 §1.3)
// ---------------------------------------------------------------------------

export function validatePlacement(
  index: MoleculeIndex,
  x: number,
  y: number,
  z: number,
  el: BlockElement,
  ctx: PlacementContext,
): PlacementResult {
  // 1. bounds
  if (!(x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H && z >= 0 && z < WORLD_D)
    || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
    return { ok: false, refusal: { reason: 'out-of-bounds' }, message: REFUSAL_TEXT.outOfBounds };
  }
  // 2. occupied
  if (ctx.getBlock(x, y, z) !== Block.Air) {
    return { ok: false, refusal: { reason: 'occupied' }, message: REFUSAL_TEXT.occupied };
  }
  // 3. player overlap
  if (ctx.player && playerOverlapsCell({ x: ctx.player.x, y: ctx.player.y, z: ctx.player.z }, x, y, z)) {
    return { ok: false, refusal: { reason: 'player-overlap' }, message: REFUSAL_TEXT.playerOverlap };
  }
  // 4. locked zone
  const zone = zoneOf(x, y, z);
  if (ctx.lockedZones.includes(zone)) {
    return { ok: false, refusal: { reason: 'locked-zone', zone }, message: REFUSAL_TEXT.lockedZone };
  }
  // 5. inventory
  const have = ctx.inventory[el];
  if (!(have > 0)) {
    return { ok: false, refusal: { reason: 'inventory-empty', el }, message: REFUSAL_TEXT.inventoryEmpty(el) };
  }
  // 6. valence of the new atom and of every neighbour it would bond to
  const key = cellKey(x, y, z);
  const nbs = index.neighbours(key);
  const tvNew = targetValenceOf(el, 0) ?? 0;
  if (el !== 'H' && nbs.length > tvNew) {
    return {
      ok: false,
      refusal: { reason: 'valence', cell: key, el, have: nbs.length, max: tvNew },
      message: REFUSAL_TEXT.valence(el, nbs.length, tvNew),
    };
  }
  for (const n of nbs) {
    const nHave = index.bondOrderSum(n.key) + 1;
    const nMax = targetValenceOf(n.el, n.charge) ?? 0;
    if (nHave > nMax) {
      return {
        ok: false,
        refusal: { reason: 'valence', cell: n.key, el: n.el, have: nHave, max: nMax },
        message: REFUSAL_TEXT.valence(n.el, nHave, nMax),
      };
    }
  }
  // 7. H-block parent rule
  if (el === 'H') {
    const heavy = nbs.filter((n) => n.el !== 'H').length;
    if (heavy !== 1) {
      return { ok: false, refusal: { reason: 'h-block-needs-parent' }, message: REFUSAL_TEXT.hBlockNeedsParent };
    }
  }
  // success
  const newBonds = nbs.map((n) => pairKey(key, n.key));
  let cage = false;
  if (nbs.length >= 3) {
    const byComponent = new Map<ComponentId, CellKey[]>();
    for (const n of nbs) {
      const c = index.componentOf(n.key);
      let list = byComponent.get(c);
      if (!list) {
        list = [];
        byComponent.set(c, list);
      }
      list.push(n.key);
    }
    for (const [c, members] of byComponent) {
      if (members.length < 3) continue;
      const cells = index.components().get(c) ?? [];
      const memberSet = new Set(members);
      for (const ring of componentRings(index, cells)) {
        let hits = 0;
        for (const r of ring) if (memberSet.has(r)) hits++;
        if (hits >= 3) {
          cage = true;
          break;
        }
      }
      if (cage) break;
    }
  }
  return { ok: true, newBonds, cage };
}

export function validateBondChange(
  index: MoleculeIndexExt,
  key: PairKey,
  ctx: Pick<PlacementContext, 'lockedZones'>,
): BondChangeResultExt {
  // 1. must touch
  const o = index.wandOrder(key);
  if (o === undefined) {
    return { ok: false, refusal: { reason: 'not-adjacent' }, message: REFUSAL_TEXT.bondNotAdjacent };
  }
  const [ka, kb] = splitPairKey(key);
  const ea = index.atoms.get(ka);
  const eb = index.atoms.get(kb);
  if (!ea || !eb) {
    return { ok: false, refusal: { reason: 'not-adjacent' }, message: REFUSAL_TEXT.bondNotAdjacent };
  }
  // 2. locked zone
  for (const e of [ea, eb]) {
    const zone = zoneOf(e.x, e.y, e.z);
    if (ctx.lockedZones.includes(zone)) {
      return { ok: false, refusal: { reason: 'locked-zone', zone }, message: REFUSAL_TEXT.lockedZone };
    }
  }
  // 3. H endpoint
  for (const e of [ea, eb]) {
    if (e.el === 'H') {
      return { ok: false, refusal: { reason: 'h-block', cell: e.key }, message: REFUSAL_TEXT.bondHBlock };
    }
  }
  // 4. the cycle
  const i = WAND_CYCLE.indexOf(o);
  const endpoints = [ea, eb].sort((p, q) => cellIndex(p.x, p.y, p.z) - cellIndex(q.x, q.y, q.z));
  for (let step = 1; step <= 3; step++) {
    const n = WAND_CYCLE[(i + step) % WAND_CYCLE.length] as WandOrder;
    if (n === 0) return { ok: true, order: 0, previous: o };
    let feasible = true;
    for (const e of endpoints) {
      const tv = targetValenceOf(e.el, e.charge);
      if (tv === undefined || index.bondOrderSum(e.key) - o + n > tv) {
        feasible = false;
        break;
      }
    }
    if (feasible) return { ok: true, order: n, previous: o };
  }
  // 5. nothing feasible: only reachable from o === 0 when order 1 is refused
  for (const e of endpoints) {
    const tv = targetValenceOf(e.el, e.charge) ?? 0;
    const have = index.bondOrderSum(e.key) + 1;
    if (have > tv) {
      return {
        ok: false,
        refusal: { reason: 'valence', cell: e.key, el: e.el, have, max: tv },
        message: REFUSAL_TEXT.bondValence(e.el, tv),
      };
    }
  }
  // Unreachable by construction; kept total.
  const e = endpoints[0] as IndexedAtom;
  const tv = targetValenceOf(e.el, e.charge) ?? 0;
  return {
    ok: false,
    refusal: { reason: 'valence', cell: e.key, el: e.el, have: index.bondOrderSum(e.key) + 1, max: tv },
    message: REFUSAL_TEXT.bondValence(e.el, tv),
  };
}

export function validateChargeChange(
  index: MoleculeIndex,
  key: CellKey,
  charge: Charge,
  ctx: Pick<PlacementContext, 'lockedZones'>,
): ChargeChangeResult {
  const atom = index.atoms.get(key);
  if (!atom) {
    return { ok: false, refusal: { reason: 'h-block' }, message: REFUSAL_TEXT.bondHBlock };
  }
  const zone = zoneOf(atom.x, atom.y, atom.z);
  if (ctx.lockedZones.includes(zone)) {
    return { ok: false, refusal: { reason: 'locked-zone', zone }, message: REFUSAL_TEXT.lockedZone };
  }
  if (atom.el === 'H') {
    return { ok: false, refusal: { reason: 'h-block' }, message: REFUSAL_TEXT.chargeUnsupported('H', charge) };
  }
  const tv = targetValenceOf(atom.el, charge);
  if (tv === undefined) {
    return {
      ok: false,
      refusal: { reason: 'unsupported', el: atom.el, charge },
      message: REFUSAL_TEXT.chargeUnsupported(atom.el, charge),
    };
  }
  const have = index.bondOrderSum(key);
  if (have > tv) {
    return {
      ok: false,
      refusal: { reason: 'valence', cell: key, el: atom.el, have, max: tv },
      message: REFUSAL_TEXT.chargeValence(atom.el, charge, tv),
    };
  }
  return { ok: true, charge };
}
