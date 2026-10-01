import { describe, it, expect, afterEach } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { perceiveAromaticity } from '@/chem/aromatic';
import { hillFormula } from '@/chem/formula';
import { smallestRings } from '@/chem/graph';
import { labelTargetStereo, analyzeStereo } from '@/chem/stereo';
import { sameMolecule } from '@/chem/compare';
import { analyze } from '@/chem/analyze';
import { registerNameIndex, registeredNameIndex } from '@/chem/naming';
import { hasPositions } from '@/chem/types';
import type { MoleculeGraph } from '@/chem/types';
import { entryById, entryBySmiles, layoutOf, loadLibrary, parseEntry, parseEntryDetailed, suppressedPairsOf } from '@/content/library';
import { loadRosterFile } from '@/content/challenges';
import { loadReagents } from '@/content/reagents';
import { mcmurrySpelling, validateContent, validateContentDetailed, worldGraphFromEmbedding } from '@/content/validate';
import type { MoleculeEntry, MoleculeLibrary } from '@/content/types';
import { NEEDS_SUPPRESSION } from './fixtures/suppressions';

const library = loadLibrary();
const roster = loadRosterFile();
const reagents = loadReagents();

const hasTags = (g: MoleculeGraph): boolean => g.atoms.some((a) => a.tet !== undefined) || g.bonds.some((b) => b.ez !== undefined);

function withEntry(lib: MoleculeLibrary, id: string, patch: Partial<MoleculeEntry> | ((e: MoleculeEntry) => MoleculeEntry)): MoleculeLibrary {
  return {
    version: 1,
    entries: lib.entries.map((e) => (e.id === id ? (typeof patch === 'function' ? patch(e) : { ...e, ...patch }) : e)),
  };
}

afterEach(() => {
  // library.ts re-registers its index on the next call; nothing leaks between tests
});

describe('library.ts loaders', () => {
  it('loads 192 entries and registers the name index', () => {
    expect(library.version).toBe(1);
    expect(library.entries.length).toBe(192);
    expect(registeredNameIndex()).not.toBeNull();
    expect(registeredNameIndex()!.size).toBe(192);
    expect(analyze(parseEntry('CCO')).name).toBe('ethanol');
  });

  it('re-registers the index when a test cleared it', () => {
    registerNameIndex(null);
    expect(registeredNameIndex()).toBeNull();
    loadLibrary();
    expect(registeredNameIndex()).not.toBeNull();
  });

  it('entryById / entryBySmiles are exact lookups', () => {
    expect(entryById('r-2-bromobutane')?.smiles).toBe('C[C@@H](Br)CC');
    expect(entryBySmiles('C[C@@H](Br)CC')?.id).toBe('r-2-bromobutane');
    expect(entryById('nope')).toBeUndefined();
    expect(entryBySmiles('CCC(C)Br ')).toBeUndefined();
  });

  it('parseEntry is memoised by SMILES and perceives aromaticity', () => {
    const a = parseEntry('CCO');
    expect(parseEntry(entryById('ethanol')!)).toBe(a);
    const d = parseEntryDetailed('CC(=O)O');
    expect(d.hydrogens).toEqual([3, 0, 0, 1]);
    expect(d.warnings).toEqual([]);
    expect(parseEntry('C[C@@H](Br)CC').atoms[1]!.tet).toBeDefined();
  });

  it('suppressedPairsOf finds face-adjacent unbonded heavy pairs', () => {
    const z = parseEntry('C/C=C\\C');
    expect(suppressedPairsOf(z, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]])).toEqual([[0, 3]]);
    expect(suppressedPairsOf(z, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]])).toEqual([]);
  });

  it('layoutOf uses the stored layout (no H, suppressed pairs derived) and embeds otherwise', () => {
    const z = layoutOf(entryById('z-but-2-ene')!)!;
    expect(z.pos).toEqual([[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]]);
    expect(z.hPos.size).toBe(0);
    expect(z.suppressedPairs).toEqual([[0, 3]]);
    const cis = layoutOf(entryById('cis-1-2-dimethylcyclohexane')!)!;
    expect(cis.pos.length).toBe(8);
    expect(cis.hPos.size).toBeGreaterThan(0);
    expect(cis.suppressedPairs).toEqual([]);
    expect(layoutOf(entryById('cis-1-2-dimethylcyclohexane')!)).toBe(cis);
  });
});

