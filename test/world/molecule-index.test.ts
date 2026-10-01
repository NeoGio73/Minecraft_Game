import { describe, it, expect } from 'vitest';
import { Block, cellKey, pairKey, type BlockElement, type CellKey, type PairKey } from '@/world/types';
import {
  WAND_CYCLE, createMoleculeIndex, validateBondChange, validateChargeChange, validatePlacement, type PlacementContext,
} from '@/world/molecule-index';
import { World } from '@/world/world';
import { extractComponent } from '@/world/extract';
import { smallestRings } from '@/chem/graph';

const FULL_INV: Readonly<Record<BlockElement, number>> = { C: 99, N: 99, O: 99, S: 99, F: 99, Cl: 99, Br: 99, I: 99, H: Infinity };

function ctxFor(world: World, extra: Partial<PlacementContext> = {}): PlacementContext {
  return { getBlock: world.getBlock, inventory: FULL_INV, player: null, lockedZones: [], ...extra };
}

function atomId(el: BlockElement): number {
  return ({ C: Block.AtomC, N: Block.AtomN, O: Block.AtomO, S: Block.AtomS, F: Block.AtomF, Cl: Block.AtomCl, Br: Block.AtomBr, I: Block.AtomI, H: Block.AtomH } as const)[el];
}

function put(world: World, el: BlockElement, x: number, y: number, z: number): CellKey {
  world.setBlock(x, y, z, atomId(el));
  return cellKey(x, y, z);
}

function ringCount(world: World, id = 0): number {
  const g = extractComponent(world.index, id);
  return g.bonds.length - g.atoms.length + 1;
}

const K = (x: number, y: number, z: number): CellKey => cellKey(x, y, z);
const P = (a: CellKey, b: CellKey): PairKey => pairKey(a, b);

