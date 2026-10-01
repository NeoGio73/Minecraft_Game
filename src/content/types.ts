/**
 * OrgoCraft content contracts: reagent cards, challenges, molecule library,
 * scoring constants. PURE MODULE (no three, no DOM).
 *
 * SMILES strings in this file's types are always targets for the chemistry
 * core (parseSmiles); names are instruction text only.
 */
import type { Charge, Element, GroupId, Hybridization, MoleculeGraph, StereoPolicy } from '../chem/types';

// ---------------------------------------------------------------------------
// Reagent cards (reaction-bench.md section 1, reconciled with SCOPE.md)
// ---------------------------------------------------------------------------

export const REAGENT_IDS = [
  // ch 7-8 alkene additions
  'HX_HCL', 'HX_HBR', 'HX_HI', 'HX_2EQ_HBR', 'HX_2EQ_HCL', 'HBR_ROOR',
  'X2_BR2', 'X2_CL2', 'HOX_BR2_H2O', 'HOX_CL2_H2O',
  'H3O_HYDRATION', 'OXYMERC', 'HYDROBORATION', 'H2_PD',
  'MCPBA', 'EPOXIDE_H3O', 'ANTI_DIHYDROXYLATION', 'OSO4', 'KMNO4_COLD',
  'O3_ZN', 'KMNO4_HOT', 'HIO4', 'CH2I2_ZNCU', 'CHCL3_KOH',
  // ch 9 alkynes
  'HGSO4_HYDRATION', 'HYDROBORATION_ALKYNE', 'H2_LINDLAR', 'LI_NH3',
  'NANH2_THEN_RX', 'NANH2_2EQ_DIHALIDE',
  // ch 10 organohalides
  'NBS_HV', 'CL2_HV', 'BR2_HV', 'ROH_HX_HCL', 'ROH_HX_HBR', 'ROH_SOCL2', 'ROH_PBR3', 'ROH_HF_PYR',
  // ch 11 substitution / elimination
  'SN2_NAOH', 'SN2_NAOCH3', 'SN2_NAOET', 'SN2_NAI', 'SN2_NACN', 'SN2_NAN3', 'SN2_NASH', 'SN2_NH3',
  'SN2_NAOAC', 'SN2_ACETYLIDE', 'TBUOK', 'NANH2_BASE', 'KOH_ETOH',
  'H2O_HEAT', 'ETOH_HEAT', 'MEOH_HEAT', 'HCOOH_H2O', 'H2SO4_HEAT_ROH',
] as const;

export type ReagentId = (typeof REAGENT_IDS)[number];

export type SubstrateClass =
  | 'alkene' | 'alkyne' | 'terminal-alkyne' | 'alkyl-halide' | 'alcohol'
  | 'epoxide' | 'diol' | 'vicinal-dihalide' | 'alkane' | 'allylic-alkene';

/** Transformation rule implemented in src/reactions/*. One rule serves several cards. */
export type RuleId =
  | 'HX_ADD' | 'RADICAL_HBR' | 'X2_ADD' | 'HOX_ADD' | 'HYDRATION' | 'OXYMERC' | 'HYDROBORATION'
  | 'H2' | 'EPOXIDATION' | 'EPOXIDE_OPEN' | 'ANTI_DIOL' | 'SYN_DIOL'
  | 'OZONOLYSIS' | 'KMNO4_CLEAVAGE' | 'DIOL_CLEAVAGE' | 'CYCLOPROPANATION'
  | 'ALKYNE_HYDRATION_HG' | 'ALKYNE_HYDROBORATION' | 'LINDLAR' | 'DISSOLVING_METAL'
  | 'ACETYLIDE_ALKYLATION' | 'DOUBLE_E2'
  | 'ALLYLIC_BROMINATION' | 'RADICAL_HALOGENATION' | 'ROH_TO_RX'
  | 'SUBST_ELIM' | 'DEHYDRATION';

export type NucStrength = 'strong' | 'moderate' | 'weak';
export type Basicity = 'strong' | 'weak';
export type Solvent = 'protic' | 'aprotic' | 'none';

export interface Nucleophile {
  /** Element that bonds to the substrate carbon. */
  readonly atom: Element;
  /** Fragment attached at the substrate carbon; atom 0 is the attaching atom.
   *  SMILES of the fragment written from the attaching atom, e.g. "O" (OH),
   *  "OCC" (OEt), "C#N", "N=[N+]=[N-]" (azide; charges), "C#CC" (propynide). */
  readonly fragment: string;
  readonly strength: NucStrength;
  readonly basicity: Basicity;
  readonly bulky: boolean;
  readonly charged: boolean;
}

