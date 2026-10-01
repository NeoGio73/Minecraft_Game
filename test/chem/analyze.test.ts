import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { buildGraph, components, withoutStereoTags } from '@/chem/graph';
import { perceiveAromaticity } from '@/chem/aromatic';
import { degreesOfUnsaturation, elementCounts, hillFormula, netCharge, piBondCount, ringCount } from '@/chem/formula';
import { functionalGroups } from '@/chem/groups';
import { fnv1a64, wlHash } from '@/chem/wlhash';
import { atomInfo } from '@/chem/hybridization';
import { acidity } from '@/chem/acidity';
import { analyzeStereo } from '@/chem/stereo';
import { analyze, cageWarnings, dedupeWarnings } from '@/chem/analyze';
import { buildNameIndex, nameOf, registerNameIndex } from '@/chem/naming';
import type { NameSource } from '@/chem/naming';
import type { ChemApi, MoleculeGraph, Vec3, Warning, WorldAtom, WorldGraph } from '@/chem/types';
import { manhattan } from '@/util/vec3';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;
const hyd = (g: MoleculeGraph): number[] => implicitHydrogens(g).hydrogens;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

const LIB: readonly NameSource[] = [
  { id: 'methane', name: 'methane', smiles: 'C' },
  { id: 'ethane', name: 'ethane', smiles: 'CC' },
  { id: 'propane', name: 'propane', smiles: 'CCC' },
  { id: 'methanol', name: 'methanol', smiles: 'CO' },
  { id: 'aspirin', name: 'aspirin', smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O' },
  { id: 'benzene', name: 'benzene', smiles: 'C1=CC=CC=C1' },
  { id: 'butan-2-ol', name: 'butan-2-ol', smiles: 'CCC(C)O' },
  { id: 'r-butan-2-ol', name: '(R)-butan-2-ol', smiles: 'C[C@@H](O)CC' },
  { id: 's-butan-2-ol', name: '(S)-butan-2-ol', smiles: 'C[C@H](O)CC' },
  { id: 'e-but-2-ene', name: '(E)-but-2-ene', smiles: 'C/C=C/C' },
  { id: 'z-but-2-ene', name: '(Z)-but-2-ene', smiles: 'C/C=C\\C' },
  { id: 'meso-2-3-dibromobutane', name: 'meso-2,3-dibromobutane', smiles: 'C[C@H](Br)[C@H](Br)C' },
  { id: '2r-3r-dibromobutane', name: '(2R,3R)-2,3-dibromobutane', smiles: 'C[C@@H](Br)[C@H](Br)C' },
  { id: 'methylammonium', name: 'methylammonium', smiles: 'C[NH3+]' },
];
const INDEX = buildNameIndex(LIB);

afterEach(() => registerNameIndex(null));

// ---------------------------------------------------------------------------
// World-graph helpers
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

/** World graph of carbon cells bonded wherever two cells touch (what extraction yields for a free-play build). */
function carbonCells(cells: readonly Vec3[]): WorldGraph {
  const atoms: WorldAtom[] = cells.map((pos, id) => ({ id, el: 'C', charge: 0, explicitH: null, aromatic: false, pos, hPos: [] }));
  const bonds: { a: number; b: number; order: 1 }[] = [];
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) if (manhattan(cells[i]!, cells[j]!) === 1) bonds.push({ a: i, b: j, order: 1 });
  }
  return buildGraph(atoms, bonds);
}

/** M12: methanol C(10,10,10) O(11,10,10) with an H block at (10,11,10), as extraction collapses it. */
const METHANOL_WORLD = grid('CO', [[10, 10, 10], [11, 10, 10]], { 0: [[10, 11, 10]] });
/** M2 chair hexagon on the cube vertices. */
const CHAIR: readonly Vec3[] = [[10, 10, 10], [11, 10, 10], [11, 11, 10], [11, 11, 11], [10, 11, 11], [10, 10, 11]];
/** M7: the inner cube vertex, face-adjacent to three ring atoms. */
const INNER: Vec3 = [10, 11, 10];

