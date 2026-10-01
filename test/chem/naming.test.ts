import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { buildGraph, withoutStereoTags } from '@/chem/graph';
import { perceiveAromaticity } from '@/chem/aromatic';
import { wlHash } from '@/chem/wlhash';
import { isIsomorphic } from '@/chem/isomorphism';
import { embedOnLattice } from '@/chem/embed';
import type { LatticeEmbedding } from '@/chem/embed';
import { assignRS } from '@/chem/stereo';
import {
  baseNameOf, buildNameIndex, nameOf, registerNameIndex, registeredNameIndex,
} from '@/chem/naming';
import type { NameIndex, NameSource } from '@/chem/naming';
import { SmilesError } from '@/chem/types';
import type { ChemApi, MoleculeGraph, Vec3, WorldAtom, WorldGraph } from '@/chem/types';
import { cellKey, pairKey } from '@/world/types';
import type { PairKey } from '@/world/types';
import { manhattan } from '@/util/vec3';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;

// ---------------------------------------------------------------------------
// Inline library (ids, names and SMILES as in 05-content.md §5.2; the real
// molecules.json is WP-05's and may not exist yet)
// ---------------------------------------------------------------------------

const LIB: readonly NameSource[] = [
  { id: 'methane', name: 'methane', smiles: 'C' },
  { id: 'ethane', name: 'ethane', smiles: 'CC' },
  { id: 'propane', name: 'propane', smiles: 'CCC' },
  { id: 'butane', name: 'butane', smiles: 'CCCC' },
  { id: '2-methylpropane', name: '2-methylpropane', smiles: 'CC(C)C' },
  { id: 'methanol', name: 'methanol', smiles: 'CO' },
  { id: 'ethanol', name: 'ethanol', smiles: 'CCO' },
  { id: 'ethoxide', name: 'ethoxide', smiles: 'CC[O-]' },
  { id: 'acetic-acid', name: 'acetic acid', smiles: 'CC(=O)O' },
  { id: 'acetate', name: 'acetate', smiles: 'CC(=O)[O-]' },
  { id: 'benzene', name: 'benzene', smiles: 'C1=CC=CC=C1' },
  { id: 'toluene', name: 'toluene', smiles: 'CC1=CC=CC=C1' },
  { id: '1-2-dimethylbenzene', name: '1,2-dimethylbenzene', smiles: 'CC1=CC=CC=C1C' },
  { id: '1-3-dimethylbenzene', name: '1,3-dimethylbenzene', smiles: 'CC1=CC(C)=CC=C1' },
  { id: 'aspirin', name: 'aspirin', smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O' },
  { id: 'e-but-2-ene', name: '(E)-but-2-ene', smiles: 'C/C=C/C' },
  { id: 'z-but-2-ene', name: '(Z)-but-2-ene', smiles: 'C/C=C\\C' },
  { id: 'z-2-chlorobut-2-ene', name: '(Z)-2-chlorobut-2-ene', smiles: 'C/C=C(\\Cl)C' },
  { id: 'e-2-chlorobut-2-ene', name: '(E)-2-chlorobut-2-ene', smiles: 'C/C=C(/Cl)C' },
  { id: '2e-4e-hexa-2-4-diene', name: '(2E,4E)-hexa-2,4-diene', smiles: 'C/C=C/C=C/C' },
  { id: 'butan-2-ol', name: 'butan-2-ol', smiles: 'CCC(C)O' },
  { id: 'r-butan-2-ol', name: '(R)-butan-2-ol', smiles: 'C[C@@H](O)CC' },
  { id: 's-butan-2-ol', name: '(S)-butan-2-ol', smiles: 'C[C@H](O)CC' },
  { id: '2-bromobutane', name: '2-bromobutane', smiles: 'CCC(C)Br' },
  { id: 'r-2-bromobutane', name: '(R)-2-bromobutane', smiles: 'C[C@@H](Br)CC' },
  { id: 's-2-bromobutane', name: '(S)-2-bromobutane', smiles: 'C[C@H](Br)CC' },
  { id: 'meso-2-3-dibromobutane', name: 'meso-2,3-dibromobutane', smiles: 'C[C@H](Br)[C@H](Br)C' },
  { id: '2r-3r-dibromobutane', name: '(2R,3R)-2,3-dibromobutane', smiles: 'C[C@@H](Br)[C@H](Br)C' },
  { id: '2s-3s-dibromobutane', name: '(2S,3S)-2,3-dibromobutane', smiles: 'C[C@H](Br)[C@@H](Br)C' },
  { id: 'cis-1-2-dimethylcyclohexane', name: 'cis-1,2-dimethylcyclohexane', smiles: 'C[C@H]1CCCC[C@H]1C' },
  { id: 'trans-1r-2r-dimethylcyclohexane', name: '(1R,2R)-1,2-dimethylcyclohexane', smiles: 'C[C@@H]1CCCC[C@H]1C' },
  { id: 'trans-1s-2s-dimethylcyclohexane', name: '(1S,2S)-1,2-dimethylcyclohexane', smiles: 'C[C@H]1CCCC[C@@H]1C' },
];

/** Index over LIB without the (S) alcohol, so a mirror build has no stereo match (N8). */
const LIB_NO_S = LIB.filter((e) => e.id !== 's-butan-2-ol');

const INDEX = buildNameIndex(LIB);
const INDEX_NO_S = buildNameIndex(LIB_NO_S);

// ---------------------------------------------------------------------------
// External libraries: the RDKit reference list and, when WP-05 has added it,
// the shipped molecules.json
// ---------------------------------------------------------------------------

const LIB_CSV = new URL('../../tools/reference/lib.csv', import.meta.url);
const MOLECULES_JSON = new URL('../../src/content/molecules.json', import.meta.url);

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function csvLibrary(): NameSource[] {
  const rows = readFileSync(LIB_CSV, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => l.split(','));
  return rows.map((row) => ({
    id: slug(row[0]!),
    name: row[0]!.replace(/;/g, ','),
    smiles: row[2]!.replace(/\\\\/g, '\\'),
  }));
}

function jsonLibrary(): NameSource[] | null {
  if (!existsSync(MOLECULES_JSON)) return null;
  const raw = JSON.parse(readFileSync(MOLECULES_JSON, 'utf8')) as { entries?: NameSource[] } | NameSource[];
  const entries = Array.isArray(raw) ? raw : raw.entries ?? [];
  return entries.map((e) => ({ id: e.id, name: e.name, smiles: e.smiles }));
}

const LIBRARIES: { label: string; entries: readonly NameSource[] }[] = [
  { label: 'inline', entries: LIB },
  { label: 'tools/reference/lib.csv', entries: csvLibrary() },
];
{
  const json = jsonLibrary();
  if (json) LIBRARIES.push({ label: 'src/content/molecules.json', entries: json });
}

const hasStereoTags = (g: MoleculeGraph): boolean => g.atoms.some((a) => a.tet !== undefined) || g.bonds.some((b) => b.ez !== undefined);

// ---------------------------------------------------------------------------
// World-graph helpers (a restatement of test/helpers/lattice.ts, 03 §6.4)
// ---------------------------------------------------------------------------

/** World graph from a SMILES constitution (tags stripped, explicitH null) plus lattice cells. */
function grid(smiles: string, pos: readonly Vec3[], hPos: Readonly<Record<number, readonly Vec3[]>> = {}): WorldGraph {
  const g = withoutStereoTags(parse(smiles));
  if (pos.length !== g.atoms.length) throw new Error(`grid: ${smiles} has ${g.atoms.length} atoms, ${pos.length} positions given`);
  const atoms: WorldAtom[] = g.atoms.map((a, i) => ({
    id: a.id, el: a.el, charge: a.charge, explicitH: null, aromatic: a.aromatic, pos: pos[i]!, hPos: hPos[i] ?? [],
  }));
  return buildGraph(atoms, g.bonds);
}

/** World graph from an embedding of a (possibly tagged) SMILES graph: tags stripped, H nodes kept as hPos. */
function worldFromEmbedding(g: MoleculeGraph, e: LatticeEmbedding): WorldGraph {
  const atoms: WorldAtom[] = withoutStereoTags(g).atoms.map((a, i) => ({
    id: a.id, el: a.el, charge: a.charge, explicitH: null, aromatic: a.aromatic, pos: e.pos[i]!, hPos: e.hPos.get(i) ?? [],
  }));
  return buildGraph(atoms, withoutStereoTags(g).bonds);
}

/** Reflection through the yz plane: every tetrahedral parity flips, E/Z is kept. */
function mirrorX(g: WorldGraph): WorldGraph {
  const flip = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
  const atoms: WorldAtom[] = g.atoms.map((a) => ({ ...a, pos: flip(a.pos), hPos: a.hPos.map(flip) }));
  return buildGraph(atoms, g.bonds);
}

const cellOf = (p: Vec3) => cellKey(p[0], p[1], p[2]);

function suppressedOf(g: WorldGraph, pairs: readonly (readonly [number, number])[]): Set<PairKey> {
  return new Set(pairs.map(([a, b]) => pairKey(cellOf(g.atoms[a]!.pos), cellOf(g.atoms[b]!.pos))));
}

/** Every fixture must be a legal build: touching <=> bonded, except for declared suppressed pairs. */
function assertBuildable(g: WorldGraph, suppressed: ReadonlySet<PairKey> = new Set()): void {
  const cells: { pos: Vec3; atom: number; h: boolean }[] = [];
  for (const a of g.atoms) {
    cells.push({ pos: a.pos, atom: a.id, h: false });
    for (const h of a.hPos) cells.push({ pos: h, atom: a.id, h: true });
  }
  const bonded = new Set<string>();
  for (const b of g.bonds) if (!b.diagonal) bonded.add(`${b.a},${b.b}`);
  const used = new Set<PairKey>();
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const p = cells[i]!;
      const q = cells[j]!;
      if (p.pos[0] === q.pos[0] && p.pos[1] === q.pos[1] && p.pos[2] === q.pos[2]) throw new Error(`fixture: cells ${p.pos} and ${q.pos} coincide`);
      const touching = manhattan(p.pos, q.pos) === 1;
      let isBonded: boolean;
      if (!p.h && !q.h) {
        isBonded = bonded.has(`${Math.min(p.atom, q.atom)},${Math.max(p.atom, q.atom)}`);
        if (touching && !isBonded) {
          const key = pairKey(cellOf(p.pos), cellOf(q.pos));
          if (suppressed.has(key)) { used.add(key); continue; }
        }
      } else if (p.h && q.h) {
        isBonded = false;
      } else {
        isBonded = p.atom === q.atom;
      }
      if (touching && !isBonded) throw new Error(`fixture not buildable: cells ${p.pos} and ${q.pos} are face-adjacent but unbonded`);
      if (!touching && isBonded) throw new Error(`fixture not buildable: cells ${p.pos} and ${q.pos} are bonded but not face-adjacent`);
    }
  }
  for (const key of suppressed) if (!used.has(key)) throw new Error(`fixture: suppressed pair ${key} is not a touching unbonded pair`);
}