export interface ReagentCard {
  readonly id: ReagentId;
  /** Hotbar / bench label, e.g. "HBr". */
  readonly label: string;
  /** Textbook reagent line, e.g. "HBr, ether". */
  readonly reagentText: string;
  /** McMurry (OpenStax 10e) chapter and section, e.g. 8, "8.5". */
  readonly chapter: number;
  readonly section: string;
  readonly substrates: readonly SubstrateClass[];
  readonly rule: RuleId;
  readonly nuc?: Nucleophile;
  readonly solvent?: Solvent;
  readonly heat?: boolean;
  /** Default equivalents for HX/X2 on alkynes. */
  readonly equiv?: 1 | 2;
  /** Halogen delivered by HX / X2 / HOX / radical cards. */
  readonly halogen?: 'F' | 'Cl' | 'Br' | 'I';
  /** True for HBR_ROOR, KMNO4_COLD, TBUOK-Hofmann: shown with a "(not in McMurry 10e)" tag. */
  readonly notInMcMurry10e?: boolean;
  /** Product or substrate needs an odd ring; hidden unless diagonal bonds are enabled. */
  readonly requiresDiagonalBonds?: boolean;
  /** Instructor toggle default. SCOPE.md decides: HBR_ROOR true; MCPBA-family false. */
  readonly enabledByDefault: boolean;
}

// ---------------------------------------------------------------------------
// Challenges (mcmurry-orgo1.md section 3, acids-bases-hybrid.md sections 6-8,
// reaction-bench.md section 5, stereo-on-grid.md section 8)
// ---------------------------------------------------------------------------

export type Chapter = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type Difficulty = 'easy' | 'medium' | 'hard';

export type Topic =
  | 'hybridization' | 'structures' | 'polarity' | 'formal-charge' | 'acids-bases'
  | 'functional-groups' | 'isomers' | 'nomenclature' | 'alkyl-groups' | 'cycloalkanes' | 'cis-trans'
  | 'chirality' | 'R/S' | 'meso' | 'unsaturation' | 'E/Z' | 'alkene-stability' | 'carbocations'
  | 'addition' | 'rearrangement' | 'elimination' | 'anti-addition' | 'hydration' | 'hydroxylation'
  | 'reduction' | 'cleavage' | 'alkyne-addition' | 'alkyne-hydration' | 'acetylide'
  | 'organohalides' | 'substitution' | 'radical';

/** Rule: the student's targeted molecule must be the target (constitution + charge). */
export interface ExactMoleculeRule {
  readonly type: 'exact-molecule';
  readonly target: string;
}

/** Rule: formula match plus required/forbidden groups and optional counts. */
export interface FormulaAndGroupsRule {
  readonly type: 'formula-and-groups';
  readonly formula: string;
  readonly required: readonly GroupId[];
  readonly forbidden: readonly GroupId[];
  readonly ringCount?: number;
  readonly piBonds?: number;
  /** Every listed size must occur among the molecule's smallest rings. */
  readonly ringSizes?: readonly number[];
  readonly netCharge?: number;
  /** Per-atom predicates counted over the molecule: {el, hyb, min, max}. */
  readonly atomCounts?: readonly { readonly el: Element; readonly hyb?: Hybridization; readonly charge?: Charge; readonly min?: number; readonly max?: number }[];
}

/** Rule: build every listed isomer; the tracker persists canonical hashes. */
export interface IsomerSetRule {
  readonly type: 'isomer-set';
  readonly formula: string;
  readonly isomers: readonly string[];
  /** isomers.length unless optional diagonal-only isomers are listed. */
  readonly count: number;
  readonly optionalDiagonalIsomers?: readonly string[];
}

/** Rule: the instruction gives a name; the target SMILES decides. Both McMurry
 *  (2-butene) and current IUPAC (but-2-ene) spellings are listed in `names`. */
export interface NameToStructureRule {
  readonly type: 'name-to-structure';
  readonly names: readonly string[];
  readonly target: string;
}

/** Rule: constitution + stereo (target SMILES carries @/@@ and / \). */
export interface StereoExactRule {
  readonly type: 'stereo-exact';
  readonly target: string;
  /** 'absolute' = verdict SAME; 'relative' = SAME or ENANTIOMER. */
  readonly mode: 'absolute' | 'relative';
  /** Alternative accepted targets (e.g. both enantiomers of a trans ring). */
  readonly accept?: readonly string[];
}

export type Selector =
  | { readonly kind: 'most-acidic-h' }
  | { readonly kind: 'most-basic-site' }
  | { readonly kind: 'most-basic-n' }
  | { readonly kind: 'hybridization'; readonly value: Hybridization; readonly el?: Element }
  | { readonly kind: 'chirality-center' }
  | { readonly kind: 'tertiary-carbon' }
  | { readonly kind: 'electrophilic-carbon' }
  | { readonly kind: 'lone-pair-atom' }
  | { readonly kind: 'more-substituted-alkene-carbon' }
  | { readonly kind: 'fewest-carbon-substituents-cx' }
  | { readonly kind: 'atom-ids'; readonly ids: readonly number[] };

