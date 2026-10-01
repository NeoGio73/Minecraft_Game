/**
 * Molecule comparison: `sameMolecule(student, target, { stereo })` and
 * `normalize(g)`. PURE MODULE. See 00-contracts §1 (StereoPolicy /
 * CompareVerdict / CompareResult), 01 (WP-02 notes) and 03 §6.3.
 *
 * Pipeline: normalize both graphs (Kekulé -> hydrogens -> aromaticity
 * perception, so both Kekulé forms of an arene compare equal) -> quick reject
 * on the Hill formula with net charge (DIFFERENT_FORMULA) -> WL hash reject
 * (DIFFERENT_CONSTITUTION; WL is an isomorphism invariant, so a hash mismatch
 * is a sound reject) -> `findIsomorphismsDetailed` (no mapping ->
 * DIFFERENT_CONSTITUTION) -> policy 'none' stops at SAME; otherwise
 * `compareStereo` per mapping and the best verdict wins
 * (SAME > ENANTIOMER > DIASTEREOMER > UNSPECIFIED > INVALID_GEOMETRY).
 *
 * Charges are compared in every policy (atom labels carry the charge).
 * Target stereo comes from its `tet` / `ez` tags; a target that is itself a
 * world graph without tags (comparing two builds) is tagged from its
 * positions first. The isomorphism-cap condition is reported through the
 * `warnings` field of `CompareResultExt` (02 §10 step 5).
 */
import { hasPositions } from './types';
import type { Atom, ChemApi, CompareResult, CompareVerdict, MoleculeGraph, StereoPolicy, Warning } from './types';
import { buildGraph } from './graph';
import { kekulize } from './kekulize';
import { implicitHydrogens } from './hydrogens';
import { perceiveAromaticity } from './aromatic';
import { hillFormula } from './formula';
import { wlHash } from './wlhash';
import { DEFAULT_MAX_STATES, findIsomorphismsDetailed } from './isomorphism';
import { compareStereo } from './stereo-compare';
import { tagsFromPositions } from './stereo';

/** `sameMolecule` result plus the warnings the comparison raised (isomorphism cap). */
export interface CompareResultExt extends CompareResult {
  readonly warnings: readonly Warning[];
}

export interface Normalized<A extends Atom = Atom> {
  /** Kekulé orders, aromaticity flags recomputed by `perceiveAromaticity`; positions and tags kept. */
  readonly graph: MoleculeGraph<A>;
  /** Total hydrogens per atom (from `implicitHydrogens` on the Kekulé graph). */
  readonly hydrogens: readonly number[];
  /** Valence warnings from `implicitHydrogens`. */
  readonly warnings: readonly Warning[];
}

/**
 * Kekulé -> H -> perceive. A graph with aromatic bonds whose orders do not
 * form a Kekulé structure is re-kekulized; one that cannot be kekulized is
 * used as given (comparison never throws for chemistry reasons).
 */
export function normalize<A extends Atom>(g: MoleculeGraph<A>): Normalized<A> {
  let k: MoleculeGraph<A> = g;
  if (g.bonds.some((b) => b.aromatic)) {
    try {
      // kekulize keeps the atom objects (buildGraph(g.atoms, bonds)), so the atom type is preserved
      k = kekulize(g) as MoleculeGraph<A>;
    } catch {
      k = g;
    }
  }
  const { hydrogens, warnings } = implicitHydrogens(k);
  return { graph: perceiveAromaticity(k), hydrogens, warnings };
}

const VERDICT_RANK: Readonly<Record<CompareVerdict, number>> = {
  SAME: 0, ENANTIOMER: 1, DIASTEREOMER: 2, UNSPECIFIED: 3, INVALID_GEOMETRY: 4,
  DIFFERENT_CONSTITUTION: 5, DIFFERENT_FORMULA: 6,
};

function hasTags(g: MoleculeGraph): boolean {
  return g.atoms.some((a) => a.tet !== undefined) || g.bonds.some((b) => b.ez !== undefined);
}

/** Same constitution with every `tet` removed; `ez` tags kept (policy 'ez'). */
function withoutTet(g: MoleculeGraph): MoleculeGraph {
  if (!g.atoms.some((a) => a.tet !== undefined)) return g;
  const atoms: Atom[] = g.atoms.map((a) => {
    if (!a.tet) return a;
    const { tet: _old, ...rest } = a;
    void _old;
    return rest;
  });
  return buildGraph(atoms, g.bonds);
}

function satisfies(policy: StereoPolicy, verdict: CompareVerdict): boolean {
  switch (policy) {
    case 'none':
      return verdict === 'SAME' || verdict === 'ENANTIOMER' || verdict === 'DIASTEREOMER' || verdict === 'UNSPECIFIED' || verdict === 'INVALID_GEOMETRY';
    case 'relative':
      return verdict === 'SAME' || verdict === 'ENANTIOMER';
    case 'absolute':
    case 'ez':
      return verdict === 'SAME';
  }
}

/**
 * Compares the student's molecule with the target under a stereo policy
 * (00-contracts §1 StereoPolicy / CompareResult; 03 §6.3). Never throws for
 * chemistry reasons.
 */
export function sameMolecule(student: MoleculeGraph, target: MoleculeGraph, opts?: { stereo?: StereoPolicy }): CompareResultExt {
  const policy: StereoPolicy = opts?.stereo ?? 'none';
  const S = normalize(student);
  const T = normalize(target);
  if (hillFormula(S.graph, S.hydrogens) !== hillFormula(T.graph, T.hydrogens)) {
    return { same: false, verdict: 'DIFFERENT_FORMULA', warnings: [] };
  }
  if (wlHash(S.graph, S.hydrogens).hash !== wlHash(T.graph, T.hydrogens).hash) {
    return { same: false, verdict: 'DIFFERENT_CONSTITUTION', warnings: [] };
  }
  const search = findIsomorphismsDetailed(T.graph, S.graph, DEFAULT_MAX_STATES);
  const warnings: Warning[] = search.capped ? [{ kind: 'isomorphism-cap', states: search.states }] : [];
  const first = search.mappings[0];
  if (first === undefined) return { same: false, verdict: 'DIFFERENT_CONSTITUTION', warnings };
  if (policy === 'none') return { same: true, verdict: 'SAME', mapping: first, warnings };

  let tgt: MoleculeGraph = T.graph;
  if (!hasTags(tgt) && hasPositions(tgt)) tgt = tagsFromPositions(tgt, T.hydrogens);
  if (policy === 'ez') tgt = withoutTet(tgt);
  if (!hasTags(tgt)) return { same: true, verdict: 'SAME', mapping: first, warnings };

  let bestMapping = first;
  let best = compareStereo(tgt, S.graph, first);
  for (let i = 1; i < search.mappings.length && best.verdict !== 'SAME'; i++) {
    const m = search.mappings[i]!;
    const r = compareStereo(tgt, S.graph, m);
    if (VERDICT_RANK[r.verdict] < VERDICT_RANK[best.verdict]) {
      best = r;
      bestMapping = m;
    }
  }
  return {
    same: satisfies(policy, best.verdict),
    verdict: best.verdict,
    mapping: bestMapping,
    differingCenters: best.differingCenters,
    differingBonds: best.differingBonds,
    ...(best.offending?.atom !== undefined ? { offendingAtom: best.offending.atom } : {}),
    ...(best.offending?.bond !== undefined ? { offendingBond: best.offending.bond } : {}),
    warnings,
  };
}

const _check: Pick<ChemApi, 'sameMolecule'> = { sameMolecule };
void _check;