describe('library content (05 §11 L1-L8)', () => {
  it('L1 every SMILES parses, is Kekulé and perceives', () => {
    for (const e of library.entries) {
      expect(() => parseSmiles(e.smiles), e.id).not.toThrow();
      expect(/[cnosp]/.test(e.smiles), e.id).toBe(false);
      expect(() => perceiveAromaticity(parseSmiles(e.smiles).graph), e.id).not.toThrow();
    }
  });

  it('L2 the engine Hill formula equals the stored formula', () => {
    for (const e of library.entries) {
      const g = parseSmiles(e.smiles).graph;
      expect(hillFormula(g, implicitHydrogens(g).hydrogens), e.id).toBe(e.formula);
    }
  });

  it('L3 labelTargetStereo reproduces the stored CIP labels', () => {
    for (const e of library.entries) {
      const { graph, hydrogens } = parseEntryDetailed(e);
      const got = labelTargetStereo(graph, hydrogens);
      const expected = e.labels ?? {};
      for (const [key, label] of Object.entries(expected)) {
        if (key.includes('=')) {
          const [i, j] = key.split('=').map((s) => Number(s) - 1);
          const k = graph.bonds.findIndex((b) => b.a === i && b.b === j);
          expect(k, `${e.id} ${key}`).toBeGreaterThanOrEqual(0);
          expect(got.bonds.get(k), `${e.id} ${key}`).toBe(label);
        } else if (label === label.toLowerCase()) {
          expect(got.centers.get(Number(key) - 1), `${e.id} ${key}`).toBe('NOT_CENTER');
        } else {
          expect(got.centers.get(Number(key) - 1), `${e.id} ${key}`).toBe(label);
        }
      }
      for (const [atom, label] of got.centers) {
        if (label === 'R' || label === 'S') expect(expected[String(atom + 1)], `${e.id} atom ${atom + 1}`).toBe(label);
      }
      for (const [k, label] of got.bonds) {
        const b = graph.bonds[k]!;
        if (label === 'E' || label === 'Z') expect(expected[`${b.a + 1}=${b.b + 1}`], `${e.id} bond ${k}`).toBe(label);
      }
    }
  });

  it('L4 meso flags agree with analyzeStereo on the embedded world graph', () => {
    let tagged = 0;
    for (const e of library.entries) {
      const g = parseEntry(e);
      if (!hasTags(g)) {
        expect(e.meso, e.id).toBeUndefined();
        continue;
      }
      tagged++;
      const emb = layoutOf(e);
      expect(emb, e.id).not.toBeNull();
      const wg = worldGraphFromEmbedding(g, emb!);
      expect(hasPositions(wg)).toBe(true);
      const st = analyzeStereo(wg, implicitHydrogens(wg).hydrogens);
      expect(st.meso, e.id).toBe(e.meso === true);
    }
    expect(library.entries.filter((e) => e.meso === true).map((e) => e.id).sort()).toEqual([
      'cis-1-2-dibromocyclohexane', 'cis-1-2-dimethylcyclohexane', 'cis-cyclohexane-1-2-diol', 'meso-2-3-dibromobutane',
    ]);
    expect(tagged).toBeGreaterThan(30);
  });

  it('L5 ids unique and kebab-case; no two entries SAME under stereo:absolute', () => {
    const ids = new Set<string>();
    for (const e of library.entries) {
      expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id), e.id).toBe(true);
      expect(ids.has(e.id), e.id).toBe(false);
      ids.add(e.id);
    }
    const byHash = new Map<string, MoleculeEntry[]>();
    for (const e of library.entries) {
      const h = analyze(parseEntry(e)).hash;
      byHash.set(h, [...(byHash.get(h) ?? []), e]);
    }
    for (const list of byHash.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          // SAME in both directions (an untagged target is a wildcard, so flat entries may coexist with their isomers)
          const ab = sameMolecule(parseEntry(list[i]!), parseEntry(list[j]!), { stereo: 'absolute' }).verdict;
          const ba = sameMolecule(parseEntry(list[j]!), parseEntry(list[i]!), { stereo: 'absolute' }).verdict;
          expect(ab === 'SAME' && ba === 'SAME', `${list[i]!.id} vs ${list[j]!.id}`).toBe(false);
        }
      }
    }
    // a stereo-unspecified entry may coexist with its defined isomers
    expect(sameMolecule(parseEntry('CCC(C)Br'), parseEntry('C[C@@H](Br)CC'), { stereo: 'absolute' }).verdict).toBe('UNSPECIFIED');
  });

  it('L6 no odd rings', () => {
    for (const e of library.entries) {
      for (const ring of smallestRings(parseEntry(e))) expect(ring.length % 2, e.id).toBe(0);
    }
  });

  it('L8 layouts: heavy-atom count, bonded pairs adjacent, suppressed pairs as listed, stereo reproduced', () => {
    let withLayout = 0;
    for (const e of library.entries) {
      if (!e.layout) continue;
      withLayout++;
      const g = parseEntry(e);
      expect(e.layout.length, e.id).toBe(g.atoms.length);
      for (const b of g.bonds) {
        const p = e.layout[b.a]!;
        const q = e.layout[b.b]!;
        expect(Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]), `${e.id} bond ${b.a}-${b.b}`).toBe(1);
      }
      const emb = layoutOf(e)!;
      const expectedPairs = NEEDS_SUPPRESSION[e.id];
      expect(emb.suppressedPairs, e.id).toEqual(expectedPairs ? [expectedPairs] : []);
      const wg = worldGraphFromEmbedding(g, emb);
      expect(sameMolecule(wg, g, { stereo: 'absolute' }).verdict, e.id).toBe('SAME');
      expect(analyze(wg).name, e.id).toBe(e.name);
    }
    expect(withLayout).toBe(37);
  });

  it('every entry has the fields the contract requires', () => {
    for (const e of library.entries) {
      expect(typeof e.name, e.id).toBe('string');
      expect(Array.isArray(e.commonNames), e.id).toBe(true);
      expect(e.requiresDiagonalBonds, e.id).toBe(false);
      expect(e.chapters.length, e.id).toBeGreaterThan(0);
      for (const ch of e.chapters) expect(ch >= 1 && ch <= 11, e.id).toBe(true);
      expect('stereoBuildable' in e).toBe(false);
    }
    expect(entryById('butan-2-ol')!.commonNames).toContain('2-butanol');
    expect(entryById('r-butan-2-ol')!.commonNames).toContain('(R)-2-butanol');
  });
});

