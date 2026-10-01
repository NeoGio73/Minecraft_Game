import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSmiles } from '@/chem/smiles';
import { embedOnLattice } from '@/chem/embed';
import type { LatticeEmbedding } from '@/chem/embed';
import { bondBetween, withoutStereoTags, withEz, withTet, buildGraph } from '@/chem/graph';
import { cross, dot, manhattan, sub } from '@/util/vec3';
import { EMBED_NODE_BUDGET } from '@/chem/types';
import type { MoleculeGraph, Vec3 } from '@/chem/types';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;

/** Every bonded pair touches; every touching unbonded pair is listed in suppressedPairs; H cells touch only their parent. */
function checkLattice(g: MoleculeGraph, e: LatticeEmbedding): void {
  const n = g.atoms.length;
  expect(e.pos.length).toBe(n);
  const cells = new Set<string>();
  for (const p of e.pos) {
    expect(Number.isInteger(p[0]) && Number.isInteger(p[1]) && Number.isInteger(p[2])).toBe(true);
    cells.add(p.join(','));
  }
  expect(cells.size).toBe(n);
  const sup = new Set(e.suppressedPairs.map((p) => p.join(',')));
  for (const [a, b] of e.suppressedPairs) {
    expect(a).toBeLessThan(b);
    expect(bondBetween(g, a, b)).toBeUndefined();
    expect(manhattan(e.pos[a]!, e.pos[b]!)).toBe(1);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = manhattan(e.pos[i]!, e.pos[j]!);
      const k = bondBetween(g, i, j);
      if (k !== undefined) {
        if (g.bonds[k]!.diagonal) expect(d).toBe(2);
        else expect(d).toBe(1);
      } else if (d === 1) {
        expect(sup.has(`${i},${j}`)).toBe(true);
      }
    }
  }
  for (const [parent, hs] of e.hPos) {
    for (const h of hs) {
      expect(cells.has(h.join(','))).toBe(false);
      cells.add(h.join(','));
      expect(manhattan(h, e.pos[parent]!)).toBe(1);
      for (let i = 0; i < n; i++) if (i !== parent) expect(manhattan(h, e.pos[i]!)).not.toBe(1);
    }
  }
}

const isZeroVec = (v: Vec3) => v[0] === 0 && v[1] === 0 && v[2] === 0;

function tetVolume(g: MoleculeGraph, e: LatticeEmbedding, atom: number): number {
  const tet = g.atoms[atom]!.tet!;
  const tips = tet.order.map((o): Vec3 => (o === 'H' ? e.hPos.get(atom)![0]! : e.pos[o]!));
  const [p0, p1, p2, p3] = tips as [Vec3, Vec3, Vec3, Vec3];
  return dot(cross(sub(p1, p0), sub(p2, p0)), sub(p3, p0));
}

function ezSameSide(g: MoleculeGraph, e: LatticeEmbedding, bondIndex: number): boolean {
  const b = g.bonds[bondIndex]!;
  const va = sub(e.pos[b.ez!.refA as number]!, e.pos[b.a]!);
  const vb = sub(e.pos[b.ez!.refB as number]!, e.pos[b.b]!);
  const u = sub(e.pos[b.b]!, e.pos[b.a]!);
  expect(dot(va, u)).toBe(0);
  expect(dot(vb, u)).toBe(0);
  expect(isZeroVec(cross(va, vb))).toBe(true);
  return dot(va, vb) > 0;
}

