/**
 * OrgoCraft shared chemistry contracts.
 *
 * PURE MODULE: imports nothing from `three` or the DOM. Every module under
 * src/chem, src/reactions, src/content and src/world (data only) codes
 * against these types. See docs/design/00-contracts.md for invariants.
 */
import type { ReagentCard, ReagentId } from '../content/types';

// ---------------------------------------------------------------------------
// Elements, charges, bond orders, vectors
// ---------------------------------------------------------------------------

/** Elements the parser and the world know. H is a block only when the player
 *  places it explicitly (stereo centers); P is parser-only in v1. */
export type Element = 'H' | 'C' | 'N' | 'O' | 'F' | 'Cl' | 'Br' | 'I' | 'S' | 'P';

export const ELEMENTS: readonly Element[] = ['H', 'C', 'N', 'O', 'F', 'Cl', 'Br', 'I', 'S', 'P'];

export const ATOMIC_NUMBER: Readonly<Record<Element, number>> = {
  H: 1, C: 6, N: 7, O: 8, F: 9, P: 15, S: 16, Cl: 17, Br: 35, I: 53,
};

/** Valence electrons of the free atom (McMurry 2.3 formal-charge formula). */
export const VALENCE_ELECTRONS: Readonly<Record<Element, number>> = {
  H: 1, C: 4, N: 5, O: 6, S: 6, P: 5, F: 7, Cl: 7, Br: 7, I: 7,
};

export type Charge = -1 | 0 | 1;

/**
 * Target valence = total bond order including implicit H, by element and
 * charge. `undefined` = the combination is unsupported and the charge tool
 * refuses it. Source: acids-bases-hybrid.md section 2.2 (McMurry Table 2.3).
 */
export const TARGET_VALENCE: Readonly<Record<Element, Readonly<Partial<Record<Charge, number>>>>> = {
  H:  { 0: 1 },
  C:  { [-1]: 3, 0: 4, 1: 3 },
  N:  { [-1]: 2, 0: 3, 1: 4 },
  O:  { [-1]: 1, 0: 2, 1: 3 },
  S:  { [-1]: 1, 0: 2, 1: 3 },
  P:  { 0: 3, 1: 4 },
  F:  { [-1]: 0, 0: 1 },
  Cl: { [-1]: 0, 0: 1 },
  Br: { [-1]: 0, 0: 1 },
  I:  { [-1]: 0, 0: 1 },
};

export type BondOrder = 1 | 2 | 3;

/** Integer lattice coordinates (world graphs) or any real triple (embeddings). */
export type Vec3 = readonly [number, number, number];

// ---------------------------------------------------------------------------
// Atoms and bonds
// ---------------------------------------------------------------------------

/** Tetrahedral stereo tag on a TARGET atom (from SMILES @/@@ or produced by the
 *  reaction engine). `order` lists the four neighbours in the reference order
 *  ('H' = the implicit hydrogen); `sign` = sign of the signed volume
 *  V = ((p1-p0) x (p2-p0)) . (p3-p0) in any right-handed 3-D realisation.
 *  SMILES '@@' => sign +1, '@' => sign -1. Swapping two entries flips sign. */
export interface TetTag {
  readonly order: readonly (number | 'H')[];
  readonly sign: 1 | -1;
}

/** Double-bond geometry tag on a TARGET bond. `refA` is a neighbour of bond.a,
 *  `refB` a neighbour of bond.b ('H' allowed); `cis` = they lie on the same
 *  side of the C=C axis. */
export interface EzTag {
  readonly refA: number | 'H';
  readonly refB: number | 'H';
  readonly cis: boolean;
}