describe('validateContent', () => {
  it('returns [] for the shipped files', () => {
    const problems = validateContent(library, roster, reagents);
    expect(problems).toEqual([]);
  });

  it('reports a mutated formula (L2)', () => {
    const lib = withEntry(library, 'ethanol', { formula: 'C2H5O' });
    const p = validateContentDetailed(lib, roster, reagents);
    expect(p.some((x) => x.where === 'library:ethanol' && /formula/.test(x.message))).toBe(true);
  });

  it('reports an unparsable or aromatic SMILES (L1) and the obsolete stereoBuildable field', () => {
    const lib = withEntry(library, 'methane', { smiles: 'C(' });
    expect(validateContent(lib, roster, reagents).some((s) => s.startsWith('library:methane: smiles does not parse'))).toBe(true);
    const lib2 = withEntry(library, 'ethane', { smiles: 'cc' });
    expect(validateContent(lib2, roster, reagents).some((s) => /library:ethane: smiles must be Kekul/.test(s))).toBe(true);
    const lib3 = withEntry(library, 'ethane', (e) => ({ ...e, stereoBuildable: false }) as MoleculeEntry);
    expect(validateContent(lib3, roster, reagents)).toContain('library:ethane: obsolete field stereoBuildable');
  });

  it('reports wrong CIP labels (L3) and a wrong meso flag (L4)', () => {
    const lib = withEntry(library, 'r-2-bromobutane', { labels: { '2': 'S' } });
    expect(validateContent(lib, roster, reagents).some((s) => s.startsWith('library:r-2-bromobutane: label 2:S'))).toBe(true);
    const lib2 = withEntry(library, '2r-3r-dibromobutane', { meso: true });
    expect(validateContent(lib2, roster, reagents).some((s) => s.startsWith('library:2r-3r-dibromobutane: meso flag true'))).toBe(true);
  });

  it('reports a duplicate molecule (L5) and an odd ring (L6)', () => {
    const lib: MoleculeLibrary = { version: 1, entries: [...library.entries, { ...entryById('ethanol')!, id: 'ethanol-again', smiles: 'OCC' }] };
    expect(validateContent(lib, roster, reagents)).toContain("library:ethanol-again: same molecule as ethanol under stereo:'absolute'");
    const lib2: MoleculeLibrary = { version: 1, entries: [...library.entries, { ...entryById('ethane')!, id: 'cyclopropane', smiles: 'C1CC1', formula: 'C3H6' }] };
    expect(validateContent(lib2, roster, reagents)).toContain('library:cyclopropane: odd ring of size 3');
  });

  it('reports a bad layout (L8)', () => {
    const lib = withEntry(library, 'e-but-2-ene', { layout: [[0, 1, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]] });
    const p = validateContent(lib, roster, reagents);
    expect(p.some((s) => s.startsWith('library:e-but-2-ene: layout does not realise the entry stereo'))).toBe(true);
    const lib2 = withEntry(library, 'e-but-2-ene', { layout: [[0, 1, 0], [0, 0, 0], [1, 0, 0]] });
    expect(validateContent(lib2, roster, reagents)).toContain('library:e-but-2-ene: layout has 3 cells for 4 heavy atoms');
    const lib3 = withEntry(library, 'e-but-2-ene', { layout: [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -2, 0]] });
    expect(validateContent(lib3, roster, reagents)).toContain('library:e-but-2-ene: layout: bonded atoms 3 and 4 are not face-adjacent');
  });

  it('mcmurrySpelling converts infix locants', () => {
    expect(mcmurrySpelling('2-methylbut-2-ene')).toBe('2-methyl-2-butene');
    expect(mcmurrySpelling('but-2-ene')).toBe('2-butene');
    expect(mcmurrySpelling('hexa-2,4-diene')).toBe('2,4-hexadiene');
    expect(mcmurrySpelling('methylcyclohexane')).toBeNull();
    expect(mcmurrySpelling('2,2,4-trimethylpentane')).toBeNull();
    expect(mcmurrySpelling('2-bromo-5-methylhexane')).toBeNull();
  });
});