describe('MoleculeIndex basics', () => {
  it('M1: two touching carbons form one bond of order 1', () => {
    const w = new World();
    put(w, 'C', 10, 10, 10);
    put(w, 'C', 11, 10, 10);
    expect(w.index.bonds.size).toBe(1);
    const b = w.index.bonds.get('10,10,10|11,10,10');
    expect(b?.order).toBe(1);
    expect(b?.diagonal).toBe(false);
    expect(w.index.bondOrderSum(K(10, 10, 10))).toBe(1);
    expect(w.index.bondOrderSum(K(11, 10, 10))).toBe(1);
    expect(w.index.neighbours(K(10, 10, 10)).map((a) => a.key)).toEqual([K(11, 10, 10)]);
    expect(w.index.components().size).toBe(1);
    expect(w.index.componentOf(K(11, 10, 10))).toBe(0);
  });

  it('M2: cube-vertex chair hexagon has 6 bonds, no chord, one 6-ring', () => {
    const w = new World();
    for (const [x, y, z] of [[10, 10, 10], [11, 10, 10], [11, 11, 10], [11, 11, 11], [10, 11, 11], [10, 10, 11]]) put(w, 'C', x!, y!, z!);
    expect(w.index.bonds.size).toBe(6);
    expect(ringCount(w)).toBe(1);
    const rings = smallestRings(extractComponent(w.index, 0));
    expect(rings.length).toBe(1);
    expect(rings[0]!.length).toBe(6);
  });

  it('M3: planar 2x3 hexagon has 7 bonds (a chord) and ring count 2', () => {
    const w = new World();
    for (let x = 10; x <= 11; x++) for (let z = 10; z <= 12; z++) put(w, 'C', x, 10, z);
    expect(w.index.bonds.size).toBe(7);
    expect(ringCount(w)).toBe(2);
  });

  it('M4: a fifth carbon neighbour is refused by valence naming the centre', () => {
    const w = new World();
    put(w, 'C', 10, 10, 10);
    put(w, 'C', 11, 10, 10);
    put(w, 'C', 9, 10, 10);
    put(w, 'C', 10, 11, 10);
    put(w, 'C', 10, 9, 10);
    const r = validatePlacement(w.index, 10, 10, 11, 'C', ctxFor(w));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toEqual({ reason: 'valence', cell: K(10, 10, 10), el: 'C', have: 5, max: 4 });
  });

  it('M5: a third neighbour of oxygen is refused (have 3, max 2)', () => {
    const w = new World();
    put(w, 'O', 10, 10, 10);
    put(w, 'C', 11, 10, 10);
    put(w, 'C', 9, 10, 10);
    const r = validatePlacement(w.index, 10, 11, 10, 'C', ctxFor(w));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toEqual({ reason: 'valence', cell: K(10, 10, 10), el: 'O', have: 3, max: 2 });
  });

  it('M6: H-block parent rule', () => {
    const w = new World();
    put(w, 'C', 10, 10, 10);
    put(w, 'C', 12, 10, 10);
    const two = validatePlacement(w.index, 11, 10, 10, 'H', ctxFor(w));
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.refusal.reason).toBe('h-block-needs-parent');
    const one = validatePlacement(w.index, 10, 11, 10, 'H', ctxFor(w));
    expect(one.ok).toBe(true);
    put(w, 'H', 10, 11, 10);
    const second = validatePlacement(w.index, 10, 12, 10, 'H', ctxFor(w));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.refusal).toEqual({ reason: 'valence', cell: K(10, 11, 10), el: 'H', have: 2, max: 1 });
  });

  it('M7: the inner cube vertex of the chair is legal and flagged cage', () => {
    const w = new World();
    for (const [x, y, z] of [[10, 10, 10], [11, 10, 10], [11, 11, 10], [11, 11, 11], [10, 11, 11], [10, 10, 11]]) put(w, 'C', x!, y!, z!);
    const r = validatePlacement(w.index, 10, 11, 10, 'C', ctxFor(w));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cage).toBe(true);
      expect(r.newBonds.length).toBe(3);
      expect([...r.newBonds].sort()).toEqual([P(K(10, 11, 10), K(10, 10, 10)), P(K(10, 11, 10), K(11, 11, 10)), P(K(10, 11, 10), K(10, 11, 11))].sort());
    }
    put(w, 'C', 10, 11, 10);
    expect(ringCount(w)).toBe(3);
    // a plain chain extension is not a cage
    const w2 = new World();
    put(w2, 'C', 10, 10, 10);
    const r2 = validatePlacement(w2.index, 11, 10, 10, 'C', ctxFor(w2));
    expect(r2.ok && !r2.cage).toBe(true);
  });

  it('M9: charge changes on methanol O and a chlorine', () => {
    const w = new World();
    const c = put(w, 'C', 10, 10, 10);
    const o = put(w, 'O', 11, 10, 10);
    expect(validateChargeChange(w.index, o, -1, { lockedZones: [] })).toEqual({ ok: true, charge: -1 });
    put(w, 'H', 11, 11, 10);
    put(w, 'C', 12, 10, 10);
    put(w, 'C', 11, 10, 11); // O now has 4 bonds? no: O has C, H, C, C = 4 -> but let us test +1 with three bonds
    const r = validateChargeChange(w.index, o, 1, { lockedZones: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.reason).toBe('valence');
    void c;
    const w3 = new World();
    const cl = put(w3, 'Cl', 10, 10, 10);
    const u = validateChargeChange(w3.index, cl, 1, { lockedZones: [] });
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.refusal).toEqual({ reason: 'unsupported', el: 'Cl', charge: 1 });
    const h = put(w3, 'H', 11, 10, 10);
    const hr = validateChargeChange(w3.index, h, 1, { lockedZones: [] });
    expect(hr.ok).toBe(false);
    if (!hr.ok) expect(hr.refusal.reason).toBe('h-block');
  });

  it('M10: a reactant-zone cell is refused with locked-zone for placement, wand and charge', () => {
    const w = new World();
    const r = validatePlacement(w.index, 55, 10, 40, 'C', ctxFor(w, { lockedZones: ['reactant'] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toEqual({ reason: 'locked-zone', zone: 'reactant' });
    const a = put(w, 'C', 55, 10, 40);
    const b = put(w, 'C', 56, 10, 40);
    const br = validateBondChange(w.index, P(a, b), { lockedZones: ['reactant'] });
    expect(br.ok).toBe(false);
    if (!br.ok) expect(br.refusal).toEqual({ reason: 'locked-zone', zone: 'reactant' });
    const cr = validateChargeChange(w.index, a, 1, { lockedZones: ['reactant'] });
    expect(cr.ok).toBe(false);
    if (!cr.ok) expect(cr.refusal).toEqual({ reason: 'locked-zone', zone: 'reactant' });
    // the product zone is not locked
    const pr = validatePlacement(w.index, 70, 10, 40, 'C', ctxFor(w, { lockedZones: ['reactant'] }));
    expect(pr.ok).toBe(true);
  });

  it('placement order: bounds, occupied, player overlap, inventory', () => {
    const w = new World();
    put(w, 'C', 10, 10, 10);
    expect(validatePlacement(w.index, -1, 10, 10, 'C', ctxFor(w)).ok).toBe(false);
    const oob = validatePlacement(w.index, 10, 32, 10, 'C', ctxFor(w));
    if (!oob.ok) expect(oob.refusal.reason).toBe('out-of-bounds');
    const occ = validatePlacement(w.index, 10, 10, 10, 'C', ctxFor(w));
    if (!occ.ok) expect(occ.refusal.reason).toBe('occupied');
    const pl = validatePlacement(w.index, 10, 11, 10, 'C', ctxFor(w, { player: { x: 10.5, y: 10.2, z: 10.5 } }));
    expect(pl.ok).toBe(false);
    if (!pl.ok) expect(pl.refusal.reason).toBe('player-overlap');
    const inv = validatePlacement(w.index, 10, 11, 10, 'N', ctxFor(w, { inventory: { ...FULL_INV, N: 0 } }));
    expect(inv.ok).toBe(false);
    if (!inv.ok) expect(inv.refusal).toEqual({ reason: 'inventory-empty', el: 'N' });
    const ok = validatePlacement(w.index, 10, 11, 10, 'N', ctxFor(w));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.newBonds).toEqual([P(K(10, 11, 10), K(10, 10, 10))]);
  });

  it('M11: rebuildFromGrid preserves orders and charges', () => {
    const w = new World();
    for (const [x, y, z] of [[10, 10, 10], [11, 10, 10], [11, 11, 10], [11, 11, 11], [10, 11, 11], [10, 10, 11]]) put(w, 'C', x!, y!, z!);
    const pair = P(K(10, 10, 10), K(11, 10, 10));
    w.setBondOrder(pair, 2);
    w.setCharge(K(10, 10, 11), 1);
    const idx = createMoleculeIndex();
    idx.rebuildFromGrid(w.getBlock, new Map([[pair, 2 as const]]), new Map([[K(10, 10, 11), 1 as const]]));
    expect(idx.atoms.size).toBe(6);
    expect(idx.bonds.size).toBe(6);
    expect(idx.bonds.get(pair)?.order).toBe(2);
    expect(idx.atoms.get(K(10, 10, 11))?.charge).toBe(1);
    expect(idx.bonds.get(P(K(11, 10, 10), K(11, 11, 10)))?.order).toBe(1);
  });

  it('component ids follow the minimum cellIndex and are dense', () => {
    const w = new World();
    put(w, 'C', 50, 20, 50); // higher y -> larger cellIndex
    put(w, 'C', 10, 10, 10);
    put(w, 'C', 11, 10, 10);
    expect(w.index.componentOf(K(10, 10, 10))).toBe(0);
    expect(w.index.componentOf(K(50, 20, 50))).toBe(1);
    expect(Array.from(w.index.components().keys())).toEqual([0, 1]);
    expect(() => w.index.componentOf(K(1, 1, 1))).toThrow();
  });
});