export interface Atom {
  /** Index in MoleculeGraph.atoms. Stable for the lifetime of the graph. */
  readonly id: number;
  readonly el: Element;
  /** Formal charge set by the charge tool or a SMILES bracket. Always compared
   *  by sameMolecule. */
  readonly charge: Charge;
  /**
   * SMILES-derived graphs: total H count from a bracket atom ([nH], [CH2]),
   * or null = compute from valence. World-derived graphs: ALWAYS null; explicit
   * H blocks are collapsed into `hPos` by extractMolecules and count toward the
   * valence sum exactly like implicit H, so the total H count is unchanged.
   */
  readonly explicitH: number | null;
  /** Set by aromaticity perception (6-ring rule); v1 content never needs it
   *  but the comparator honours it so Kekule forms hash identically. */
  readonly aromatic: boolean;
  /** Present only on target graphs that carry tetrahedral stereo. */
  readonly tet?: TetTag;
  /** Present on world-derived graphs only (see WorldAtom). */
  readonly pos?: Vec3;
  readonly hPos?: readonly Vec3[];
}

/** An atom extracted from the voxel grid: it has a lattice position and the
 *  positions of any explicit H blocks that were collapsed into it. */
export interface WorldAtom extends Atom {
  readonly pos: Vec3;
  readonly hPos: readonly Vec3[];
  readonly explicitH: null;
}

export interface Bond {
  /** Atom ids with a < b. */
  readonly a: number;
  readonly b: number;
  /** Kekule order. Kept even when `aromatic` is true. */
  readonly order: BondOrder;
  readonly aromatic: boolean;
  /** Edge-adjacent (sqrt 2) bond. Reserved: no v1 content sets it; the world
   *  never creates it; every algorithm must tolerate it. */
  readonly diagonal?: boolean;
  /** Present only on target graphs whose C=C geometry must be checked. */
  readonly ez?: EzTag;
}

export interface MoleculeGraph<A extends Atom = Atom> {
  readonly atoms: readonly A[];
  readonly bonds: readonly Bond[];
  /** adj[atomId] = indices into `bonds` (both endpoints list the bond). */
  readonly adj: readonly (readonly number[])[];
}

export type WorldGraph = MoleculeGraph<WorldAtom>;

/** Type guard: every atom has a lattice position. */
export function hasPositions(g: MoleculeGraph): g is WorldGraph {
  return g.atoms.every((a) => a.pos !== undefined && a.hPos !== undefined);
}

// ---------------------------------------------------------------------------
// Warnings (closed union)
// ---------------------------------------------------------------------------

export type Warning =
  | { readonly kind: 'over-valence'; readonly atom: number; readonly have: number; readonly max: number }
  | { readonly kind: 'h-block-valence'; readonly atom: number; readonly bonds: number }
  | { readonly kind: 'charge-unsupported'; readonly atom: number; readonly charge: Charge }
  | { readonly kind: 'planar-center'; readonly atom: number; readonly shape: 'T' | 'square-planar' }
  | { readonly kind: 'alkene-geometry'; readonly bond: number; readonly label: 'COLLINEAR' | 'NOT_PLANAR' | 'TWISTED' }
  | { readonly kind: 'cage'; readonly atom: number; readonly ringAtoms: readonly number[] }
  | { readonly kind: 'isomorphism-cap'; readonly states: number }
  | { readonly kind: 'unverified-pka'; readonly classId: string };

export type WarningKind = Warning['kind'];

// ---------------------------------------------------------------------------
// Functional groups (McMurry Table 3.1 + fallback + ions)
// ---------------------------------------------------------------------------

/**
 * Group ids in DETECTION ORDER. Earlier rules claim atoms; a later rule that
 * touches a claimed atom is skipped. 'alkane'/'cycloalkane' fire only when no
 * other group fires. Ion groups fire on charged atoms after the neutral rules.
 */
export const GROUP_IDS = [
  'carboxylic-acid',
  'acid-anhydride',
  'ester',
  'thioester',
  'acyl-halide',
  'amide',
  'nitrile',
  'aldehyde',
  'ketone',
  'imine',
  'sulfoxide',
  'alcohol',
  'thiol',
  'disulfide',
  'ether',
  'sulfide',
  'amine',
  'halide',
  'arene',
  'alkyne',
  'alkene',
  'phosphate',
  'carboxylate',
  'alkoxide',
  'thiolate',
  'ammonium',
  'oxonium',
  'carbocation',
  'carbanion',
  'amide-ion',
  'acetylide',
  'alkane',
  'cycloalkane',
] as const;

export type GroupId = (typeof GROUP_IDS)[number];