/** Rule: molecules are placed and locked; the student selects atoms or
 *  hydrogens. Success = selected set equals the selector's answer set
 *  (any member of an equivalence class is accepted for most-acidic-h /
 *  most-basic-*). */
export interface SelectAtomRule {
  readonly type: 'select-atom';
  readonly molecules: readonly string[];
  readonly selector: Selector;
  /** 'hydrogens' shows H mini-blocks and expects an H pick. */
  readonly target: 'atoms' | 'hydrogens';
  /** 'all' = every matching atom must be selected; 'any' = one suffices. */
  readonly match: 'all' | 'any';
  readonly maxAttempts: number;
  readonly answerDescription: string;
}

/** Rule: reactant locked in the reactant zone; student picks the given card
 *  (or it is pre-applied) and builds `expected` in the product zone. */
export interface PredictProductRule {
  readonly type: 'predict-product';
  readonly reactant: string;
  readonly reagentId: ReagentId;
  readonly equiv?: 1 | 2;
  /** SMILES of the alkyl halide for NANH2_THEN_RX. */
  readonly rx?: string;
  /** Every molecule the student must build (multiset). */
  readonly expected: readonly string[];
  readonly stereoCheck: StereoPolicy;
  /** Also-correct builds shown with a note ("minor product (19%)"). */
  readonly acceptAlso?: readonly { readonly smiles: string; readonly note: string }[];
  /** Any one of `expected` suffices (textbook mixtures). */
  readonly acceptAny?: boolean;
}

/** Rule: reactant and product previewed; student picks a reagent card. */
export interface ChooseReagentRule {
  readonly type: 'choose-reagent';
  readonly reactant: string;
  readonly product: string;
  readonly options: readonly ReagentId[];
  /** Any listed id is correct. */
  readonly correct: readonly ReagentId[];
  readonly maxAttempts: number;
  /** Explanation per wrong option, keyed by ReagentId. */
  readonly rejections?: Readonly<Partial<Record<ReagentId, string>>>;
}

export interface QuizOption {
  readonly id: string;
  readonly text: string;
}

export interface QuizMcRule {
  readonly type: 'quiz';
  readonly kind: 'mc';
  readonly prompt: string;
  readonly options: readonly QuizOption[];
  /** Option ids; any listed id is correct. */
  readonly correct: readonly string[];
  readonly shuffle: boolean;
  readonly maxAttempts: number;
  readonly explanation: string;
  /** Optional molecule to display with a marked atom. */
  readonly display?: { readonly smiles: string; readonly markedAtom?: number; readonly showLonePairs?: boolean; readonly hideCharges?: boolean };
}

export interface QuizYesNoRule {
  readonly type: 'quiz';
  readonly kind: 'yesno';
  readonly prompt: string;
  readonly correct: boolean;
  readonly maxAttempts: number;
  readonly explanation: string;
  readonly display?: { readonly smiles: string; readonly markedAtom?: number };
}

export type ChallengeRule =
  | ExactMoleculeRule
  | FormulaAndGroupsRule
  | IsomerSetRule
  | NameToStructureRule
  | StereoExactRule
  | SelectAtomRule
  | PredictProductRule
  | ChooseReagentRule
  | QuizMcRule
  | QuizYesNoRule;

export type RuleType = ChallengeRule['type'];

export interface Challenge {
  /** Stable id, e.g. "ch5-build-r-2-bromobutane". Never renamed once shipped
   *  (progress bitmasks are indexed by roster order). */
  readonly id: string;
  readonly chapter: Chapter;
  /** OpenStax section, e.g. "5.5". */
  readonly section: string;
  readonly topic: Topic;
  readonly title: string;
  readonly instruction: string;
  readonly objective: string;
  readonly hint: string;
  readonly difficulty: Difficulty;
  /** Must equal POINTS_BY_DIFFICULTY[difficulty]; a test asserts it. */
  readonly points: number;
  readonly rule: ChallengeRule;
  readonly requiresDiagonalBonds: boolean;
  /** Citation, e.g. "MM 5.5 (m00054)". */
  readonly source: string;
  /** Feedback overrides keyed by FeedbackKind. */
  readonly feedback?: Readonly<Partial<Record<FeedbackKind, string>>>;
}

/** Roster file shape (src/content/challenges.json). */
export interface ChallengeRoster {
  readonly version: 1;
  readonly challenges: readonly Challenge[];
}

// ---------------------------------------------------------------------------
// Acceptance results and feedback
// ---------------------------------------------------------------------------