describe('wand cycle and suppressed pairs (09 §1.1, §1.3)', () => {
  it('WAND_CYCLE is 1,2,3,0', () => {
    expect(WAND_CYCLE).toEqual([1, 2, 3, 0]);
  });

  it('M8: methanol C–O, fluoromethane C–F, and a C–H block bond', () => {
    const w = new World();
    const c = put(w, 'C', 10, 10, 10);
    const o = put(w, 'O', 11, 10, 10);
    const co = P(c, o);
    expect(validateBondChange(w.index, co, { lockedZones: [] })).toEqual({ ok: true, order: 2, previous: 1 });
    w.setBondOrder(co, 2);
    expect(validateBondChange(w.index, co, { lockedZones: [] })).toEqual({ ok: true, order: 0, previous: 2 });

    const w2 = new World();
    const c2 = put(w2, 'C', 10, 10, 10);
    const f = put(w2, 'F', 11, 10, 10);
    const cf = P(c2, f);
    expect(validateBondChange(w2.index, cf, { lockedZones: [] })).toEqual({ ok: true, order: 0, previous: 1 });
    w2.suppressBond(cf);
    expect(validateBondChange(w2.index, cf, { lockedZones: [] })).toEqual({ ok: true, order: 1, previous: 0 });

    const w3 = new World();
    const c3 = put(w3, 'C', 10, 10, 10);
    const h = put(w3, 'H', 11, 10, 10);
    const r = validateBondChange(w3.index, P(c3, h), { lockedZones: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toEqual({ reason: 'h-block', cell: h });

    // not touching
    const nr = validateBondChange(w3.index, P(c3, K(12, 10, 10)), { lockedZones: [] });
    expect(nr.ok).toBe(false);
    if (!nr.ok) expect(nr.refusal.reason).toBe('not-adjacent');

    // a plain C–C bond goes 1 -> 2 -> 3 -> 0 -> 1
    const w4 = new World();
    const a = put(w4, 'C', 10, 10, 10);
    const b = put(w4, 'C', 11, 10, 10);
    const ab = P(a, b);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const s = validateBondChange(w4.index, ab, { lockedZones: [] });
      expect(s.ok).toBe(true);
      if (!s.ok) break;
      seen.push(s.order);
      if (s.order === 0) w4.suppressBond(ab);
      else if (s.previous === 0) w4.restoreBond(ab);
      else w4.setBondOrder(ab, s.order);
    }
    expect(seen).toEqual([2, 3, 0, 1]);
    expect(w4.index.bonds.get(ab)?.order).toBe(1);
  });

  it('M17: suppress / restore round trip on a 2x2 square', () => {
    const w = new World();
    const a = put(w, 'C', 10, 10, 10);
    const b = put(w, 'C', 10, 10, 11);
    const c = put(w, 'C', 11, 10, 11);
    const d = put(w, 'C', 11, 10, 10);
    expect(w.index.bonds.size).toBe(4);
    const key: PairKey = '10,10,10|11,10,10';
    w.suppressBond(key);
    expect(w.index.bonds.size).toBe(3);
    expect(Array.from(w.index.suppressed)).toEqual([key]);
    expect(w.index.isSuppressed(key)).toBe(true);
    expect(w.index.bondOrderSum(a)).toBe(1);
    expect(w.index.bondOrderSum(d)).toBe(1);
    expect(w.index.wandOrder(key)).toBe(0);
    expect(w.index.wandOrder(P(a, b))).toBe(1);
    expect(w.index.wandOrder(P(a, c))).toBeUndefined();
    expect(w.index.bondedNeighbours(a).map((x) => x.key)).toEqual([b]);
    expect(w.index.neighbours(a).map((x) => x.key).sort()).toEqual([b, d].sort());
    expect(w.index.suppressedOf(a)).toEqual([key]);
    expect(w.index.suppressedOf(d)).toEqual([key]);
    expect(w.index.suppressedOf(b)).toEqual([]);
    expect(w.index.components().size).toBe(1);
    expect(w.index.bondsOf(a).map((x) => x.key)).toEqual([P(a, b)]);
    expect(() => w.index.setBondOrder(key, 2)).toThrow();
    expect(() => w.index.suppressBond(key)).toThrow(/not a bond/);
    w.restoreBond(key);
    expect(w.index.bonds.size).toBe(4);
    expect(w.index.bonds.get(key)?.order).toBe(1);
    expect(w.index.suppressed.size).toBe(0);
    expect(() => w.index.restoreBond(key)).toThrow(/not suppressed/);
  });

  it('a suppressed pair between two chains keeps them as two components', () => {
    const w = new World();
    const a = put(w, 'C', 10, 10, 10);
    const b = put(w, 'C', 11, 10, 10);
    w.suppressBond(P(a, b));
    expect(w.index.components().size).toBe(2);
    expect(w.index.componentOf(a)).toBe(0);
    expect(w.index.componentOf(b)).toBe(1);
  });

  it('M18: removeAtom clears the suppressed pair and re-placing re-bonds', () => {
    const w = new World();
    const a = put(w, 'C', 10, 10, 10);
    put(w, 'C', 10, 10, 11);
    put(w, 'C', 11, 10, 11);
    const d = put(w, 'C', 11, 10, 10);
    const key = P(a, d);
    w.suppressBond(key);
    w.index.removeAtom(d);
    expect(w.index.suppressed.size).toBe(0);
    expect(w.index.suppressedOf(a)).toEqual([]);
    expect(w.index.atoms.size).toBe(3);
    w.index.addAtom({ key: d, el: 'C', x: 11, y: 10, z: 10, charge: 0 });
    expect(w.index.bonds.get(key)?.order).toBe(1);
    expect(w.index.suppressed.size).toBe(0);
  });

  it('M19: rebuildFromGrid keeps touching suppressed pairs and drops the rest', () => {
    const w = new World();
    const a = put(w, 'C', 10, 10, 10);
    put(w, 'C', 10, 10, 11);
    put(w, 'C', 11, 10, 11);
    const d = put(w, 'C', 11, 10, 10);
    const key = P(a, d);
    w.suppressBond(key);
    const stray = P(K(10, 10, 10), K(20, 10, 10));
    const hKey = put(w, 'H', 10, 11, 10);
    const hPair = P(a, hKey);
    const idx = createMoleculeIndex();
    idx.rebuildFromGrid(w.getBlock, new Map(), new Map(), new Set([key, stray, hPair]));
    expect(Array.from(idx.suppressed)).toEqual([key]);
    expect(idx.bonds.size).toBe(4); // 3 ring bonds + C–H
    expect(idx.bonds.has(hPair)).toBe(true);
    // without the 4th argument nothing is suppressed
    const idx2 = createMoleculeIndex();
    idx2.rebuildFromGrid(w.getBlock, new Map(), new Map());
    expect(idx2.suppressed.size).toBe(0);
    expect(idx2.bonds.size).toBe(5);
  });

  it('M20: a restore from 0 is refused when the endpoint valence is full; the pair stays suppressed', () => {
    const w = new World();
    const a = put(w, 'C', 10, 10, 10);
    const b = put(w, 'C', 11, 10, 10);
    const key = P(a, b);
    w.suppressBond(key);
    put(w, 'C', 9, 10, 10);
    put(w, 'C', 10, 11, 10);
    put(w, 'C', 10, 9, 10);
    put(w, 'C', 10, 10, 11);
    expect(w.index.bondOrderSum(a)).toBe(4);
    const r = validateBondChange(w.index, key, { lockedZones: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal).toEqual({ reason: 'valence', cell: a, el: 'C', have: 5, max: 4 });
      expect(r.message).toBe('Valence full: C can only have 4 bonds.');
    }
    expect(w.index.isSuppressed(key)).toBe(true);
  });

  it('placement next to a suppressed endpoint sees the freed valence', () => {
    const w = new World();
    const o = put(w, 'O', 10, 10, 10);
    const c = put(w, 'C', 11, 10, 10);
    put(w, 'C', 9, 10, 10);
    // O has two bonds: a third neighbour is refused
    expect(validatePlacement(w.index, 10, 11, 10, 'C', ctxFor(w)).ok).toBe(false);
    w.suppressBond(P(o, c));
    // now O has one bond: the placement is allowed and will bond
    const r = validatePlacement(w.index, 10, 11, 10, 'C', ctxFor(w));
    expect(r.ok).toBe(true);
  });
});
