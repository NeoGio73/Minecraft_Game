import { describe, it, expect } from 'vitest';
import { Block, cellKey, pairKey, type BlockElement, type CellKey } from '@/world/types';
import { World } from '@/world/world';
import { createMoleculeIndex, createMoleculeIndexWithHooks } from '@/world/molecule-index';
import {
  extractAll, extractComponent, extractComponentDetailed, extractMolecules, implicitHCell, suppressedPairsOfComponent,
} from '@/world/extract';
import { implicitHydrogens } from '@/chem/hydrogens';
import { hasPositions } from '@/chem/types';

function atomId(el: BlockElement): number {
  return ({ C: Block.AtomC, N: Block.AtomN, O: Block.AtomO, S: Block.AtomS, F: Block.AtomF, Cl: Block.AtomCl, Br: Block.AtomBr, I: Block.AtomI, H: Block.AtomH } as const)[el];
}
function put(world: World, el: BlockElement, x: number, y: number, z: number): CellKey {
  world.setBlock(x, y, z, atomId(el));
  return cellKey(x, y, z);
}
const K = cellKey;

describe('extraction (02 §12.3)', () => {
  it('M12: methanol with an explicit H block collapses the H into hPos', () => {
    const w = new World();
    put(w, 'C', 10, 10, 10);
    put(w, 'O', 11, 10, 10);
    put(w, 'H', 10, 11, 10);
    const ex = extractAll(w.index);
    expect(ex.components.length).toBe(1);
    expect(ex.orphanHydrogens).toEqual([]);
    const c = ex.components[0]!;
    expect(c.id).toBe(0);
    const g = c.graph;
    expect(hasPositions(g)).toBe(true);
    expect(g.atoms.length).toBe(2);
    expect(g.atoms[0]).toMatchObject({ id: 0, el: 'C', charge: 0, explicitH: null, aromatic: false, pos: [10, 10, 10], hPos: [[10, 11, 10]] });
    expect(g.atoms[1]).toMatchObject({ id: 1, el: 'O', pos: [11, 10, 10], hPos: [] });
    expect(g.bonds).toEqual([{ a: 0, b: 1, order: 1, aromatic: false }]);
    expect(g.adj).toEqual([[0], [0]]);
    expect(c.cells).toEqual([K(10, 10, 10), K(11, 10, 10)]);
    expect(c.hCells).toEqual([[K(10, 11, 10)], []]);
    expect(c.warnings).toEqual([]);
    expect(c.zone).toBe('world');
    expect(implicitHydrogens(g).hydrogens).toEqual([3, 1]);
    expect(extractMolecules(w.index)[0]).toEqual(g);
    expect(extractComponent(w.index, 0)).toEqual(g);
  });

  it('M13: zone filter and component ordering', () => {
    const w = new World();
    put(w, 'C', 60, 10, 60); // pad
    put(w, 'C', 61, 10, 60);
    put(w, 'N', 10, 10, 10); // world, lower cellIndex
    put(w, 'C', 11, 10, 10);
    const all = extractAll(w.index);
    expect(all.components.map((c) => c.id)).toEqual([0, 1]);
    expect(all.components[0]!.graph.atoms[0]!.el).toBe('N');
    expect(all.components[0]!.zone).toBe('world');
    expect(all.components[1]!.zone).toBe('pad');
    const pad = extractAll(w.index, 'pad');
    expect(pad.components.length).toBe(1);
    expect(pad.components[0]!.id).toBe(1);
    expect(extractMolecules(w.index, 'reactant')).toEqual([]);
    // a molecule straddling the pad edge is 'world'
    const w2 = new World();
    put(w2, 'C', 51, 10, 60);
    put(w2, 'C', 52, 10, 60);
    expect(extractAll(w2.index).components[0]!.zone).toBe('world');
  });

  it('bond order and charge reach the graph; atom ids ascend with cellIndex', () => {
    const w = new World();
    const c1 = put(w, 'C', 10, 11, 10); // higher cellIndex than (11,10,10)
    const c2 = put(w, 'C', 10, 10, 10);
    const o = put(w, 'O', 11, 10, 10);
    w.setBondOrder(pairKey(c2, o), 2);
    w.setCharge(c1, -1);
    const g = extractComponent(w.index, 0);
    expect(g.atoms.map((a) => a.pos)).toEqual([[10, 10, 10], [11, 10, 10], [10, 11, 10]]);
    expect(g.atoms[2]!.charge).toBe(-1);
    expect(g.bonds).toEqual([{ a: 0, b: 1, order: 2, aromatic: false }, { a: 0, b: 2, order: 1, aromatic: false }]);
  });

  it('M14: an H block bonded to two heavy atoms attaches to the lower cellIndex parent with a warning', () => {
    const w = new World();
    w.setBlock(10, 10, 10, Block.AtomC);
    w.setBlock(12, 10, 10, Block.AtomC);
    w.setBlock(11, 10, 10, Block.AtomH); // bypasses validation
    const idx = createMoleculeIndex();
    idx.rebuildFromGrid(w.getBlock, new Map(), new Map());
    const ex = extractAll(idx);
    expect(ex.components.length).toBe(1);
    const c = ex.components[0]!;
    expect(c.graph.atoms.length).toBe(2);
    expect(c.graph.atoms[0]!.hPos).toEqual([[11, 10, 10]]);
    expect(c.graph.atoms[1]!.hPos).toEqual([]);
    expect(c.graph.bonds).toEqual([]);
    expect(c.warnings).toEqual([{ kind: 'h-block-valence', atom: 0, bonds: 2 }]);
  });

  it('M15: an isolated H block is an orphan and no component', () => {
    const w = new World();
    w.setBlock(10, 10, 10, Block.AtomH);
    const idx = createMoleculeIndex();
    idx.rebuildFromGrid(w.getBlock, new Map(), new Map());
    const ex = extractAll(idx);
    expect(ex.components).toEqual([]);
    expect(ex.orphanHydrogens).toEqual([K(10, 10, 10)]);
    expect(() => extractComponent(idx, 0)).toThrow();
    expect(() => extractComponent(idx, 5)).toThrow();
  });

  it('M16: a diagonal index bond is extracted with diagonal: true; face bonds carry no key', () => {
    const idx = createMoleculeIndexWithHooks();
    idx.addAtom({ key: K(10, 10, 10), el: 'C', x: 10, y: 10, z: 10, charge: 0 });
    idx.addAtom({ key: K(11, 10, 10), el: 'C', x: 11, y: 10, z: 10, charge: 0 });
    idx.addAtom({ key: K(11, 11, 11), el: 'C', x: 11, y: 11, z: 11, charge: 0 });
    idx.addBond(K(11, 10, 10), K(11, 11, 11), 1, true);
    const g = extractComponent(idx, 0);
    expect(g.bonds.length).toBe(2);
    expect(g.bonds[0]).toEqual({ a: 0, b: 1, order: 1, aromatic: false });
    expect('diagonal' in g.bonds[0]!).toBe(false);
    expect(g.bonds[1]).toEqual({ a: 1, b: 2, order: 1, aromatic: false, diagonal: true });
  });

  it('charge-unsupported warning when the stored charge has no target valence', () => {
    const idx = createMoleculeIndex();
    idx.addAtom({ key: K(10, 10, 10), el: 'Cl', x: 10, y: 10, z: 10, charge: 1 });
    const c = extractComponentDetailed(idx, 0);
    expect(c.warnings).toEqual([{ kind: 'charge-unsupported', atom: 0, charge: 1 }]);
    expect(c.graph.atoms[0]!.charge).toBe(1);
  });
});