// Verified layouts (05 §5.3 / 03 §2.5 / 03 §3.3)
const R_BUTANOL = grid('CC(O)CC', [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [2, 0, 0]]);
const S_BUTANOL = grid('CC(O)CC', [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [2, 0, 0]]);
const T_BUTANOL = grid('CC(O)CC', [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]]);
const E_BUTENE = grid('CC=CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]]);
const Z_BUTENE = grid('CC=CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]]);
const TWISTED_BUTENE = grid('CC=CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]]);
const Z_CHLOROBUTENE = grid('CC=C(Cl)C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, -1, 0]]);
const MESO_DIBROMO = grid('CC(Br)C(Br)C', [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, -1], [1, -1, 0]]);
const RR_DIBROMO = grid('CC(Br)C(Br)C', [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [1, -1, 0], [1, 0, 1]]);
const ACETATE = grid('CC(=O)[O-]', [[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 0, 0]]);

afterEach(() => registerNameIndex(null));

// ---------------------------------------------------------------------------

describe('naming.ts', () => {
  it('N1 baseNameOf strips one leading stereo descriptor', () => {
    expect(baseNameOf('(R)-butan-2-ol')).toBe('butan-2-ol');
    expect(baseNameOf('(2R,3S)-2,3-dibromobutane')).toBe('2,3-dibromobutane');
    expect(baseNameOf('cis-1,2-dimethylcyclohexane')).toBe('1,2-dimethylcyclohexane');
    expect(baseNameOf('(E)-but-2-ene')).toBe('but-2-ene');
    expect(baseNameOf('meso-tartaric acid')).toBe('tartaric acid');
    expect(baseNameOf('butane')).toBe('butane');
    // more descriptors from the library names
    expect(baseNameOf('(2E,4E)-hexa-2,4-diene')).toBe('hexa-2,4-diene');
    expect(baseNameOf('(1R,2R)-1,2-dimethylcyclohexane')).toBe('1,2-dimethylcyclohexane');
    expect(baseNameOf('trans-1,2-dimethylcyclohexane')).toBe('1,2-dimethylcyclohexane');
    expect(baseNameOf('(2S,3R)-2-amino-3-hydroxybutanoic acid')).toBe('2-amino-3-hydroxybutanoic acid');
    expect(baseNameOf('(+)-tartaric acid')).toBe('tartaric acid');
    expect(baseNameOf('(±)-butan-2-ol')).toBe('butan-2-ol');
    expect(baseNameOf('(-)-carvone')).toBe('carvone');
    expect(baseNameOf('rac-2-bromobutane')).toBe('2-bromobutane');
    expect(baseNameOf('(rac)-2-bromobutane')).toBe('2-bromobutane');
    expect(baseNameOf('(rel)-2-bromobutane')).toBe('2-bromobutane');
    expect(baseNameOf('erythro-3-bromobutan-2-ol')).toBe('3-bromobutan-2-ol');
    expect(baseNameOf('threo-3-bromobutan-2-ol')).toBe('3-bromobutan-2-ol');
    expect(baseNameOf('(meso)-2,3-dibromobutane')).toBe('2,3-dibromobutane');
    expect(baseNameOf('TRANS-but-2-ene')).toBe('but-2-ene');
    // only a hyphenated descriptor at the start is stripped
    expect(baseNameOf('cisplatin')).toBe('cisplatin');
    expect(baseNameOf('2-methyl-trans-but-2-ene')).toBe('2-methyl-trans-but-2-ene');
    expect(baseNameOf('meso-(2R,3S)-2,3-dibromobutane')).toBe('(2R,3S)-2,3-dibromobutane');
    expect(baseNameOf('')).toBe('');
  });

  it('buildNameIndex parses, perceives, hashes and buckets every entry in ascending id order', () => {
    expect(INDEX.size).toBe(LIB.length);
    let total = 0;
    for (const [hash, bucket] of INDEX.byHash) {
      total += bucket.length;
      for (const e of bucket) {
        expect(wlHash(e.graph, e.hydrogens).hash).toBe(hash);
        expect(e.hydrogens.length).toBe(e.graph.atoms.length);
        expect(e.baseName).toBe(baseNameOf(e.name));
        expect(e.hasStereo).toBe(hasStereoTags(e.graph));
      }
      const ids = bucket.map((e) => e.id);
      expect(ids).toEqual([...ids].sort());
    }
    expect(total).toBe(LIB.length);
    // the three butan-2-ol entries share one bucket; the two bromobutane stereo entries another
    const butanol = INDEX.byHash.get(wlHash(parse('CCC(C)O'), implicitHydrogens(parse('CCC(C)O')).hydrogens).hash)!;
    expect(butanol.map((e) => e.id)).toEqual(['butan-2-ol', 'r-butan-2-ol', 's-butan-2-ol']);
    expect(butanol.map((e) => e.hasStereo)).toEqual([false, true, true]);
    // input order does not matter
    const reversed = buildNameIndex([...LIB].reverse());
    const bucket2 = reversed.byHash.get(wlHash(parse('CCC(C)O'), implicitHydrogens(parse('CCC(C)O')).hydrogens).hash)!;
    expect(bucket2.map((e) => e.id)).toEqual(['butan-2-ol', 'r-butan-2-ol', 's-butan-2-ol']);
    // the stored graph is perceived: benzene atoms and ring bonds are aromatic
    const benzene = [...INDEX.byHash.values()].flat().find((e) => e.id === 'benzene')!;
    expect(benzene.graph.atoms.every((a) => a.aromatic)).toBe(true);
    expect(benzene.graph.bonds.every((b) => b.aromatic)).toBe(true);
    // tags are kept on stereo entries
    const r = [...INDEX.byHash.values()].flat().find((e) => e.id === 'r-butan-2-ol')!;
    expect(r.graph.atoms[1]!.tet).toBeDefined();
    const z = [...INDEX.byHash.values()].flat().find((e) => e.id === 'z-but-2-ene')!;
    expect(z.graph.bonds.some((b) => b.ez?.cis === true)).toBe(true);
    // the empty library
    const empty = buildNameIndex([]);
    expect(empty.size).toBe(0);
    expect(empty.byHash.size).toBe(0);
    expect(nameOf(parse('C'), empty)).toBeNull();
  });

  it('buildNameIndex propagates a SmilesError for a bad entry', () => {
    expect(() => buildNameIndex([{ id: 'bad', name: 'bad', smiles: 'C1CC' }])).toThrow(SmilesError);
    expect(() => buildNameIndex([{ id: 'bad', name: 'bad', smiles: 'c1cccc1' }])).toThrow(SmilesError);
  });

  for (const lib of LIBRARIES) {
    it(`N2 ${lib.label}: every non-stereo entry names itself`, () => {
      const index = buildNameIndex(lib.entries);
      expect(index.size).toBe(lib.entries.length);
      let checked = 0;
      for (const e of lib.entries) {
        const g = parse(e.smiles);
        if (hasStereoTags(g)) continue;
        expect(nameOf(g, index), e.id).toBe(e.name);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });

    it(`N3 ${lib.label}: a stereo entry without positions names the flat entry or the base name`, () => {
      const index = buildNameIndex(lib.entries);
      let checked = 0;
      for (const e of lib.entries) {
        const g = parse(e.smiles);
        if (!hasStereoTags(g)) continue;
        const gp = perceiveAromaticity(g);
        const h = wlHash(gp, implicitHydrogens(g).hydrogens).hash;
        const cands = (index.byHash.get(h) ?? []).filter((c) => isIsomorphic(c.graph, gp));
        expect(cands.length, e.id).toBeGreaterThan(0);
        const flat = cands.find((c) => !c.hasStereo);
        const expected = flat ? flat.name : cands[0]!.baseName;
        const got = nameOf(g, index);
        expect(got, e.id).toBe(expected);
        // never the stereo-defined name itself, since no positions were given
        if (!flat) expect(got, e.id).toBe(baseNameOf(cands[0]!.name));
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it('N3 inline cases: flat entry when present, else base name of the first candidate by id', () => {
    expect(nameOf(parse('C[C@@H](O)CC'), INDEX)).toBe('butan-2-ol');
    expect(nameOf(parse('C[C@H](O)CC'), INDEX)).toBe('butan-2-ol');
    expect(nameOf(parse('C[C@@H](O)CC'), INDEX_NO_S)).toBe('butan-2-ol');
    expect(nameOf(parse('C[C@@H](Br)CC'), INDEX)).toBe('2-bromobutane');
    // no flat but-2-ene entry: base name of (E)-but-2-ene
    expect(nameOf(parse('C/C=C\\C'), INDEX)).toBe('but-2-ene');
    expect(nameOf(parse('CC=CC'), INDEX)).toBe('but-2-ene');
    // ids sort 2r-3r < 2s-3s < meso: the base name of (2R,3R)-2,3-dibromobutane
    expect(nameOf(parse('C[C@H](Br)[C@H](Br)C'), INDEX)).toBe('2,3-dibromobutane');
    expect(nameOf(parse('CC(Br)C(Br)C'), INDEX)).toBe('2,3-dibromobutane');
    expect(nameOf(parse('CC1CCCCC1C'), INDEX)).toBe('1,2-dimethylcyclohexane');
    expect(nameOf(parse('C/C=C/C=C/C'), INDEX)).toBe('hexa-2,4-diene');
  });

  it('N4 Kekulé and aromatic SMILES forms name each other', () => {
    const lower = buildNameIndex([{ id: 'benzene', name: 'benzene', smiles: 'c1ccccc1' }, { id: 'toluene', name: 'toluene', smiles: 'Cc1ccccc1' }]);
    expect(nameOf(parse('C1=CC=CC=C1'), lower)).toBe('benzene');
    expect(nameOf(parse('CC1=CC=CC=C1'), lower)).toBe('toluene');
    expect(nameOf(parse('c1ccccc1'), INDEX)).toBe('benzene');
    expect(nameOf(parse('Cc1ccccc1'), INDEX)).toBe('toluene');
    expect(nameOf(parse('CC(=O)Oc1ccccc1C(=O)O'), INDEX)).toBe('aspirin');
    expect(nameOf(parse('OC(=O)c1ccccc1OC(C)=O'), INDEX)).toBe('aspirin');
    // 1,3-cyclohexadiene is not benzene (different H counts)
    expect(nameOf(parse('C1=CC=CCC1'), INDEX)).toBeNull();
  });

  it('N5 a rewritten Kekulé form of o-xylene finds o-xylene, not m-xylene', () => {
    expect(nameOf(parse('CC1C(C)=CC=CC=1'), INDEX)).toBe('1,2-dimethylbenzene');
    expect(nameOf(parse('Cc1ccccc1C'), INDEX)).toBe('1,2-dimethylbenzene');
    expect(nameOf(parse('CC1=CC=CC(C)=C1'), INDEX)).toBe('1,3-dimethylbenzene');
    expect(nameOf(parse('Cc1cccc(C)c1'), INDEX)).toBe('1,3-dimethylbenzene');
    expect(nameOf(parse('Cc1ccc(C)cc1'), INDEX)).toBeNull();
  });

  it('N6 unknown molecules, wrong charge and the empty graph give null', () => {
    expect(nameOf(parse('CCCCCCCCC'), INDEX)).toBeNull();
    expect(nameOf(parse('CCCCO'), INDEX)).toBeNull();
    expect(nameOf(parse('C[O-]'), INDEX)).toBeNull();
    expect(nameOf(parse('CC[O-]'), INDEX)).toBe('ethoxide');
    expect(nameOf(parse('CCO'), INDEX)).toBe('ethanol');
    expect(nameOf(parse('CC(=O)[O-]'), INDEX)).toBe('acetate');
    expect(nameOf(parse('CC(=O)O'), INDEX)).toBe('acetic acid');
    expect(nameOf({ atoms: [], bonds: [], adj: [] }, INDEX)).toBeNull();
    // two components are not an entry
    expect(nameOf(parse('C.C'), INDEX)).toBeNull();
  });

  it('N7 the registered index is the default; null means no name', () => {
    registerNameIndex(null);
    expect(registeredNameIndex()).toBeNull();
    expect(nameOf(parse('CCCC'))).toBeNull();
    registerNameIndex(INDEX);
    expect(registeredNameIndex()).toBe(INDEX);
    expect(nameOf(parse('CCCC'))).toBe('butane');
    expect(nameOf(parse('CC(C)C'))).toBe('2-methylpropane');
    // an explicit index wins over the registered one
    const other = buildNameIndex([{ id: 'n-butane', name: 'n-butane', smiles: 'CCCC' }]);
    expect(nameOf(parse('CCCC'), other)).toBe('n-butane');
    expect(nameOf(parse('CCCC'), null)).toBeNull();
    registerNameIndex(null);
    expect(nameOf(parse('CCCC'))).toBeNull();
  });

  it('N8 world graph of (R)-butan-2-ol from E4 names (R)-butan-2-ol; the mirror build names butan-2-ol', () => {
    const r = parse('C[C@@H](O)CC');
    const e = embedOnLattice(r)!;
    expect(e).not.toBeNull();
    const wr = worldFromEmbedding(r, e);
    assertBuildable(wr);
    expect(wr.atoms[1]!.hPos.length).toBe(1);
    expect(assignRS(wr, implicitHydrogens(wr).hydrogens, 1).label).toBe('R');
    expect(nameOf(wr, INDEX_NO_S)).toBe('(R)-butan-2-ol');
    expect(nameOf(wr, INDEX)).toBe('(R)-butan-2-ol');
    const ws = mirrorX(wr);
    assertBuildable(ws);
    expect(assignRS(ws, implicitHydrogens(ws).hydrogens, 1).label).toBe('S');
    expect(nameOf(ws, INDEX_NO_S)).toBe('butan-2-ol');
    expect(nameOf(ws, INDEX)).toBe('(S)-butan-2-ol');
    // a world graph passed through the registered index
    registerNameIndex(INDEX);
    expect(nameOf(wr)).toBe('(R)-butan-2-ol');
    expect(nameOf(ws)).toBe('(S)-butan-2-ol');
  });

  it('N8 octant layouts of 05 §5.3: R, S and a T-shaped (flat) build', () => {
    for (const g of [R_BUTANOL, S_BUTANOL, T_BUTANOL]) assertBuildable(g);
    expect(nameOf(R_BUTANOL, INDEX)).toBe('(R)-butan-2-ol');
    expect(nameOf(S_BUTANOL, INDEX)).toBe('(S)-butan-2-ol');
    expect(nameOf(S_BUTANOL, INDEX_NO_S)).toBe('butan-2-ol');
    expect(nameOf(T_BUTANOL, INDEX)).toBe('butan-2-ol');
    // without the flat entry a flat build gets the base name
    const stereoOnly = buildNameIndex(LIB.filter((x) => x.id !== 'butan-2-ol'));
    expect(nameOf(T_BUTANOL, stereoOnly)).toBe('butan-2-ol');
    expect(nameOf(R_BUTANOL, stereoOnly)).toBe('(R)-butan-2-ol');
    // the same cells with Br: the bromobutane entries
    const rBr = grid('CC(Br)CC', [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [2, 0, 0]]);
    const sBr = grid('CC(Br)CC', [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [2, 0, 0]]);
    expect(nameOf(rBr, INDEX)).toBe('(R)-2-bromobutane');
    expect(nameOf(sBr, INDEX)).toBe('(S)-2-bromobutane');
    expect(nameOf(mirrorX(rBr), INDEX)).toBe('(S)-2-bromobutane');
  });

  it('N8 E/Z builds: E, Z (one suppressed pair), trisubstituted Z and a twisted alkene', () => {
    assertBuildable(E_BUTENE);
    assertBuildable(Z_BUTENE, suppressedOf(Z_BUTENE, [[0, 3]]));
    assertBuildable(Z_CHLOROBUTENE, suppressedOf(Z_CHLOROBUTENE, [[0, 3]]));
    expect(nameOf(E_BUTENE, INDEX)).toBe('(E)-but-2-ene');
    expect(nameOf(Z_BUTENE, INDEX)).toBe('(Z)-but-2-ene');
    expect(nameOf(mirrorX(Z_BUTENE), INDEX)).toBe('(Z)-but-2-ene');
    expect(nameOf(TWISTED_BUTENE, INDEX)).toBe('but-2-ene');
    expect(nameOf(Z_CHLOROBUTENE, INDEX)).toBe('(Z)-2-chlorobut-2-ene');
    const eChloro = grid('CC=C(Cl)C', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [1, 1, 0]]);
    assertBuildable(eChloro, suppressedOf(eChloro, [[0, 4]]));
    expect(nameOf(eChloro, INDEX)).toBe('(E)-2-chlorobut-2-ene');
    const diene = grid('CC=CC=CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0], [2, -1, 0], [2, -2, 0]]);
    assertBuildable(diene);
    expect(nameOf(diene, INDEX)).toBe('(2E,4E)-hexa-2,4-diene');
  });

  it('N8 two-centre builds: meso and (2R,3R)-2,3-dibromobutane, charged acetate', () => {
    assertBuildable(MESO_DIBROMO);
    assertBuildable(RR_DIBROMO);
    expect(nameOf(MESO_DIBROMO, INDEX)).toBe('meso-2,3-dibromobutane');
    expect(nameOf(mirrorX(MESO_DIBROMO), INDEX)).toBe('meso-2,3-dibromobutane');
    expect(nameOf(RR_DIBROMO, INDEX)).toBe('(2R,3R)-2,3-dibromobutane');
    expect(nameOf(mirrorX(RR_DIBROMO), INDEX)).toBe('(2S,3S)-2,3-dibromobutane');
    // with only the meso entry indexed, the (R,R) build gets the base name
    const mesoOnly = buildNameIndex(LIB.filter((x) => x.id !== '2r-3r-dibromobutane' && x.id !== '2s-3s-dibromobutane'));
    expect(nameOf(RR_DIBROMO, mesoOnly)).toBe('2,3-dibromobutane');
    expect(nameOf(MESO_DIBROMO, mesoOnly)).toBe('meso-2,3-dibromobutane');
    assertBuildable(ACETATE);
    expect(nameOf(ACETATE, INDEX)).toBe('acetate');
  });

  it('N8 ring stereo from embeddings: cis (meso) and trans-1,2-dimethylcyclohexane', () => {
    const cases: [string, string][] = [
      ['C[C@H]1CCCC[C@H]1C', 'cis-1,2-dimethylcyclohexane'],
      ['C[C@@H]1CCCC[C@H]1C', '(1R,2R)-1,2-dimethylcyclohexane'],
      ['C[C@H]1CCCC[C@@H]1C', '(1S,2S)-1,2-dimethylcyclohexane'],
    ];
    for (const [smiles, name] of cases) {
      const g = parse(smiles);
      const e = embedOnLattice(g)!;
      expect(e, smiles).not.toBeNull();
      const w = worldFromEmbedding(g, e);
      assertBuildable(w, suppressedOf(w, e.suppressedPairs));
      expect(nameOf(w, INDEX), smiles).toBe(name);
    }
  });

  it('ChemApi conformance', () => {
    const api: Pick<ChemApi, 'nameOf'> = { nameOf };
    expect(api.nameOf(parse('C'))).toBeNull();
  });
});