export type FeedbackKind =
  | 'correct'
  | 'correct-reduced'
  | 'wrong-formula'
  | 'constitutional-isomer'
  | 'enantiomer'
  | 'diastereomer'
  | 'unspecified-center'
  | 'invalid-alkene-geometry'
  | 'missing-group'
  | 'forbidden-group'
  | 'wrong-ring-count'
  | 'wrong-pi-count'
  | 'wrong-charge'
  | 'valence-error'
  | 'extra-molecule'
  | 'missing-molecule'
  | 'already-built'
  | 'not-an-isomer'
  | 'wrong-atom'
  | 'no-hydrogens'
  | 'wrong-reagent'
  | 'wrong-option'
  | 'attempts-exhausted'
  /** select-atom submitted with an empty selection: never consumes an attempt (engineering review finding 4). */
  | 'nothing-selected'
  | 'nothing-targeted';

export interface SubmitResult {
  readonly passed: boolean;
  readonly kind: FeedbackKind;
  /** Student-facing sentence(s), fully written out. */
  readonly message: string;
  /** For isomer sets: how many are done. */
  readonly progress?: { readonly done: number; readonly total: number };
  /** Attempt number that produced this result (1-based). */
  readonly attempt: number;
  /** Points earned by this submission (0 when not passed or already solved). */
  readonly pointsEarned: number;
}

/** Everything a rule evaluator needs from the world/UI. */
export interface SubmissionContext {
  /** Molecules on the lab pad (or product zone for bench challenges). */
  readonly padMolecules: readonly MoleculeGraph[];
  /** The one the student is targeting, if any. */
  readonly targeted: MoleculeGraph | null;
  /** Selected atoms as (moleculeIndex, atomId, hSlot?) for select-atom rules. */
  readonly selection: readonly { readonly molecule: number; readonly atom: number; readonly hSlot?: number }[];
  /** Chosen reagent id for choose-reagent rules. */
  readonly chosenReagent?: ReagentId;
  /** Chosen quiz option id / yes-no. */
  readonly quizAnswer?: string | boolean;
  /** Canonical hashes already accepted for this isomer-set challenge. */
  readonly isomersDone: ReadonlySet<string>;
  readonly attempt: number;
  readonly diagonalBondsEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Molecule library (src/content/molecules.json)
// ---------------------------------------------------------------------------

export interface MoleculeEntry {
  /** Stable id, e.g. "r-2-butanol". */
  readonly id: string;
  /** IUPAC name shown in the panel. */
  readonly name: string;
  readonly commonNames: readonly string[];
  /** Hill formula as the chemistry core computes it (validated by a test). */
  readonly formula: string;
  /** Kekule SMILES; may carry @/@@ and / \ for stereo entries. */
  readonly smiles: string;
  readonly chapters: readonly Chapter[];
  readonly requiresDiagonalBonds: boolean;
  /** Expected CIP labels keyed by 1-based SMILES atom position, e.g. {"2":"R"}, or by bond "a=b" for E/Z;
   *  lowercase r/s are the pseudo-asymmetric labels of the 1,4-disubstituted cyclohexanes (05 §5.1 rule 3). */
  readonly labels?: Readonly<Record<string, 'R' | 'S' | 'E' | 'Z' | 'r' | 's'>>;
  /** Verified lattice layout for tutorials/ghost builds; pos[i] for SMILES atom i. */
  readonly layout?: readonly (readonly [number, number, number])[];
  readonly meso?: boolean;
}

export interface MoleculeLibrary {
  readonly version: 1;
  readonly entries: readonly MoleculeEntry[];
}

// ---------------------------------------------------------------------------
// Scoring constants (single source of truth; tests assert them)
// ---------------------------------------------------------------------------

export const POINTS_BY_DIFFICULTY: Readonly<Record<Difficulty, number>> = { easy: 2, medium: 4, hard: 8 };

/** Fraction of points earned on the n-th successful attempt (index attempt-1)
 *  for quiz, select-atom and choose-reagent rules. Build rules always earn
 *  full points (unlimited attempts). */
export const ATTEMPT_MULTIPLIER: readonly number[] = [1, 0.5, 0];

export const DEFAULT_MAX_ATTEMPTS = { quiz: 2, selectAtom: 3, chooseReagent: 2 } as const;

/** Default pass mark (percent) - also written to the SCORM manifest. */
export const DEFAULT_PASS_MARK = 70;

/** raw = Math.round(100 * earned / total); integer 0..100. */
export function rawScore(earned: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * earned) / total)));
}

/** Points for a successful attempt number (1-based). */
export function pointsForAttempt(points: number, attempt: number, unlimited: boolean): number {
  if (unlimited) return points;
  const m = ATTEMPT_MULTIPLIER[attempt - 1] ?? 0;
  return Math.floor(points * m);
}