/** Subtype refinements shown in the panel. */
export type GroupSubtype =
  | 'methanol' | 'primary' | 'secondary' | 'tertiary'   // alcohol, amine, alkyl halide
  | 'phenol' | 'enol'                                    // alcohol on sp2 C
  | 'aryl' | 'vinyl' | 'methyl'                          // halide, amine
  | 'formaldehyde' | 'formate'                           // aldehyde, ester
  | 'cumulated';                                         // allene alkene

export interface GroupHit {
  readonly group: GroupId;
  readonly subtype?: GroupSubtype;
  /** Atom ids claimed by this hit (heavy atoms only). */
  readonly atoms: readonly number[];
  /** Student-facing label, e.g. "alcohol (secondary)". */
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Per-atom info: hybridization, geometry, formal charge
// ---------------------------------------------------------------------------

export type Hybridization = 'sp3' | 'sp2' | 'sp' | 'none';

export type Geometry =
  | 'tetrahedral'
  | 'trigonal pyramidal'
  | 'bent'
  | 'trigonal planar'
  | 'linear'
  | 'terminal'
  | 'none';

export type IdealAngle = 109.5 | 120 | 180 | null;

export interface AtomInfo {
  readonly id: number;
  readonly el: Element;
  readonly charge: Charge;
  /** Heavy-atom neighbour ids. */
  readonly neighbors: readonly number[];
  /** Sum of bond orders over heavy bonds. */
  readonly heavyBondOrderSum: number;
  /** Total hydrogens (implicit + collapsed explicit blocks). */
  readonly hydrogens: number;
  /** sigma = neighbors.length + hydrogens. */
  readonly sigma: number;
  /** pi = sum(order - 1) over heavy bonds. */
  readonly pi: number;
  /** lonePairs(el, charge) = (V - charge - targetValence) / 2. */
  readonly lonePairs: number;
  /** sigma + lonePairs, minus 1 when conjugatedLonePair. */
  readonly stericNumber: number;
  readonly conjugatedLonePair: boolean;
  readonly hybridization: Hybridization;
  readonly geometry: Geometry;
  readonly idealAngle: IdealAngle;
  readonly observedAngleNote?: string;
  /** V - (2*lonePairs + heavyBondOrderSum + hydrogens). Equals `charge` by
   *  construction; exposed for the formal-charge quiz and as a consistency check. */
  readonly formalCharge: number;
  /** Set when heavyBondOrderSum > targetValence(el, charge). */
  readonly valenceError?: string;
}

// ---------------------------------------------------------------------------
// Stereochemistry (stereo-on-grid.md 1.5, 3.1, 7)
// ---------------------------------------------------------------------------

export type CenterLabel = 'R' | 'S' | 'UNSPECIFIED' | 'NOT_CENTER' | 'CANNOT_ASSIGN';

/** Shape of the explicit substituent set on the octahedral grid. */
export type CenterShape = 'octant' | 'T' | 'seesaw' | 'square-planar';

export interface StereoCenter {
  readonly atom: number;
  readonly label: CenterLabel;
  /** null when NOT_CENTER / CANNOT_ASSIGN or when the graph has no positions. */
  readonly shape: CenterShape | null;
  /** Neighbour ids best-first ('H' = implicit hydrogen); absent on NOT_CENTER. */
  readonly priorities?: readonly (number | 'H')[];
  readonly reason?: string;
  /** Student-facing fix instruction (stereo-on-grid.md 1.5 messages). */
  readonly hint?: string;
  /** For 'T' centers: the two free cells where an explicit H would define it. */
  readonly suggestedHPositions?: readonly Vec3[];
}

export type BondLabel = 'E' | 'Z' | 'NO_EZ' | 'RING' | 'COLLINEAR' | 'NOT_PLANAR' | 'TWISTED';

export interface DoubleBondStereo {
  /** Index into MoleculeGraph.bonds. */
  readonly bond: number;
  readonly a: number;
  readonly b: number;
  readonly label: BondLabel;
  /** Higher-priority substituent on each end (when ranking succeeded). */
  readonly higherA?: number | 'H';
  readonly higherB?: number | 'H';
  /** Chain-continuation relation, reported alongside E/Z ("E (trans)"). */
  readonly cisTrans?: 'cis' | 'trans';
  readonly hint?: string;
}

export interface RingFace {
  readonly ring: readonly number[];
  readonly normal: Vec3;
  readonly subs: readonly { readonly atom: number; readonly ringAtom: number; readonly face: 1 | -1 | 0 }[];
}

export interface StereoAnalysis {
  readonly centers: readonly StereoCenter[];
  readonly doubleBonds: readonly DoubleBondStereo[];
  readonly ringFaces: readonly RingFace[];
  /** true when the molecule has >=1 center with label R/S and is not meso. */
  readonly chiral: boolean;
  readonly meso: boolean;
}

/** How much stereo a comparison enforces. */
export type StereoPolicy = 'none' | 'relative' | 'absolute' | 'ez';

export type CompareVerdict =
  | 'SAME'
  | 'ENANTIOMER'
  | 'DIASTEREOMER'
  | 'UNSPECIFIED'
  | 'INVALID_GEOMETRY'
  | 'DIFFERENT_CONSTITUTION'
  | 'DIFFERENT_FORMULA';

export interface CompareResult {
  /** true iff the verdict satisfies the policy (see 00-contracts.md). */
  readonly same: boolean;
  readonly verdict: CompareVerdict;
  /** mapping[targetAtomId] = studentAtomId for the best isomorphism found. */
  readonly mapping?: readonly number[];
  /** Atoms/bonds (target ids) that disagree under the best mapping. */
  readonly differingCenters?: readonly number[];
  readonly differingBonds?: readonly number[];
  /** Student atom that is UNSPECIFIED / bond with INVALID_GEOMETRY. */
  readonly offendingAtom?: number;
  readonly offendingBond?: number;
  /** The isomorphism-cap condition (02 §10 step 5) and nothing else; absent when no warning arose. */
  readonly warnings?: readonly Warning[];
}

// ---------------------------------------------------------------------------
// Acidity (acids-bases-hybrid.md section 5)
// ---------------------------------------------------------------------------

export interface HydrogenSite {
  /** Heavy atom carrying the H. */
  readonly parentId: number;
  /** 0..n-1 among the hydrogens of parentId (explicit blocks first, in hPos order). */
  readonly slot: number;
  /** Lattice cell of an explicit H block, when the H is one. */
  readonly explicitPos?: Vec3;
  readonly pKa: number;
  /** e.g. 'OH.carboxylic', 'CH.alpha', 'NH.ammonium'. */
  readonly classId: string;
  /** classId + '|' + sorted modifiers; identical key <=> identical pKa. */
  readonly classKey: string;
  /** "O-H of a carboxylic acid" */
  readonly label: string;
  /** Citation string, e.g. "MM 2.8 T2.3 (m00025)". */
  readonly source: string;
  /** false when the constant is a general-textbook value not in McMurry. */
  readonly verified: boolean;
}

export interface BasicSite {
  readonly atomId: number;
  /** pKa of the conjugate acid. */
  readonly pKaH: number;
  readonly classId: string;
  readonly classKey: string;
  readonly label: string;
  readonly source: string;
  readonly verified: boolean;
}

export interface AcidityAnalysis {
  readonly hydrogens: readonly HydrogenSite[];
  readonly basicSites: readonly BasicSite[];
  /** Hydrogen sites within PKA_TIE of the minimum pKa. */
  readonly mostAcidic: readonly HydrogenSite[];
  readonly mostBasic: readonly BasicSite[];
}

/** Ties within this many pKa units are equivalent answers. */
export const PKA_TIE = 0.05;
/** A select-H challenge is valid only if the runner-up class is this far above the answer. */
export const PKA_MIN_MARGIN = 3;

// ---------------------------------------------------------------------------
// Analysis (everything the molecule panel shows)
// ---------------------------------------------------------------------------

export interface Analysis {
  /** Hill formula, plain digits, e.g. "C9H8O4"; charged: "C2H3O2-" / "CH5N+" . */
  readonly formula: string;
  readonly counts: Readonly<Record<Element, number>>;
  /** Total hydrogens per atom id (implicit + collapsed explicit blocks). */
  readonly hydrogens: readonly number[];
  readonly netCharge: number;
  /** Degrees of unsaturation (2C + 2 + N - H - X) / 2. */
  readonly dou: number;
  /** bonds - atoms + components. */
  readonly ringCount: number;
  readonly components: number;
  readonly groups: readonly GroupHit[];
  readonly warnings: readonly Warning[];
  /** Library name or null ("Unnamed"). */
  readonly name: string | null;
  /** FNV-1a 64-bit hex of the WL refinement (constitution + charge, no stereo). */
  readonly hash: string;
  readonly atoms: readonly AtomInfo[];
  /** Present only for world graphs (positions available). */
  readonly stereo: StereoAnalysis | null;
  readonly acidity: AcidityAnalysis;
}

// ---------------------------------------------------------------------------
// Reactions (reaction-bench.md section 0)
// ---------------------------------------------------------------------------

export type Mechanism =
  | 'SN1' | 'SN2' | 'E1' | 'E2'
  | 'addition' | 'oxidation' | 'reduction' | 'radical' | 'none';

export type ReactionStereo = 'none' | 'racemic' | 'relative' | 'absolute';

export interface ReactOptions {
  readonly equiv?: 1 | 2;
  /** Alkyl halide for acetylide alkylation (NANH2_THEN_RX). */
  readonly rx?: MoleculeGraph;
  readonly rearrangement?: 'warn' | 'apply' | 'ignore';
}

export interface ReactionResult {
  /** Every molecule the student must build. More than one only for cleavage
   *  fragments or genuine textbook mixtures (then `mixture` is true). */
  readonly major: readonly MoleculeGraph[];
  readonly minor?: readonly MoleculeGraph[];
  readonly mechanism: Mechanism;
  readonly stereo: ReactionStereo;
  /** Student-facing warnings (mixture, rearrangement, slow, ...). */
  readonly warnings: readonly string[];
  readonly noReaction?: boolean;
  /** One-line rule justification in McMurry's words for the HUD. */
  readonly justification: string;
  readonly mixture?: boolean;
  /** Reagent card that produced the result. */
  readonly reagentId: ReagentId;
}

// ---------------------------------------------------------------------------
// Lattice embedding (reaction-bench.md 4.2)
// ---------------------------------------------------------------------------

export interface EmbedOptions {
  readonly allowDiagonal?: boolean;
  /** Search nodes before giving up. Default EMBED_NODE_BUDGET. */
  readonly nodeBudget?: number;
  readonly origin?: Vec3;
  /** Allow touching, unbonded heavy-atom pairs (reported in `suppressedPairs`). Default true.
   *  false = induced embedding only (09 §1.8). */
  readonly allowSuppressed?: boolean;
}

export const EMBED_NODE_BUDGET = 50_000;

export interface Embedding {
  /** pos[atomId] for every heavy atom; explicit H at stereocenters are appended
   *  as extra entries in `hPos` keyed by parent id. */
  readonly pos: readonly Vec3[];
  readonly hPos: ReadonlyMap<number, readonly Vec3[]>;
  readonly nodesVisited: number;
  /** Heavy-atom id pairs [a, b], a < b, sorted lexicographically, that are face-adjacent in `pos`
   *  but not bonded in the graph: the pairs the student must set to "no bond" (09 §1.8).
   *  Empty for an induced embedding; H nodes never appear. */
  readonly suppressedPairs: readonly (readonly [number, number])[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedSmiles {
  readonly graph: MoleculeGraph;
  /** Bracket atoms with @/@@ produce `tet` on the atom; / and \ produce `ez` on
   *  the bond. These lists mirror them for tests. */
  readonly tetra: readonly { readonly atom: number; readonly order: readonly (number | 'H')[]; readonly sign: 1 | -1 }[];
  readonly dbl: readonly { readonly bond: number; readonly refA: number | 'H'; readonly refB: number | 'H'; readonly cis: boolean }[];
}

export class SmilesError extends Error {
  constructor(message: string, readonly smiles: string, readonly index: number) {
    super(message);
    this.name = 'SmilesError';
  }
}

// ---------------------------------------------------------------------------
// Public API of the chemistry modules (one implementer per module; see
// docs/design/01-work-packages.md for file ownership).
// ---------------------------------------------------------------------------

export interface CipRank {
  /** Neighbour ids best-first; 'H' entries are implicit hydrogens. */
  readonly ligands: readonly (number | 'H')[];
  /** true when two adjacent ligands are Rule-1a indistinguishable. */
  readonly tie: boolean;
  /** true when a tied ligand contains a stereo element (needs CIP rules 3-5). */
  readonly tieNeedsAdvancedRules: boolean;
}

export interface ChemApi {
  // src/chem/smiles.ts
  parseSmiles(smiles: string): ParsedSmiles;
  // src/chem/valence.ts
  targetValence(el: Element, charge: Charge): number | undefined;
  lonePairs(el: Element, charge: Charge): number;
  // src/chem/hydrogens.ts
  implicitHydrogens(g: MoleculeGraph): { hydrogens: number[]; warnings: Warning[] };
  // src/chem/formula.ts
  hillFormula(g: MoleculeGraph, hydrogens: readonly number[]): string;
  elementCounts(g: MoleculeGraph, hydrogens: readonly number[]): Record<Element, number>;
  degreesOfUnsaturation(counts: Readonly<Record<Element, number>>): number;
  ringCount(g: MoleculeGraph): number;
  // src/chem/aromatic.ts
  perceiveAromaticity(g: MoleculeGraph): MoleculeGraph;
  // src/chem/groups.ts
  functionalGroups(g: MoleculeGraph, hydrogens: readonly number[]): GroupHit[];
  // src/chem/wlhash.ts
  wlHash(g: MoleculeGraph, hydrogens: readonly number[]): { hash: string; classes: number[] };
  // src/chem/isomorphism.ts
  findIsomorphisms(target: MoleculeGraph, student: MoleculeGraph, maxStates?: number): number[][];
  // src/chem/compare.ts
  sameMolecule(student: MoleculeGraph, target: MoleculeGraph, opts?: { stereo?: StereoPolicy }): CompareResult;
  // src/chem/cip.ts
  cipRank(g: MoleculeGraph, hydrogens: readonly number[], center: number, exclude?: number): CipRank;
  // src/chem/stereo.ts
  assignRS(g: WorldGraph, hydrogens: readonly number[], center: number): StereoCenter;
  assignEZ(g: WorldGraph, hydrogens: readonly number[], bondIndex: number): DoubleBondStereo;
  analyzeStereo(g: WorldGraph, hydrogens: readonly number[]): StereoAnalysis;
  // src/chem/hybridization.ts
  atomInfo(g: MoleculeGraph, hydrogens: readonly number[]): AtomInfo[];
  hybridization(info: AtomInfo): Hybridization;
  // src/chem/charge.ts
  formalCharge(info: AtomInfo): number;
  canSetCharge(g: MoleculeGraph, atom: number, charge: Charge): { ok: true } | { ok: false; reason: string };
  // src/chem/acidity.ts
  hydrogenSites(g: MoleculeGraph, info: readonly AtomInfo[]): HydrogenSite[];
  basicSites(g: MoleculeGraph, info: readonly AtomInfo[]): BasicSite[];
  acidity(g: MoleculeGraph, info: readonly AtomInfo[]): AcidityAnalysis;
  predictAcidBase(acid: MoleculeGraph, base: MoleculeGraph): { pKaAcid: number; pKaConjugate: number; delta: number; favorsProducts: boolean; text: string };
  // src/chem/analyze.ts
  analyze(g: MoleculeGraph): Analysis;
  // src/chem/naming.ts
  nameOf(g: MoleculeGraph): string | null;
  // src/reactions/react.ts
  react(substrate: MoleculeGraph, card: ReagentCard, opts?: ReactOptions): ReactionResult;
  // src/chem/embed.ts
  embedOnLattice(g: MoleculeGraph, opts?: EmbedOptions): Embedding | null;
}
