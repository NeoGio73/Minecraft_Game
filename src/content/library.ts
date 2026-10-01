/**
 * Molecule library loader: `loadLibrary`, `entryById`, `entryBySmiles`,
 * `parseEntry` (memoised), `layoutOf`. PURE MODULE.
 * See docs/design/05-content.md sections 1, 5 and 10; 09-amendment-no-bond.md section 1.9.
 *
 * `loadLibrary()` parses `molecules.json` once, builds the id / SMILES maps
 * and registers the panel name index (`registerNameIndex(buildNameIndex(entries))`)
 * so `analyze(...).name` resolves. The other exports load the library on
 * demand, so no caller has to remember to call `loadLibrary()` first.
 */
import moleculesJson from './molecules.json';
import type { MoleculeEntry, MoleculeLibrary } from './types';
import type { MoleculeGraph, Vec3, Warning } from '../chem/types';
import { parseSmiles } from '../chem/smiles';
import { implicitHydrogens } from '../chem/hydrogens';
import { perceiveAromaticity } from '../chem/aromatic';
import { bondBetween } from '../chem/graph';
import { embedOnLattice } from '../chem/embed';
import type { LatticeEmbedding } from '../chem/embed';
import { buildNameIndex, registerNameIndex, registeredNameIndex } from '../chem/naming';
import type { NameIndex } from '../chem/naming';

export interface ParsedEntry {
  /** Perceived graph (Kekulé orders, aromatic flags recomputed, stereo tags kept). */
  readonly graph: MoleculeGraph;
  readonly hydrogens: readonly number[];
  readonly warnings: readonly Warning[];
}

interface Loaded {
  readonly library: MoleculeLibrary;
  readonly byId: ReadonlyMap<string, MoleculeEntry>;
  readonly bySmiles: ReadonlyMap<string, MoleculeEntry>;
  readonly index: NameIndex;
}

let loaded: Loaded | null = null;
const parsed = new Map<string, ParsedEntry>();
const layouts = new Map<string, LatticeEmbedding | null>();

function load(): Loaded {
  if (loaded) {
    if (registeredNameIndex() === null) registerNameIndex(loaded.index);
    return loaded;
  }
  const library = moleculesJson as unknown as MoleculeLibrary;
  const byId = new Map<string, MoleculeEntry>();
  const bySmiles = new Map<string, MoleculeEntry>();
  for (const e of library.entries) {
    byId.set(e.id, e);
    bySmiles.set(e.smiles, e);
  }
  const index = buildNameIndex(library.entries);
  loaded = { library, byId, bySmiles, index };
  registerNameIndex(index);
  return loaded;
}

/** The shipped library; registers the name index on first call. */
export function loadLibrary(): MoleculeLibrary {
  return load().library;
}

export function entryById(id: string): MoleculeEntry | undefined {
  return load().byId.get(id);
}

/** Exact-string lookup on `MoleculeEntry.smiles` (rules reference library molecules by their SMILES). */
export function entryBySmiles(smiles: string): MoleculeEntry | undefined {
  return load().bySmiles.get(smiles);
}

function smilesOf(entry: MoleculeEntry | string): string {
  return typeof entry === 'string' ? entry : entry.smiles;
}

/** parseSmiles + implicitHydrogens + perceiveAromaticity, memoised by SMILES string (graph, hydrogens and warnings). */
export function parseEntryDetailed(entry: MoleculeEntry | string): ParsedEntry {
  const smiles = smilesOf(entry);
  const hit = parsed.get(smiles);
  if (hit) return hit;
  const g = parseSmiles(smiles).graph;
  const { hydrogens, warnings } = implicitHydrogens(g);
  const graph = perceiveAromaticity(g);
  const rec: ParsedEntry = { graph, hydrogens, warnings };
  parsed.set(smiles, rec);
  return rec;
}

/** The perceived graph of an entry (or any SMILES), memoised by SMILES string. */
export function parseEntry(entry: MoleculeEntry | string): MoleculeGraph {
  return parseEntryDetailed(entry).graph;
}

function faceAdjacent(a: Vec3, b: Vec3): boolean {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) === 1;
}

/**
 * Face-adjacent unbonded heavy pairs `[a, b]` (a < b, sorted lexicographically)
 * of any position list `pos[atomId]` (09 §1.8; declared here because
 * src/chem/embed.ts does not export it yet).
 */
export function suppressedPairsOf(g: MoleculeGraph, pos: readonly Vec3[]): (readonly [number, number])[] {
  const out: [number, number][] = [];
  const n = Math.min(g.atoms.length, pos.length);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (!faceAdjacent(pos[a]!, pos[b]!)) continue;
      if (bondBetween(g, a, b) !== undefined) continue;
      out.push([a, b]);
    }
  }
  out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return out;
}

/**
 * `entry.layout` when present (pos = layout, hPos empty, suppressedPairs from
 * `suppressedPairsOf`), else `embedOnLattice(parseEntry(entry))` (memoised by
 * id). `null` only for odd rings (09 §1.9).
 */
export function layoutOf(entry: MoleculeEntry): LatticeEmbedding | null {
  const g = parseEntry(entry);
  if (entry.layout && entry.layout.length === g.atoms.length) {
    const pos: Vec3[] = entry.layout.map((p) => [p[0], p[1], p[2]] as const);
    return { pos, hPos: new Map(), nodesVisited: 0, suppressedPairs: suppressedPairsOf(g, pos) };
  }
  const key = `${entry.id}|${entry.smiles}`;
  if (layouts.has(key)) return layouts.get(key) ?? null;
  const e = embedOnLattice(g);
  layouts.set(key, e);
  return e;
}