const R_BUTANOL = grid('CC(O)CC', [[0, 1, 0], [0, 0, 0], [0, 0, -1], [1, 0, 0], [2, 0, 0]]);
const T_BUTANOL = grid('CC(O)CC', [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]]);
const E_BUTENE = grid('CC=CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]]);
const Z_BUTENE = grid('CC=CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]]);
const COLLINEAR_BUTENE = grid('CC=CC', [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]]);
const MESO_DIBROMO = grid('CC(Br)C(Br)C', [[0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, -1], [1, -1, 0]]);

const LIB_CSV = new URL('../../tools/reference/lib.csv', import.meta.url);
const MOLECULES_JSON = new URL('../../src/content/molecules.json', import.meta.url);

// ---------------------------------------------------------------------------

describe('analyze.ts', () => {
  it('Z1 aspirin', () => {
    const g = parse('CC(=O)Oc1ccccc1C(=O)O');
    const a = analyze(g);
    expect(a.formula).toBe('C9H8O4');
    expect(a.counts).toEqual({ ...a.counts, C: 9, H: 8, O: 4, N: 0, Br: 0, Cl: 0, F: 0, I: 0, P: 0, S: 0 });
    expect(a.dou).toBe(6);
    expect(a.ringCount).toBe(1);
    expect(a.components).toBe(1);
    expect(a.netCharge).toBe(0);
    expect(a.groups.length).toBe(3);
    expect(a.groups.map((h) => h.group)).toEqual(['carboxylic-acid', 'ester', 'arene']);
    expect(a.stereo).toBeNull();
    expect(a.name).toBeNull();
    expect(a.atoms.length).toBe(13);
    expect(a.hydrogens.length).toBe(13);
    expect(sum(a.hydrogens)).toBe(8);
    a.atoms.forEach((info, i) => expect(info.id).toBe(i));
    // the ring carbons are reported sp2 on the perceived graph
    for (const i of [4, 5, 6, 7, 8, 9]) expect(a.atoms[i]!.hybridization).toBe('sp2');
    // no valence, cage or stereo warnings: only the unverified conjugate-acid pKa of the most basic oxygen
    expect(a.warnings.filter((w) => w.kind !== 'unverified-pka')).toEqual([]);
    expect(a.acidity.mostAcidic.length).toBeGreaterThan(0);
    expect(a.acidity.mostAcidic[0]!.classId).toBe('OH.carboxylic');
    registerNameIndex(INDEX);
    const named = analyze(g);
    expect(named.name).toBe('aspirin');
    expect(named.hash).toBe(a.hash);
    // the Kekulé library form gives the same record
    const kek = analyze(parse('CC(=O)OC1=CC=CC=C1C(=O)O'));
    expect(kek.hash).toBe(a.hash);
    expect(kek.formula).toBe(a.formula);
    expect(kek.groups.map((h) => h.label)).toEqual(a.groups.map((h) => h.label));
    expect(kek.name).toBe('aspirin');
  });

  it('Z2 world graph of methanol (M12)', () => {
    registerNameIndex(INDEX);
    const a = analyze(METHANOL_WORLD);
    expect(a.stereo).not.toBeNull();
    expect(a.hydrogens).toEqual([3, 1]);
    expect(a.formula).toBe('CH4O');
    expect(a.name).toBe('methanol');
    expect(a.stereo!.centers).toEqual([]);
    expect(a.stereo!.doubleBonds).toEqual([]);
    expect(a.stereo!.ringFaces).toEqual([]);
    expect(a.stereo!.chiral).toBe(false);
    expect(a.stereo!.meso).toBe(false);
    expect(a.groups.map((h) => h.label)).toEqual(['alcohol (methanol)']);
    // the explicit H block is the first hydrogen site of the carbon
    expect(a.acidity.hydrogens.length).toBe(4);
    expect(a.acidity.hydrogens[0]).toMatchObject({ parentId: 0, slot: 0, explicitPos: [10, 11, 10] });
    expect(a.acidity.hydrogens[1]!.explicitPos).toBeUndefined();
    expect(a.acidity.mostAcidic.map((s) => s.parentId)).toEqual([1]);
    expect(a.acidity.mostBasic.map((s) => s.classId)).toEqual(['B.O.alcohol']);
    expect(a.warnings).toEqual([{ kind: 'unverified-pka', classId: 'B.O.alcohol' }]);
    expect(a.atoms[0]!.geometry).toBe('tetrahedral');
    expect(a.atoms[1]!.geometry).toBe('bent');
    // the same molecule parsed from SMILES: no stereo record, same everything else
    const s = analyze(parse('CO'));
    expect(s.stereo).toBeNull();
    expect(s.hash).toBe(a.hash);
    expect(s.hydrogens).toEqual(a.hydrogens);
    expect(s.name).toBe('methanol');
  });

  it('Z3 over-valence is reported exactly once', () => {
    const a = analyze(parse('CC(C)(C)(C)C'));
    const ov = a.warnings.filter((w) => w.kind === 'over-valence');
    expect(ov).toEqual([{ kind: 'over-valence', atom: 1, have: 5, max: 4 }]);
    expect(a.hydrogens[1]).toBe(0);
    expect(a.atoms[1]!.valenceError).toBeDefined();
    expect(a.formula).toBe('C6H15');
    // a neutral sulfone and a four-bond amine
    expect(analyze(parse('CS(=O)(=O)C')).warnings.filter((w) => w.kind === 'over-valence')).toEqual([{ kind: 'over-valence', atom: 1, have: 6, max: 2 }]);
    expect(analyze(parse('CN(C)(C)C')).warnings.filter((w) => w.kind === 'over-valence')).toEqual([{ kind: 'over-valence', atom: 1, have: 4, max: 3 }]);
  });

  it('Z4 extra warnings come first and are deduplicated', () => {
    const g = parse('CC(C)(C)(C)C');
    const w: Warning = { kind: 'h-block-valence', atom: 0, bonds: 2 };
    const a = analyze(g, [w]);
    expect(a.warnings[0]).toEqual(w);
    expect(a.warnings[1]).toEqual({ kind: 'over-valence', atom: 1, have: 5, max: 4 });
    const twice = analyze(g, [w, w]);
    expect(twice.warnings.filter((x) => x.kind === 'h-block-valence')).toEqual([w]);
    expect(twice.warnings.length).toBe(a.warnings.length);
    // an extra over-valence for the same atom suppresses the computed one (first occurrence wins)
    const dup: Warning = { kind: 'over-valence', atom: 1, have: 5, max: 4 };
    expect(analyze(g, [dup]).warnings.filter((x) => x.kind === 'over-valence')).toEqual([dup]);
    // different atoms are different warnings
    const w0: Warning = { kind: 'h-block-valence', atom: 0, bonds: 0 };
    const w1: Warning = { kind: 'h-block-valence', atom: 1, bonds: 2 };
    expect(analyze(parse('CO'), [w0, w1]).warnings.slice(0, 2)).toEqual([w0, w1]);
    // charge-unsupported from extraction (a world Cl with charge +1)
    const cu: Warning = { kind: 'charge-unsupported', atom: 0, charge: 1 };
    const ag = analyze(grid('CCl', [[0, 0, 0], [1, 0, 0]]), [cu]);
    expect(ag.warnings[0]).toEqual(cu);
  });

  it('dedupeWarnings keys on kind plus atom / bond / classId / states', () => {
    const ws: Warning[] = [
      { kind: 'over-valence', atom: 1, have: 5, max: 4 },
      { kind: 'over-valence', atom: 1, have: 6, max: 4 },
      { kind: 'over-valence', atom: 2, have: 5, max: 4 },
      { kind: 'planar-center', atom: 1, shape: 'T' },
      { kind: 'planar-center', atom: 1, shape: 'square-planar' },
      { kind: 'alkene-geometry', bond: 0, label: 'COLLINEAR' },
      { kind: 'alkene-geometry', bond: 0, label: 'TWISTED' },
      { kind: 'alkene-geometry', bond: 1, label: 'TWISTED' },
      { kind: 'unverified-pka', classId: 'B.O.alcohol' },
      { kind: 'unverified-pka', classId: 'B.O.alcohol' },
      { kind: 'unverified-pka', classId: 'NH.amide' },
      { kind: 'isomorphism-cap', states: 200001 },
      { kind: 'isomorphism-cap', states: 200001 },
      { kind: 'cage', atom: 6, ringAtoms: [0, 1, 2, 3, 4, 5] },
      { kind: 'cage', atom: 6, ringAtoms: [1, 2, 3, 4, 5, 0] },
      { kind: 'h-block-valence', atom: 1, bonds: 2 },
      { kind: 'charge-unsupported', atom: 1, charge: 1 },
    ];
    expect(dedupeWarnings(ws)).toEqual([ws[0], ws[2], ws[3], ws[5], ws[7], ws[8], ws[10], ws[11], ws[13], ws[15], ws[16]]);
    expect(dedupeWarnings([])).toEqual([]);
  });

  it('Z5 cage: tricyclic C7H10 has one cage warning and three rings', () => {
    const g = parse('C12C3CC1CC2C3');
    const a = analyze(g);
    expect(a.ringCount).toBe(3);
    expect(a.formula).toBe('C7H10');
    const cages = a.warnings.filter((w) => w.kind === 'cage');
    expect(cages.length).toBe(1);
    expect(cages[0]).toMatchObject({ kind: 'cage', atom: 0 });
    // ring ids are those of g (the removed atom 0 is skipped), in ring path order
    const ring = (cages[0] as { ringAtoms: readonly number[] }).ringAtoms;
    expect([...ring].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
    for (let k = 0; k < 6; k++) {
      const [p, q] = [ring[k]!, ring[(k + 1) % 6]!];
      expect(g.adj[p]!.some((b) => g.bonds[b]!.a + g.bonds[b]!.b === p + q), `${p}-${q}`).toBe(true);
    }
    expect(cageWarnings(g)).toEqual(cages);
    expect(a.groups.map((h) => h.label)).toEqual(['cycloalkane']);
  });

  it('M7 cage: the chair hexagon plus its inner-vertex carbon', () => {
    const chair = carbonCells(CHAIR);
    expect(chair.bonds.length).toBe(6);
    expect(analyze(chair).ringCount).toBe(1);
    expect(cageWarnings(chair)).toEqual([]);
    const caged = carbonCells([...CHAIR, INNER]);
    expect(caged.bonds.length).toBe(9);
    const a = analyze(caged);
    expect(a.ringCount).toBe(3);
    expect(a.stereo).not.toBeNull();
    const cages = a.warnings.filter((w) => w.kind === 'cage');
    expect(cages.length).toBe(1);
    expect(cages[0]).toMatchObject({ kind: 'cage', atom: 6 });
    const ring = (cages[0] as { ringAtoms: readonly number[] }).ringAtoms;
    expect([...ring].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5]);
    // the ring atoms are ids of the full graph: all six bonded in a cycle
    for (let k = 0; k < 6; k++) expect(manhattan(caged.atoms[ring[k]!]!.pos, caged.atoms[ring[(k + 1) % 6]!]!.pos)).toBe(1);
    // the planar 2x3 hexagon (M3) has a chord but no cage; a substituent outside the ring is fine
    const planar = carbonCells([[10, 10, 10], [11, 10, 10], [10, 10, 11], [11, 10, 11], [10, 10, 12], [11, 10, 12]]);
    expect(analyze(planar).ringCount).toBe(2);
    expect(cageWarnings(planar)).toEqual([]);
    const methylcyclohexane = carbonCells([...CHAIR, [9, 10, 10]]);
    expect(cageWarnings(methylcyclohexane)).toEqual([]);
  });

  it('cageWarnings: acyclic and simple ring molecules never warn; bicyclics with a three-fold bridgehead do', () => {
    for (const s of ['C', 'CC(C)(C)C', 'CCCCCC', 'C1CCCCC1', 'c1ccccc1', 'C1CCC1', 'CC1CCCCC1C', 'c1ccc2ccccc2c1', 'C1CC2CCC1CC2']) {
      expect(cageWarnings(parse(s)), s).toEqual([]);
    }
    // bicyclo[2.2.2]octane: each bridgehead has three neighbours, but no single ring holds all three
    expect(cageWarnings(parse('C1CC2CCC1CC2'))).toEqual([]);
    // a ring with a methine bonded to three ring atoms: remove the methine, the 6-ring remains
    const g = parse('C12C3CC1CC2C3');
    expect(cageWarnings(g).map((w) => w.kind)).toEqual(['cage']);
    expect(cageWarnings({ atoms: [], bonds: [], adj: [] })).toEqual([]);
  });

  it('Z6 the empty graph', () => {
    registerNameIndex(INDEX);
    const a = analyze({ atoms: [], bonds: [], adj: [] });
    expect(a.formula).toBe('');
    expect(Object.values(a.counts).every((c) => c === 0)).toBe(true);
    expect(a.hydrogens).toEqual([]);
    expect(a.netCharge).toBe(0);
    expect(a.dou).toBe(0);
    expect(a.ringCount).toBe(0);
    expect(a.components).toBe(0);
    expect(a.groups).toEqual([]);
    expect(a.warnings).toEqual([]);
    expect(a.name).toBeNull();
    expect(a.hash).toBe(fnv1a64('0|0|'));
    expect(a.atoms).toEqual([]);
    expect(a.stereo).toBeNull();
    expect(a.acidity).toEqual({ hydrogens: [], basicSites: [], mostAcidic: [], mostBasic: [] });
  });

  it('Z7 methylammonium', () => {
    registerNameIndex(INDEX);
    const a = analyze(parse('C[NH3+]'));
    expect(a.netCharge).toBe(1);
    expect(a.formula).toBe('CH6N+');
    expect(a.groups.map((h) => h.group)).toEqual(['ammonium']);
    expect(a.dou).toBe(-0.5);
    expect(a.hydrogens).toEqual([3, 3]);
    expect(a.atoms[1]!.formalCharge).toBe(1);
    expect(a.atoms[1]!.geometry).toBe('tetrahedral');
    expect(a.acidity.mostAcidic.map((s) => s.classId)).toEqual(['NH.ammonium.primary', 'NH.ammonium.primary', 'NH.ammonium.primary']);
    expect(a.acidity.basicSites).toEqual([]);
    expect(a.name).toBe('methylammonium');
    expect(a.warnings).toEqual([]);
    // other ions keep the half-integer DoU
    expect(analyze(parse('C[O-]')).dou).toBe(0.5);
    expect(analyze(parse('CC(=O)[O-]')).formula).toBe('C2H3O2-');
  });

  it('Z8 two components', () => {
    const a = analyze(parse('C.CC'));
    expect(a.components).toBe(2);
    expect(a.formula).toBe('C3H10');
    expect(a.ringCount).toBe(0);
    expect(a.groups.length).toBe(1);
    expect(a.groups[0]).toMatchObject({ group: 'alkane', atoms: [0, 1, 2], label: 'alkane' });
    expect(a.name).toBeNull();
    expect(a.hash).toBe(wlHash(parse('C.CC'), hyd(parse('C.CC'))).hash);
  });

  it('Z9 hash, counts and hydrogens agree with the core modules', () => {
    const smiles = [
      'CC(=O)Oc1ccccc1C(=O)O', 'c1ccccc1', 'C1=CC=CC=C1', 'CC1=CC=CC=C1C', 'C[NH3+]', 'C.CC', 'OC(=O)[C@H](O)[C@@H](O)C(=O)O',
      'O=[N+]([O-])c1ccccc1', 'C[S+](C)[O-]', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'CC(C)(C)(C)C', 'C/C=C\\C',
    ];
    for (const s of smiles) {
      const g = parse(s);
      const a = analyze(g);
      const h = hyd(g);
      const gp = perceiveAromaticity(g);
      expect(a.hash, s).toBe(wlHash(gp, h).hash);
      expect(a.hydrogens, s).toEqual(h);
      expect(a.counts.H, s).toBe(sum(a.hydrogens));
      expect(a.counts, s).toEqual(elementCounts(gp, h));
      expect(a.formula, s).toBe(hillFormula(gp, h));
      expect(a.netCharge, s).toBe(netCharge(gp));
      expect(a.dou, s).toBe(degreesOfUnsaturation(a.counts));
      expect(a.ringCount, s).toBe(ringCount(gp));
      expect(a.components, s).toBe(components(gp).length);
      expect(a.groups, s).toEqual(functionalGroups(gp, h));
      expect(a.atoms, s).toEqual(atomInfo(gp, h));
      expect(a.acidity, s).toEqual(acidity(gp, a.atoms));
      expect(a.stereo, s).toBeNull();
      expect(a.name, s).toBe(nameOf(gp, null));
    }
  });

  it('both Kekulé forms of an arene give one record; phenoxide is perceived before acidity', () => {
    const a = analyze(parse('c1ccccc1'));
    const b = analyze(parse('C1=CC=CC=C1'));
    expect(a.hash).toBe(b.hash);
    expect(a.groups.map((h) => h.label)).toEqual(['arene']);
    expect(b.groups.map((h) => h.label)).toEqual(['arene']);
    expect(a.atoms.every((i) => i.hybridization === 'sp2')).toBe(true);
    expect(a.dou).toBe(4);
    expect(a.ringCount).toBe(1);
    const ox = analyze(parse('CC1C(C)=CC=CC=1'));
    expect(ox.hash).toBe(analyze(parse('Cc1ccccc1C')).hash);
    // a Kekulé phenoxide drawn on the grid reads B.O.phenoxide (10), not B.O.enolate (19)
    const ph = analyze(parse('[O-]C1=CC=CC=C1'));
    expect(ph.acidity.mostBasic.map((s) => s.classId)).toEqual(['B.O.phenoxide']);
    expect(ph.acidity.mostBasic[0]!.pKaH).toBe(10);
    expect(ph.groups.map((h) => h.group)).toEqual(['arene', 'alkoxide']);
    expect(ph.warnings).toEqual([]);
  });

  it('stereo for world graphs: R centre, flat T centre warning, E/Z and a collinear alkene', () => {
    registerNameIndex(INDEX);
    const r = analyze(R_BUTANOL);
    expect(r.stereo).not.toBeNull();
    expect(r.stereo).toEqual(analyzeStereo(R_BUTANOL, hyd(R_BUTANOL)));
    expect(r.stereo!.centers.map((c) => [c.atom, c.label])).toEqual([[1, 'R']]);
    expect(r.stereo!.chiral).toBe(true);
    expect(r.stereo!.meso).toBe(false);
    expect(r.name).toBe('(R)-butan-2-ol');
    expect(r.warnings).toEqual([{ kind: 'unverified-pka', classId: 'B.O.alcohol' }]);
    const t = analyze(T_BUTANOL);
    expect(t.stereo!.centers.map((c) => [c.atom, c.label, c.shape])).toEqual([[1, 'UNSPECIFIED', 'T']]);
    expect(t.stereo!.chiral).toBe(false);
    expect(t.name).toBe('butan-2-ol');
    // stereo warnings precede the pKa warning
    expect(t.warnings).toEqual([
      { kind: 'planar-center', atom: 1, shape: 'T' },
      { kind: 'unverified-pka', classId: 'B.O.alcohol' },
    ]);
    const sq = analyze(grid('CC(O)CC', [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]], { 1: [[0, -1, 0]] }));
    expect(sq.warnings[0]).toEqual({ kind: 'planar-center', atom: 1, shape: 'square-planar' });
    expect(sq.hydrogens).toEqual([3, 1, 1, 2, 3]);
    const e = analyze(E_BUTENE);
    expect(e.stereo!.doubleBonds.map((d) => [d.bond, d.label])).toEqual([[1, 'E']]);
    expect(e.name).toBe('(E)-but-2-ene');
    const z = analyze(Z_BUTENE);
    expect(z.stereo!.doubleBonds.map((d) => [d.bond, d.label])).toEqual([[1, 'Z']]);
    expect(z.name).toBe('(Z)-but-2-ene');
    expect(z.ringCount).toBe(0);
    const col = analyze(COLLINEAR_BUTENE);
    expect(col.stereo!.doubleBonds.map((d) => d.label)).toEqual(['COLLINEAR']);
    expect(col.warnings[0]).toEqual({ kind: 'alkene-geometry', bond: 1, label: 'COLLINEAR' });
    expect(col.name).toBe('but-2-ene');
    // no warnings of either stereo kind on a clean alkene build
    expect(e.warnings.filter((w) => w.kind === 'alkene-geometry' || w.kind === 'planar-center')).toEqual([]);
    const meso = analyze(MESO_DIBROMO);
    expect(meso.stereo!.meso).toBe(true);
    expect(meso.stereo!.chiral).toBe(false);
    expect(meso.stereo!.centers.map((c) => c.label).sort()).toEqual(['R', 'S']);
    expect(meso.name).toBe('meso-2,3-dibromobutane');
    expect(meso.groups.map((h) => h.label)).toEqual(['alkyl halide (secondary)', 'alkyl halide (secondary)']);
  });

  it('tags on a target graph without positions are ignored: stereo null, base name', () => {
    registerNameIndex(INDEX);
    const a = analyze(parse('C[C@@H](O)CC'));
    expect(a.stereo).toBeNull();
    expect(a.name).toBe('butan-2-ol');
    const z = analyze(parse('C/C=C\\C'));
    expect(z.stereo).toBeNull();
    expect(z.name).toBe('but-2-ene');
    expect(z.hash).toBe(analyze(parse('CC=CC')).hash);
  });

  it('unverified pKa warnings come from the most acidic and most basic classes only', () => {
    // ethanol: OH 16.0 verified; most basic O (B.O.alcohol) unverified
    expect(analyze(parse('CCO')).warnings).toEqual([{ kind: 'unverified-pka', classId: 'B.O.alcohol' }]);
    // ethylamine: NH 36 verified, amine N 10.6 verified
    expect(analyze(parse('CCN')).warnings).toEqual([]);
    // propanamide: NH.amide 17 unverified and the tie of two unverified basic classes
    const amide = analyze(parse('CCC(N)=O'));
    expect(amide.warnings.map((w) => w.kind)).toEqual(['unverified-pka', 'unverified-pka', 'unverified-pka']);
    expect(amide.warnings.map((w) => (w as { classId: string }).classId).sort()).toEqual(['B.N.amide', 'B.O.amide', 'NH.amide']);
    // acetate: the only hydrogens are alpha to the carboxylate (unverified), the base is verified
    expect(analyze(parse('CC(=O)[O-]')).warnings).toEqual([{ kind: 'unverified-pka', classId: 'CH.alpha.carboxylic' }]);
    // methane: no basic site, verified alkane C-H
    expect(analyze(parse('C')).warnings).toEqual([]);
  });

  it('warning order: extra, valence, cage, stereo, pKa', () => {
    const inner = carbonCells([...CHAIR, INNER]);
    // an alcohol on a ring atom gives an unverified basic site; an extra h-block warning leads
    const atoms: WorldAtom[] = [...inner.atoms, { id: 7, el: 'O', charge: 0, explicitH: null, aromatic: false, pos: [12, 10, 10], hPos: [] }];
    const g = buildGraph(atoms, [...inner.bonds, { a: 1, b: 7, order: 1 }]);
    const extra: Warning = { kind: 'h-block-valence', atom: 7, bonds: 2 };
    const a = analyze(g, [extra]);
    expect(a.warnings.map((w) => w.kind)).toEqual(['h-block-valence', 'cage', 'unverified-pka']);
  });

  it('keeps the input graph untouched and the record consistent', () => {
    const g = parse('CC(=O)Oc1ccccc1C(=O)O');
    const before = JSON.stringify(g);
    const a = analyze(g);
    expect(JSON.stringify(g)).toBe(before);
    expect(a.atoms.length).toBe(g.atoms.length);
    expect(a.hydrogens.length).toBe(g.atoms.length);
    expect(a.acidity.hydrogens.length).toBe(sum(a.hydrogens));
    a.acidity.hydrogens.forEach((s) => expect(a.hydrogens[s.parentId]).toBeGreaterThan(s.slot));
    // calling twice gives equal records
    expect(analyze(g)).toEqual(a);
  });

  it('library-wide: every reference molecule analyses, formula matches RDKit, counts agree', () => {
    const rows = readFileSync(LIB_CSV, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => l.split(','));
    expect(rows.length).toBeGreaterThan(100);
    const entries: { id: string; smiles: string; formula: string }[] = rows.map((row) => ({
      id: row[0]!, formula: row[1]!, smiles: row[2]!.replace(/\\\\/g, '\\'),
    }));
    if (existsSync(MOLECULES_JSON)) {
      const raw = JSON.parse(readFileSync(MOLECULES_JSON, 'utf8')) as { entries?: { id: string; smiles: string; formula: string }[] } | { id: string; smiles: string; formula: string }[];
      const json = Array.isArray(raw) ? raw : raw.entries ?? [];
      for (const e of json) entries.push({ id: e.id, smiles: e.smiles, formula: e.formula });
    }
    for (const e of entries) {
      const g = parse(e.smiles);
      const a = analyze(g);
      expect(a.formula, e.id).toBe(e.formula);
      expect(a.counts.H, e.id).toBe(sum(a.hydrogens));
      expect(a.stereo, e.id).toBeNull();
      expect(a.atoms.length, e.id).toBe(g.atoms.length);
      expect(a.hash, e.id).toBe(wlHash(perceiveAromaticity(g), hyd(g)).hash);
      expect(a.warnings.filter((w) => w.kind === 'over-valence' || w.kind === 'charge-unsupported'), e.id).toEqual([]);
      if (a.netCharge === 0) expect(a.dou, e.id).toBe(a.ringCount + piBondCount(g));
      if (a.groups.length === 0) continue;
      for (const h of a.groups) for (const i of h.atoms) expect(i, e.id).toBeLessThan(g.atoms.length);
    }
  });

  it('ChemApi conformance', () => {
    const api: Pick<ChemApi, 'analyze'> = { analyze };
    expect(api.analyze(parse('C')).formula).toBe('CH4');
  });
});