describe('suppressed pairs and extraction (09 §1.7)', () => {
  function square(): { w: World; cells: CellKey[] } {
    const w = new World();
    const cells = [put(w, 'C', 60, 10, 60), put(w, 'C', 60, 10, 61), put(w, 'C', 61, 10, 61), put(w, 'C', 61, 10, 60)];
    return { w, cells };
  }

  it('Z-but-2-ene square without the suppression is a 4-ring (C4H8 as cyclobutane)', () => {
    const { w } = square();
    const g = extractComponent(w.index, 0);
    expect(g.bonds.length).toBe(4);
    expect(g.bonds.length - g.atoms.length + 1).toBe(1);
    expect(implicitHydrogens(g).hydrogens).toEqual([2, 2, 2, 2]);
    expect(suppressedPairsOfComponent(w.index, 0)).toEqual([]);
  });

  it('with the C1–C4 pair suppressed and C2=C3 double it extracts as an open chain', () => {
    const { w } = square();
    const pair = pairKey(K(60, 10, 60), K(61, 10, 60));
    w.suppressBond(pair);
    w.setBondOrder(pairKey(K(60, 10, 61), K(61, 10, 61)), 2);
    const g = extractComponent(w.index, 0);
    expect(g.atoms.length).toBe(4);
    expect(g.bonds.length).toBe(3);
    expect(g.bonds.length - g.atoms.length + 1).toBe(0);
    // atom ids by cellIndex: (60,10,60)=0, (61,10,60)=1, (60,10,61)=2, (61,10,61)=3
    expect(g.bonds).toEqual([
      { a: 0, b: 2, order: 1, aromatic: false },
      { a: 1, b: 3, order: 1, aromatic: false },
      { a: 2, b: 3, order: 2, aromatic: false },
    ]);
    const hs = implicitHydrogens(g).hydrogens;
    expect(hs.reduce((s, h) => s + h, 0)).toBe(8);
    expect(suppressedPairsOfComponent(w.index, 0)).toEqual([pair]);
    expect(extractAll(w.index, 'pad').components.length).toBe(1);
  });

  it('suppressedPairsOfComponent lists pairs reaching into another component, sorted', () => {
    const w = new World();
    const a = put(w, 'C', 10, 10, 10);
    const b = put(w, 'C', 11, 10, 10);
    const c = put(w, 'C', 10, 10, 11);
    w.suppressBond(pairKey(a, b));
    w.suppressBond(pairKey(a, c));
    expect(w.index.components().size).toBe(3);
    const pairs = suppressedPairsOfComponent(w.index, 0);
    expect(pairs).toEqual([pairKey(a, b), pairKey(a, c)].sort());
    expect(suppressedPairsOfComponent(w.index, 1)).toEqual([pairKey(a, b)]);
    expect(suppressedPairsOfComponent(w.index, 2)).toEqual([pairKey(a, c)]);
    expect(suppressedPairsOfComponent(w.index, 7)).toEqual([]);
  });
});

describe('implicitHCell (06 §1)', () => {
  it('lists the free faces in H_FILL_ORDER', () => {
    const w = new World();
    put(w, 'C', 10, 10, 10);
    const expected = [[10, 11, 10], [10, 9, 10], [10, 10, 11], [10, 10, 9], [11, 10, 10], [9, 10, 10]];
    for (let k = 0; k < 6; k++) expect(implicitHCell(w.getBlock, 10, 10, 10, k)).toEqual(expected[k]);
    expect(implicitHCell(w.getBlock, 10, 10, 10, 6)).toBeNull();
    expect(implicitHCell(w.getBlock, 10, 10, 10, -1)).toBeNull();
  });
  it('skips terrain and atom cells', () => {
    const w = new World();
    put(w, 'C', 10, 10, 10);
    w.setBlock(10, 9, 10, Block.LabTile);
    expect(implicitHCell(w.getBlock, 10, 10, 10, 1)).toEqual([10, 10, 11]);
    const w2 = new World();
    put(w2, 'C', 10, 10, 10);
    put(w2, 'C', 10, 11, 10);
    put(w2, 'H', 10, 9, 10);
    expect(implicitHCell(w2.getBlock, 10, 10, 10, 0)).toEqual([10, 10, 11]);
  });
});
