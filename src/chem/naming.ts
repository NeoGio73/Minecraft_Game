/**
 * Library naming: a WL-hash index over molecule entries with isomorphism
 * confirmation, and `nameOf(g)` for the molecule panel.
 * PURE MODULE. See docs/design/02-chemistry-core.md section 14.
 *
 * The index is built from whatever `NameSource` list the caller passes
 * (`MoleculeEntry` satisfies it); this module never imports
 * `molecules.json`. `library.ts` (WP-05) calls `registerNameIndex` once at
 * load so `nameOf` / `analyze` can run without an explicit index.
 *
 * Lookup: hash filter (constitution + charge, no stereo) -> `isIsomorphic`
 * confirmation -> for a world graph, `sameMolecule(..., {stereo:'absolute'})`
 * against every stereo-defined candidate (first SAME by id wins) -> else the
 * name of the first stereo-free candidate -> else the base name of the first
 * candidate. So (R)-butan-2-ol built as R names "(R)-butan-2-ol"; built as S
 * or flat it names "butan-2-ol".
 */
import { hasPositions } from './types';
import type { ChemApi, MoleculeGraph } from './types';
import { parseSmiles } from './smiles';
import { implicitHydrogens } from './hydrogens';
import { perceiveAromaticity } from './aromatic';
import { wlHash } from './wlhash';
import { isIsomorphic } from './isomorphism';
import { sameMolecule } from './compare';

/** The fields of a library entry the index needs (`MoleculeEntry` satisfies it). */
export interface NameSource {
  readonly id: string;
  readonly name: string;
  readonly smiles: string;
}

export interface NameEntry {
  readonly id: string;
  readonly name: string;
  /** `name` with one leading stereo descriptor removed (`baseNameOf`). */
  readonly baseName: string;
  /** Perceived graph of the entry SMILES (Kekulé orders, aromatic flags recomputed, tags kept). */
  readonly graph: MoleculeGraph;
  readonly hydrogens: readonly number[];
  /** Some atom carries `tet` or some bond carries `ez`. */
  readonly hasStereo: boolean;
}

export interface NameIndex {
  /** Entries bucketed by WL hash, each bucket in ascending `id` order. */
  readonly byHash: ReadonlyMap<string, readonly NameEntry[]>;
  /** Number of entries indexed. */
  readonly size: number;
}

/**
 * One leading stereo descriptor: `(R)-`, `(2R,3S)-`, `(E)-`, `(2E,4E)-`,
 * `(+)-`, `(±)-`, `(meso)-`, `(rac)-`, `(rel)-`, `meso-`, `cis-`, `trans-`,
 * `rac-`, `erythro-`, `threo-` (case-insensitive).
 */
const STEREO_PREFIX = /^(?:\((?:\d*[RSEZ]|[+\-±]|meso|rac|rel)(?:,\s*(?:\d*[RSEZ]|[+\-±]))*\)|meso|cis|trans|rac|erythro|threo)-/i;

/** `(R)-butan-2-ol` -> `butan-2-ol`, `cis-1,2-dimethylcyclohexane` -> `1,2-dimethylcyclohexane`, `butane` -> `butane`. */
export function baseNameOf(name: string): string {
  return name.replace(STEREO_PREFIX, '');
}

function compareIds(a: NameSource, b: NameSource): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Parses every entry (ascending `id`), perceives aromaticity, hashes it and
 * buckets it by hash. A `SmilesError` propagates to the caller (the library
 * test reports it with the entry id).
 */
export function buildNameIndex(entries: readonly NameSource[]): NameIndex {
  const byHash = new Map<string, NameEntry[]>();
  const sorted = [...entries].sort(compareIds);
  let size = 0;
  for (const source of sorted) {
    const parsed = parseSmiles(source.smiles);
    const hydrogens = implicitHydrogens(parsed.graph).hydrogens;
    const graph = perceiveAromaticity(parsed.graph);
    const hash = wlHash(graph, hydrogens).hash;
    const hasStereo = graph.atoms.some((a) => a.tet !== undefined) || graph.bonds.some((b) => b.ez !== undefined);
    const entry: NameEntry = {
      id: source.id,
      name: source.name,
      baseName: baseNameOf(source.name),
      graph,
      hydrogens,
      hasStereo,
    };
    const bucket = byHash.get(hash);
    if (bucket) bucket.push(entry);
    else byHash.set(hash, [entry]);
    size++;
  }
  return { byHash, size };
}

let registered: NameIndex | null = null;

/** library.ts calls this once at load; `nameOf` uses the registered index when none is passed. */
export function registerNameIndex(index: NameIndex | null): void {
  registered = index;
}

/** The index last passed to `registerNameIndex`, or null. */
export function registeredNameIndex(): NameIndex | null {
  return registered;
}

/**
 * Library name of `g`, or null when no index is available or no entry has
 * the same constitution and charge. Stereo is honoured only when `g` has
 * lattice positions (a world graph): a stereo-defined entry is named only
 * when the build is `SAME` under `stereo: 'absolute'`; otherwise the first
 * stereo-free entry's name, or the base name of the first candidate.
 */
export function nameOf(g: MoleculeGraph, index: NameIndex | null = registered): string | null {
  if (index === null || g.atoms.length === 0) return null;
  const hydrogens = implicitHydrogens(g).hydrogens;
  const gp = perceiveAromaticity(g);
  const hash = wlHash(gp, hydrogens).hash;
  const cands = (index.byHash.get(hash) ?? []).filter((e) => isIsomorphic(e.graph, gp));
  if (cands.length === 0) return null;
  if (hasPositions(g)) {
    for (const e of cands) {
      if (!e.hasStereo) continue;
      if (sameMolecule(g, e.graph, { stereo: 'absolute' }).verdict === 'SAME') return e.name;
    }
  }
  const flat = cands.find((e) => !e.hasStereo);
  if (flat) return flat.name;
  return cands[0]!.baseName;
}

const _check: Pick<ChemApi, 'nameOf'> = { nameOf };
void _check;