describe('embedOnLattice', () => {
  it('E2 odd rings cannot embed without diagonals', () => {
    for (const s of ['C1CC1', 'CC1CC1', 'C1CCCC1', 'CN1CCC[C@H]1c1cccnc1']) {
      expect(embedOnLattice(parse(s)), s).toBeNull();
      expect(embedOnLattice(parse(s), { allowDiagonal: false }), s).toBeNull();
    }
  });
  it('E3 E-but-2-ene is induced; Z-but-2-ene needs one suppressed pair (Amendment 1)', () => {
    const e = parse('C/C=C/C');
    const ee = embedOnLattice(e)!;
    expect(ee).not.toBeNull();
    checkLattice(e, ee);
    expect(ee.suppressedPairs).toEqual([]);
    expect(ezSameSide(e, ee, 1)).toBe(false);

    const z = parse('C/C=C\\C');
    const ez = embedOnLattice(z)!;
    expect(ez).not.toBeNull();
    checkLattice(z, ez);
    expect(ez.suppressedPairs).toEqual([[0, 3]]);
    expect(ezSameSide(z, ez, 1)).toBe(true);
    expect(embedOnLattice(z, { allowSuppressedPairs: false })).toBeNull();
    expect(embedOnLattice(withoutStereoTags(z), { allowSuppressedPairs: false })).not.toBeNull();
  });
  it('trisubstituted and tetrasubstituted alkenes embed planar with their cis pairs suppressed', () => {
    const cases: [string, number][] = [
      // trisubstituted: the lone substituent is cis to exactly one of the two opposite ones (1 pair);
      // tetrasubstituted: two cis pairs; 1,2-disubstituted Z: one pair
      ['C/C=C(\\Cl)C', 1], ['C/C=C(/Cl)C', 1], ['CC/C=C(/C)CC', 1], ['C/C(F)=C(\\Cl)C', 2],
      ['CCC/C=C\\CCC', 1], ['Cl/C=C\\Cl', 1], ['CC/C=C(/Br)Br', 1],
    ];
    for (const [s, count] of cases) {
      const g = parse(s);
      const e = embedOnLattice(g)!;
      expect(e, s).not.toBeNull();
      checkLattice(g, e);
      expect(e.suppressedPairs.length, s).toBe(count);
      const k = g.bonds.findIndex((b) => b.ez !== undefined);
      expect(ezSameSide(g, e, k), s).toBe(g.bonds[k]!.ez!.cis);
      // every substituent of both alkene carbons is perpendicular to the axis and coplanar
      const b = g.bonds[k]!;
      const u = sub(e.pos[b.b]!, e.pos[b.a]!);
      const vecs: Vec3[] = [];
      for (const [c, partner] of [[b.a, b.b], [b.b, b.a]] as const) {
        for (const kk of g.adj[c]!) {
          const other = g.bonds[kk]!.a === c ? g.bonds[kk]!.b : g.bonds[kk]!.a;
          if (other === partner) continue;
          const v = sub(e.pos[other]!, e.pos[c]!);
          expect(dot(v, u), s).toBe(0);
          vecs.push(v);
        }
      }
      for (const v of vecs) for (const w of vecs) expect(isZeroVec(cross(v, w)), s).toBe(true);
    }
  });
  it('an ez ref of H is rewritten to the other substituent', () => {
    let g = parse('CC=CC');
    const k = bondBetween(g, 1, 2)!;
    g = withEz(g, k, { refA: 'H', refB: 3, cis: false }); // H on C1 trans to C3 => methyls cis
    const e = embedOnLattice(g)!;
    expect(e).not.toBeNull();
    checkLattice(g, e);
    expect(e.suppressedPairs).toEqual([[0, 3]]);
    expect(e.hPos.size).toBe(0);
    // =CH2 end has no geometry: tag ignored, induced embedding
    let g2 = parse('CC=C');
    g2 = withEz(g2, bondBetween(g2, 1, 2)!, { refA: 0, refB: 'H', cis: true });
    const e2 = embedOnLattice(g2)!;
    expect(e2).not.toBeNull();
    expect(e2.suppressedPairs).toEqual([]);
  });
  it('E4 E5 tetrahedral tags: (R)- and (S)-butan-2-ol', () => {
    const r = parse('C[C@@H](O)CC');
    const er = embedOnLattice(r)!;
    expect(er).not.toBeNull();
    checkLattice(r, er);
    expect([...er.hPos.keys()]).toEqual([1]);
    expect(er.hPos.get(1)!.length).toBe(1);
    expect(tetVolume(r, er, 1)).toBeGreaterThan(0);
    expect(er.suppressedPairs).toEqual([]);
    const s = parse('C[C@H](O)CC');
    const es = embedOnLattice(s)!;
    expect(es).not.toBeNull();
    checkLattice(s, es);
    expect(tetVolume(s, es, 1)).toBeLessThan(0);
    // a centre with four heavy neighbours needs no H node
    const q = parse('C[C@](O)(F)CC');
    const eq = embedOnLattice(q)!;
    expect(eq).not.toBeNull();
    expect(eq.hPos.size).toBe(0);
    expect(tetVolume(q, eq, 1) * q.atoms[1]!.tet!.sign).toBeGreaterThan(0);
  });
  it('E6 meso-2,3-dibromobutane satisfies both centres', () => {
    const g = parse('C[C@H](Br)[C@@H](Br)C');
    const e = embedOnLattice(g)!;
    expect(e).not.toBeNull();
    checkLattice(g, e);
    expect(e.hPos.size).toBe(2);
    expect(Math.sign(tetVolume(g, e, 1))).toBe(g.atoms[1]!.tet!.sign);
    expect(Math.sign(tetVolume(g, e, 3))).toBe(g.atoms[3]!.tet!.sign);
  });
  it('ring stereo: trans-1,2-dibromocyclohexane and cis-1,2-dimethylcyclohexane', () => {
    for (const s of ['Br[C@H]1CCCC[C@@H]1Br', 'C[C@H]1CCCC[C@@H]1C', 'C[C@H]1CCCC[C@H]1C']) {
      const g = parse(s);
      const e = embedOnLattice(g)!;
      expect(e, s).not.toBeNull();
      checkLattice(g, e);
      for (const a of g.atoms) if (a.tet) expect(Math.sign(tetVolume(g, e, a.id)), s).toBe(a.tet.sign);
    }
  });
  it('E7 node budget', () => {
    expect(embedOnLattice(parse('CCO'), { nodeBudget: 1 })).toBeNull();
    const e = embedOnLattice(parse('CCO'))!;
    expect(e.nodesVisited).toBeGreaterThan(1);
    expect(e.nodesVisited).toBeLessThan(EMBED_NODE_BUDGET);
  });
  it('E8 components are laid out 4 empty cells apart along +x', () => {
    const g = parse('C.CC');
    const e = embedOnLattice(g)!;
    expect(e).not.toBeNull();
    checkLattice(g, e);
    const maxFirst = e.pos[0]![0];
    expect(e.pos[1]![0]).toBeGreaterThanOrEqual(maxFirst + 5);
    expect(e.pos[2]![0]).toBeGreaterThanOrEqual(maxFirst + 5);
    expect(Math.min(e.pos[1]![0], e.pos[2]![0])).toBe(maxFirst + 5);
    const three = parse('O=C.C=O.CC(=O)C');
    const e3 = embedOnLattice(three)!;
    expect(e3).not.toBeNull();
    checkLattice(three, e3);
  });
  it('E9 origin translates every position', () => {
    const g = parse('C[C@@H](O)CC');
    const a = embedOnLattice(g)!;
    const b = embedOnLattice(g, { origin: [52, 9, 64] })!;
    expect(b.pos).toEqual(a.pos.map((p) => [p[0] + 52, p[1] + 9, p[2] + 64]));
    expect(b.hPos.get(1)).toEqual(a.hPos.get(1)!.map((p) => [p[0] + 52, p[1] + 9, p[2] + 64]));
    expect(a.pos[1]).toEqual([0, 0, 0]);
  });
  it('E10 E11 quaternary carbons', () => {
    for (const s of ['CC(C)(C)C', 'CC(C)(C)C(C)(C)C', 'CC(C)CC(C)(C)C', 'CCC(CC)C(C)C']) {
      const g = parse(s);
      const e = embedOnLattice(g)!;
      expect(e, s).not.toBeNull();
      checkLattice(g, e);
      expect(e.suppressedPairs, s).toEqual([]);
    }
  });
  it('rings embed on the cube chair; the chair plus an inner-vertex carbon is a cage', () => {
    for (const s of ['C1CCCCC1', 'C1CCC=CC1', 'c1ccccc1', 'CC1=CCCCC1', 'C12C3CC1CC2C3', 'C1CCC2CCCCC2C1']) {
      const g = parse(s);
      const e = embedOnLattice(g)!;
      expect(e, s).not.toBeNull();
      checkLattice(g, e);
      expect(e.suppressedPairs, s).toEqual([]);
    }
  });
  it('diagonal bonds embed only with allowDiagonal', () => {
    const atoms = [0, 1, 2].map((id) => ({ id, el: 'C' as const, charge: 0 as const, explicitH: null, aromatic: false }));
    const g = buildGraph(atoms, [{ a: 0, b: 1, order: 1 }, { a: 1, b: 2, order: 1 }, { a: 0, b: 2, order: 1, diagonal: true }]);
    expect(embedOnLattice(g)).toBeNull();
    const e = embedOnLattice(g, { allowDiagonal: true })!;
    expect(e).not.toBeNull();
    checkLattice(g, e);
    expect(e.suppressedPairs).toEqual([]);
  });
  it('a strict (induced) request for a planar-forced cis pair returns null immediately', () => {
    let g = parse('CCCC');
    g = withTet(g, 1, { order: [0, 'H', 2, 'H'], sign: 1 });
    void g;
    expect(embedOnLattice(parse('Cl/C=C\\Cl'), { allowSuppressedPairs: false })).toBeNull();
  });
  it('empty graph', () => {
    const e = embedOnLattice({ atoms: [], bonds: [], adj: [] })!;
    expect(e.pos).toEqual([]);
    expect(e.suppressedPairs).toEqual([]);
    expect(e.nodesVisited).toBe(0);
  });
  it('E1 every reference-library entry embeds unless it has an odd ring; only Z alkenes need suppressed pairs', () => {
    const csv = readFileSync(new URL('../../tools/reference/lib.csv', import.meta.url), 'utf8');
    const rows = csv.split('\n').filter((l) => l.trim()).map((l) => l.split(','));
    let maxNodes = 0;
    for (const row of rows) {
      const smiles = row[2]!.replace(/\\\\/g, '\\');
      const g = parse(smiles);
      const e = embedOnLattice(g);
      const oddRing = ['C1CC1', 'C1CCOC1', 'C1CO1', 'CN1CCC[C@H]1c1cccnc1', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C'].includes(smiles);
      if (oddRing) {
        expect(e, smiles).toBeNull();
        continue;
      }
      expect(e, smiles).not.toBeNull();
      checkLattice(g, e!);
      maxNodes = Math.max(maxNodes, e!.nodesVisited);
      const zAlkene = smiles === 'C/C=C\\C';
      expect(e!.suppressedPairs.length, smiles).toBe(zAlkene ? 1 : 0);
      for (const a of g.atoms) if (a.tet) expect(Math.sign(tetVolume(g, e!, a.id)), smiles).toBe(a.tet.sign);
      for (let k = 0; k < g.bonds.length; k++) if (g.bonds[k]!.ez) expect(ezSameSide(g, e!, k), smiles).toBe(g.bonds[k]!.ez!.cis);
    }
    expect(maxNodes).toBeLessThan(10_000);
    const json = new URL('../../src/content/molecules.json', import.meta.url);
    if (existsSync(json)) {
      type Entry = { id: string; smiles: string; requiresDiagonalBonds?: boolean };
      const parsed = JSON.parse(readFileSync(json, 'utf8')) as Entry[] | { entries: Entry[] };
      const entries = Array.isArray(parsed) ? parsed : parsed.entries;
      for (const entry of entries) {
        if (entry.requiresDiagonalBonds) continue;
        const g = parse(entry.smiles);
        const e = embedOnLattice(g);
        expect(e, entry.id).not.toBeNull();
        checkLattice(g, e!);
        expect(e!.nodesVisited, entry.id).toBeLessThan(10_000);
        for (const a of g.atoms) if (a.tet) expect(Math.sign(tetVolume(g, e!, a.id)), entry.id).toBe(a.tet.sign);
      }
    }
  });
});
