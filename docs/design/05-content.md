# 05 — Content: challenge roster and molecule library (`src/content/`)

Owner: WP-05. Conforms to `docs/design/00-contracts.md` and `src/content/types.ts` (names and shapes used verbatim). Precedence: `docs/SCOPE.md` > 00-contracts > this document > research reports (mcmurry-orgo1 §2/§4/§5, acids-bases-hybrid §7/§9, reaction-bench §5, stereo-on-grid §5/§6/§8) > DESIGN-draft §5. Every SMILES, formula, CIP label, meso flag and lattice layout below was regenerated with RDKit 2026.03.6 (`verify05.py`, written during this design pass in the session scratchpad; WP-05 commits it as `tools/reference/verify05.py` next to `verify_library.py` — see §12 item 9), not copied by hand.

## 0. Files and responsibilities

| File | Holds | Pure |
|---|---|---|
| `src/content/molecules.json` | `MoleculeLibrary` (§5) | data |
| `src/content/challenges.json` | `ChallengeRoster` (§4) | data |
| `src/content/reagents.json` | `ReagentCard[]` — authored in `04-reaction-bench.md`; this document only consumes `ReagentId`s | data |
| `orgocraft.config.json` | `OrgocraftConfig` (§1) | data |
| `src/content/library.ts` | `loadLibrary`, `entryById`, `parseEntry` (memoised), `entryBySmiles` | yes |
| `src/content/reagents.ts` | `loadReagents`, `cardById` | yes |
| `src/content/challenges.ts` | `loadRoster(config)`, `rosterInfo(roster, config)`, `isomerHashes` | yes |
| `src/content/acceptance.ts` | `evaluate(challenge, ctx)` and one `evaluate<Rule>` per rule type (§7) | yes |
| `src/content/selectors.ts` | `answerSet(selector, graphs, analyses)` (§8) | yes |
| `src/content/feedback.ts` | `FEEDBACK` table, `feedbackText(kind, params)` (§9) | yes |
| `src/content/validate.ts` | `validateContent(library, roster, reagents): string[]` (§11) | yes |

No file in this folder imports `three` or the DOM. Placement of locked molecules (select-atom, bench reactant), ghost rendering and the quiz dialog are 07-ui's job; this folder only supplies graphs, layouts and verdicts.

## 1. Contract additions (exact TypeScript; nothing here edits the type files)

```ts
// orgocraft.config.json  (read by src/content/challenges.ts and src/lms/ScormAdapter.ts)
export interface OrgocraftConfig {
  readonly version: string;                       // "1.0.0"; also stamped into the manifest
  readonly passMark: number;                      // percent, default DEFAULT_PASS_MARK (70); manifest masteryscore
  readonly disabledChallenges: readonly string[]; // challenge ids the instructor switched off
  readonly enabledReagents?: readonly ReagentId[];// overrides ReagentCard.enabledByDefault when present
  readonly diagonalBonds: boolean;                // false in v1; true reveals requiresDiagonalBonds content
}
export const DEFAULT_CONFIG: OrgocraftConfig = { version: '1.0.0', passMark: DEFAULT_PASS_MARK, disabledChallenges: [], diagonalBonds: false };

// src/content/challenges.ts
/** Enabled challenges in roster (file) order; disabled ones are REMOVED from the array but keep their
 *  roster index in RosterInfo.enabled so progress bitmasks never shift. */
export function loadRoster(config: OrgocraftConfig): Challenge[];
/** Full roster (every record, including disabled and diagonal-only) in file order = bit order. */
export function loadFullRoster(): readonly Challenge[];
export function rosterInfo(roster: readonly Challenge[], config: OrgocraftConfig): RosterInfo;   // src/lms/types RosterInfo
export function totalPoints(info: RosterInfo): number;      // Σ points[i] where enabled[i]
export function isEnabled(c: Challenge, config: OrgocraftConfig): boolean;
/** WL hashes of IsomerSetRule.isomers (and optionalDiagonalIsomers), computed once per rule at load. */
export function isomerHashes(rule: IsomerSetRule): { readonly required: ReadonlySet<string>; readonly optional: ReadonlySet<string> };
/** true for quiz, select-atom and choose-reagent (attempt-limited); false for build rules. */
export function isAttemptLimited(rule: ChallengeRule): boolean;
export function maxAttemptsOf(rule: ChallengeRule): number;  // rule.maxAttempts, or Infinity for build rules

// src/content/library.ts
export function loadLibrary(): MoleculeLibrary;
export function entryById(id: string): MoleculeEntry | undefined;
/** Exact-string lookup on MoleculeEntry.smiles (rules reference library molecules by their SMILES). */
export function entryBySmiles(smiles: string): MoleculeEntry | undefined;
/** parseSmiles + implicitHydrogens + perceiveAromaticity, memoised by SMILES string. */
export function parseEntry(entry: MoleculeEntry | string): MoleculeGraph;
/** entry.layout when present (pos = layout, hPos empty, suppressedPairs = suppressedPairsOf(parseEntry(entry), layout)),
 *  else embedOnLattice(parseEntry(entry)) (memoised); null only for odd rings (09-amendment-no-bond.md §1.9). */
export function layoutOf(entry: MoleculeEntry): EmbeddingExt | null;

// src/content/acceptance.ts
export function evaluate(challenge: Challenge, ctx: SubmissionContext): SubmitResult;
export function evaluateExactMolecule(rule: ExactMoleculeRule | NameToStructureRule, ctx: SubmissionContext, c: Challenge): SubmitResult;
export function evaluateFormulaAndGroups(rule: FormulaAndGroupsRule, ctx: SubmissionContext, c: Challenge): SubmitResult;
export function evaluateIsomerSet(rule: IsomerSetRule, ctx: SubmissionContext, c: Challenge): SubmitResult;
export function evaluateStereoExact(rule: StereoExactRule, ctx: SubmissionContext, c: Challenge): SubmitResult;
export function evaluateSelectAtom(rule: SelectAtomRule, ctx: SubmissionContext, c: Challenge): SubmitResult;
export function evaluatePredictProduct(rule: PredictProductRule, ctx: SubmissionContext, c: Challenge): SubmitResult;
export function evaluateChooseReagent(rule: ChooseReagentRule, ctx: SubmissionContext, c: Challenge): SubmitResult;
export function evaluateQuiz(rule: QuizMcRule | QuizYesNoRule, ctx: SubmissionContext, c: Challenge): SubmitResult;
/** Points for a passing submission: full for build rules; pointsForAttempt for attempt-limited rules;
 *  acceptAlso ("correct-reduced") earns pointsForAttempt(points, 2, false) = half (04 §8.4 step 5's "full
 *  credit" is superseded: this module owns acceptance.ts). */
export function pointsFor(c: Challenge, attempt: number, reduced: boolean): number;
/** Credit delta State reports and passes to applyOutcome for a passing submission on challenge i:
 *  not yet solved            → pointsEarned (full or half as above)
 *  solved reduced, now full  → c.points − pointsForAttempt(c.points, 2, false)   (the upgrade, see below)
 *  otherwise (already ≥)     → 0 */
export function creditDelta(c: Challenge, result: SubmitResult, state: ProgressState, index: number): number;
/** Maps a CompareVerdict (never SAME) to the FeedbackKind the build rules report. */
export function kindForVerdict(v: CompareVerdict, sameElements: boolean): FeedbackKind;

// src/lms/Progress.ts — semantics of applyOutcome fixed here for WP-10 (signature unchanged from 00-contracts §5):
/** applyOutcome(state, i, outcome, points) with bit = 1n << BigInt(i):
 *  (a) outcome NotAttempted → state unchanged.
 *  (b) outcome Attempted    → attempted |= bit; earned unchanged (a second call returns the same object).
 *  (c) outcome SolvedReduced, bit ∉ solved → attempted |= bit; solved |= bit; reduced |= bit; earned += max(0, points).
 *  (d) outcome SolvedFull,    bit ∉ solved → attempted |= bit; solved |= bit; earned += max(0, points).
 *  (e) UPGRADE: outcome SolvedFull, bit ∈ reduced → reduced &= ~bit; earned += max(0, points), where the caller
 *      passes points = creditDelta(...) = c.points − pointsForAttempt(c.points, 2, false) (1, 2 or 4).
 *  (f) every other call on a solved bit (SolvedFull on full, SolvedReduced on any solved) → state unchanged:
 *      a solve is never downgraded and never double-counted.
 *  Invariant after every call: reduced ⊆ solved ⊆ attempted; summarize(state).earned === state.earned. */
export function applyOutcome(state: ProgressState, index: number, outcome: Outcome, points: number): ProgressState;

// src/content/selectors.ts
export interface SelectionItem { readonly molecule: number; readonly atom: number; readonly hSlot?: number }
export function answerSet(selector: Selector, graphs: readonly MoleculeGraph[], analyses: readonly Analysis[]): SelectionItem[];
/** Heavy-atom fallback: an item without hSlot on a 'hydrogens' rule expands to every H slot of that atom. */
export function normalizeSelection(sel: readonly SelectionItem[], target: 'atoms' | 'hydrogens', analyses: readonly Analysis[]): SelectionItem[] | 'no-hydrogens';
export function itemKey(i: SelectionItem): string;   // `${molecule}:${atom}` or `${molecule}:${atom}:${hSlot}`

// src/content/feedback.ts
export type FeedbackParams = Readonly<Record<string, string | number | undefined>>;
export const FEEDBACK: Readonly<Record<FeedbackKind, (p: FeedbackParams) => string>>;
export function feedbackText(kind: FeedbackKind, params?: FeedbackParams, override?: string): string;

// src/content/validate.ts
export interface ContentProblem { readonly where: string; readonly message: string }   // where = "challenge:<id>" | "library:<id>" | "reagent:<id>"
export function validateContent(library: MoleculeLibrary, roster: ChallengeRoster, reagents: readonly ReagentCard[]): string[];  // "<where>: <message>"
export function validateContentDetailed(library: MoleculeLibrary, roster: ChallengeRoster, reagents: readonly ReagentCard[]): ContentProblem[];
/** Required "no bond" pairs per build target and per library entry (09 §1.9); reported, never a failure. */
export interface BuildReportRow { readonly where: string; readonly smiles: string; readonly nodesVisited: number; readonly suppressedPairs: readonly (readonly [number, number])[] }
export function buildReport(library: MoleculeLibrary, roster: ChallengeRoster): BuildReportRow[];

// src/content/feedback.ts — additions (09 §1.9, §4.5)
export const NO_BOND_HINT = 'Two touching atoms that should not be bonded have bonded into a ring: point the bond wand (B) at the bar between them and press E until it shows the red x break marker (no bond).';
// FeedbackParams may carry `extraRing: 1` (student ringCount > target ringCount); the wrong-formula, constitutional-isomer and
// wrong-ring-count templates then append ' ' + NO_BOND_HINT.
```

Clarifications of `types.ts` used here (no shape change):
- `IsomerSetRule.isomers` / `optionalDiagonalIsomers` hold **SMILES** (02-chemistry-core Q6); `challenges.ts` hashes them at load with `wlHash(perceiveAromaticity(parsed), hydrogens).hash`; `SubmissionContext.isomersDone` and `ProgressState.isomersDone` store those hashes.
- `QuizMcRule.display.markedAtom` / `QuizYesNoRule.display.markedAtom` is the **0-based heavy-atom index in `parseSmiles` order** of `display.smiles`.
- `SelectAtomRule.match: 'any'` passes iff the normalised selection is non-empty and every selected item is in the answer set (a selection that also contains a wrong item fails; 07-ui limits `'any'` rules to a single pick, so this equals the contract's "intersects").
- `PredictProductRule.acceptAlso` passes with `kind: 'correct-reduced'`, `pointsEarned = pointsForAttempt(points, 2, false)` (half, floored) and progress outcome `SolvedReduced`. A later submission that matches `expected` exactly on the same challenge is accepted with `kind: 'correct'`, outcome `SolvedFull` and `pointsEarned = points − pointsForAttempt(points, 2, false)` (the upgrade of `applyOutcome` rule (e) above; 08 §3.2 rule A3 and test P-A2 are replaced by this: a reduced solve is upgraded exactly once and never downgraded). This is what the roster texts "earns half credit … for full credit" promise.
- `Challenge.section` is the OpenStax section (`"5.5"`); `source` is `MM <section> (m000NN)` where `NN = chapterStart + sectionNumber` with chapter starts 1→157, 2→17, 3→31, 4→39, 5→49, 6→76, 7→62, 8→88, 9→102, 10→112, 11→121 (verified against the citations already in the contracts: 2.8→m00025, 5.5→m00054, 7.9→m00071, 9.7→m00109, 1.6→m00163).

## 2. Scoring model

Constants are `POINTS_BY_DIFFICULTY = {easy: 2, medium: 4, hard: 8}`, `ATTEMPT_MULTIPLIER = [1, 0.5, 0]`, `DEFAULT_MAX_ATTEMPTS = {quiz: 2, selectAtom: 3, chooseReagent: 2}`, `DEFAULT_PASS_MARK = 70` (all in `types.ts`).

1. **Points per challenge** = `POINTS_BY_DIFFICULTY[difficulty]`; the JSON also stores `points` and `test/content/challenges.test.ts` asserts equality for every record.
2. **Total** = `totalPoints(rosterInfo(loadFullRoster(), config))` = Σ points over enabled challenges. It is **never a literal** anywhere (critic 5.1): tests compute it from the JSON, the progress bar reads `score:changed.total`, INSTRUCTOR.md says "total shown in the game". With the roster of §4 and the default config the value is **378** (91 challenges: 25 easy = 50, 50 medium = 200, 16 hard = 128; 09-amendment-no-bond.md §4.3); this number appears here only as a cross-check and `challenges.test.ts` asserts it against the JSON sum so a content edit that changes it fails loudly until this line is updated.
3. **Earned per solve**: build rules (`exact-molecule`, `formula-and-groups`, `isomer-set`, `name-to-structure`, `stereo-exact`, `predict-product`) have unlimited attempts and earn full points, except an `acceptAlso` match which earns `floor(points × 0.5)` and is recorded as `SolvedReduced`; a subsequent exact match on that challenge upgrades it to `SolvedFull` and earns the remaining `points − floor(points × 0.5)` (§1, `applyOutcome` rule (e)). Attempt-limited rules (`select-atom`, `quiz`, `choose-reagent`) earn `pointsForAttempt(points, attempt, false)` = full on attempt 1, half on attempt 2, nothing from attempt 3 on; when `attempt ≥ maxAttempts` and the answer is wrong the challenge is marked `Attempted` and the answer is revealed (`attempts-exhausted`).
4. **Raw score** = `rawScore(earned, total) = round(100·earned/total)`, clamped to 0..100. Monotonic within an attempt: `earned` only increases (already-solved challenges return `pointsEarned: 0` except the one-time reduced → full upgrade, which returns the positive remainder; a reduced solve is never downgraded), so `raw` never decreases; `ProgressState.reportedRaw` additionally stores the highest value written so a restore can never lower the gradebook.
5. **Pass**: `raw ≥ config.passMark` → `lesson_status = passed`. With 378 points, `raw ≥ 70` first holds at `earned = 263` (`round(100·263/378) = 70`; 262 rounds to 69).
6. **Disabled challenges** contribute nothing to `total` and are absent from the UI; their roster bits stay reserved. New challenges are appended to the file, never inserted (ids and bit positions are permanent).
7. Diagonal-only challenges (`requiresDiagonalBonds: true`) are hidden and excluded from `total` unless `config.diagonalBonds` is true. The v1 roster contains none; `IsomerSetRule.optionalDiagonalIsomers` on `ch4-isomers-c4h8` is the only diagonal-aware datum.

## 3. Roster conventions

- **Ordering**: file order = McMurry chapter 1 → 11, then section, then pedagogical order. Index in the file is the progress bit.
- **Ids**: `ch<N>-<verb>-<subject>` in kebab-case, ASCII, permanent.
- **Instructions** are self-contained: they name the molecule to build (by name and, where useful, by condensed formula), say where (lab pad / product zone), and never refer to a previous challenge or to "the molecule you are holding". Bench instructions always name the reactant that is locked in the reactant zone.
- **Objective** is one sentence for the instructor view. **Hint** is shown on request (no point deduction).
- **Feedback**: defaults come from `FEEDBACK` (§9); a record's `feedback` map overrides single kinds.
- **SMILES rules**: every SMILES in `target`, `accept`, `molecules`, `reactant`, `product`, `expected`, `acceptAlso[].smiles`, `isomers`, `rx` and `display.smiles` is the `smiles` string of a library entry (validator check L7). `optionalDiagonalIsomers` are the one exception (odd rings are not in the library) and are parsed directly.
- **maxAttempts** always equals the `DEFAULT_MAX_ATTEMPTS` value for the rule type.
- **Difficulty**: easy = single concept, ≤ 4 heavy atoms or one pick; medium = one rule applied once; hard = two rules or explicit stereo at two centres.

## 4. Challenge roster (`src/content/challenges.json`, `version: 1`)

91 records. `requiresDiagonalBonds` is `false` on every record and omitted below only for brevity; the JSON file writes it out. Four records were added or replaced by 09-amendment-no-bond.md §4.2 (`ch7-build-z-but-2-ene`, `ch7-build-z-2-chlorobut-2-ene`, `ch9-predict-br2-1-equiv-but-1-yne`, `ch9-predict-lindlar-z-hex-3-ene`); because v1 has not shipped they sit at their pedagogical positions, and the append-only rule applies from the first release on.

### 4.1 Chapter 1 — Structure and bonding (7 challenges, 20 points)

```json
[
{"id":"ch1-build-methane","chapter":1,"section":"1.6","topic":"hybridization","title":"One carbon, four hydrogens",
 "instruction":"Place a single carbon block on the lab pad and target it. The molecule panel fills in the hydrogens automatically: it should read CH4 with one sp3 carbon and a tetrahedral geometry. Submit.",
 "objective":"Carbon is tetravalent; implicit hydrogens complete the valence; an sp3 carbon is tetrahedral (109.5 degrees).",
 "hint":"Carbon always fills up to four bonds. With no neighbours all four are hydrogens.",
 "difficulty":"easy","points":2,"rule":{"type":"exact-molecule","target":"C"},"source":"MM 1.6 (m00163)"},
{"id":"ch1-build-ethene","chapter":1,"section":"1.8","topic":"hybridization","title":"Ethene: a double bond",
 "instruction":"Build ethene (ethylene, CH2=CH2) on the lab pad: two carbon blocks side by side, then use the bond wand on the bond between them until it reads order 2. Both carbons must show sp2 in the panel.",
 "objective":"A double bond is one sigma plus one pi bond; sp2 carbons are trigonal planar (120 degrees).",
 "hint":"Point at the bar between the two carbons and press the bond wand once (1 -> 2).",
 "difficulty":"easy","points":2,"rule":{"type":"exact-molecule","target":"C=C"},"source":"MM 1.8 (m00165)"},
{"id":"ch1-build-ethyne","chapter":1,"section":"1.9","topic":"hybridization","title":"Ethyne: a triple bond",
 "instruction":"Build ethyne (acetylene, HC≡CH) on the lab pad: two bonded carbon blocks with the bond cycled to order 3. Both carbons must show sp and linear in the panel.",
 "objective":"A triple bond is one sigma plus two pi bonds; sp carbons are linear (180 degrees).",
 "hint":"Press the bond wand twice on a fresh C-C bond (1 -> 2 -> 3). Each carbon then has room for exactly one hydrogen.",
 "difficulty":"easy","points":2,"rule":{"type":"exact-molecule","target":"C#C"},"source":"MM 1.9 (m00166)"},
{"id":"ch1-condensed-2-methylbutane","chapter":1,"section":"1.12","topic":"structures","title":"Read a condensed structure",
 "instruction":"Build the molecule written as the condensed structure CH3CH(CH3)CH2CH3 on the lab pad.",
 "objective":"Read condensed structures: a group in parentheses hangs off the preceding carbon.",
 "hint":"Four carbons in a row; the CH3 in parentheses is a branch on the second carbon. The molecule is 2-methylbutane.",
 "difficulty":"easy","points":2,"rule":{"type":"exact-molecule","target":"CCC(C)C"},"source":"MM 1.12 (m00169)"},
{"id":"ch1-select-sp2-propene","chapter":1,"section":"1.8","topic":"hybridization","title":"Find the sp2 carbons",
 "instruction":"Propene (CH2=CH-CH3) is placed on the lab pad and locked. Use the select tool to select every sp2-hybridized carbon, then submit.",
 "objective":"An atom with three sigma partners and one pi bond is sp2; the methyl carbon with four sigma partners is sp3.",
 "hint":"Count what each carbon is bonded to, hydrogens included. Three partners means sp2, four means sp3.",
 "difficulty":"medium","points":4,
 "rule":{"type":"select-atom","molecules":["C=CC"],"selector":{"kind":"hybridization","value":"sp2","el":"C"},"target":"atoms","match":"all","maxAttempts":3,"answerDescription":"the two carbons of the C=C double bond (C1 and C2)"},
 "source":"MM 1.8 (m00165)"},
{"id":"ch1-quiz-hybridization-acetamide-n","chapter":1,"section":"1.10","topic":"hybridization","title":"Hybridization of an amide nitrogen",
 "instruction":"Acetamide (CH3-CO-NH2) is shown with its nitrogen marked. Answer the question in the quiz panel.",
 "objective":"A lone pair next to a C=O is conjugated: the amide nitrogen is sp2 and planar, not sp3.",
 "hint":"Would the lone pair rather sit in a p orbital that overlaps with the C=O pi bond, or in an sp3 orbital?",
 "difficulty":"medium","points":4,
 "rule":{"type":"quiz","kind":"mc","prompt":"What is the hybridization of the marked nitrogen atom in acetamide?",
  "options":[{"id":"a","text":"sp"},{"id":"b","text":"sp2"},{"id":"c","text":"sp3"},{"id":"d","text":"unhybridized"}],
  "correct":["b"],"shuffle":true,"maxAttempts":2,
  "explanation":"The nitrogen lone pair is delocalized into the C=O pi bond (resonance), so the nitrogen is sp2 and trigonal planar, like the nitrogen of every amide (McMurry 1.10 and 24.3). A simple amine nitrogen such as the one in methylamine is sp3.",
  "display":{"smiles":"CC(N)=O","markedAtom":2,"showLonePairs":true}},
 "source":"MM 1.10 (m00167)"},
{"id":"ch1-build-sp-and-sp3-c4h6","chapter":1,"section":"1.9","topic":"hybridization","title":"Mixed hybridization",
 "instruction":"Build any neutral molecule with the formula C4H6 that contains at least one sp carbon and at least one sp3 carbon. Target it and submit. The panel lists the hybridization of every atom.",
 "objective":"Recognise sp (triple bond or allene centre) and sp3 carbons in one molecule.",
 "hint":"A triple bond makes two sp carbons. But-1-yne (HC≡C-CH2-CH3) and but-2-yne both work; buta-1,3-diene does not (no sp carbon).",
 "difficulty":"medium","points":4,
 "rule":{"type":"formula-and-groups","formula":"C4H6","required":[],"forbidden":[],"netCharge":0,
  "atomCounts":[{"el":"C","hyb":"sp","min":1},{"el":"C","hyb":"sp3","min":1}]},
 "source":"MM 1.9 (m00166)"}
]
```

Accepted set of `ch1-build-sp-and-sp3-c4h6` (enumerated by the test): but-1-yne `C#CCC`, but-2-yne `CC#CC`, buta-1,2-diene `CC=C=C`. Rejected: buta-1,3-diene (no sp), cyclobutene (no sp), methylenecyclopropane (odd ring, unbuildable anyway).

### 4.2 Chapter 2 — Polar bonds, formal charge, acids and bases (14 challenges, 48 points)

```json
[
{"id":"ch2-select-electrophilic-carbon-chloromethane","chapter":2,"section":"2.1","topic":"polarity","title":"Where is the partial positive charge?",
 "instruction":"Chloromethane (CH3Cl) is placed on the lab pad and locked. Select the atom that carries the partial positive charge (delta+) and submit.",
 "objective":"Chlorine is more electronegative than carbon, so the C-Cl bond is polarized with carbon delta+ (electrophilic).",
 "hint":"Electronegativity increases toward the upper right of the periodic table. Which atom of the C-Cl bond pulls electron density toward itself?",
 "difficulty":"easy","points":2,
 "rule":{"type":"select-atom","molecules":["CCl"],"selector":{"kind":"electrophilic-carbon"},"target":"atoms","match":"all","maxAttempts":3,"answerDescription":"the carbon atom bonded to chlorine"},
 "source":"MM 2.1 (m00018)"},
{"id":"ch2-quiz-formal-charge-hydronium","chapter":2,"section":"2.3","topic":"formal-charge","title":"Formal charge of hydronium oxygen",
 "instruction":"The hydronium ion H3O+ is shown with lone pairs drawn and its charge hidden. Answer the quiz question.",
 "objective":"Formal charge = valence electrons - (nonbonding electrons + half the bonding electrons); oxygen with three bonds and one lone pair is +1.",
 "hint":"Oxygen brings 6 valence electrons. Count 2 nonbonding electrons and 6 bonding electrons (three bonds): 6 - (2 + 6/2) = +1.",
 "difficulty":"easy","points":2,
 "rule":{"type":"quiz","kind":"mc","prompt":"What is the formal charge on the oxygen atom of H3O+?",
  "options":[{"id":"a","text":"-2"},{"id":"b","text":"-1"},{"id":"c","text":"0"},{"id":"d","text":"+1"},{"id":"e","text":"+2"}],
  "correct":["d"],"shuffle":false,"maxAttempts":2,
  "explanation":"Formal charge = 6 valence electrons - (2 nonbonding + 6/2 bonding) = +1 (McMurry 2.3).",
  "display":{"smiles":"[OH3+]","markedAtom":0,"showLonePairs":true,"hideCharges":true}},
 "source":"MM 2.3 (m00020)"},
{"id":"ch2-build-acetate-ion","chapter":2,"section":"2.10","topic":"formal-charge","title":"Conjugate base of acetic acid",
 "instruction":"Build the acetate ion, the conjugate base of acetic acid (CH3CO2-), on the lab pad. Use the charge tool (key C) to put a -1 charge on the oxygen that lost its proton. Target the ion and submit.",
 "objective":"Removing H+ from a carboxylic acid leaves a carboxylate with a -1 formal charge on oxygen; its charge is shared by resonance between the two oxygens.",
 "hint":"Build acetic acid first (CH3-C(=O)-OH), then target the single-bonded oxygen and press C once: it becomes O- with no hydrogen. Either oxygen may carry the charge; the two forms are resonance forms of one ion.",
 "difficulty":"medium","points":4,"rule":{"type":"exact-molecule","target":"CC(=O)[O-]"},"source":"MM 2.10 (m00027)",
 "feedback":{"wrong-charge":"Right atoms, wrong charge. The acetate ion has a net charge of -1: put a -1 charge on one oxygen (the one without a hydrogen).",
  "wrong-formula":"Wrong formula: yours is C2H4O2, the target is C2H3O2-. Right skeleton but you left the O-H hydrogen on: target the single-bonded oxygen and press C once to make it O- (the hydrogen disappears and the charge becomes -1)."}},
{"id":"ch2-build-tert-butyl-cation","chapter":2,"section":"2.3","topic":"formal-charge","title":"A carbocation",
 "instruction":"Build the tert-butyl cation, (CH3)3C+, on the lab pad: a central carbon bonded to three methyl groups, carrying a +1 charge (charge tool, key C). Target it and submit. Check that the panel reports the central carbon as sp2 and trigonal planar.",
 "objective":"A carbon with three bonds, no lone pair and a +1 formal charge is sp2 with an empty p orbital (McMurry 7.9).",
 "hint":"Place four carbons in a T or star (one centre, three arms), target the centre and press C once for +1. The centre then has no hydrogen.",
 "difficulty":"medium","points":4,"rule":{"type":"exact-molecule","target":"C[C+](C)C"},"source":"MM 2.3 (m00020)",
 "feedback":{"wrong-formula":"Wrong formula: yours is C4H10, the target is C4H9+. That is 2-methylpropane (isobutane): target the central carbon and press C once to make it C+ (its hydrogen disappears and the panel shows sp2, trigonal planar)."}},
{"id":"ch2-select-most-acidic-h-ethanol","chapter":2,"section":"2.8","topic":"acids-bases","title":"Most acidic hydrogen in ethanol",
 "instruction":"Ethanol (CH3CH2OH) is placed on the lab pad with its hydrogens shown. Select its most acidic hydrogen and submit.",
 "objective":"An O-H hydrogen (pKa 16) is far more acidic than a C-H hydrogen (pKa about 60) because the alkoxide puts its negative charge on oxygen.",
 "hint":"Which conjugate base puts the negative charge on the most electronegative atom?",
 "difficulty":"easy","points":2,
 "rule":{"type":"select-atom","molecules":["CCO"],"selector":{"kind":"most-acidic-h"},"target":"hydrogens","match":"any","maxAttempts":3,"answerDescription":"the O-H hydrogen (pKa 16.0; the C-H hydrogens are about 60)"},
 "source":"MM 2.8 (m00025)"},
{"id":"ch2-select-most-acidic-h-acetic-acid-vs-ethanol","chapter":2,"section":"2.9","topic":"acids-bases","title":"Stronger acid: acetic acid or ethanol?",
 "instruction":"Acetic acid (CH3CO2H) and ethanol (CH3CH2OH) are both placed on the lab pad with hydrogens shown. Select the single most acidic hydrogen in the whole scene and submit.",
 "objective":"Table 2.3: acetic acid pKa 4.76 versus ethanol 16.00; the carboxylate is resonance-stabilized.",
 "hint":"Both are O-H hydrogens. Which conjugate base spreads its negative charge over two oxygens?",
 "difficulty":"medium","points":4,
 "rule":{"type":"select-atom","molecules":["CC(=O)O","CCO"],"selector":{"kind":"most-acidic-h"},"target":"hydrogens","match":"any","maxAttempts":3,"answerDescription":"the O-H hydrogen of acetic acid (pKa 4.8; ethanol O-H is 16.0)"},
 "source":"MM 2.9 (m00026)"},
{"id":"ch2-select-most-acidic-h-2-mercaptoethanol","chapter":2,"section":"2.8","topic":"acids-bases","title":"S-H versus O-H",
 "instruction":"2-Mercaptoethanol (HS-CH2-CH2-OH) is placed on the lab pad with hydrogens shown. Select its most acidic hydrogen and submit.",
 "objective":"A thiol S-H (pKa 10.3) is more acidic than an alcohol O-H (16) because the larger sulfur atom stabilizes the negative charge better.",
 "hint":"Compare Appendix B values: thiol 10.3, primary alcohol 16.0.",
 "difficulty":"medium","points":4,
 "rule":{"type":"select-atom","molecules":["OCCS"],"selector":{"kind":"most-acidic-h"},"target":"hydrogens","match":"any","maxAttempts":3,"answerDescription":"the S-H hydrogen (pKa 10.3; the O-H is 16.0)"},
 "source":"MM 2.8 (m00025)"},
{"id":"ch2-select-most-acidic-h-pentane-2-4-dione","chapter":2,"section":"2.10","topic":"acids-bases","title":"A carbon acid",
 "instruction":"Pentane-2,4-dione (CH3-CO-CH2-CO-CH3) is placed on the lab pad with hydrogens shown. Select its most acidic hydrogen and submit.",
 "objective":"A C-H flanked by two carbonyl groups (pKa 9) is far more acidic than an ordinary alpha C-H (19): the enolate is stabilized by resonance onto both oxygens.",
 "hint":"Which carbon sits between the two C=O groups? Its hydrogens give a conjugate base with the charge delocalized over two oxygens.",
 "difficulty":"hard","points":8,
 "rule":{"type":"select-atom","molecules":["CC(=O)CC(C)=O"],"selector":{"kind":"most-acidic-h"},"target":"hydrogens","match":"any","maxAttempts":3,"answerDescription":"either hydrogen of the central CH2 (pKa 9; the terminal CH3 hydrogens are 19)"},
 "source":"MM 2.10 (m00027)"},
{"id":"ch2-select-most-acidic-h-2-ammonioethanol","chapter":2,"section":"2.8","topic":"acids-bases","title":"N+-H versus O-H",
 "instruction":"The 2-hydroxyethylammonium ion (HO-CH2-CH2-NH3+) is placed on the lab pad with hydrogens shown. Select its most acidic hydrogen and submit.",
 "objective":"A positively charged N-H (ammonium, pKa 10.6) is more acidic than a neutral O-H (16): losing H+ neutralizes the charge.",
 "hint":"Removing a proton from a positively charged atom gives a neutral molecule; removing it from a neutral atom creates a negative charge.",
 "difficulty":"medium","points":4,
 "rule":{"type":"select-atom","molecules":["OCC[NH3+]"],"selector":{"kind":"most-acidic-h"},"target":"hydrogens","match":"any","maxAttempts":3,"answerDescription":"any hydrogen on the NH3+ nitrogen (pKa 10.6; the O-H is 16.0)"},
 "source":"MM 2.8 (m00025)"},
{"id":"ch2-select-most-basic-site-2-aminoethanol","chapter":2,"section":"2.10","topic":"acids-bases","title":"Most basic site",
 "instruction":"2-Aminoethanol (H2N-CH2-CH2-OH) is placed on the lab pad and locked. Select the atom that is protonated first by a strong acid (the most basic site) and submit.",
 "objective":"An amine nitrogen (conjugate acid pKa 10.6) is a much stronger base than an alcohol oxygen (conjugate acid pKa about -2).",
 "hint":"The more stable the conjugate acid, the stronger the base. Compare RNH3+ (pKa 10.6) with ROH2+ (pKa about -2).",
 "difficulty":"easy","points":2,
 "rule":{"type":"select-atom","molecules":["OCCN"],"selector":{"kind":"most-basic-site"},"target":"atoms","match":"any","maxAttempts":3,"answerDescription":"the nitrogen atom (conjugate acid pKa 10.6)"},
 "source":"MM 2.10 (m00027)"},
{"id":"ch2-select-most-basic-n-3-aminopropanamide","chapter":2,"section":"2.10","topic":"acids-bases","title":"Which nitrogen is more basic?",
 "instruction":"3-Aminopropanamide (H2N-CH2-CH2-CO-NH2) is placed on the lab pad and locked. It has two nitrogen atoms. Select the more basic nitrogen and submit.",
 "objective":"An amide nitrogen is essentially nonbasic because its lone pair is delocalized into the C=O; the amine nitrogen is the basic site (McMurry 24.3).",
 "hint":"Which nitrogen's lone pair is free, and which one is tied up in resonance with a carbonyl group?",
 "difficulty":"medium","points":4,
 "rule":{"type":"select-atom","molecules":["NCCC(N)=O"],"selector":{"kind":"most-basic-n"},"target":"atoms","match":"any","maxAttempts":3,"answerDescription":"the amine nitrogen on the CH2 chain (conjugate acid pKa 10.6), not the amide nitrogen next to C=O (about -1)"},
 "source":"MM 2.10 (m00027)"},
{"id":"ch2-select-lewis-base-dimethyl-ether","chapter":2,"section":"2.11","topic":"acids-bases","title":"Lewis base site",
 "instruction":"Dimethyl ether (CH3-O-CH3) is placed on the lab pad and locked. Select the atom that donates an electron pair to BF3 (the Lewis base site) and submit.",
 "objective":"A Lewis base donates a lone pair; in an ether that is the oxygen.",
 "hint":"Which atom has nonbonding electrons?",
 "difficulty":"easy","points":2,
 "rule":{"type":"select-atom","molecules":["COC"],"selector":{"kind":"lone-pair-atom"},"target":"atoms","match":"all","maxAttempts":3,"answerDescription":"the oxygen atom (two lone pairs)"},
 "source":"MM 2.11 (m00028)"},
{"id":"ch2-quiz-acetic-acid-plus-hydroxide","chapter":2,"section":"2.9","topic":"acids-bases","title":"Does the reaction go?",
 "instruction":"Answer the yes/no question in the quiz panel using pKa values (acetic acid 4.76, water 15.74).",
 "objective":"An acid-base reaction favors products when the acid on the left has a lower pKa than the conjugate acid formed on the right.",
 "hint":"Compare the pKa of acetic acid with the pKa of water, the conjugate acid of hydroxide.",
 "difficulty":"easy","points":2,
 "rule":{"type":"quiz","kind":"yesno","prompt":"CH3CO2H + HO-  ->  CH3CO2- + H2O.  Does this reaction proceed as written (equilibrium favors products)?","correct":true,"maxAttempts":2,
  "explanation":"Acetic acid (pKa 4.76) is a stronger acid than water (pKa 15.74), so the equilibrium lies to the right by about 10^11 (McMurry 2.9)."},
 "source":"MM 2.9 (m00026)"},
{"id":"ch2-quiz-acetylene-plus-hydroxide","chapter":2,"section":"2.9","topic":"acids-bases","title":"Can hydroxide deprotonate acetylene?",
 "instruction":"Answer the yes/no question in the quiz panel using pKa values (acetylene 25, water 15.74).",
 "objective":"Hydroxide is too weak a base to remove the proton of a terminal alkyne; McMurry's worked example 2.4.",
 "hint":"The conjugate acid of HO- is water. Is water a weaker or a stronger acid than acetylene?",
 "difficulty":"medium","points":4,
 "rule":{"type":"quiz","kind":"yesno","prompt":"HC≡CH + HO-  ->  HC≡C- + H2O.  Does this reaction proceed as written (equilibrium favors products)?","correct":false,"maxAttempts":2,
  "explanation":"Acetylene (pKa 25) is a weaker acid than water (pKa 15.74), so the equilibrium lies to the left by about 10^9. A stronger base such as NaNH2 (conjugate acid NH3, pKa 36) is needed (McMurry 2.9 and 9.7)."},
 "source":"MM 2.9 (m00026)"}
]
```

Validation facts (from 03-stereo-acidity-hybridization §11, engine-verified): ethanol `OH.alcohol.primary` 16.0 vs `CH.alkane` 60; scene acetic/ethanol `OH.carboxylic` 4.8 vs 16.0; 2-mercaptoethanol `SH.thiol` 10.3 vs 16.0; pentane-2,4-dione `CH.alpha.ketone+ketone` 9 vs `CH.alpha.ketone` 19; 2-ammonioethanol `NH.ammonium.primary` 10.6 vs 16.0; 2-aminoethanol `B.N.amine.primary` 10.6 vs `B.O.alcohol` −2.4; 3-aminopropanamide (N only) `B.N.amine.primary` 10.6 vs `B.N.amide` −1. Every answer class is `verified: true` and every margin ≥ `PKA_MIN_MARGIN` (3). The pKa of NH3 is quoted as **36** everywhere a student can read it (this quiz explanation, `PKA['NH.amine.nh3'] = 36`, source `APP_B`, 03 §10.2); McMurry 9.7 rounds it to 35, which `PKA_SOURCES` records as a comment and which 04 §5.9.3 `JUSTIFY.internalAlkyne` must not quote (its text reads "pKa NH3 ≈ 36"). Propanamide, glycolamide and 3-hydroxypropanoic acid from the research pool are deliberately not used (unverified class or margin < 3).

### 4.3 Chapter 3 — Functional groups, isomers, alkane naming (10 challenges, 36 points)

```json
[
{"id":"ch3-fg-alcohol-c3h8o","chapter":3,"section":"3.1","topic":"functional-groups","title":"Build an alcohol",
 "instruction":"Build a molecule with the formula C3H8O that contains an alcohol group and no ether group. Target it and submit.",
 "objective":"An alcohol is C-O-H (Table 3.1); the same formula can also be an ether, which is a different functional group.",
 "hint":"Three carbons in a row; put an O-H on the end carbon (propan-1-ol) or the middle one (propan-2-ol).",
 "difficulty":"easy","points":2,
 "rule":{"type":"formula-and-groups","formula":"C3H8O","required":["alcohol"],"forbidden":["ether"]},"source":"MM 3.1 (m00032)"},
{"id":"ch3-fg-carboxylic-acid-c2h4o2","chapter":3,"section":"3.1","topic":"functional-groups","title":"Build a carboxylic acid",
 "instruction":"Build a molecule with the formula C2H4O2 that contains a carboxylic acid group. Target it and submit.",
 "objective":"-CO2H is one functional group (carbonyl carbon bonded to O-H), not a ketone plus an alcohol.",
 "hint":"One carbon carries both a C=O (bond wand) and an O-H: CH3-C(=O)-OH, acetic acid.",
 "difficulty":"easy","points":2,
 "rule":{"type":"formula-and-groups","formula":"C2H4O2","required":["carboxylic-acid"],"forbidden":["ester","aldehyde","ketone","alcohol","ether"]},"source":"MM 3.1 (m00032)"},
{"id":"ch3-fg-ester-c3h6o2","chapter":3,"section":"3.1","topic":"functional-groups","title":"Build an ester",
 "instruction":"Build a molecule with the formula C3H6O2 that contains an ester group and no carboxylic acid group. Target it and submit.",
 "objective":"An ester is C(=O)-O-C: an acid whose O-H hydrogen is replaced by a carbon.",
 "hint":"Methyl acetate CH3-C(=O)-O-CH3 or ethyl formate H-C(=O)-O-CH2CH3 both work.",
 "difficulty":"medium","points":4,
 "rule":{"type":"formula-and-groups","formula":"C3H6O2","required":["ester"],"forbidden":["carboxylic-acid","ketone","aldehyde","alcohol","ether"]},"source":"MM 3.1 (m00032)"},
{"id":"ch3-fg-amide-c2h5no","chapter":3,"section":"3.1","topic":"functional-groups","title":"Build an amide",
 "instruction":"Build a molecule with the formula C2H5NO that contains an amide group and no amine group. Target it and submit.",
 "objective":"An amide has nitrogen bonded directly to a carbonyl carbon; a nitrogen elsewhere is an amine.",
 "hint":"Acetamide CH3-C(=O)-NH2 or N-methylformamide H-C(=O)-NH-CH3.",
 "difficulty":"medium","points":4,
 "rule":{"type":"formula-and-groups","formula":"C2H5NO","required":["amide"],"forbidden":["amine","ketone","aldehyde","alcohol","imine"]},"source":"MM 3.1 (m00032)"},
{"id":"ch3-isomers-c4h10","chapter":3,"section":"3.2","topic":"isomers","title":"Both butanes",
 "instruction":"Build both constitutional isomers of C4H10 on the lab pad, submitting each one when it is finished (target it, then submit). The counter shows how many distinct skeletons you have made. Earlier isomers may stay on the pad.",
 "objective":"Same formula, different connectivity: butane and 2-methylpropane.",
 "hint":"A straight chain of four, then move one end carbon onto the middle carbon as a branch.",
 "difficulty":"easy","points":2,
 "rule":{"type":"isomer-set","formula":"C4H10","isomers":["CCCC","CC(C)C"],"count":2},"source":"MM 3.2 (m00033)"},
{"id":"ch3-isomers-c5h12","chapter":3,"section":"3.2","topic":"isomers","title":"Three pentanes",
 "instruction":"Build all three constitutional isomers of C5H12 on the lab pad, submitting each one when it is finished. Earlier isomers may stay on the pad.",
 "objective":"Branching multiplies isomers: pentane, 2-methylbutane, 2,2-dimethylpropane.",
 "hint":"Straight chain; one branch on C2; two branches on the same carbon.",
 "difficulty":"medium","points":4,
 "rule":{"type":"isomer-set","formula":"C5H12","isomers":["CCCCC","CCC(C)C","CC(C)(C)C"],"count":3},"source":"MM 3.2 (m00033)"},
{"id":"ch3-isomers-c6h14","chapter":3,"section":"3.2","topic":"isomers","title":"Five hexanes",
 "instruction":"Build all five constitutional isomers of C6H14 (McMurry Table 3.2) on the lab pad, submitting each one when it is finished. Earlier isomers may stay on the pad.",
 "objective":"Systematic enumeration: hexane, two methylpentanes, two dimethylbutanes.",
 "hint":"Hexane; 2-methylpentane; 3-methylpentane; 2,2-dimethylbutane; 2,3-dimethylbutane. 3-Methylpentane and 2-methylpentane are different: check where the branch sits.",
 "difficulty":"hard","points":8,
 "rule":{"type":"isomer-set","formula":"C6H14","isomers":["CCCCCC","CCCC(C)C","CCC(C)CC","CCC(C)(C)C","CC(C)C(C)C"],"count":5},"source":"MM 3.2 (m00033)"},
{"id":"ch3-name-3-ethyl-2-methylpentane","chapter":3,"section":"3.4","topic":"nomenclature","title":"Decode a name",
 "instruction":"Build 3-ethyl-2-methylpentane on the lab pad, target it and submit.",
 "objective":"Parent chain, locants and alphabetical substituent order (ethyl before methyl).",
 "hint":"A five-carbon chain numbered so the first branch gets the lowest number: methyl on C2, ethyl on C3.",
 "difficulty":"medium","points":4,
 "rule":{"type":"name-to-structure","names":["3-ethyl-2-methylpentane"],"target":"CCC(CC)C(C)C"},"source":"MM 3.4 (m00035)"},
{"id":"ch3-name-2-2-4-trimethylpentane","chapter":3,"section":"3.4","topic":"nomenclature","title":"Isooctane",
 "instruction":"Build 2,2,4-trimethylpentane (isooctane) on the lab pad, target it and submit.",
 "objective":"Multiple identical substituents: one locant per group, tri- prefix, a carbon may carry two methyls.",
 "hint":"Five-carbon chain; two methyls on C2 (a quaternary carbon) and one on C4.",
 "difficulty":"medium","points":4,
 "rule":{"type":"name-to-structure","names":["2,2,4-trimethylpentane","isooctane"],"target":"CC(C)CC(C)(C)C"},"source":"MM 3.4 (m00035)"},
{"id":"ch3-select-tertiary-carbon-2-methylbutane","chapter":3,"section":"3.3","topic":"alkyl-groups","title":"Find the tertiary carbon",
 "instruction":"2-Methylbutane is placed on the lab pad and locked. Select its tertiary carbon (the carbon bonded to exactly three other carbons) and submit.",
 "objective":"Primary, secondary, tertiary and quaternary carbons are classified by the number of carbon neighbours.",
 "hint":"Count carbon neighbours only; hydrogens do not count.",
 "difficulty":"easy","points":2,
 "rule":{"type":"select-atom","molecules":["CCC(C)C"],"selector":{"kind":"tertiary-carbon"},"target":"atoms","match":"all","maxAttempts":3,"answerDescription":"the branch carbon C2, which has three carbon neighbours"},
 "source":"MM 3.3 (m00034)"}
]
```

Accepted sets (enumerated by tests): alcohol C3H8O → propan-1-ol, propan-2-ol; carboxylic acid C2H4O2 → acetic acid only; ester C3H6O2 → methyl ethanoate, ethyl methanoate; amide C2H5NO → ethanamide, N-methylmethanamide. Negative fixtures: methoxyethane for the alcohol rule (`forbidden-group`), methyl formate for the acid rule (`missing-group`), propanoic acid for the ester rule (`forbidden-group`), 2-aminoacetaldehyde `NCC=O` for the amide rule (`missing-group`; amine also forbidden).

### 4.4 Chapter 4 — Cycloalkanes and cis/trans (6 challenges, 22 points)

```json
[
{"id":"ch4-isomers-c4h8","chapter":4,"section":"4.1","topic":"isomers","title":"Four ways to be C4H8",
 "instruction":"Build every constitutional isomer of C4H8 that can be made with face-to-face bonds on this grid: three alkenes and one four-membered ring. Submit each one when it is finished; earlier isomers may stay on the pad. (A fifth isomer, methylcyclopropane, needs a three-membered ring and is not required.)",
 "objective":"One degree of unsaturation is either one C=C or one ring; E and Z but-2-ene count as one constitutional isomer.",
 "hint":"But-1-ene, but-2-ene, 2-methylpropene, cyclobutane (a 2x2 square of carbons).",
 "difficulty":"medium","points":4,
 "rule":{"type":"isomer-set","formula":"C4H8","isomers":["C=CCC","C/C=C/C","C=C(C)C","C1CCC1"],"count":4,"optionalDiagonalIsomers":["CC1CC1"]},"source":"MM 4.1 (m00040)"},
{"id":"ch4-cycloalkane-c5h10","chapter":4,"section":"4.1","topic":"cycloalkanes","title":"A five-carbon cycloalkane",
 "instruction":"Build a cycloalkane (one ring, no double or triple bonds) with the formula C5H10 whose ring has four carbons. Target it and submit.",
 "objective":"Cycloalkanes are CnH2n; the ring is the parent and the extra carbon is a methyl substituent.",
 "hint":"A 2x2 square of carbons (cyclobutane) with one more carbon attached: methylcyclobutane. Cyclopentane itself cannot be built on this grid.",
 "difficulty":"medium","points":4,
 "rule":{"type":"formula-and-groups","formula":"C5H10","required":[],"forbidden":["alkene","alkyne"],"ringCount":1,"ringSizes":[4]},"source":"MM 4.1 (m00040)"},
{"id":"ch4-name-methylcyclohexane","chapter":4,"section":"4.1","topic":"nomenclature","title":"Methylcyclohexane",
 "instruction":"Build methylcyclohexane on the lab pad, target it and submit. A six-membered ring on this grid is a chair: six corners of a cube (see Help > Rings). Build it one block above the pad floor so the chair has room.",
 "objective":"The ring is the parent when it has at least as many carbons as the substituent; no locant is needed for one substituent.",
 "hint":"Walk around a 2x2x2 cube visiting six of its eight corners so that consecutive corners touch face to face, then attach one carbon to any ring carbon on a free face.",
 "difficulty":"easy","points":2,
 "rule":{"type":"name-to-structure","names":["methylcyclohexane"],"target":"CC1CCCCC1"},"source":"MM 4.1 (m00040)"},
{"id":"ch4-build-c6h12-six-membered-ring","chapter":4,"section":"4.1","topic":"unsaturation","title":"A ring instead of a double bond",
 "instruction":"Build a molecule with the formula C6H12 that contains a six-membered ring. Target it and submit.",
 "objective":"One degree of unsaturation realized as a ring; the cyclohexane chair on the cube corners.",
 "hint":"Cyclohexane is the only C6H12 with a six-membered ring. Use the cube-corner chair (Help > Rings); a flat 2x3 rectangle bonds across the middle and becomes two fused rings.",
 "difficulty":"medium","points":4,
 "rule":{"type":"formula-and-groups","formula":"C6H12","required":[],"forbidden":["alkene","alkyne"],"ringCount":1,"ringSizes":[6]},"source":"MM 4.1 (m00040)"},
{"id":"ch4-cis-1-2-dimethylcyclohexane","chapter":4,"section":"4.2","topic":"cis-trans","title":"cis-1,2-Dimethylcyclohexane",
 "instruction":"Build cis-1,2-dimethylcyclohexane on the lab pad: a cyclohexane chair with two methyl groups on adjacent ring carbons, both on the same face of the ring. On this grid one of the two methyls must point straight out in the ring's own plane, and that ring carbon then needs an explicit hydrogen block (H slot in the hotbar) above or below to fix its configuration. The panel shows 'cis' between the two substituents when you have it. Target and submit.",
 "objective":"cis = same face of the ring; the cis-1,2 isomer is a meso compound (superimposable on its mirror image).",
 "hint":"Put the first methyl perpendicular to the ring at its carbon. For the neighbouring carbon, the perpendicular spot that would be cis is already touching another ring atom, so put that methyl in-plane and place an H block on the free face; the ring-face arrows in the panel tell you if the two substituents are on the same side.",
 "difficulty":"medium","points":4,
 "rule":{"type":"stereo-exact","target":"C[C@H]1CCCC[C@H]1C","mode":"relative"},"source":"MM 4.2 (m00041)",
 "feedback":{"diastereomer":"Your two methyl groups are on opposite faces of the ring: that is the trans isomer. cis means both on the same face."}},
{"id":"ch4-trans-1-2-dimethylcyclohexane","chapter":4,"section":"4.2","topic":"cis-trans","title":"trans-1,2-Dimethylcyclohexane",
 "instruction":"Build trans-1,2-dimethylcyclohexane on the lab pad: a cyclohexane chair with two methyl groups on adjacent ring carbons, one above and one below the ring. Either enantiomer is accepted. Target and submit.",
 "objective":"trans = opposite faces; the trans-1,2 isomer is chiral (a pair of enantiomers, 1R,2R and 1S,2S).",
 "hint":"Put each methyl on the free face that is perpendicular to both ring bonds at its carbon; on the cube chair those two spots are automatically on opposite faces.",
 "difficulty":"medium","points":4,
 "rule":{"type":"stereo-exact","target":"C[C@@H]1CCCC[C@H]1C","mode":"relative","accept":["C[C@H]1CCCC[C@@H]1C"]},"source":"MM 4.2 (m00041)",
 "feedback":{"diastereomer":"Your two methyl groups are on the same face of the ring: that is the cis (meso) isomer. trans means opposite faces."}}
]
```

`ch4-cycloalkane-c5h10` accepts exactly methylcyclobutane (`CC1CCC1`); ethylcyclopropane, dimethylcyclopropanes and cyclopentane fail `ringSizes` (and are unbuildable). `ch4-build-c6h12-six-membered-ring` accepts exactly cyclohexane (critic C12 fix: `ringSizes: [6]` rejects every methylcyclopentane/ethylcyclobutane/dimethylcyclobutane). The cis/trans ring facts are in §6.3.

### 4.5 Chapter 5 — Stereochemistry at tetrahedral centres (8 challenges, 42 points)

```json
[
{"id":"ch5-select-chirality-center-butan-2-ol","chapter":5,"section":"5.2","topic":"chirality","title":"Find the chirality centre",
 "instruction":"Butan-2-ol (CH3-CH(OH)-CH2-CH3) is placed on the lab pad and locked. Select its chirality centre (the carbon bonded to four different groups) and submit.",
 "objective":"A chirality centre carries four different groups: here H, OH, CH3 and CH2CH3.",
 "hint":"A CH2 or CH3 carbon can never be a chirality centre: it has two or three identical hydrogens.",
 "difficulty":"easy","points":2,
 "rule":{"type":"select-atom","molecules":["CCC(C)O"],"selector":{"kind":"chirality-center"},"target":"atoms","match":"all","maxAttempts":3,"answerDescription":"C2, the carbon bonded to OH, H, CH3 and CH2CH3"},
 "source":"MM 5.2 (m00051)"},
{"id":"ch5-build-r-2-bromobutane","chapter":5,"section":"5.5","topic":"R/S","title":"(R)-2-Bromobutane",
 "instruction":"Build (R)-2-bromobutane on the lab pad. Give C2 three substituents at right angles to each other (an 'octant' arrangement) so its hidden hydrogen has only one possible place, or place the hydrogen block explicitly. The panel labels the centre R or S. Target and submit.",
 "objective":"CIP priorities Br > CH2CH3 > CH3 > H; with H pointing away, Br -> ethyl -> methyl clockwise is R.",
 "hint":"Rank: Br first, then the ethyl carbon (C,H,H) beats the methyl carbon (H,H,H). If the panel says S, swap any two of the three groups on C2.",
 "difficulty":"medium","points":4,
 "rule":{"type":"stereo-exact","target":"C[C@@H](Br)CC","mode":"absolute"},"source":"MM 5.5 (m00054)"},
{"id":"ch5-build-s-alanine","chapter":5,"section":"5.5","topic":"R/S","title":"(S)-Alanine",
 "instruction":"Build (S)-alanine, (S)-2-aminopropanoic acid (CH3-CH(NH2)-CO2H), the natural L enantiomer, on the lab pad. Make C2 an octant centre or place its hydrogen explicitly. Target and submit.",
 "objective":"NH2 > CO2H > CH3 > H (the carboxyl carbon outranks the methyl because it carries oxygens); S = counter-clockwise.",
 "hint":"Rank by the first atom: N beats C. Between the two carbons, the one bonded to (O,O,O) beats (H,H,H). With H away, N -> CO2H -> CH3 counter-clockwise is S.",
 "difficulty":"medium","points":4,
 "rule":{"type":"stereo-exact","target":"N[C@@H](C)C(=O)O","mode":"absolute"},"source":"MM 5.5 (m00054)",
 "feedback":{"enantiomer":"Right molecule, wrong hand: you built (R)-alanine, the unnatural D enantiomer. Swap any two groups on C2. (S)-Alanine is the naturally occurring (+) enantiomer (McMurry 5.5)."}},
{"id":"ch5-build-r-lactic-acid","chapter":5,"section":"5.5","topic":"R/S","title":"(R)-Lactic acid",
 "instruction":"Build (R)-lactic acid, (R)-2-hydroxypropanoic acid (CH3-CH(OH)-CO2H), on the lab pad. Make C2 an octant centre or place its hydrogen explicitly. Target and submit.",
 "objective":"OH > CO2H > CH3 > H; McMurry Figure 5.6: (-)-lactic acid is R.",
 "hint":"Oxygen outranks carbon, so OH is first; the CO2H carbon (O,O,O) beats CH3 (H,H,H).",
 "difficulty":"medium","points":4,
 "rule":{"type":"stereo-exact","target":"C[C@@H](O)C(=O)O","mode":"absolute"},"source":"MM 5.5 (m00054)"},
{"id":"ch5-build-r-3-methylhexane","chapter":5,"section":"5.5","topic":"R/S","title":"(R)-3-Methylhexane",
 "instruction":"Build (R)-3-methylhexane on the lab pad. Every group on C3 is carbon, so the priorities are decided further out along each chain. Make C3 an octant centre or place its hydrogen explicitly. Target and submit.",
 "objective":"CIP rule 2: when the first atoms tie, compare outward: propyl (C,H,H then C,H,H) beats ethyl (C,H,H then H,H,H) beats methyl.",
 "hint":"Propyl > ethyl > methyl > H. Propyl and ethyl tie at the first and second atoms; at the third atom propyl still has a carbon and ethyl has only hydrogens.",
 "difficulty":"hard","points":8,
 "rule":{"type":"stereo-exact","target":"CCC[C@H](C)CC","mode":"absolute"},"source":"MM 5.5 (m00054)"},
{"id":"ch5-build-meso-2-3-dibromobutane","chapter":5,"section":"5.7","topic":"meso","title":"meso-2,3-Dibromobutane",
 "instruction":"Build meso-2,3-dibromobutane, the (2R,3S) stereoisomer, on the lab pad. Both C2 and C3 need a definite configuration: make each an octant centre or place its hydrogen explicitly. The panel must report 'meso'. Target and submit.",
 "objective":"Two chirality centres with opposite labels and a mirror plane: the compound is superimposable on its mirror image (achiral).",
 "hint":"If you reflect a meso compound you get the same molecule. Make one centre R and the other S; the panel shows both labels and the word 'meso'.",
 "difficulty":"hard","points":8,
 "rule":{"type":"stereo-exact","target":"C[C@H](Br)[C@H](Br)C","mode":"absolute"},"source":"MM 5.7 (m00056)",
 "feedback":{"diastereomer":"You built the chiral (2R,3R) or (2S,3S) diastereomer. A meso compound has an internal mirror plane: make one centre R and the other S."}},
{"id":"ch5-build-2r-3r-dibromobutane","chapter":5,"section":"5.6","topic":"R/S","title":"(2R,3R)-2,3-Dibromobutane",
 "instruction":"Build (2R,3R)-2,3-dibromobutane on the lab pad. Both C2 and C3 need a definite configuration: make each an octant centre or place its hydrogen explicitly. Target and submit.",
 "objective":"Two identical centres with the same label give a chiral molecule; (2S,3S) is its enantiomer and the meso form is a diastereomer.",
 "hint":"Br > CH(Br)CH3 > CH3 > H at each centre. Check each label in the panel; both must read R.",
 "difficulty":"hard","points":8,
 "rule":{"type":"stereo-exact","target":"C[C@@H](Br)[C@H](Br)C","mode":"absolute"},"source":"MM 5.6 (m00055)",
 "feedback":{"enantiomer":"That is (2S,3S)-2,3-dibromobutane, the enantiomer. Both centres must be R.","diastereomer":"That is meso-(2R,3S)-2,3-dibromobutane, a diastereomer. Both centres must be R."}},
{"id":"ch5-quiz-cis-1-2-dimethylcyclohexane-chiral","chapter":5,"section":"5.7","topic":"meso","title":"Is it chiral?",
 "instruction":"cis-1,2-Dimethylcyclohexane is shown. Answer the yes/no question in the quiz panel.",
 "objective":"A compound with chirality centres can still be achiral if it has a mirror plane (meso).",
 "hint":"Is there a plane that cuts the ring between C1 and C2 and reflects one methyl onto the other?",
 "difficulty":"medium","points":4,
 "rule":{"type":"quiz","kind":"yesno","prompt":"cis-1,2-Dimethylcyclohexane has two chirality centres. Is the molecule chiral?","correct":false,"maxAttempts":2,
  "explanation":"No. The two centres are R and S, and a mirror plane passes through the ring between C1 and C2, so the cis isomer is a meso compound and is achiral. The trans isomer has no such plane and is chiral (McMurry 5.7).",
  "display":{"smiles":"C[C@H]1CCCC[C@H]1C"}},
 "source":"MM 5.7 (m00056)"}
]
```

### 4.6 Chapter 6 — Overview of reactions (1 challenge, 2 points)

```json
[
{"id":"ch6-predict-ethene-hbr","chapter":6,"section":"6.4","topic":"addition","title":"First reaction: ethene + HBr",
 "instruction":"Go to the reaction bench. Ethene is locked in the reactant zone. Apply the HBr card and build the product in the product zone, then submit.",
 "objective":"Electrophilic addition: the C=C pi bond is the nucleophile, H+ the electrophile; the product is bromoethane.",
 "hint":"H adds to one carbon and Br to the other; the double bond becomes a single bond.",
 "difficulty":"easy","points":2,
 "rule":{"type":"predict-product","reactant":"C=C","reagentId":"HX_HBR","expected":["CCBr"],"stereoCheck":"none"},"source":"MM 6.4 (m00080)"}
]
```

### 4.7 Chapter 7 — Alkenes: structure, E/Z, Markovnikov (10 challenges, 46 points)

```json
[
{"id":"ch7-unsaturation-c6h10","chapter":7,"section":"7.2","topic":"unsaturation","title":"Two degrees of unsaturation",
 "instruction":"Build any molecule with the formula C6H10 that has exactly one ring and exactly one C=C double bond (no triple bond). Target it and submit.",
 "objective":"Degree of unsaturation = (2C + 2 - H)/2 = 2 here; each ring and each pi bond accounts for one.",
 "hint":"(2 x 6 + 2 - 10)/2 = 2. Cyclohexene (a chair ring with one double bond) is the simplest answer; a cyclobutane ring plus an ethenyl or ethylidene group also works.",
 "difficulty":"medium","points":4,
 "rule":{"type":"formula-and-groups","formula":"C6H10","required":["alkene"],"forbidden":["alkyne"],"ringCount":1,"piBonds":1},"source":"MM 7.2 (m00064)"},
{"id":"ch7-name-2-methylbut-2-ene","chapter":7,"section":"7.3","topic":"nomenclature","title":"Name an alkene",
 "instruction":"Build 2-methylbut-2-ene (McMurry: 2-methyl-2-butene) on the lab pad, target it and submit.",
 "objective":"The chain must contain the C=C; number from the end nearer the double bond; the alkene locant comes before -ene.",
 "hint":"A four-carbon chain with the double bond between C2 and C3 and a methyl on C2: (CH3)2C=CH-CH3.",
 "difficulty":"easy","points":2,
 "rule":{"type":"name-to-structure","names":["2-methylbut-2-ene","2-methyl-2-butene"],"target":"CC=C(C)C"},"source":"MM 7.3 (m00065)"},
{"id":"ch7-build-e-but-2-ene","chapter":7,"section":"7.4","topic":"E/Z","title":"(E)-But-2-ene",
 "instruction":"Build (E)-but-2-ene (trans-2-butene) on the lab pad: the two methyl groups on opposite sides of the C=C, all four carbons in one plane (a zigzag). Target and submit. The panel labels the double bond E or Z.",
 "objective":"E = higher-priority groups on opposite sides; a double bond cannot rotate, so E and Z are different compounds.",
 "hint":"Put one CH3 above its alkene carbon and the other CH3 below its alkene carbon, in the same plane as the C=C (up-down zigzag, never a straight line and never twisted out of the plane).",
 "difficulty":"medium","points":4,
 "rule":{"type":"stereo-exact","target":"C/C=C/C","mode":"absolute"},"source":"MM 7.4 (m00066)",
 "feedback":{"diastereomer":"Your double bond is Z (cis): the two methyl groups are on the same side. Move one methyl to the opposite side of the C=C."}},
{"id":"ch7-build-z-but-2-ene","chapter":7,"section":"7.4","topic":"E/Z","title":"(Z)-But-2-ene",
 "instruction":"Build (Z)-but-2-ene (cis-2-butene) on the lab pad: the two methyl groups on the SAME side of the C=C, all four carbons in one plane (a U shape). The two methyl blocks touch and bond into a ring at first: point the bond wand (B) at the bar between them and press E until it becomes a red x break marker (no bond). Target and submit. The panel labels the double bond E or Z.",
 "objective":"Z = higher-priority groups on the same side. On the block grid a cis pair of substituents touches, so the automatic bond between them must be broken with the wand; the two methyls are then not bonded and the molecule is an open-chain alkene.",
 "hint":"CH3 above C2, C2=C3 across, CH3 above C3. Cycle the bar between the two CH3 blocks with the wand (B, then E: double, triple, no bond) until the red x marker shows, then set C2=C3 to double.",
 "difficulty":"medium","points":4,
 "rule":{"type":"stereo-exact","target":"C/C=C\\C","mode":"absolute"},"source":"MM 7.4 (m00066)",
 "feedback":{"diastereomer":"Your double bond is E (trans): the two methyl groups are on opposite sides. Move one methyl so both are on the same side of the C=C, then break the bond between them with the wand."}},
{"id":"ch7-build-2e-4e-hexa-2-4-diene","chapter":7,"section":"7.5","topic":"E/Z","title":"(2E,4E)-Hexa-2,4-diene",
 "instruction":"Build (2E,4E)-hexa-2,4-diene (CH3-CH=CH-CH=CH-CH3) on the lab pad with both double bonds E, all six carbons in one plane. Target and submit. The panel labels each double bond.",
 "objective":"Each double bond gets its own E/Z descriptor; a planar zigzag chain makes both E.",
 "hint":"An all-trans zigzag: go up, across, down, across, up, across, down. Every substituent must be beside its alkene carbon, never in line with the C=C.",
 "difficulty":"hard","points":8,
 "rule":{"type":"stereo-exact","target":"C/C=C/C=C/C","mode":"absolute"},"source":"MM 7.5 (m00067)"},
{"id":"ch7-build-z-2-chlorobut-2-ene","chapter":7,"section":"7.5","topic":"E/Z","title":"Build (Z)-2-chlorobut-2-ene",
 "instruction":"Build (Z)-2-chlorobut-2-ene, CH3-C(Cl)=CH-CH3, on the lab pad. Rank the two groups on each alkene carbon (Cl versus CH3 on C2; CH3 versus H on C3): Z means the two higher-priority groups are on the same side of the C=C. Keep every substituent beside its alkene carbon, all in one plane. Two blocks on the same side touch and bond at first: break that bond with the bond wand (B, then E until the red x marker). Target and submit.",
 "objective":"E/Z for a trisubstituted alkene: rank the substituents on each carbon by atomic number (Cl > C on C2; C > H on C3); Z when the higher-ranked groups are on the same side (McMurry 7.5).",
 "hint":"McMurry's own example. Chlorine outranks methyl on C2; methyl outranks hydrogen on C3. Put the Cl and the C3 methyl on the same side (Z, zusammen: on ze zame zide); the C2 methyl goes opposite the Cl. The Cl block and the C3 methyl block touch: cycle that bar to no bond.",
 "difficulty":"hard","points":8,
 "rule":{"type":"stereo-exact","target":"C/C=C(\\Cl)C","mode":"absolute"},"source":"MM 7.5 (m00067)",
 "feedback":{"diastereomer":"Your double bond is E: the chlorine (highest priority on C2) and the C3 methyl (highest on C3) are on opposite sides. Z puts them on the same side; the C2 methyl then sits opposite the chlorine."}},
{"id":"ch7-quiz-alkene-stability","chapter":7,"section":"7.6","topic":"alkene-stability","title":"Which alkene is most stable?",
 "instruction":"Answer the quiz question using McMurry Table 7.2 (heats of hydrogenation).",
 "objective":"Stability: more substituted > less substituted; trans > cis (steric strain between cis substituents).",
 "hint":"A smaller heat of hydrogenation means a more stable alkene: but-1-ene -127, (Z)-but-2-ene -120, (E)-but-2-ene -116 kJ/mol.",
 "difficulty":"medium","points":4,
 "rule":{"type":"quiz","kind":"mc","prompt":"Which of these C4 alkenes is the most stable?",
  "options":[{"id":"a","text":"but-1-ene"},{"id":"b","text":"(Z)-but-2-ene (cis)"},{"id":"c","text":"(E)-but-2-ene (trans)"},{"id":"d","text":"They are equally stable"}],
  "correct":["c"],"shuffle":true,"maxAttempts":2,
  "explanation":"Disubstituted alkenes are more stable than monosubstituted ones, and the trans isomer is more stable than the cis isomer because the cis methyl groups crowd each other. Heats of hydrogenation (Table 7.2): but-1-ene -127, cis-but-2-ene -120, trans-but-2-ene -116 kJ/mol."},
 "source":"MM 7.6 (m00068)"},
{"id":"ch7-select-carbocation-carbon-2-methylpropene","chapter":7,"section":"7.9","topic":"carbocations","title":"Where does the positive charge go?",
 "instruction":"2-Methylpropene ((CH3)2C=CH2) is placed on the lab pad and locked. When H+ adds to this alkene, one carbon becomes a carbocation. Select the carbon that carries the positive charge in the more stable carbocation and submit.",
 "objective":"Carbocation stability 3 > 2 > 1 > methyl; H+ adds to the less substituted carbon so the charge lands on the more substituted one (Markovnikov).",
 "hint":"Which alkene carbon has more alkyl groups attached? That carbon makes the more stable (tertiary) cation.",
 "difficulty":"easy","points":2,
 "rule":{"type":"select-atom","molecules":["C=C(C)C"],"selector":{"kind":"more-substituted-alkene-carbon"},"target":"atoms","match":"all","maxAttempts":3,"answerDescription":"C2, the alkene carbon bonded to two methyl groups"},
 "source":"MM 7.9 (m00071)"},
{"id":"ch7-predict-2-methylpropene-hcl","chapter":7,"section":"7.8","topic":"addition","title":"Markovnikov addition of HCl",
 "instruction":"Reaction bench: 2-methylpropene is locked in the reactant zone. Apply the HCl card, build the single product in the product zone and submit.",
 "objective":"Markovnikov's rule: H goes to the carbon with more hydrogens, Cl to the more substituted carbon via the tertiary carbocation.",
 "hint":"The product is 2-chloro-2-methylpropane, (CH3)3C-Cl.",
 "difficulty":"easy","points":2,
 "rule":{"type":"predict-product","reactant":"C=C(C)C","reagentId":"HX_HCL","expected":["CC(C)(C)Cl"],"stereoCheck":"none"},"source":"MM 7.8 (m00070)"},
{"id":"ch7-predict-rearrangement-3-methylbut-1-ene-hcl","chapter":7,"section":"7.11","topic":"rearrangement","title":"A carbocation rearrangement",
 "instruction":"Reaction bench: 3-methylbut-1-ene (CH2=CH-CH(CH3)2) is locked in the reactant zone. Apply the HCl card. The first-formed secondary carbocation rearranges by a hydride shift to a tertiary carbocation. Build the REARRANGED product (the chloride from the tertiary cation) in the product zone and submit. The unrearranged product is also formed and earns half credit.",
 "objective":"A 1,2-hydride shift converts a secondary carbocation into a more stable tertiary one before chloride attacks (McMurry 7.11: about a 1:1 mixture).",
 "hint":"After H+ adds to C1, the cation is on C2 (secondary). An H moves from C3 to C2, putting the cation on C3 (tertiary). Cl then bonds to C3: 2-chloro-2-methylbutane.",
 "difficulty":"hard","points":8,
 "rule":{"type":"predict-product","reactant":"C=CC(C)C","reagentId":"HX_HCL","expected":["CCC(C)(C)Cl"],"stereoCheck":"none",
  "acceptAlso":[{"smiles":"CC(C)C(C)Cl","note":"2-chloro-3-methylbutane, the unrearranged product: also formed (about 1:1, McMurry 7.11). Build 2-chloro-2-methylbutane, the product of the hydride shift, for full credit."}]},
 "source":"MM 7.11 (m00073)"}
]
```

`ch7-unsaturation-c6h10` is intentionally open: cyclohexene, 1-ethylcyclobutene, 3-ethylcyclobutene, 1,2-/1,3-/3,3-dimethylcyclobutene, ethenylcyclobutane and ethylidenecyclobutane all pass (all correct chemistry); the enumerated negatives are hexa-1,3-diene (`wrong-ring-count`), cyclohexane C6H12 (`wrong-formula`), hex-1-yne (`forbidden-group`), bicyclo[2.2.0]hexane (`wrong-pi-count`). The bench runs `react` with `rearrangement: 'warn'` (R7), which returns both chlorides with `mixture: true`; the challenge grades the rearranged one as `expected` and the other through `acceptAlso`.

### 4.8 Chapter 8 — Alkene reactions (10 challenges, 50 points)

```json
[
{"id":"ch8-predict-koh-etoh-bromocyclohexane","chapter":8,"section":"8.1","topic":"elimination","title":"Make an alkene by elimination",
 "instruction":"Reaction bench: bromocyclohexane is locked in the reactant zone. Apply the KOH / ethanol card, build the product in the product zone and submit.",
 "objective":"Dehydrohalogenation: a strong base removes H and X from adjacent carbons to form C=C.",
 "hint":"Remove Br and a hydrogen from the neighbouring ring carbon; the product is cyclohexene.",
 "difficulty":"easy","points":2,
 "rule":{"type":"predict-product","reactant":"BrC1CCCCC1","reagentId":"KOH_ETOH","expected":["C1CCC=CC1"],"stereoCheck":"none"},"source":"MM 8.1 (m00089)"},
{"id":"ch8-predict-br2-e-but-2-ene-meso","chapter":8,"section":"8.2","topic":"anti-addition","title":"Anti addition of Br2",
 "instruction":"Reaction bench: (E)-but-2-ene is locked in the reactant zone. Apply the Br2 / CH2Cl2 card and build the product in the product zone WITH the correct stereochemistry: both new centres must have a definite configuration (octant centres or explicit hydrogens). Submit.",
 "objective":"Br2 adds anti through a bromonium ion; a trans alkene therefore gives meso-2,3-dibromobutane.",
 "hint":"The two bromines end up on opposite faces of the former double bond. With the E alkene that makes the (2R,3S) meso compound; the panel should say 'meso'.",
 "difficulty":"hard","points":8,
 "rule":{"type":"predict-product","reactant":"C/C=C/C","reagentId":"X2_BR2","expected":["C[C@H](Br)[C@H](Br)C"],"stereoCheck":"relative"},"source":"MM 8.2 (m00090)",
 "feedback":{"diastereomer":"You built (2R,3R)- or (2S,3S)-2,3-dibromobutane. Br2 adds anti, so the trans alkene gives the meso (2R,3S) product: put the two bromines on opposite faces."}},
{"id":"ch8-predict-br2-cyclohexene-trans","chapter":8,"section":"8.2","topic":"anti-addition","title":"Br2 on a ring: trans product",
 "instruction":"Reaction bench: cyclohexene is locked in the reactant zone. Apply the Br2 / CH2Cl2 card and build the product with the correct cis/trans relationship of the two bromines (either enantiomer). Submit.",
 "objective":"Anti addition to a cycloalkene gives the trans-1,2-dibromide as a racemic pair.",
 "hint":"One Br above the ring, the other below, on adjacent carbons: trans-1,2-dibromocyclohexane.",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"C1CCC=CC1","reagentId":"X2_BR2","expected":["Br[C@@H]1CCCC[C@H]1Br"],"stereoCheck":"relative"},"source":"MM 8.2 (m00090)",
 "feedback":{"diastereomer":"Your bromines are cis (same face). Br2 adds anti: the product is trans-1,2-dibromocyclohexane."}},
{"id":"ch8-predict-hydroboration-2-methylbut-2-ene","chapter":8,"section":"8.5","topic":"hydration","title":"Anti-Markovnikov hydration",
 "instruction":"Reaction bench: 2-methylbut-2-ene is locked in the reactant zone. Apply the hydroboration-oxidation card (1. BH3, THF; 2. H2O2, NaOH), build the alcohol in the product zone and submit.",
 "objective":"Hydroboration-oxidation puts OH on the less substituted alkene carbon (non-Markovnikov, syn).",
 "hint":"OH goes to the CH carbon, H to the C(CH3)2 carbon: 3-methylbutan-2-ol.",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"CC=C(C)C","reagentId":"HYDROBORATION","expected":["CC(C)C(C)O"],"stereoCheck":"none"},"source":"MM 8.5 (m00093)"},
{"id":"ch8-predict-hydroboration-1-methylcyclohexene","chapter":8,"section":"8.5","topic":"hydration","title":"Hydroboration is syn",
 "instruction":"Reaction bench: 1-methylcyclohexene is locked in the reactant zone. Apply the hydroboration-oxidation card and build the alcohol in the product zone with the correct cis/trans relationship between the OH and the CH3 (either enantiomer). Submit.",
 "objective":"H and OH add syn (same face) and anti-Markovnikov: the OH lands on C2 and ends up trans to the methyl on C1.",
 "hint":"The new H goes to C1 on the same face as the new OH on C2; the methyl already on C1 is therefore pushed to the other face: trans-2-methylcyclohexanol.",
 "difficulty":"hard","points":8,
 "rule":{"type":"predict-product","reactant":"CC1=CCCCC1","reagentId":"HYDROBORATION","expected":["C[C@@H]1CCCC[C@H]1O"],"stereoCheck":"relative"},"source":"MM 8.5 (m00093)",
 "feedback":{"diastereomer":"Your OH and CH3 are cis. H and OH add to the same face, which forces the methyl to the opposite face from the OH: the product is trans-2-methylcyclohexanol."}},
{"id":"ch8-choose-anti-markovnikov-hydration","chapter":8,"section":"8.5","topic":"hydration","title":"Choose the hydration method",
 "instruction":"At the reaction bench, 2-methylpropene is shown as the reactant and 2-methylpropan-1-ol as the target product. Pick the reagent card that performs this conversion and submit.",
 "objective":"Oxymercuration and acid-catalysed hydration are Markovnikov; hydroboration-oxidation is the complementary anti-Markovnikov method.",
 "hint":"The OH must end up on the CH2 carbon (less substituted). Which reagent delivers OH there?",
 "difficulty":"medium","points":4,
 "rule":{"type":"choose-reagent","reactant":"C=C(C)C","product":"CC(C)CO","options":["OXYMERC","HYDROBORATION","H3O_HYDRATION","H2_PD"],"correct":["HYDROBORATION"],"maxAttempts":2,
  "rejections":{"OXYMERC":"Oxymercuration-demercuration is Markovnikov: the OH goes to the more substituted carbon and gives 2-methylpropan-2-ol (tert-butyl alcohol).","H3O_HYDRATION":"Acid-catalysed hydration is Markovnikov via the tertiary carbocation and gives 2-methylpropan-2-ol.","H2_PD":"Catalytic hydrogenation adds H2, not water; it gives 2-methylpropane."}},
 "source":"MM 8.5 (m00093)"},
{"id":"ch8-predict-oso4-cyclohexene-cis-diol","chapter":8,"section":"8.7","topic":"hydroxylation","title":"Syn dihydroxylation",
 "instruction":"Reaction bench: cyclohexene is locked in the reactant zone. Apply the OsO4 card (then NaHSO3), build the diol in the product zone with the correct cis/trans relationship of the two OH groups and submit.",
 "objective":"OsO4 adds two OH groups syn through a cyclic osmate ester: cis-1,2-diol.",
 "hint":"Both OH groups on the same face of the ring: cis-cyclohexane-1,2-diol (a meso compound).",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"C1CCC=CC1","reagentId":"OSO4","expected":["O[C@H]1CCCC[C@H]1O"],"stereoCheck":"relative"},"source":"MM 8.7 (m00095)",
 "feedback":{"diastereomer":"Your OH groups are trans. OsO4 delivers both oxygens from the same face: the product is the cis diol."}},
{"id":"ch8-predict-h2-1-2-dimethylcyclohexene","chapter":8,"section":"8.6","topic":"reduction","title":"Syn addition of H2",
 "instruction":"Reaction bench: 1,2-dimethylcyclohexene is locked in the reactant zone. Apply the H2 / Pd card, build the alkane in the product zone with the correct cis/trans relationship of the two methyl groups and submit.",
 "objective":"Catalytic hydrogenation adds both hydrogens from the catalyst surface to the same face: cis-1,2-dimethylcyclohexane.",
 "hint":"Both new hydrogens arrive on one face, so both methyls are pushed to the other face: cis (the meso isomer).",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"CC1=C(C)CCCC1","reagentId":"H2_PD","expected":["C[C@H]1CCCC[C@H]1C"],"stereoCheck":"relative"},"source":"MM 8.6 (m00094)",
 "feedback":{"diastereomer":"Your methyls are trans. H2 adds syn from the catalyst surface, so both methyls end up cis."}},
{"id":"ch8-predict-ozonolysis-2-methylbut-2-ene","chapter":8,"section":"8.8","topic":"cleavage","title":"Ozonolysis: two carbonyls",
 "instruction":"Reaction bench: 2-methylbut-2-ene is locked in the reactant zone. Apply the ozonolysis card (1. O3; 2. Zn, H3O+). Build BOTH carbonyl products as two separate molecules in the product zone and submit.",
 "objective":"Ozonolysis cleaves the C=C; a carbon with two alkyl groups becomes a ketone, a carbon with one H becomes an aldehyde.",
 "hint":"Cut the double bond and put =O on each end: acetone (CH3)2C=O and acetaldehyde CH3CH=O.",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"CC=C(C)C","reagentId":"O3_ZN","expected":["CC(C)=O","CC=O"],"stereoCheck":"none"},"source":"MM 8.8 (m00096)"},
{"id":"ch8-predict-kmno4-2-methylbut-2-ene","chapter":8,"section":"8.8","topic":"cleavage","title":"Oxidative cleavage with KMnO4",
 "instruction":"Reaction bench: 2-methylbut-2-ene is locked in the reactant zone. Apply the hot acidic KMnO4 card. Build BOTH products as two separate molecules in the product zone and submit.",
 "objective":"Hot KMnO4 cleaves the C=C like ozone but oxidizes the aldehyde fragment further to a carboxylic acid; a disubstituted carbon still gives a ketone.",
 "hint":"Acetone from the (CH3)2C= end and acetic acid (not acetaldehyde) from the CH3CH= end.",
 "difficulty":"hard","points":8,
 "rule":{"type":"predict-product","reactant":"CC=C(C)C","reagentId":"KMNO4_HOT","expected":["CC(C)=O","CC(=O)O"],"stereoCheck":"none"},"source":"MM 8.8 (m00096)",
 "feedback":{"constitutional-isomer":"One fragment has the right formula but the wrong structure. Remember that KMnO4 oxidizes an aldehyde fragment all the way to the carboxylic acid."}}
]
```

### 4.9 Chapter 9 — Alkynes (9 challenges, 50 points)

```json
[
{"id":"ch9-predict-hbr-1-equiv-hex-1-yne","chapter":9,"section":"9.3","topic":"alkyne-addition","title":"One HBr on an alkyne",
 "instruction":"Reaction bench: hex-1-yne is locked in the reactant zone. Apply the HBr card with the equivalents switch on 1. Build the product in the product zone and submit.",
 "objective":"HX adds once to an alkyne with Markovnikov regiochemistry to give a vinylic halide.",
 "hint":"Br goes to the internal alkyne carbon (C2), H to the terminal carbon: 2-bromohex-1-ene, CH2=C(Br)-C4H9.",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"C#CCCCC","reagentId":"HX_HBR","equiv":1,"expected":["C=C(Br)CCCC"],"stereoCheck":"none"},"source":"MM 9.3 (m00105)"},
{"id":"ch9-predict-hbr-2-equiv-hex-1-yne","chapter":9,"section":"9.3","topic":"alkyne-addition","title":"Two HBr on an alkyne",
 "instruction":"Reaction bench: hex-1-yne is locked in the reactant zone. Apply the 2 equiv HBr card. Build the product in the product zone and submit.",
 "objective":"The second HBr also adds Markovnikov, so both bromines end up on the same carbon: a geminal dihalide, not a vicinal one.",
 "hint":"Both Br on C2: 2,2-dibromohexane. Students often wrongly build 1,2-dibromohexane.",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"C#CCCCC","reagentId":"HX_2EQ_HBR","expected":["CCCCC(C)(Br)Br"],"stereoCheck":"none"},"source":"MM 9.3 (m00105)",
 "feedback":{"constitutional-isomer":"Right formula, wrong positions: both bromines go to the SAME carbon (C2). The second addition follows Markovnikov's rule again, giving the geminal 2,2-dibromide."}},
{"id":"ch9-predict-br2-1-equiv-but-1-yne","chapter":9,"section":"9.3","topic":"alkyne-addition","title":"One Br2 on an alkyne: trans dibromide",
 "instruction":"Reaction bench: but-1-yne is locked in the reactant zone. Apply the Br2 / CH2Cl2 card with the equivalents switch on 1. Build the product in the product zone with the correct geometry: the two bromines on opposite sides of the new C=C (anti addition), every substituent beside its alkene carbon, all in one plane. The Br on C1 and the ethyl group on C2 end up on the same side and touch: break that bond with the bond wand (B, then E until the red x marker). Submit.",
 "objective":"One equivalent of X2 adds anti across a triple bond to give the (E)-1,2-dihaloalkene (McMurry 9.3).",
 "hint":"(E)-1,2-dibromobut-1-ene, BrCH=C(Br)CH2CH3: Br above C1, Br below C2, the ethyl CH2 above C2 next to the first Br. Cycle the Br-CH2 bar to no bond, then set C1=C2 to double.",
 "difficulty":"hard","points":8,
 "rule":{"type":"predict-product","reactant":"C#CCC","reagentId":"X2_BR2","equiv":1,"expected":["Br/C=C(/Br)CC"],"stereoCheck":"ez"},"source":"MM 9.3 (m00105)",
 "feedback":{"diastereomer":"Your two bromines are on the same side (Z). Br2 adds anti to an alkyne: the bromines end up on opposite sides of the C=C (E).","invalid-alkene-geometry":"The double bond is not planar or a substituent is in line with it. Put both bromines and the ethyl group beside their alkene carbons in one plane, and break the bond where the Br and the ethyl group touch."}},
{"id":"ch9-predict-hgso4-hydration-hex-1-yne","chapter":9,"section":"9.4","topic":"alkyne-hydration","title":"Mercury-catalysed hydration",
 "instruction":"Reaction bench: hex-1-yne is locked in the reactant zone. Apply the H2O / H2SO4 / HgSO4 card. Build the isolated product (the carbonyl compound, not the enol) in the product zone and submit.",
 "objective":"Markovnikov hydration of a terminal alkyne gives an enol that tautomerizes to a methyl ketone.",
 "hint":"OH goes to C2, then the enol C(OH)=CH2 becomes C(=O)-CH3: hexan-2-one.",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"C#CCCCC","reagentId":"HGSO4_HYDRATION","expected":["CCCCC(C)=O"],"stereoCheck":"none"},"source":"MM 9.4 (m00106)",
 "feedback":{"constitutional-isomer":"Right formula, wrong structure. If you built the enol (C=C-OH), remember it tautomerizes to the ketone; if you built the aldehyde, remember HgSO4 hydration is Markovnikov and gives the methyl ketone hexan-2-one."}},
{"id":"ch9-choose-hydroboration-hexanal","chapter":9,"section":"9.4","topic":"alkyne-hydration","title":"Alkyne to aldehyde",
 "instruction":"At the reaction bench, hex-1-yne is shown as the reactant and hexanal as the target product. Pick the reagent card that performs this conversion and submit.",
 "objective":"Hydroboration-oxidation of a terminal alkyne is anti-Markovnikov and gives the aldehyde; Hg-catalysed hydration gives the methyl ketone.",
 "hint":"Which hydration reagent puts the oxygen on the terminal carbon?",
 "difficulty":"medium","points":4,
 "rule":{"type":"choose-reagent","reactant":"C#CCCCC","product":"CCCCCC=O","options":["HGSO4_HYDRATION","HYDROBORATION_ALKYNE","H3O_HYDRATION","H2_LINDLAR"],"correct":["HYDROBORATION_ALKYNE"],"maxAttempts":2,
  "rejections":{"HGSO4_HYDRATION":"Hg-catalysed hydration is Markovnikov and gives the methyl ketone hexan-2-one.","H3O_HYDRATION":"Aqueous acid alone does not hydrate an alkyne usefully, and any hydration would be Markovnikov (ketone).","H2_LINDLAR":"Lindlar hydrogenation adds H2 to give the cis alkene; it adds no oxygen."}},
 "source":"MM 9.4 (m00106)"},
{"id":"ch9-predict-lindlar-z-hex-3-ene","chapter":9,"section":"9.5","topic":"reduction","title":"Alkyne to cis alkene",
 "instruction":"Reaction bench: hex-3-yne is locked in the reactant zone. Apply the H2 / Lindlar catalyst card. Build (Z)-hex-3-ene (cis-3-hexene) in the product zone with the correct geometry: both ethyl groups beside their alkene carbons, in one plane, on the SAME side. The two ethyl groups touch where they meet: break that bond with the bond wand (B, then E until the red x marker) so they stay separate. Submit.",
 "objective":"Lindlar's poisoned catalyst delivers both hydrogens to the same face (syn addition) and stops at the cis (Z) alkene; Li/NH3 gives the trans alkene and Pd/C the alkane.",
 "hint":"A U shape: CH2 above C3, C3=C4 across, CH2 above C4, each CH3 continuing outward. The two CH2 blocks touch: cycle their bar to no bond. Then set C3=C4 to double.",
 "difficulty":"hard","points":8,
 "rule":{"type":"predict-product","reactant":"CCC#CCC","reagentId":"H2_LINDLAR","expected":["CC/C=C\\CC"],"stereoCheck":"ez"},"source":"MM 9.5 (m00107)",
 "feedback":{"diastereomer":"Your alkene is E (trans). Lindlar hydrogenation is syn: both hydrogens add to the same face, so the two ethyl groups end up on the same side (Z).","invalid-alkene-geometry":"The double bond is not planar or a substituent is in line with it. Put both ethyl groups beside their carbons in the same plane as the C=C, on the same side, and break the bond where they touch."}},
{"id":"ch9-predict-li-nh3-hex-3-yne","chapter":9,"section":"9.5","topic":"reduction","title":"Alkyne to trans alkene",
 "instruction":"Reaction bench: hex-3-yne is locked in the reactant zone. Apply the Li / NH3 card. Build (E)-hex-3-ene in the product zone with the correct geometry (planar zigzag, ethyl groups on opposite sides) and submit.",
 "objective":"Dissolving-metal reduction gives anti addition of H2: the trans (E) alkene.",
 "hint":"Both ethyl groups must be beside their alkene carbon (not in line with the C=C), in one plane, one above and one below.",
 "difficulty":"hard","points":8,
 "rule":{"type":"predict-product","reactant":"CCC#CCC","reagentId":"LI_NH3","expected":["CC/C=C/CC"],"stereoCheck":"ez"},"source":"MM 9.5 (m00107)",
 "feedback":{"diastereomer":"Your alkene is Z (cis). Li/NH3 reduction is anti: the two ethyl groups must end up on opposite sides (E).","invalid-alkene-geometry":"The double bond is not planar or a substituent is in line with it. Put both ethyl groups beside their carbons in the same plane as the C=C, on opposite sides."}},
{"id":"ch9-select-most-acidic-h-propyne","chapter":9,"section":"9.7","topic":"acetylide","title":"Acidity of a terminal alkyne",
 "instruction":"Propyne (HC≡C-CH3) is placed on the lab pad with hydrogens shown. Select its most acidic hydrogen and submit.",
 "objective":"A terminal alkyne C-H (pKa 25) is far more acidic than an alkane C-H (about 60) because the acetylide lone pair sits in an sp orbital.",
 "hint":"Table 9.1: ≡C-H 25, =C-H 44, -C-H 60.",
 "difficulty":"easy","points":2,
 "rule":{"type":"select-atom","molecules":["C#CC"],"selector":{"kind":"most-acidic-h"},"target":"hydrogens","match":"any","maxAttempts":3,"answerDescription":"the hydrogen on the triple-bonded carbon (pKa 25)"},
 "source":"MM 9.7 (m00109)"},
{"id":"ch9-predict-acetylide-alkylation-ethyne","chapter":9,"section":"9.8","topic":"acetylide","title":"Acetylide alkylation",
 "instruction":"Reaction bench: ethyne (acetylene) is locked in the reactant zone. Apply the 1. NaNH2, NH3; 2. R-Br card with 1-bromopropane as the alkyl halide. Build the product in the product zone and submit.",
 "objective":"NaNH2 deprotonates the terminal alkyne; the acetylide ion then displaces bromide from a primary alkyl halide (SN2) to make a new C-C bond.",
 "hint":"The acetylide carbon bonds to the CH2 that carried the Br: HC≡C-CH2CH2CH3, pent-1-yne.",
 "difficulty":"hard","points":8,
 "rule":{"type":"predict-product","reactant":"C#C","reagentId":"NANH2_THEN_RX","rx":"CCCBr","expected":["C#CCCC"],"stereoCheck":"none"},"source":"MM 9.8 (m00110)"}
]
```

### 4.10 Chapter 10 — Organohalides (7 challenges, 26 points)

```json
[
{"id":"ch10-isomers-c4h9br","chapter":10,"section":"10.1","topic":"organohalides","title":"Four bromobutanes",
 "instruction":"Build all four constitutional isomers of C4H9Br on the lab pad, submitting each one when it is finished. Earlier isomers may stay on the pad.",
 "objective":"Positional and skeletal isomers of an alkyl halide: 1-bromobutane, 2-bromobutane, 1-bromo-2-methylpropane, 2-bromo-2-methylpropane.",
 "hint":"Two on the butane skeleton (Br on C1 or C2) and two on the 2-methylpropane skeleton (Br on CH2 or on the central carbon).",
 "difficulty":"medium","points":4,
 "rule":{"type":"isomer-set","formula":"C4H9Br","isomers":["CCCCBr","CCC(C)Br","CC(C)CBr","CC(C)(C)Br"],"count":4},"source":"MM 10.1 (m00113)"},
{"id":"ch10-name-2-bromo-5-methylhexane","chapter":10,"section":"10.1","topic":"nomenclature","title":"Name an alkyl halide",
 "instruction":"Build 2-bromo-5-methylhexane on the lab pad, target it and submit.",
 "objective":"Halogens are substituents named alphabetically with alkyl groups; number from the end nearer the first substituent of either kind.",
 "hint":"Six-carbon chain; Br on C2 and a methyl on C5. Numbering from the other end would give 5-bromo-2-methylhexane, which is wrong because 2 < 5 for the first substituent.",
 "difficulty":"medium","points":4,
 "rule":{"type":"name-to-structure","names":["2-bromo-5-methylhexane"],"target":"CC(C)CCC(C)Br"},"source":"MM 10.1 (m00113)"},
{"id":"ch10-predict-nbs-cyclohexene","chapter":10,"section":"10.3","topic":"radical","title":"Allylic bromination",
 "instruction":"Reaction bench: cyclohexene is locked in the reactant zone. Apply the NBS / hv card, build the product in the product zone and submit.",
 "objective":"NBS substitutes an allylic hydrogen by Br through a resonance-stabilized allylic radical; the double bond stays.",
 "hint":"Br replaces an H on the carbon NEXT to the C=C, not on the double bond: 3-bromocyclohexene.",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"C1CCC=CC1","reagentId":"NBS_HV","expected":["BrC1CCCC=C1"],"stereoCheck":"none"},"source":"MM 10.3 (m00115)",
 "feedback":{"wrong-formula":"Wrong formula. NBS is a substitution (one H replaced by Br), not an addition of Br2: the product keeps the double bond and has the formula C6H9Br."}},
{"id":"ch10-predict-cl2-hv-butane","chapter":10,"section":"10.2","topic":"radical","title":"Radical chlorination of butane",
 "instruction":"Reaction bench: butane is locked in the reactant zone. Apply the Cl2 / hv card. Build the MAJOR monochlorination product in the product zone and submit. The minor product earns half credit.",
 "objective":"Secondary C-H bonds are about 3.5 times more reactive than primary ones toward Cl radicals: 4 x 3.5 = 14 versus 6 x 1 = 6, so 2-chlorobutane is 70 % of the product.",
 "hint":"Count the hydrogens of each kind and weight them: six primary H (x1) versus four secondary H (x3.5).",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"CCCC","reagentId":"CL2_HV","expected":["CCC(C)Cl"],"stereoCheck":"none",
  "acceptAlso":[{"smiles":"CCCCCl","note":"1-chlorobutane, the minor product (30 %). The major product, 2-chlorobutane (70 %), earns full credit."}]},
 "source":"MM 10.2 (m00114)"},
{"id":"ch10-predict-tert-butanol-hcl","chapter":10,"section":"10.5","topic":"organohalides","title":"Tertiary alcohol + HCl",
 "instruction":"Reaction bench: 2-methylpropan-2-ol (tert-butyl alcohol) is locked in the reactant zone. Apply the HCl (ether) card, build the product in the product zone and submit.",
 "objective":"Tertiary alcohols react with HX by an SN1 mechanism through the tertiary carbocation.",
 "hint":"OH is replaced by Cl on the same carbon: 2-chloro-2-methylpropane.",
 "difficulty":"easy","points":2,
 "rule":{"type":"predict-product","reactant":"CC(C)(C)O","reagentId":"ROH_HX_HCL","expected":["CC(C)(C)Cl"],"stereoCheck":"none"},"source":"MM 10.5 (m00117)"},
{"id":"ch10-choose-propan-1-ol-to-1-chloropropane","chapter":10,"section":"10.5","topic":"organohalides","title":"Primary alcohol to chloride",
 "instruction":"At the reaction bench, propan-1-ol is shown as the reactant and 1-chloropropane as the target product. Pick the best reagent card and submit.",
 "objective":"Primary and secondary alcohols are converted to chlorides with SOCl2 (and to bromides with PBr3); HX works well only for tertiary alcohols.",
 "hint":"HCl is slow with primary alcohols. Which reagent converts a primary alcohol into a chloride under mild conditions?",
 "difficulty":"medium","points":4,
 "rule":{"type":"choose-reagent","reactant":"CCCO","product":"CCCCl","options":["ROH_HX_HCL","ROH_SOCL2","ROH_PBR3","H2SO4_HEAT_ROH"],"correct":["ROH_SOCL2"],"maxAttempts":2,
  "rejections":{"ROH_HX_HCL":"HCl reacts with primary alcohols only slowly (no stable carbocation); McMurry 10.5 reserves HX for tertiary alcohols.","ROH_PBR3":"PBr3 gives the bromide, 1-bromopropane, not the chloride.","H2SO4_HEAT_ROH":"Hot H2SO4 dehydrates alcohols to alkenes; it introduces no chlorine."}},
 "source":"MM 10.5 (m00117)"},
{"id":"ch10-choose-butan-2-ol-to-2-bromobutane","chapter":10,"section":"10.5","topic":"organohalides","title":"Secondary alcohol to bromide",
 "instruction":"At the reaction bench, butan-2-ol is shown as the reactant and 2-bromobutane as the target product. Pick the best reagent card and submit.",
 "objective":"PBr3 converts primary and secondary alcohols to alkyl bromides.",
 "hint":"Which reagent delivers Br to a secondary carbon without needing a carbocation?",
 "difficulty":"medium","points":4,
 "rule":{"type":"choose-reagent","reactant":"CCC(C)O","product":"CCC(C)Br","options":["ROH_HX_HBR","ROH_SOCL2","ROH_PBR3","HBR_ROOR"],"correct":["ROH_PBR3"],"maxAttempts":2,
  "rejections":{"ROH_HX_HBR":"HBr is slow for a secondary alcohol; McMurry 10.5 uses PBr3 for primary and secondary alcohols.","ROH_SOCL2":"SOCl2 gives the chloride, 2-chlorobutane.","HBR_ROOR":"HBr with peroxides adds to alkenes (radical anti-Markovnikov addition); it does not replace an alcohol OH."}},
 "source":"MM 10.5 (m00117)"}
]
```

### 4.11 Chapter 11 — Substitution and elimination (9 challenges, 36 points)

```json
[
{"id":"ch11-predict-sn2-inversion-2-bromobutane","chapter":11,"section":"11.2","topic":"substitution","title":"SN2 inverts the centre",
 "instruction":"Reaction bench: (S)-2-bromobutane is locked in the reactant zone. Apply the NaI / acetone card (iodide is an excellent nucleophile but a very weak base, so a secondary halide reacts cleanly by SN2). Build the product, 2-iodobutane, in the product zone with the correct absolute configuration: make C2 an octant centre or place its hydrogen explicitly so the panel labels it. Submit.",
 "objective":"Backside attack (Walden inversion): the nucleophile enters opposite the leaving group, so (S)-2-bromobutane gives (R)-2-iodobutane (McMurry 11.2, Figure 11.2; Table 11.1 for NaI).",
 "hint":"The I ends up on the opposite side from where the Br was. The label changes S -> R here because I and Br rank the same relative to the alkyl groups (halogen > ethyl > methyl > H).",
 "difficulty":"hard","points":8,
 "rule":{"type":"predict-product","reactant":"C[C@H](Br)CC","reagentId":"SN2_NAI","expected":["C[C@@H](I)CC"],"stereoCheck":"absolute"},"source":"MM 11.2 (m00123)",
 "feedback":{"enantiomer":"You built (S)-2-iodobutane: retention of configuration. SN2 proceeds by backside attack and INVERTS the centre, giving (R)-2-iodobutane."}},
{"id":"ch11-predict-sn2-cyanide-1-bromobutane","chapter":11,"section":"11.3","topic":"substitution","title":"SN2 with cyanide",
 "instruction":"Reaction bench: 1-bromobutane is locked in the reactant zone. Apply the NaCN / DMSO card, build the product in the product zone and submit.",
 "objective":"A primary halide and a strong nucleophile in a polar aprotic solvent react by SN2; cyanide bonds through carbon, giving a nitrile.",
 "hint":"The carbon of CN replaces Br on C1: pentanenitrile, CH3CH2CH2CH2-C≡N (five carbons now).",
 "difficulty":"easy","points":2,
 "rule":{"type":"predict-product","reactant":"CCCCBr","reagentId":"SN2_NACN","expected":["CCCCC#N"],"stereoCheck":"none"},"source":"MM 11.3 (m00124)"},
{"id":"ch11-predict-sn1-tert-butyl-bromide-water","chapter":11,"section":"11.4","topic":"substitution","title":"SN1 solvolysis",
 "instruction":"Reaction bench: 2-bromo-2-methylpropane (tert-butyl bromide) is locked in the reactant zone. Apply the H2O, heat card. Build the MAJOR product in the product zone and submit. The minor elimination product earns half credit.",
 "objective":"A tertiary halide with a weak nucleophile in a protic solvent ionizes to a carbocation (SN1); water then gives the alcohol, with some E1 alkene as a minor product.",
 "hint":"Water replaces Br on the tertiary carbon: 2-methylpropan-2-ol (tert-butyl alcohol).",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"CC(C)(C)Br","reagentId":"H2O_HEAT","expected":["CC(C)(C)O"],"stereoCheck":"none",
  "acceptAlso":[{"smiles":"C=C(C)C","note":"2-methylpropene, the E1 elimination product: minor (about 36 % in aqueous ethanol, McMurry 11.10). The SN1 product 2-methylpropan-2-ol earns full credit."}]},
 "source":"MM 11.4 (m00125)"},
{"id":"ch11-predict-tert-butyl-bromide-methoxide-e2","chapter":11,"section":"11.12","topic":"elimination","title":"Tertiary halide + strong base",
 "instruction":"Reaction bench: 2-bromo-2-methylpropane (tert-butyl bromide) is locked in the reactant zone. Apply the NaOCH3 / CH3OH card, build the organic product in the product zone and submit.",
 "objective":"A tertiary halide never reacts by SN2; with a strong base it undergoes E2 to give the alkene.",
 "hint":"Methoxide removes a hydrogen from a methyl group while Br leaves: 2-methylpropene, not the ether.",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"CC(C)(C)Br","reagentId":"SN2_NAOCH3","expected":["C=C(C)C"],"stereoCheck":"none"},"source":"MM 11.12 (m00133)",
 "feedback":{"wrong-formula":"Wrong formula. If you built the ether (tert-butyl methyl ether), remember that SN2 cannot happen at a tertiary carbon: the strong base methoxide causes E2 elimination instead, giving 2-methylpropene (C4H8)."}},
{"id":"ch11-predict-e2-zaitsev-2-bromo-2-methylbutane","chapter":11,"section":"11.7","topic":"elimination","title":"Zaitsev's rule",
 "instruction":"Reaction bench: 2-bromo-2-methylbutane is locked in the reactant zone. Apply the NaOEt / EtOH card. Build the MAJOR alkene in the product zone and submit. The minor alkene earns half credit.",
 "objective":"E2 eliminations give mainly the more substituted (more stable) alkene: 2-methylbut-2-ene (70 %) over 2-methylbut-1-ene (30 %).",
 "hint":"Remove Br from C2 and an H from C3 (giving a trisubstituted alkene) rather than from a methyl group (disubstituted).",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"CCC(C)(C)Br","reagentId":"SN2_NAOET","expected":["CC=C(C)C"],"stereoCheck":"none",
  "acceptAlso":[{"smiles":"C=C(C)CC","note":"2-methylbut-1-ene, the minor (Hofmann) product, 30 %. The Zaitsev product 2-methylbut-2-ene (70 %) earns full credit."}]},
 "source":"MM 11.7 (m00128)"},
{"id":"ch11-predict-e2-2-bromobutane","chapter":11,"section":"11.7","topic":"elimination","title":"E2 on a secondary halide",
 "instruction":"Reaction bench: 2-bromobutane is locked in the reactant zone. Apply the NaOEt / EtOH card. Build the MAJOR alkene in the product zone and submit (its E/Z geometry is not graded here). The minor alkene earns half credit.",
 "objective":"A secondary halide with a strong base gives E2; the Zaitsev product but-2-ene (81 %) dominates over but-1-ene (19 %).",
 "hint":"Take the beta hydrogen from C3 (giving CH3-CH=CH-CH3) rather than from C1 (giving CH2=CH-CH2-CH3).",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"CCC(C)Br","reagentId":"SN2_NAOET","expected":["C/C=C/C"],"stereoCheck":"none",
  "acceptAlso":[{"smiles":"C=CCC","note":"but-1-ene, the minor product (19 %). The Zaitsev product but-2-ene (81 %) earns full credit."}]},
 "source":"MM 11.7 (m00128)"},
{"id":"ch11-predict-e2-1-chloro-1-methylcyclohexane","chapter":11,"section":"11.7","topic":"elimination","title":"Zaitsev in a ring",
 "instruction":"Reaction bench: 1-chloro-1-methylcyclohexane is locked in the reactant zone. Apply the KOH / ethanol card. Build the MAJOR alkene in the product zone and submit. The minor alkene earns half credit.",
 "objective":"McMurry worked example 11.4: the trisubstituted endocyclic alkene 1-methylcyclohexene is the Zaitsev product; methylenecyclohexane (disubstituted) is minor.",
 "hint":"Remove Cl and a ring hydrogen next to it (double bond inside the ring), not a methyl hydrogen.",
 "difficulty":"medium","points":4,
 "rule":{"type":"predict-product","reactant":"CC1(Cl)CCCCC1","reagentId":"KOH_ETOH","expected":["CC1=CCCCC1"],"stereoCheck":"none",
  "acceptAlso":[{"smiles":"C=C1CCCCC1","note":"methylenecyclohexane, the minor (less substituted) alkene. The Zaitsev product 1-methylcyclohexene earns full credit."}]},
 "source":"MM 11.7 (m00128)"},
{"id":"ch11-choose-sn2-vs-e2-2-bromobutane","chapter":11,"section":"11.12","topic":"elimination","title":"Substitution or elimination?",
 "instruction":"At the reaction bench, 2-bromobutane is shown as the reactant and but-2-ene as the target product. Pick the reagent card that gives this product and submit.",
 "objective":"A secondary halide gives E2 with a strong base (alkoxide) and SN2 with a good but weakly basic nucleophile (I-, CN-); a weak nucleophile like water gives slow SN1/E1.",
 "hint":"Which reagent is a strong base rather than just a good nucleophile?",
 "difficulty":"medium","points":4,
 "rule":{"type":"choose-reagent","reactant":"CCC(C)Br","product":"C/C=C/C","options":["SN2_NACN","SN2_NAOET","H2O_HEAT","SN2_NAI"],"correct":["SN2_NAOET"],"maxAttempts":2,
  "rejections":{"SN2_NACN":"Cyanide is a good nucleophile but a weak base: a secondary halide gives SN2 substitution (2-methylbutanenitrile), not elimination.","H2O_HEAT":"Water is a weak nucleophile and a weak base; a plain secondary halide reacts only slowly by SN1/E1 and the major product would be the alcohol.","SN2_NAI":"Iodide is an excellent nucleophile but not a base: SN2 gives 2-iodobutane."}},
 "source":"MM 11.12 (m00133)"},
{"id":"ch11-select-fastest-sn2-substrate","chapter":11,"section":"11.3","topic":"substitution","title":"Which substrate reacts fastest by SN2?",
 "instruction":"Three alkyl bromides are placed on the lab pad and locked: bromomethane, 2-bromopropane and 2-bromo-2-methylpropane. Select any atom of the molecule that reacts fastest with a nucleophile by the SN2 mechanism and submit.",
 "objective":"Steric hindrance controls SN2 rates: methyl > primary > secondary >> tertiary (which does not react by SN2 at all).",
 "hint":"Backside attack needs an open carbon. Which C-Br carbon has the fewest alkyl groups around it?",
 "difficulty":"easy","points":2,
 "rule":{"type":"select-atom","molecules":["CBr","CC(C)Br","CC(C)(C)Br"],"selector":{"kind":"fewest-carbon-substituents-cx"},"target":"atoms","match":"any","maxAttempts":3,"answerDescription":"bromomethane (either of its atoms): its carbon has no alkyl substituents"},
 "source":"MM 11.3 (m00124)"}
]
```

### 4.12 Roster summary and dropped items

| chapter | records | points | rule types used |
|---|---|---|---|
| 1 | 7 | 20 | exact-molecule ×4, select-atom, quiz(mc), formula-and-groups |
| 2 | 14 | 48 | select-atom ×9, quiz(mc), exact-molecule ×2, quiz(yesno) ×2 |
| 3 | 10 | 36 | formula-and-groups ×4, isomer-set ×3, name-to-structure ×2, select-atom |
| 4 | 6 | 22 | isomer-set, formula-and-groups ×2, name-to-structure, stereo-exact ×2 |
| 5 | 8 | 42 | select-atom, stereo-exact ×6, quiz(yesno) |
| 6 | 1 | 2 | predict-product |
| 7 | 10 | 46 | formula-and-groups, name-to-structure, stereo-exact ×4, quiz(mc), select-atom, predict-product ×2 |
| 8 | 10 | 50 | predict-product ×9, choose-reagent |
| 9 | 9 | 50 | predict-product ×7, choose-reagent, select-atom |
| 10 | 7 | 26 | isomer-set, name-to-structure, predict-product ×3, choose-reagent ×2 |
| 11 | 9 | 36 | predict-product ×7, choose-reagent, select-atom |
| **total** | **91** | **378** | 9 rule kinds (8 `rule.type`s plus yes/no quiz), every `Selector.kind` except `atom-ids` is exercised |

Dropped from the research lists and why: DESIGN-draft C18–C25 (arenes/carbonyl derivatives, Organic II, SCOPE); mcmurry #21 cyclopentane variants (odd rings); acids-bases C2-05 propanamide (unverified pKa class), glycolamide and 3-hydroxypropanoic acid (margin), C2-01 DMSO/nitromethane (kept out to hold the roster at 89; nitromethane and DMSO stay in the library for the panel); stereo-on-grid S5 "enantiomer of the shown molecule" and S8 "diastereomer of the shown molecule" (need a display field on `StereoExactRule`, see §12); reaction-bench RB-11/RB-14 (epoxide, cyclopropane: diagonal), RB-38 (optional in the research; buildable since 09-amendment-no-bond.md but kept as the engine vector 04 §9.1 row 5 only), RB-37 TBUOK Hofmann (not in 10e); ch10 Grignard (needs Mg). Restored by 09-amendment-no-bond.md: the tri-substituted E/Z build (`ch7-build-z-2-chlorobut-2-ene`, replacing the E/Z quiz), RB-18 (`ch9-predict-br2-1-equiv-but-1-yne`) and RB-21 as a predict-product (`ch9-predict-lindlar-z-hex-3-ene`, replacing the choose-reagent). Reserve ideas for v1.1 are listed in §12.

## 5. Molecule library (`src/content/molecules.json`, `version: 1`)

### 5.1 Entry rules

1. `smiles` is Kekulé (no lowercase), charge in brackets, stereo as `@`/`@@` and `/` `\`; it is the string rules reference (`entryBySmiles`).
2. `formula` is the RDKit Hill formula (`CalcMolFormula`) and must equal `hillFormula(parseEntry(e))` (test L2).
3. `labels` keys are 1-based SMILES atom positions (`"2":"R"`) or `"a=b"` for double bonds (`"2=3":"E"`), exactly as `rdCIPLabeler` reported them; the engine's `labelTargetStereo` must reproduce them (test L3). Pseudo-asymmetric `r`/`s` labels (1,4-disubstituted rings) are stored as reported and the engine is expected to return `NOT_CENTER` for those atoms (test L3 accepts `NOT_CENTER` for lowercase labels).
4. `meso: true` only when the entry has ≥ 1 R/S centre and equals its own mirror image (4 entries).
5. `requiresDiagonalBonds` is `false` for every entry: the library holds **no odd rings** (methylcyclopropane, cyclopropane, cyclopentane, THF, oxirane, nicotine, caffeine are excluded).
6. `layout` is given only where the verified octant embedding needs no explicit hydrogen (§5.3); all other entries fall back to `embedOnLattice`.
7. `commonNames` always lists the other locant spelling when one exists (`butan-2-ol` ↔ `2-butanol`) and McMurry's trivial names; `name` is the panel name.
8. No two entries are the same molecule under `sameMolecule(a, b, {stereo: 'absolute'}).verdict === 'SAME'` (test L5). A stereo-unspecified entry may coexist with its stereo-defined isomers (`2-bromobutane` beside `(R)-` and `(S)-2-bromobutane`): `nameOf` then names a flat build "2-bromobutane" and a defined build "(R)-2-bromobutane".
9. Chapter tags are advisory (panel "appears in chapter" line); they do not gate anything.

### 5.2 Entries (192; every row regenerated by `verify05.py`: formula and labels from RDKit, flags from the lattice embedder)

Columns: id | name | common / alternate names | formula | SMILES | chapters | CIP labels (1-based SMILES positions) | flags. The flags column is empty for every entry: since 09-amendment-no-bond.md every entry embeds (the eight Z / trisubstituted alkenes with one required "no bond" pair each, §6.2); the former `NOT-BUILDABLE(stereo)` flag is gone.

| id | name | alternate names | formula | SMILES | ch | labels | flags |
|---|---|---|---|---|---|---|---|
| `methane` | methane |  | CH4 | `C` | 1 |  |  |
| `ethane` | ethane |  | C2H6 | `CC` | 1 |  |  |
| `propane` | propane |  | C3H8 | `CCC` | 3 |  |  |
| `butane` | butane | n-butane | C4H10 | `CCCC` | 3 |  |  |
| `2-methylpropane` | 2-methylpropane | isobutane | C4H10 | `CC(C)C` | 3 |  |  |
| `pentane` | pentane | n-pentane | C5H12 | `CCCCC` | 3 |  |  |
| `2-methylbutane` | 2-methylbutane | isopentane | C5H12 | `CCC(C)C` | 1,3 |  |  |
| `2-2-dimethylpropane` | 2,2-dimethylpropane | neopentane | C5H12 | `CC(C)(C)C` | 3 |  |  |
| `hexane` | hexane | n-hexane | C6H14 | `CCCCCC` | 3 |  |  |
| `2-methylpentane` | 2-methylpentane | isohexane | C6H14 | `CCCC(C)C` | 3 |  |  |
| `3-methylpentane` | 3-methylpentane |  | C6H14 | `CCC(C)CC` | 3 |  |  |
| `2-2-dimethylbutane` | 2,2-dimethylbutane |  | C6H14 | `CCC(C)(C)C` | 3 |  |  |
| `2-3-dimethylbutane` | 2,3-dimethylbutane |  | C6H14 | `CC(C)C(C)C` | 3 |  |  |
| `3-ethyl-2-methylpentane` | 3-ethyl-2-methylpentane |  | C8H18 | `CCC(CC)C(C)C` | 3 |  |  |
| `2-2-4-trimethylpentane` | 2,2,4-trimethylpentane | isooctane | C8H18 | `CC(C)CC(C)(C)C` | 3 |  |  |
| `3-methylhexane` | 3-methylhexane |  | C7H16 | `CCCC(C)CC` | 5 |  |  |
| `r-3-methylhexane` | (R)-3-methylhexane |  | C7H16 | `CCC[C@H](C)CC` | 5 | 4:R |  |
| `s-3-methylhexane` | (S)-3-methylhexane |  | C7H16 | `CCC[C@@H](C)CC` | 5 | 4:S |  |
| `cyclobutane` | cyclobutane |  | C4H8 | `C1CCC1` | 4 |  |  |
| `methylcyclobutane` | methylcyclobutane |  | C5H10 | `CC1CCC1` | 4 |  |  |
| `cyclohexane` | cyclohexane |  | C6H12 | `C1CCCCC1` | 4 |  |  |
| `methylcyclohexane` | methylcyclohexane |  | C7H14 | `CC1CCCCC1` | 4 |  |  |
| `1-1-dimethylcyclohexane` | 1,1-dimethylcyclohexane |  | C8H16 | `CC1(C)CCCCC1` | 4 |  |  |
| `cis-1-2-dimethylcyclohexane` | cis-1,2-dimethylcyclohexane | (1R,2S)-1,2-dimethylcyclohexane; meso-1,2-dimethylcyclohexane | C8H16 | `C[C@H]1CCCC[C@H]1C` | 4,8 | 2:S, 7:R | meso |
| `trans-1r-2r-dimethylcyclohexane` | (1R,2R)-1,2-dimethylcyclohexane | trans-1,2-dimethylcyclohexane | C8H16 | `C[C@@H]1CCCC[C@H]1C` | 4 | 2:R, 7:R |  |
| `trans-1s-2s-dimethylcyclohexane` | (1S,2S)-1,2-dimethylcyclohexane | trans-1,2-dimethylcyclohexane | C8H16 | `C[C@H]1CCCC[C@@H]1C` | 4 | 2:S, 7:S |  |
| `cis-1-4-dimethylcyclohexane` | cis-1,4-dimethylcyclohexane |  | C8H16 | `C[C@H]1CC[C@@H](C)CC1` | 4 | 2:s, 5:s |  |
| `trans-1-4-dimethylcyclohexane` | trans-1,4-dimethylcyclohexane |  | C8H16 | `C[C@H]1CC[C@H](C)CC1` | 4 | 2:r, 5:r |  |
| `ethene` | ethene | ethylene | C2H4 | `C=C` | 1,6,7 |  |  |
| `propene` | propene | propylene | C3H6 | `C=CC` | 1,7 |  |  |
| `propa-1-2-diene` | propa-1,2-diene | allene; 1,2-propadiene | C3H4 | `C=C=C` | 1 |  |  |
| `propenal` | propenal | prop-2-enal; acrolein; 2-propenal | C3H4O | `C=CC=O` | 1 |  |  |
| `but-1-ene` | but-1-ene | 1-butene | C4H8 | `C=CCC` | 4,7 |  |  |
| `e-but-2-ene` | (E)-but-2-ene | trans-2-butene; (E)-2-butene; trans-but-2-ene | C4H8 | `C/C=C/C` | 4,7,8 | 2=3:E |  |
| `z-but-2-ene` | (Z)-but-2-ene | cis-2-butene; (Z)-2-butene; cis-but-2-ene | C4H8 | `C/C=C\C` | 7 | 2=3:Z |  |
| `2-methylpropene` | 2-methylpropene | isobutylene; isobutene; methylpropene | C4H8 | `C=C(C)C` | 4,7,8,11 |  |  |
| `buta-1-3-diene` | buta-1,3-diene | 1,3-butadiene | C4H6 | `C=CC=C` | 7 |  |  |
| `2-methylbut-2-ene` | 2-methylbut-2-ene | 2-methyl-2-butene | C5H10 | `CC=C(C)C` | 7,8,11 |  |  |
| `2-methylbut-1-ene` | 2-methylbut-1-ene | 2-methyl-1-butene | C5H10 | `C=C(C)CC` | 11 |  |  |
| `3-methylbut-1-ene` | 3-methylbut-1-ene | 3-methyl-1-butene | C5H10 | `C=CC(C)C` | 7 |  |  |
| `2-methylpent-2-ene` | 2-methylpent-2-ene | 2-methyl-2-pentene | C6H12 | `CCC=C(C)C` | 8 |  |  |
| `2-3-dimethylbut-2-ene` | 2,3-dimethylbut-2-ene | 2,3-dimethyl-2-butene | C6H12 | `CC(C)=C(C)C` | 7 |  |  |
| `e-pent-2-ene` | (E)-pent-2-ene | trans-2-pentene; (E)-2-pentene | C5H10 | `C/C=C/CC` | 7 | 2=3:E |  |
| `e-3-methylpent-2-ene` | (E)-3-methylpent-2-ene | (E)-3-methyl-2-pentene | C6H12 | `C/C=C(\C)CC` | 7 | 2=3:E |  |
| `z-3-methylpent-2-ene` | (Z)-3-methylpent-2-ene | (Z)-3-methyl-2-pentene | C6H12 | `C/C=C(/C)CC` | 7 | 2=3:Z |  |
| `z-2-chlorobut-2-ene` | (Z)-2-chlorobut-2-ene | (Z)-2-chloro-2-butene | C4H7Cl | `C/C=C(\Cl)C` | 7 | 2=3:Z |  |
| `e-2-chlorobut-2-ene` | (E)-2-chlorobut-2-ene | (E)-2-chloro-2-butene | C4H7Cl | `C/C=C(/Cl)C` | 7 | 2=3:E |  |
| `e-hex-3-ene` | (E)-hex-3-ene | trans-3-hexene; (E)-3-hexene | C6H12 | `CC/C=C/CC` | 7,9 | 3=4:E |  |
| `z-hex-3-ene` | (Z)-hex-3-ene | cis-3-hexene; (Z)-3-hexene | C6H12 | `CC/C=C\CC` | 9 | 3=4:Z |  |
| `2e-4e-hexa-2-4-diene` | (2E,4E)-hexa-2,4-diene | trans,trans-2,4-hexadiene | C6H10 | `C/C=C/C=C/C` | 7 | 2=3:E, 4=5:E |  |
| `e-1-2-dichloroethene` | (E)-1,2-dichloroethene | trans-1,2-dichloroethylene | C2H2Cl2 | `Cl/C=C/Cl` | 7 | 2=3:E |  |
| `z-1-2-dichloroethene` | (Z)-1,2-dichloroethene | cis-1,2-dichloroethylene | C2H2Cl2 | `Cl/C=C\Cl` | 7 | 2=3:Z |  |
| `cyclohexene` | cyclohexene |  | C6H10 | `C1CCC=CC1` | 7,8,10,11 |  |  |
| `1-methylcyclohexene` | 1-methylcyclohexene |  | C7H12 | `CC1=CCCCC1` | 7,8,11 |  |  |
| `methylenecyclohexane` | methylenecyclohexane |  | C7H12 | `C=C1CCCCC1` | 11 |  |  |
| `1-2-dimethylcyclohexene` | 1,2-dimethylcyclohexene |  | C8H14 | `CC1=C(C)CCCC1` | 8 |  |  |
| `isopropylidenecyclohexane` | isopropylidenecyclohexane | (propan-2-ylidene)cyclohexane | C9H16 | `CC(C)=C1CCCCC1` | 8 |  |  |
| `ethyne` | ethyne | acetylene | C2H2 | `C#C` | 1,9 |  |  |
| `propyne` | propyne | methylacetylene | C3H4 | `C#CC` | 1,9 |  |  |
| `but-1-yne` | but-1-yne | 1-butyne | C4H6 | `C#CCC` | 2,9 |  |  |
| `but-2-yne` | but-2-yne | 2-butyne | C4H6 | `CC#CC` | 9 |  |  |
| `pent-1-yne` | pent-1-yne | 1-pentyne | C5H8 | `C#CCCC` | 9 |  |  |
| `hex-1-yne` | hex-1-yne | 1-hexyne | C6H10 | `C#CCCCC` | 9 |  |  |
| `hex-3-yne` | hex-3-yne | 3-hexyne | C6H10 | `CCC#CCC` | 9 |  |  |
| `chloromethane` | chloromethane | methyl chloride | CH3Cl | `CCl` | 2,10 |  |  |
| `bromomethane` | bromomethane | methyl bromide | CH3Br | `CBr` | 11 |  |  |
| `chloroethane` | chloroethane | ethyl chloride | C2H5Cl | `CCCl` | 10 |  |  |
| `bromoethane` | bromoethane | ethyl bromide | C2H5Br | `CCBr` | 6,10 |  |  |
| `1-chloropropane` | 1-chloropropane | propyl chloride; n-propyl chloride | C3H7Cl | `CCCCl` | 10 |  |  |
| `2-chloropropane` | 2-chloropropane | isopropyl chloride | C3H7Cl | `CC(C)Cl` | 10 |  |  |
| `2-bromopropane` | 2-bromopropane | isopropyl bromide | C3H7Br | `CC(C)Br` | 11 |  |  |
| `1-bromobutane` | 1-bromobutane | butyl bromide; n-butyl bromide | C4H9Br | `CCCCBr` | 10,11 |  |  |
| `1-iodobutane` | 1-iodobutane | butyl iodide | C4H9I | `CCCCI` | 11 |  |  |
| `r-2-iodobutane` | (R)-2-iodobutane | (R)-sec-butyl iodide | C4H9I | `C[C@@H](I)CC` | 11 | 2:R |  |
| `s-2-iodobutane` | (S)-2-iodobutane | (S)-sec-butyl iodide | C4H9I | `C[C@H](I)CC` | 11 | 2:S |  |
| `1-chlorobutane` | 1-chlorobutane | butyl chloride | C4H9Cl | `CCCCCl` | 10 |  |  |
| `2-chlorobutane` | 2-chlorobutane | sec-butyl chloride | C4H9Cl | `CCC(C)Cl` | 10 |  |  |
| `s-2-bromobutane` | (S)-2-bromobutane | (S)-sec-butyl bromide | C4H9Br | `C[C@H](Br)CC` | 5,11 | 2:S |  |
| `r-2-bromobutane` | (R)-2-bromobutane | (R)-sec-butyl bromide | C4H9Br | `C[C@@H](Br)CC` | 5,10,11 | 2:R |  |
| `1-bromo-2-methylpropane` | 1-bromo-2-methylpropane | isobutyl bromide | C4H9Br | `CC(C)CBr` | 10 |  |  |
| `2-bromo-2-methylpropane` | 2-bromo-2-methylpropane | tert-butyl bromide | C4H9Br | `CC(C)(C)Br` | 7,10,11 |  |  |
| `2-chloro-2-methylpropane` | 2-chloro-2-methylpropane | tert-butyl chloride | C4H9Cl | `CC(C)(C)Cl` | 7,10 |  |  |
| `2-chloro-2-methylbutane` | 2-chloro-2-methylbutane |  | C5H11Cl | `CCC(C)(C)Cl` | 7 |  |  |
| `2-chloro-3-methylbutane` | 2-chloro-3-methylbutane |  | C5H11Cl | `CC(C)C(C)Cl` | 7 |  |  |
| `2-bromo-2-methylbutane` | 2-bromo-2-methylbutane |  | C5H11Br | `CCC(C)(C)Br` | 11 |  |  |
| `2-bromo-5-methylhexane` | 2-bromo-5-methylhexane |  | C7H15Br | `CC(C)CCC(C)Br` | 10 |  |  |
| `bromocyclohexane` | bromocyclohexane | cyclohexyl bromide | C6H11Br | `BrC1CCCCC1` | 8,9,10,11 |  |  |
| `1-chloro-1-methylcyclohexane` | 1-chloro-1-methylcyclohexane |  | C7H13Cl | `CC1(Cl)CCCCC1` | 10,11 |  |  |
| `3-bromocyclohexene` | 3-bromocyclohexene | 3-bromocyclohex-1-ene | C6H9Br | `BrC1CCCC=C1` | 10 |  |  |
| `meso-2-3-dibromobutane` | meso-2,3-dibromobutane | (2R,3S)-2,3-dibromobutane | C4H8Br2 | `C[C@H](Br)[C@H](Br)C` | 5,8 | 2:S, 4:R | meso |
| `2r-3r-dibromobutane` | (2R,3R)-2,3-dibromobutane |  | C4H8Br2 | `C[C@@H](Br)[C@H](Br)C` | 5 | 2:R, 4:R |  |
| `2s-3s-dibromobutane` | (2S,3S)-2,3-dibromobutane |  | C4H8Br2 | `C[C@H](Br)[C@@H](Br)C` | 5 | 2:S, 4:S |  |
| `cis-1-2-dibromocyclohexane` | cis-1,2-dibromocyclohexane | (1R,2S)-1,2-dibromocyclohexane | C6H10Br2 | `Br[C@H]1CCCC[C@H]1Br` | 8 | 2:S, 7:R | meso |
| `trans-1r-2r-dibromocyclohexane` | (1R,2R)-1,2-dibromocyclohexane | trans-1,2-dibromocyclohexane | C6H10Br2 | `Br[C@@H]1CCCC[C@H]1Br` | 8 | 2:R, 7:R |  |
| `trans-1s-2s-dibromocyclohexane` | (1S,2S)-1,2-dibromocyclohexane | trans-1,2-dibromocyclohexane | C6H10Br2 | `Br[C@H]1CCCC[C@@H]1Br` | 8 | 2:S, 7:S |  |
| `2-2-dibromohexane` | 2,2-dibromohexane |  | C6H12Br2 | `CCCCC(C)(Br)Br` | 9 |  |  |
| `2-bromohex-1-ene` | 2-bromohex-1-ene | 2-bromo-1-hexene | C6H11Br | `C=C(Br)CCCC` | 9 |  |  |
| `e-1-2-dibromobut-1-ene` | (E)-1,2-dibromobut-1-ene | (E)-1,2-dibromo-1-butene | C4H6Br2 | `Br/C=C(/Br)CC` | 9 | 2=3:E |  |
| `1-bromo-2-methylpropan-2-ol` | 1-bromo-2-methylpropan-2-ol | 1-bromo-2-methyl-2-propanol | C4H9BrO | `CC(C)(O)CBr` | 8 |  |  |
| `dichloromethane` | dichloromethane | methylene chloride | CH2Cl2 | `ClCCl` | 10 |  |  |
| `1-bromopropane` | 1-bromopropane | propyl bromide; n-propyl bromide | C3H7Br | `CCCBr` | 9,10 |  |  |
| `2-bromobutane` | 2-bromobutane | sec-butyl bromide | C4H9Br | `CCC(C)Br` | 10,11 |  |  |
| `buta-1-2-diene` | buta-1,2-diene | 1,2-butadiene; methylallene | C4H6 | `CC=C=C` | 1 |  |  |
| `cyclobutene` | cyclobutene |  | C4H6 | `C1=CCC1` | 7 |  |  |
| `1-ethylcyclobutene` | 1-ethylcyclobutene |  | C6H10 | `CCC1=CCC1` | 7 |  |  |
| `methanol` | methanol | methyl alcohol | CH4O | `CO` | 1,2,3 |  |  |
| `ethanol` | ethanol | ethyl alcohol | C2H6O | `CCO` | 2,3 |  |  |
| `propan-1-ol` | propan-1-ol | 1-propanol; n-propyl alcohol | C3H8O | `CCCO` | 3,10 |  |  |
| `propan-2-ol` | propan-2-ol | 2-propanol; isopropyl alcohol; isopropanol | C3H8O | `CC(C)O` | 3 |  |  |
| `butan-1-ol` | butan-1-ol | 1-butanol; n-butanol | C4H10O | `CCCCO` | 3 |  |  |
| `butan-2-ol` | butan-2-ol | 2-butanol; sec-butyl alcohol | C4H10O | `CCC(C)O` | 5,10 |  |  |
| `r-butan-2-ol` | (R)-butan-2-ol | (R)-2-butanol | C4H10O | `C[C@@H](O)CC` | 5,11 | 2:R |  |
| `s-butan-2-ol` | (S)-butan-2-ol | (S)-2-butanol | C4H10O | `C[C@H](O)CC` | 5,11 | 2:S |  |
| `2-methylpropan-2-ol` | 2-methylpropan-2-ol | tert-butanol; tert-butyl alcohol; 2-methyl-2-propanol | C4H10O | `CC(C)(C)O` | 3,8,10,11 |  |  |
| `2-methylpropan-1-ol` | 2-methylpropan-1-ol | isobutyl alcohol; 2-methyl-1-propanol | C4H10O | `CC(C)CO` | 8 |  |  |
| `3-methylbutan-2-ol` | 3-methylbutan-2-ol | 3-methyl-2-butanol | C5H12O | `CC(C)C(C)O` | 8 |  |  |
| `2-methylbutan-2-ol` | 2-methylbutan-2-ol | 2-methyl-2-butanol; tert-amyl alcohol | C5H12O | `CCC(C)(C)O` | 8 |  |  |
| `2-methylpentan-2-ol` | 2-methylpentan-2-ol | 2-methyl-2-pentanol | C6H14O | `CCCC(C)(C)O` | 8 |  |  |
| `2-methylpentan-3-ol` | 2-methylpentan-3-ol | 2-methyl-3-pentanol | C6H14O | `CCC(O)C(C)C` | 8 |  |  |
| `cyclohexanol` | cyclohexanol |  | C6H12O | `OC1CCCCC1` | 8 |  |  |
| `1-methylcyclohexanol` | 1-methylcyclohexanol | 1-methylcyclohexan-1-ol | C7H14O | `CC1(O)CCCCC1` | 8,10 |  |  |
| `trans-1r-2r-2-methylcyclohexanol` | (1R,2R)-2-methylcyclohexan-1-ol | trans-2-methylcyclohexanol | C7H14O | `C[C@@H]1CCCC[C@H]1O` | 8 | 2:R, 7:R |  |
| `trans-1s-2s-2-methylcyclohexanol` | (1S,2S)-2-methylcyclohexan-1-ol | trans-2-methylcyclohexanol | C7H14O | `C[C@H]1CCCC[C@@H]1O` | 8 | 2:S, 7:S |  |
| `cis-cyclohexane-1-2-diol` | cis-cyclohexane-1,2-diol | cis-1,2-cyclohexanediol; meso-cyclohexane-1,2-diol | C6H12O2 | `O[C@H]1CCCC[C@H]1O` | 8 | 2:S, 7:R | meso |
| `trans-1r-2r-cyclohexane-1-2-diol` | (1R,2R)-cyclohexane-1,2-diol | trans-1,2-cyclohexanediol | C6H12O2 | `O[C@@H]1CCCC[C@H]1O` | 8 | 2:R, 7:R |  |
| `trans-1s-2s-cyclohexane-1-2-diol` | (1S,2S)-cyclohexane-1,2-diol | trans-1,2-cyclohexanediol | C6H12O2 | `O[C@H]1CCCC[C@@H]1O` | 8 | 2:S, 7:S |  |
| `ethane-1-2-diol` | ethane-1,2-diol | ethylene glycol; 1,2-ethanediol | C2H6O2 | `OCCO` | 3 |  |  |
| `prop-2-yn-1-ol` | prop-2-yn-1-ol | propargyl alcohol | C3H4O | `OCC#C` | 2 |  |  |
| `3-hydroxypropanoic-acid` | 3-hydroxypropanoic acid |  | C3H6O3 | `OC(=O)CCO` | 2 |  |  |
| `2-mercaptoethanol` | 2-sulfanylethan-1-ol | 2-mercaptoethanol | C2H6OS | `OCCS` | 2 |  |  |
| `2-aminoethanol` | 2-aminoethan-1-ol | 2-aminoethanol; ethanolamine | C2H7NO | `OCCN` | 2 |  |  |
| `2-ammonioethanol` | 2-hydroxyethan-1-aminium | 2-ammonioethanol; protonated ethanolamine | C2H8NO+ | `OCC[NH3+]` | 2 |  |  |
| `r-lactic-acid` | (R)-2-hydroxypropanoic acid | (R)-lactic acid; D-lactic acid | C3H6O3 | `C[C@@H](O)C(=O)O` | 5 | 2:R |  |
| `s-lactic-acid` | (S)-2-hydroxypropanoic acid | (S)-lactic acid; L-lactic acid | C3H6O3 | `C[C@H](O)C(=O)O` | 5 | 2:S |  |
| `dimethyl-ether` | methoxymethane | dimethyl ether | C2H6O | `COC` | 2,3 |  |  |
| `diethyl-ether` | ethoxyethane | diethyl ether; ether | C4H10O | `CCOCC` | 3 |  |  |
| `methanal` | methanal | formaldehyde | CH2O | `C=O` | 1,3 |  |  |
| `ethanal` | ethanal | acetaldehyde | C2H4O | `CC=O` | 3,8 |  |  |
| `propanal` | propanal | propionaldehyde | C3H6O | `CCC=O` | 3 |  |  |
| `butanal` | butanal | butyraldehyde | C4H8O | `CCCC=O` | 3 |  |  |
| `2-methylpropanal` | 2-methylpropanal | isobutyraldehyde | C4H8O | `CC(C)C=O` | 3 |  |  |
| `hexanal` | hexanal |  | C6H12O | `CCCCCC=O` | 9 |  |  |
| `propanone` | propan-2-one | acetone; propanone | C3H6O | `CC(C)=O` | 1,2,3,8 |  |  |
| `butanone` | butan-2-one | butanone; methyl ethyl ketone; 2-butanone | C4H8O | `CCC(C)=O` | 2,3 |  |  |
| `pentan-2-one` | pentan-2-one | 2-pentanone | C5H10O | `CCCC(C)=O` | 3 |  |  |
| `pentan-3-one` | pentan-3-one | 3-pentanone | C5H10O | `CCC(=O)CC` | 3 |  |  |
| `3-methylbutan-2-one` | 3-methylbutan-2-one | 3-methyl-2-butanone | C5H10O | `CC(C)C(C)=O` | 3 |  |  |
| `hexan-2-one` | hexan-2-one | 2-hexanone | C6H12O | `CCCCC(C)=O` | 9 |  |  |
| `cyclohexanone` | cyclohexanone |  | C6H10O | `O=C1CCCCC1` | 3,8 |  |  |
| `pentane-2-4-dione` | pentane-2,4-dione | 2,4-pentanedione; acetylacetone | C5H8O2 | `CC(=O)CC(C)=O` | 2 |  |  |
| `4-aminobutan-2-one` | 4-aminobutan-2-one |  | C4H9NO | `CC(=O)CCN` | 2 |  |  |
| `methanoic-acid` | methanoic acid | formic acid | CH2O2 | `OC=O` | 2 |  |  |
| `ethanoic-acid` | ethanoic acid | acetic acid | C2H4O2 | `CC(=O)O` | 2,3 |  |  |
| `propanoic-acid` | propanoic acid | propionic acid | C3H6O2 | `CCC(=O)O` | 3 |  |  |
| `methyl-ethanoate` | methyl ethanoate | methyl acetate | C3H6O2 | `CC(=O)OC` | 3 |  |  |
| `ethyl-methanoate` | ethyl methanoate | ethyl formate | C3H6O2 | `O=COCC` | 3 |  |  |
| `ethyl-ethanoate` | ethyl ethanoate | ethyl acetate | C4H8O2 | `CC(=O)OCC` | 3 |  |  |
| `ethanamide` | ethanamide | acetamide | C2H5NO | `CC(N)=O` | 1,3 |  |  |
| `n-methylmethanamide` | N-methylmethanamide | N-methylformamide | C2H5NO | `CNC=O` | 3 |  |  |
| `n-methylethanamide` | N-methylethanamide | N-methylacetamide | C3H7NO | `CC(=O)NC` | 3 |  |  |
| `3-aminopropanamide` | 3-aminopropanamide |  | C3H8N2O | `NCCC(N)=O` | 2 |  |  |
| `s-alanine` | (S)-2-aminopropanoic acid | (S)-alanine; L-alanine; alanine | C3H7NO2 | `N[C@@H](C)C(=O)O` | 5 | 2:S |  |
| `r-alanine` | (R)-2-aminopropanoic acid | (R)-alanine; D-alanine | C3H7NO2 | `N[C@H](C)C(=O)O` | 5 | 2:R |  |
| `glycine` | aminoethanoic acid | glycine; aminoacetic acid | C2H5NO2 | `NCC(=O)O` | 5 |  |  |
| `acetate-ion` | ethanoate ion | acetate ion; acetate | C2H3O2- | `CC(=O)[O-]` | 2 |  |  |
| `methylamine` | methanamine | methylamine | CH5N | `CN` | 1,3 |  |  |
| `ethylamine` | ethanamine | ethylamine | C2H7N | `CCN` | 2,3 |  |  |
| `dimethylamine` | N-methylmethanamine | dimethylamine | C2H7N | `CNC` | 3 |  |  |
| `trimethylamine` | N,N-dimethylmethanamine | trimethylamine | C3H9N | `CN(C)C` | 1,3 |  |  |
| `propan-1-amine` | propan-1-amine | 1-propanamine; propylamine | C3H9N | `CCCN` | 3 |  |  |
| `propan-2-amine` | propan-2-amine | 2-propanamine; isopropylamine | C3H9N | `CC(C)N` | 3 |  |  |
| `n-methylethanamine` | N-methylethanamine | ethylmethylamine | C3H9N | `CCNC` | 3 |  |  |
| `ethanenitrile` | ethanenitrile | acetonitrile; methyl cyanide | C2H3N | `CC#N` | 1,3 |  |  |
| `pentanenitrile` | pentanenitrile | butyl cyanide | C5H9N | `CCCCC#N` | 11 |  |  |
| `hydrogen-cyanide` | hydrogen cyanide | HCN | CHN | `C#N` | 1,2 |  |  |
| `methylammonium` | methanaminium | methylammonium ion | CH6N+ | `C[NH3+]` | 2 |  |  |
| `ammonium` | ammonium ion | ammonium | H4N+ | `[NH4+]` | 1,2 |  |  |
| `ammonia` | ammonia |  | H3N | `N` | 2 |  |  |
| `nitromethane` | nitromethane |  | CH3NO2 | `C[N+](=O)[O-]` | 2 |  |  |
| `water` | water |  | H2O | `O` | 1,2 |  |  |
| `hydronium` | oxonium ion | hydronium ion; hydronium | H3O+ | `[OH3+]` | 2 |  |  |
| `hydroxide` | hydroxide ion | hydroxide | HO- | `[OH-]` | 2 |  |  |
| `methoxide` | methoxide ion | methoxide; methanolate | CH3O- | `C[O-]` | 2 |  |  |
| `ethoxide` | ethoxide ion | ethoxide; ethanolate | C2H5O- | `CC[O-]` | 2 |  |  |
| `tert-butyl-cation` | 2-methylpropan-2-ylium | tert-butyl cation; 2-methyl-2-propyl cation | C4H9+ | `C[C+](C)C` | 1,2,7 |  |  |
| `methyl-cation` | methylium | methyl cation | CH3+ | `[CH3+]` | 2 |  |  |
| `methyl-anion` | methanide | methyl anion | CH3- | `[CH3-]` | 2 |  |  |
| `methanethiol` | methanethiol | methyl mercaptan | CH4S | `CS` | 2,3 |  |  |
| `methanethiolate` | methanethiolate ion | methanethiolate | CH3S- | `C[S-]` | 2 |  |  |
| `dimethyl-sulfide` | methylsulfanylmethane | dimethyl sulfide | C2H6S | `CSC` | 3 |  |  |
| `dmso` | dimethyl sulfoxide | DMSO; methylsulfinylmethane | C2H6OS | `C[S+](C)[O-]` | 2 |  |  |
| `hydrogen-chloride` | hydrogen chloride | HCl | HCl | `Cl` | 2 |  |  |

### 5.3 Verified `layout` values (heavy atoms, index = SMILES atom order; every listed layout is a lattice embedding whose stereo RDKit reproduced from the coordinates with implicit hydrogens; the last eight contain exactly one face-adjacent unbonded pair, which `layoutOf` reports as a required "no bond" pair — 09-amendment-no-bond.md §2.1)

```json
{
 "r-3-methylhexane":                 [[3,0,0],[2,0,0],[1,0,0],[0,0,0],[0,0,-1],[0,1,0],[-1,1,0]],
 "s-3-methylhexane":                 [[3,0,0],[2,0,0],[1,0,0],[0,0,0],[0,0,1],[0,1,0],[-1,1,0]],
 "trans-1r-2r-dimethylcyclohexane":  [[0,0,-1],[0,0,0],[0,1,0],[0,1,1],[1,1,1],[1,0,1],[1,0,0],[1,-1,0]],
 "trans-1s-2s-dimethylcyclohexane":  [[0,0,1],[0,0,0],[0,1,0],[0,1,-1],[1,1,-1],[1,0,-1],[1,0,0],[1,-1,0]],
 "trans-1-4-dimethylcyclohexane":    [[0,0,1],[0,0,0],[1,0,0],[1,0,-1],[1,1,-1],[1,1,-2],[0,1,-1],[0,1,0]],
 "e-but-2-ene":                      [[0,1,0],[0,0,0],[1,0,0],[1,-1,0]],
 "e-pent-2-ene":                     [[0,1,0],[0,0,0],[1,0,0],[1,-1,0],[2,-1,0]],
 "e-hex-3-ene":                      [[-1,0,0],[0,0,0],[1,0,0],[1,1,0],[2,1,0],[3,1,0]],
 "2e-4e-hexa-2-4-diene":             [[0,1,0],[0,0,0],[1,0,0],[1,-1,0],[2,-1,0],[2,-2,0]],
 "e-1-2-dichloroethene":             [[0,1,0],[0,0,0],[1,0,0],[1,-1,0]],
 "s-2-bromobutane":                  [[0,1,0],[0,0,0],[0,0,1],[1,0,0],[2,0,0]],
 "r-2-bromobutane":                  [[0,1,0],[0,0,0],[0,0,-1],[1,0,0],[2,0,0]],
 "r-2-iodobutane":                   [[0,1,0],[0,0,0],[0,0,-1],[1,0,0],[2,0,0]],
 "s-2-iodobutane":                   [[0,1,0],[0,0,0],[0,0,1],[1,0,0],[2,0,0]],
 "meso-2-3-dibromobutane":           [[0,1,0],[0,0,0],[0,0,1],[1,0,0],[1,0,-1],[1,-1,0]],
 "2r-3r-dibromobutane":              [[0,1,0],[0,0,0],[0,0,-1],[1,0,0],[1,-1,0],[1,0,1]],
 "2s-3s-dibromobutane":              [[0,1,0],[0,0,0],[0,0,1],[1,0,0],[1,-1,0],[1,0,-1]],
 "trans-1r-2r-dibromocyclohexane":   [[0,0,-1],[0,0,0],[0,1,0],[0,1,1],[1,1,1],[1,0,1],[1,0,0],[1,-1,0]],
 "trans-1s-2s-dibromocyclohexane":   [[0,0,1],[0,0,0],[0,1,0],[0,1,-1],[1,1,-1],[1,0,-1],[1,0,0],[1,-1,0]],
 "r-butan-2-ol":                     [[0,1,0],[0,0,0],[0,0,-1],[1,0,0],[2,0,0]],
 "s-butan-2-ol":                     [[0,1,0],[0,0,0],[0,0,1],[1,0,0],[2,0,0]],
 "trans-1r-2r-2-methylcyclohexanol": [[0,0,-1],[0,0,0],[0,1,0],[0,1,1],[1,1,1],[1,0,1],[1,0,0],[1,-1,0]],
 "trans-1s-2s-2-methylcyclohexanol": [[0,0,1],[0,0,0],[0,1,0],[0,1,-1],[1,1,-1],[1,0,-1],[1,0,0],[1,-1,0]],
 "trans-1r-2r-cyclohexane-1-2-diol": [[0,0,-1],[0,0,0],[0,1,0],[0,1,1],[1,1,1],[1,0,1],[1,0,0],[1,-1,0]],
 "trans-1s-2s-cyclohexane-1-2-diol": [[0,0,1],[0,0,0],[0,1,0],[0,1,-1],[1,1,-1],[1,0,-1],[1,0,0],[1,-1,0]],
 "r-lactic-acid":                    [[0,1,0],[0,0,0],[0,0,-1],[1,0,0],[2,0,0],[1,-1,0]],
 "s-lactic-acid":                    [[0,1,0],[0,0,0],[0,0,1],[1,0,0],[2,0,0],[1,-1,0]],
 "s-alanine":                        [[0,1,0],[0,0,0],[0,0,-1],[1,0,0],[2,0,0],[1,-1,0]],
 "r-alanine":                        [[0,1,0],[0,0,0],[0,0,1],[1,0,0],[2,0,0],[1,-1,0]],
 "z-but-2-ene":                      [[0,1,0],[0,0,0],[1,0,0],[1,1,0]],
 "z-hex-3-ene":                      [[-1,1,0],[0,1,0],[0,0,0],[1,0,0],[1,1,0],[2,1,0]],
 "z-2-chlorobut-2-ene":              [[0,1,0],[0,0,0],[1,0,0],[1,1,0],[1,-1,0]],
 "e-2-chlorobut-2-ene":              [[0,1,0],[0,0,0],[1,0,0],[1,-1,0],[1,1,0]],
 "e-3-methylpent-2-ene":             [[0,1,0],[0,0,0],[1,0,0],[1,1,0],[1,-1,0],[2,-1,0]],
 "z-3-methylpent-2-ene":             [[0,1,0],[0,0,0],[1,0,0],[1,-1,0],[1,1,0],[2,1,0]],
 "z-1-2-dichloroethene":             [[0,1,0],[0,0,0],[1,0,0],[1,1,0]],
 "e-1-2-dibromobut-1-ene":           [[0,1,0],[0,0,0],[1,0,0],[1,-1,0],[1,1,0],[2,1,0]]
}
```

The four cis entries (`cis-1-2-dimethylcyclohexane`, `cis-1-2-dibromocyclohexane`, `cis-cyclohexane-1-2-diol`, `cis-1-4-dimethylcyclohexane`) have **no** heavy-atom-only definite layout (§6.3) and use `embedOnLattice`, which returns the explicit H in `hPos`. Their verified layouts with one explicit H (for `test/content/buildable.test.ts` fixtures): cis-1,2-dimethylcyclohexane heavy `[[-1,0,0],[0,0,0],[0,1,0],[0,1,1],[1,1,1],[1,0,1],[1,0,0],[1,-1,0]]` with H on atom 1 at `[0,0,-1]`; the dibromide and diol use the same cells; cis-1,4 `[[0,-1,0],[0,0,0],[1,0,0],[1,0,1],[1,1,1],[1,1,2],[0,1,1],[0,1,0]]` with H on atom 1 at `[0,0,-1]`. Note that `MoleculeEntry.layout` cannot express an explicit H, hence the fallback rule.

## 6. Buildability rule

### 6.1 Definition

A target graph `T` is **buildable** iff `embedOnLattice(T) !== null` (02-chemistry-core §13; 09-amendment-no-bond.md §4.4): there is an injective map `pos: atoms(T) → Z³` such that every bonded heavy pair is face-adjacent, the `tet`/`ez` tags are realised (`sign(V) = tet.sign`, planar coplanar alkene with the `cis` relation) with explicit H cells for tetrahedral centres that need them, and every face-adjacent *unbonded* heavy pair is recorded as a required "no bond" pair (`suppressedPairs`) that the student sets with the bond wand. Touching is no longer forbidden (the former "induced subgraph" rule is withdrawn). Consequences (all confirmed by enumeration):

1. **Odd rings** are impossible (no odd cycle in the cubic lattice). Excluded from library and roster; `optionalDiagonalIsomers` and `requiresDiagonalBonds` keep the door open.
2. **Fused/bridged cages**: a 2×3 planar hexagon has a chord; six-membered rings are always the cube-corner chair (Help > Rings). Placing an atom on one of the two free cube corners bonds it to three ring atoms (`cage` warning, R15).
3. **Alkene geometry**: an sp2 carbon's substituents sit perpendicular to the C=C axis, all in one plane; two substituents on adjacent alkene carbons that are cis occupy face-adjacent cells, auto-bond when placed, and the student breaks that bond with the wand (one such pair for every Z-1,2-disubstituted and every trisubstituted alkene, two for a tetrasubstituted one). **Every alkene with a defined E/Z is therefore buildable**; a same-side pair left bonded shows up as an extra ring and the feedback appends `NO_BOND_HINT` (§9).
4. **Ring alkenes** (cyclohexene, 1-methylcyclohexene, 1,2-dimethylcyclohexene) embed on the chair; the double bond is labelled `RING` and no geometry check runs.
5. Quaternary carbons, neopentyl chains, 2,2,4-trimethylpentane, 3-ethyl-2-methylpentane and every chain in the library embed (max 297 search nodes with the plain embedder).

### 6.2 Library entries that need a "no bond" pair (09-amendment-no-bond.md §2.1; RDKit-verified layouts in §5.3)

| entry | required suppressed pair (SMILES atom indices) | used by |
|---|---|---|
| `z-but-2-ene` | [0,3] (the two methyls) | `ch7-build-z-but-2-ene` (target), alkene-stability quiz text |
| `z-hex-3-ene` | [1,4] (the two CH2) | `ch9-predict-lindlar-z-hex-3-ene` (`expected`) |
| `z-2-chlorobut-2-ene` | [0,3] (C3 methyl and Cl) | `ch7-build-z-2-chlorobut-2-ene` (target) |
| `e-2-chlorobut-2-ene` | [0,4] (the two methyls) | library only (naming) |
| `e-3-methylpent-2-ene` | [0,3] | library only (naming) |
| `z-3-methylpent-2-ene` | [0,4] | library only (naming) |
| `z-1-2-dichloroethene` | [0,3] (the two chlorines) | library only |
| `e-1-2-dibromobut-1-ene` | [0,4] (Br on C1 and the ethyl CH2) | `ch9-predict-br2-1-equiv-but-1-yne` (`expected`) |

Every entry (192) and every build target (exact, name, stereo-exact, isomer, predict expected/acceptAlso, quiz display) is buildable; the 184 entries not listed here embed induced (no suppression); no v1 target needs more than one suppression. `test/content/buildable.test.ts` asserts all of this (§11 tests B1–B3; the pair list lives in `test/content/fixtures/suppressions.ts`).

### 6.3 Ring cis/trans on the cube chair (verified fact that the Help overlay and two hints depend on)

Take the chair `(0,0,0) (0,1,0) (0,1,1) (1,1,1) (1,0,1) (1,0,0)` (Newell normal ∝ `(1,1,−1)`). At each ring carbon the two ring bonds are perpendicular, so the unique octant (perpendicular-to-both) substituent cell is `(0,0,±1)` at `(0,0,0)` and `(1,±1,0)` at `(1,0,0)`; but `(1,1,0)` is the omitted cube corner (bonds to three ring atoms) and `(0,0,1)` is face-adjacent to ring atom `(1,0,1)`. Hence with octant substituents on adjacent ring carbons **only the trans arrangement exists** (`(0,0,−1)` face `+`, `(1,−1,0)` face `−`). A **cis-1,2** pair requires one substituent in the ring plane (T-shaped centre, e.g. methyl at `(−1,0,0)`) plus an explicit H block at `(0,0,−1)` to make that centre definite. 1,2-Disubstituted ring products in the roster: trans ones (`ch4-trans…`, `ch8-…br2-cyclohexene-trans`, `ch8-…hydroboration-1-methylcyclohexene`) build with octant substituents; cis ones (`ch4-cis…`, `ch8-…oso4…`, `ch8-…h2-1-2-dimethylcyclohexene`) need the T + H technique, which their instructions and hints state explicitly, and the ring-face arrows (`StereoAnalysis.ringFaces`) give the student the cis/trans reading live.

## 7. Acceptance (`src/content/acceptance.ts`)

All evaluators are pure functions of `(challenge, ctx)`. `analyze` results are memoised per graph object for the duration of one `evaluate` call. `attempt = ctx.attempt` (1-based, supplied by State). Points: `pointsFor(c, attempt, reduced)`:

```
pointsFor(c, attempt, reduced):
  if reduced: return pointsForAttempt(c.points, 2, false)          // half, floored
  if isAttemptLimited(c.rule): return pointsForAttempt(c.points, attempt, false)
  return c.points
```
State (not this module) replaces `pointsEarned` by `creditDelta(c, result, progress, index)` (§1) before applying it: 0 when the challenge was already solved with ≥ that credit, the remainder `points − floor(points/2)` on the one-time reduced → full upgrade.

### 7.1 Common preconditions (build rules)

```
requireTargeted(ctx):
  if ctx.targeted === null or ctx.padMolecules.indexOf(ctx.targeted) < 0
      → fail('nothing-targeted')                  // "Target a molecule on the lab pad first."
  a = analyze(ctx.targeted)
  if a.warnings.some(w => w.kind === 'over-valence' || w.kind === 'h-block-valence')
      → fail('valence-error', { atom: w.atom + 1, el })
  return a
kindForVerdict(v, sameElements):
  DIFFERENT_FORMULA      → sameElements ? 'wrong-charge' : 'wrong-formula'
  DIFFERENT_CONSTITUTION → 'constitutional-isomer'
  ENANTIOMER             → 'enantiomer'
  DIASTEREOMER           → 'diastereomer'
  UNSPECIFIED            → 'unspecified-center'
  INVALID_GEOMETRY       → 'invalid-alkene-geometry'
```
`sameElements` = `elementCounts` of student and target agree (only the net charge differs). The zone precondition (all atoms on the pad, `y ≥ 9`) is enforced by State when it assembles `padMolecules`; evaluators trust the context.

### 7.2 `exact-molecule` and `name-to-structure`

```
a = requireTargeted(ctx); T = parseEntry(rule.target); tA = analyze(T)
r = sameMolecule(ctx.targeted, T, { stereo: 'none' })
if r.same → pass('correct', { name: tA.name ?? rule.names?.[0] ?? tA.formula })
else fail(kindForVerdict(r.verdict, sameElements), { yours: a.formula, expected: tA.formula, name, extraRing: a.ringCount > tA.ringCount ? 1 : undefined })
```
`extraRing` (09 §4.5) makes the `wrong-formula` / `constitutional-isomer` template append `NO_BOND_HINT`: the student left two touching atoms bonded that the target does not bond.

### 7.3 `formula-and-groups` (checks in this order; first failure reported)

```
a = requireTargeted(ctx)
1 formulaWithoutCharge(a) !== rule.formula          → 'wrong-formula' {yours, expected}
2 rule.netCharge !== undefined && a.netCharge !== rule.netCharge → 'wrong-charge' {yours: a.netCharge, expected}
3 for g of rule.required: no hit with hit.group === g → 'missing-group' {what: GROUP_NAME[g]}
4 for g of rule.forbidden: some hit.group === g       → 'forbidden-group' {what: hit.label}
5 rule.ringCount !== undefined && a.ringCount !== rule.ringCount → 'wrong-ring-count' {yours, expected}
6 rule.ringSizes: sizes = smallestRings(g).map(len); for s of ringSizes: sizes.includes(s) false → 'wrong-ring-count' {yours: sizes.join('/') || 'none', expected: `a ${s}-membered ring`}
7 rule.piBonds !== undefined && piBondCount(g) !== rule.piBonds → 'wrong-pi-count' {yours, expected}
8 for p of rule.atomCounts: n = count of a.atoms where el === p.el && (p.hyb ? hybridization === p.hyb : true) && (p.charge !== undefined ? charge === p.charge : true);
    n < (p.min ?? 0) || n > (p.max ?? ∞) → 'missing-group' {what: describe(p)}   // "at least 1 sp carbon" / "exactly 3 sp2 carbons"
pass('correct', { name: a.name ?? a.formula })
```
`formulaWithoutCharge` strips a trailing charge suffix so `rule.formula` is always neutral-style; charged targets use `netCharge`.

### 7.4 `isomer-set`

```
{required, optional} = isomerHashes(rule)
allowed = ctx.diagonalBondsEnabled ? required ∪ optional : required
goal    = rule.count + (ctx.diagonalBondsEnabled ? optional.size : 0)
a = requireTargeted(ctx)
for m of ctx.padMolecules (m !== ctx.targeted): am = analyze(m)
    if formulaWithoutCharge(am) !== rule.formula || !allowed.has(am.hash) → 'extra-molecule' {formula: am.formula}
if formulaWithoutCharge(a) !== rule.formula → 'wrong-formula'
if !allowed.has(a.hash)                     → 'not-an-isomer' {formula: rule.formula, name: a.name}
if ctx.isomersDone.has(a.hash)              → 'already-built' {name: a.name}, progress {done, total: goal}
done = ctx.isomersDone.size + 1
passed = done ≥ goal
return { passed, kind: 'correct', progress: {done, total: goal}, pointsEarned: passed ? points : 0, message: passed ? FEEDBACK.correct : `${done} of ${goal} isomers built …` }
```
State adds `a.hash` to `isomersDone` whenever `kind === 'correct'` (passed or not). A non-passing accepted isomer is reported with `kind: 'correct'`, `passed: false`.

### 7.5 `stereo-exact`

```
a = requireTargeted(ctx)
targets = [rule.target, ...(rule.accept ?? [])].map(parseEntry)
results = targets.map(t => sameMolecule(ctx.targeted, t, { stereo: rule.mode }))
if results.some(r => r.same) → pass('correct', { name: labelledName(target) })
r = results[0]  // feedback always relative to the primary target
fail(kindForVerdict(r.verdict, sameElements), { atom: (r.offendingAtom ?? 0) + 1, bond: r.offendingBond, name, yours: a.formula, expected: analyze(targets[0]).formula, extraRing: a.ringCount > analyze(targets[0]).ringCount ? 1 : undefined })
```
Planar-centre feedback: when `r.verdict === 'UNSPECIFIED'`, the message appends `STEREO_TEXT.flatT` or `flatSquare` according to `a.stereo.centers.find(c => c.atom === r.offendingAtom)?.shape` (`centers` holds one entry per qualifying carbon in ascending id, not one per atom id; `undefined` → `flatT`) (07 also highlights `suggestedHPositions`).

### 7.6 `select-atom`

```
graphs   = rule.molecules.map(parseEntry)        // the locked molecules, in rule order = ctx.padMolecules order
analyses = graphs.map(analyze)
A = answerSet(rule.selector, graphs, analyses)   // SelectionItem[]
S = normalizeSelection(ctx.selection, rule.target, analyses)
if S === 'no-hydrogens' → fail('no-hydrogens')  (does not consume an attempt: State keeps attempt unchanged)
if S.length === 0        → fail('wrong-atom', {expected: rule.answerDescription}) with attempt consumed
keysA = set(A.map(itemKey)); keysS = set(S.map(itemKey))
ok = rule.match === 'all' ? keysA equals keysS : (keysS.size > 0 && every k of keysS in keysA)
if ok → pass('correct', {expected: rule.answerDescription}), pointsEarned = pointsFor(c, attempt, false)
if attempt ≥ rule.maxAttempts → fail('attempts-exhausted', {expected: rule.answerDescription})
fail('wrong-atom', {expected: rule.answerDescription, picked: describe(S[0])})
```
`normalizeSelection`: for `target: 'hydrogens'`, an item without `hSlot` (heavy-atom fallback) expands to `{molecule, atom, hSlot: k}` for `k in 0..hydrogens−1`; if that atom has zero hydrogens the whole selection is `'no-hydrogens'`. For `target: 'atoms'` any `hSlot` is dropped. Equivalence classes: `answerSet` for `most-acidic-h` already returns every H of every site in the tie class, so "any member" is automatic.

### 7.7 `predict-product`

```
expected = rule.expected.map(parseEntry); comps = ctx.padMolecules (product zone)
for m of comps: if analyze(m) has over-valence/h-block-valence → 'valence-error'
if comps.length === 0 → 'missing-molecule' {expected: expected.length, have: 0, formula: analyze(expected[0]).formula}   // same as 04 §8.4 step 2
// 1. exact multiset match under the stereo policy
matched = greedyMatch(comps, expected, m => e => sameMolecule(m, e, {stereo: rule.stereoCheck}).same)
if rule.acceptAny: if some comp matches some expected and comps.length === 1 → pass
else if matched covers every expected and every comp → pass('correct', {name})
// 2. acceptAlso (single component, constitution only)
if comps.length === 1 and rule.acceptAlso: for alt of rule.acceptAlso:
    if sameMolecule(comps[0], parseEntry(alt.smiles), {stereo:'none'}).same
        → pass('correct-reduced', {note: alt.note}), pointsEarned = pointsFor(c, attempt, true)
// 3. diagnostics, in order
if comps.length > expected.length → 'extra-molecule' {formula of the first unmatched comp}
if comps.length < expected.length → 'missing-molecule' {expected: expected.length, have: comps.length, formula of first unmatched expected}
// same count, some pair failed: report the best verdict for the first unmatched expected against the first unmatched comp
r = sameMolecule(comp, exp, {stereo: rule.stereoCheck});  fail(kindForVerdict(r.verdict, sameElements), {..., extraRing: analyze(comp).ringCount > analyze(exp).ringCount ? 1 : undefined})
```
`greedyMatch` is a maximum bipartite matching by backtracking (≤ 3 expected molecules in v1, so brute force over permutations). `acceptAlso` is checked only after the exact match fails and only when the student built exactly one molecule.

### 7.8 `choose-reagent`

```
if ctx.chosenReagent === undefined → 'wrong-reagent' {reason: 'Pick a reagent card first.'} (attempt not consumed)
if rule.correct.includes(chosen) → pass('correct', {reagent: cardById(chosen).label}), pointsFor(c, attempt, false)
reason = rule.rejections?.[chosen] ?? FEEDBACK default
if attempt ≥ rule.maxAttempts → 'attempts-exhausted' {expected: rule.correct.map(label).join(' or '), reason}
fail('wrong-reagent', {reason})
```

### 7.9 `quiz`

```
answer = ctx.quizAnswer
mc:    ok = typeof answer === 'string' && rule.correct.includes(answer)
yesno: ok = typeof answer === 'boolean' && answer === rule.correct
if ok → pass('correct', {explanation: rule.explanation}), pointsFor(c, attempt, false)
if attempt ≥ rule.maxAttempts → 'attempts-exhausted' {explanation, expected: correct option text / 'Yes'|'No'}
fail('wrong-option', {})            // explanation is withheld until the last attempt
```

## 8. Selectors (`src/content/selectors.ts`)

`answerSet(selector, graphs, analyses)` returns `SelectionItem[]` over molecule index `m` and atom id; `info = analyses[m].atoms[atom]`.

| kind | answer set |
|---|---|
| `most-acidic-h` | `min = min over all m, all sites s ∈ analyses[m].acidity.hydrogens of s.pKa`; every `{m, s.parentId, s.slot}` with `s.pKa ≤ min + PKA_TIE` (the global tie class across all placed molecules) |
| `most-basic-site` | `max` of `pKaH` over all `basicSites` of all molecules; every `{m, b.atomId}` with `pKaH ≥ max − PKA_TIE` |
| `most-basic-n` | as above restricted to sites with `graphs[m].atoms[b.atomId].el === 'N'` |
| `hybridization` | every atom with `info.hybridization === value` and (`el` absent or `info.el === el`) |
| `chirality-center` | every carbon `c` with `info.sigma === 4`, `info.hydrogens ≤ 1`, `charge 0`, and `cipRank(g, hydrogens, c).tie === false` (four Rule-1a-distinct ligands; topological, independent of the placed geometry) |
| `tertiary-carbon` | every neutral carbon whose carbon-neighbour count is exactly 3 and `hybridization === 'sp3'` |
| `electrophilic-carbon` | every neutral carbon with ≥ 1 neighbour in `{O, N, F, Cl, Br, I}`; for a C=O the carbonyl carbon qualifies (it has an O neighbour) |
| `lone-pair-atom` | every atom with `info.lonePairs > 0` |
| `more-substituted-alkene-carbon` | for each non-aromatic C=C bond `(a,b)`: `ka = heavy neighbours of a other than b`, `kb` likewise; if `ka > kb` add `a`, if `kb > ka` add `b`, tie adds nothing |
| `fewest-carbon-substituents-cx` | over all molecules find every bond C–X (X ∈ Cl, Br, I); `n(m) = min` carbon-neighbour count of such a carbon in molecule `m`; `nmin = min over m`; answer = **every atom** of every molecule with `n(m) === nmin` |
| `atom-ids` | `{molecule: 0, atom: id}` for each id (ids are `parseSmiles` order of `molecules[0]`) |

Validator rule S1: every select-atom answer set must be non-empty, and for `match: 'all'` it must not contain every atom of every molecule.

## 9. Feedback (`src/content/feedback.ts`)

`feedbackText(kind, params, override)` returns `override ?? FEEDBACK[kind](params)`. Params are optional; templates fall back to the generic sentence when a param is absent. All strings ASCII, sentence case, no emojis.

| kind | template |
|---|---|
| `correct` | `Correct!{name ? ` That is ${name}.` : ''}{explanation ? ' ' + explanation : ''}{expected ? ` Answer: ${expected}.` : ''}` |
| `correct-reduced` | `Accepted for half credit: ${note}` |
| `wrong-formula` | `Wrong formula: yours is ${yours}, the target is ${expected}. Check the atom count and the number of hydrogens the panel shows.` + (`extraRing` ? ` ${NO_BOND_HINT}` : ``) |
| `constitutional-isomer` | `Right formula (${yours}) but the atoms are connected differently: this is a constitutional isomer of the target${name ? ` (you built ${name})` : ''}.` + (`extraRing` ? ` ${NO_BOND_HINT}` : ``) |
| `enantiomer` | `Right molecule, wrong handedness: your build is the enantiomer (mirror image) of the target. Swap any two groups on C${atom}.` |
| `diastereomer` | `Right atoms and bonds, but the stereochemistry differs from the target at C${atom}: this is a diastereomer. Check the R/S or cis/trans labels in the panel.` |
| `unspecified-center` | `C${atom} has no definite configuration yet. ${shapeText}` where `shapeText` = `STEREO_TEXT.flatT` or `STEREO_TEXT.flatSquare` |
| `invalid-alkene-geometry` | `The C=C double bond${bond !== undefined ? ` at bond ${bond}` : ''} is not laid out flat. Put every substituent beside its alkene carbon (never in line with the C=C) and keep all of them in one plane.` |
| `missing-group` | `The molecule needs ${what}. The panel lists the functional groups it currently has.` |
| `forbidden-group` | `The molecule must not contain ${what}.` |
| `wrong-ring-count` | `Ring count: yours has ${yours}, the target needs ${expected}.` + (`yours > expected` ? ` ${NO_BOND_HINT}` : ``) |
| `wrong-pi-count` | `Pi bonds: yours has ${yours}, the target needs ${expected}. Use the bond wand to change a bond order.` |
| `wrong-charge` | `Right atoms, wrong charge: the net charge is ${yours}, the target has ${expected}. Use the charge tool (C) on the atom that should carry it.` |
| `valence-error` | `${el} at position ${atom} has too many bonds. Remove a bond or lower a bond order before submitting.` |
| `extra-molecule` | `Extra molecule on the pad: ${formula}. Remove it (or use Clear pad in the menu) and submit again.` |
| `missing-molecule` | `Expected ${expected} product molecules, found ${have}. Build the missing one (${formula}) as a separate molecule.` |
| `already-built` | `You already built ${name}. Build a different isomer.` |
| `not-an-isomer` | `That molecule has the right formula (${formula}) but is not a valid isomer here${name ? `: ${name}` : ''}. (Stereoisomers count as the same skeleton.)` |
| `wrong-atom` | `Not that one.${picked ? ` You picked ${picked}.` : ''} Think again and try another selection.` |
| `no-hydrogens` | `That atom has no hydrogens. Select a hydrogen (or an atom that carries one).` |
| `wrong-reagent` | `That reagent does not give this product. ${reason}` |
| `wrong-option` | `Not correct. Try again.` |
| `attempts-exhausted` | `No attempts left. The answer was: ${expected}.${explanation ? ' ' + explanation : ''}${reason ? ' ' + reason : ''}` |
| `nothing-targeted` | `Nothing is targeted. Look at the molecule you built on the lab pad and press Submit again.` (pad rules only; an empty product zone is `missing-molecule`) |

`NO_BOND_HINT` = `Two touching atoms that should not be bonded have bonded into a ring: point the bond wand (B) at the bar between them and press E until it shows the red x break marker (no bond).` (09 §1.9).

Progress line for isomer sets (not a FeedbackKind, returned in `message` with `kind: 'correct'`, `passed: false`): `Isomer ${done} of ${total} accepted: ${name}. Keep going.`

## 10. Loaders

- `loadLibrary()` parses `molecules.json` once, builds `byId`/`bySmiles` maps and calls `registerNameIndex(buildNameIndex(entries))`.
- `loadReagents()` returns the cards; `cardById` throws on an unknown id (content bug).
- `loadFullRoster()` returns the file as-is; `loadRoster(config)` filters `disabledChallenges` and, unless `config.diagonalBonds`, `requiresDiagonalBonds`. `rosterInfo` maps every full-roster record to `{ids, points, enabled, passMark}` with `enabled[i] = isEnabled(full[i], config)`.
- `isomerHashes` is memoised per rule object.

## 11. Validation test spec

`validateContent` returns every problem as `"<where>: <message>"`; `test/content/validate.test.ts` asserts the result is `[]` for the shipped files, and each numbered check below has a negative fixture test that mutates a copy and expects the specific message.

Library (`test/content/library.test.ts`):
- **L1** every `smiles` parses (`parseSmiles`, no `SmilesError`); `kekulize`/`perceiveAromaticity` succeed; no lowercase characters in `smiles`.
- **L2** `hillFormula(parseEntry(e)) === e.formula`.
- **L3** `labelTargetStereo` reproduces `labels` (R/S/E/Z at the listed positions; lowercase `r/s` positions must be `NOT_CENTER`); entries without `labels` have no R/S/E/Z label.
- **L4** `meso === analyzeStereo(embedded world graph).meso` for entries with tet tags (embedding via `layoutOf`).
- **L5** no two entries `SAME` under `stereo: 'absolute'`; ids unique; ids kebab-case ASCII.
- **L6** `ringCount(g) === 0` or every smallest ring has even size (no odd rings).
- **L7** (roster side) every rule SMILES (`target`, `accept[]`, `molecules[]`, `reactant`, `product`, `expected[]`, `acceptAlso[].smiles`, `isomers[]`, `rx`, `display.smiles`) equals some entry's `smiles`.
- **L8** `layout`, when present: length = heavy-atom count, every bonded pair face-adjacent, `suppressedPairsOf(g, layout)` equals what `layoutOf` reports (touching unbonded pairs are required suppressions, not errors), and the world graph built from `layout` with those pairs suppressed gives `sameMolecule(..., parseEntry(e), {stereo:'absolute'}).verdict === 'SAME'` (no explicit H needed).

Roster (`test/content/challenges.test.ts`):
- **R1** JSON matches the `Challenge` shape (every field present, `rule.type` in the union, `topic` in `Topic`, `chapter` in 1..11); `version === 1`.
- **R2** ids unique; file order non-decreasing in `chapter`; `source` matches `/^MM \d+\.\d+ \(m\d{5}\)$/` and its module number equals `chapterStart + sectionNumber` (§1 table).
- **R3** `points === POINTS_BY_DIFFICULTY[difficulty]`; `totalPoints(rosterInfo(full, DEFAULT_CONFIG))` equals the sum computed in the test from the JSON (and equals 378 — a literal that lives only in this test's assertion message and in §2 as a cross-check).
- **R4** `maxAttempts` equals `DEFAULT_MAX_ATTEMPTS` for the rule type; `quiz` `correct` ids exist in `options`; option ids unique; `shuffle` false when option order is meaningful (the formal-charge scale).
- **R5** `choose-reagent`: `options ⊆ REAGENT_IDS`, `correct ⊆ options`, `rejections` keys ⊆ `options \ correct`, every card in `options` is enabled by default (or the challenge is disabled in `DEFAULT_CONFIG`), `react(reactant, cardById(correct[0]))` yields a product `SAME` (stereo 'none') as `product`.
- **R6** `predict-product`: `react(parseEntry(reactant), cardById(reagentId), {equiv, rx: parseEntry(rx), rearrangement: 'warn'})` returns `major` such that, as a multiset under `stereoCheck`, `expected` ⊆ `major` (and equals `major` unless `acceptAlso` lists the remainder or `mixture` is true); every `acceptAlso.smiles` is `SAME` (stereo 'none') as some element of `major ∪ minor`; `stereoCheck !== 'none'` only when every `expected` graph carries a `tet`/`ez` tag. There is **no** `major ∪ minor` exception for `expected` (04 §7.5 / §9.1 row 62 note / §10 item 2 are withdrawn): a challenge whose graded product the engine reports as `minor` is a content bug. `ch11-predict-sn2-inversion-2-bromobutane` therefore uses `SN2_NAI` (decision R4 `R4_sec_sn2` → `[SN2]`, `major = [C[C@@H](I)CC]`, policy `absolute`, inversion through `substituteInvert`; 04 §9.2 row t), not `SN2_NAOH` (R3 `[E2, SN2]`, alcohol in `minor`). Row 62 of 04 §9.1 stays as an engine test vector only.
- **R7** `select-atom`: answer set non-empty (S1); for `most-acidic-h`/`most-basic-*` every answer site is `verified: true` and the second-lowest distinct pKa (resp. second-highest pKaH) over **all** sites of **all** listed molecules is ≥ `PKA_MIN_MARGIN` away; `answerDescription` non-empty; `target: 'hydrogens'` only with `most-acidic-h`.
- **R8** `isomer-set`: `count === isomers.length`; every isomer has `rule.formula`; hashes pairwise distinct; `optionalDiagonalIsomers` have the formula, distinct hashes, and contain an odd ring.
- **R9** `formula-and-groups`: `required ∩ forbidden = ∅`, all ids in `GROUP_IDS`, none of the ungrouped classes (urea, carbamate, nitro, water) is relied on; the accepted-set fixtures listed in §4 pass and the listed negatives fail with the stated kind.
- **R10** `stereo-exact` / `name-to-structure` / `exact-molecule` targets: `embedOnLattice` (suppressed pairs allowed) succeeds on the full graph (stereo included) for `stereo-exact` and on the stereo-stripped graph otherwise, and `buildReport` lists its `suppressedPairs`; `names[]` contains both locant spellings when the name has a locant (regex `\d-[a-z]+-\d` ↔ `-\d-` forms) — asserted by listing.
- **R11** every `instruction`, `objective`, `hint`, `title` non-empty ASCII-printable (≡ and degree sign allowed), no reference to "previous", "you are holding", "the last molecule".
- **R12** no record has `requiresDiagonalBonds: true` (v1); the number of records is 91.
- **R13** every `quiz` rule with `display` has `layoutOf(entryBySmiles(display.smiles)) !== null` (embeds **with** stereo, suppressed pairs allowed and placed by `placeLockedMolecule`, 09 §3.3): 07 §1.1 step 3 places the display as locked blocks, which has no ball-and-stick fallback, so only an odd-ring molecule is excluded; `display.markedAtom`, when present, is `< heavy-atom count`. Negative fixture: `display: {smiles: "C1CC1"}` on `ch7-quiz-alkene-stability` → `challenge:ch7-quiz-alkene-stability: display C1CC1 is not buildable`.

Buildability (`test/content/buildable.test.ts`):
- **B1** every library entry embeds; the eight §6.2 entries return exactly the one `suppressedPairs` entry listed in `test/content/fixtures/suppressions.ts` (`NEEDS_SUPPRESSION`) and `null` under `{allowSuppressed: false}`; every other entry returns `suppressedPairs.length === 0`.
- **B2** every build-rule SMILES (per R10 policy) embeds within `EMBED_NODE_BUDGET`; record `nodesVisited` and fail if any exceeds 10 000 (regression guard); `suppressedPairs.length ≤ 2` for every row of `buildReport`, which the test prints.
- **B3** end-to-end for every `exact-molecule`, `name-to-structure`, `stereo-exact` and `predict-product` record: place the embedding through `World.setBlock` (plus `hPos` H blocks), call `world.suppressBond` for every `suppressedPairs` entry, set bond orders, `extractMolecules`, `evaluate` → `passed === true` (this covers the four 09 §4.2 records); for every `predict-product` with `acceptAlso`, placing the alternative gives `kind === 'correct-reduced'`; for `ch7-build-z-but-2-ene` the same placement *without* the suppression gives `kind === 'wrong-formula'` with a message ending in `NO_BOND_HINT`.

Acceptance (`test/content/acceptance.test.ts`): per rule type ≥ 1 positive and ≥ 2 negative contexts with the expected `FeedbackKind` (WP-05 note): the negatives named in §4 plus the mirror image of each `stereo-exact` target (`enantiomer`, except meso which passes), a T-shaped 2-bromobutane (`unspecified-center`), a Z but-2-ene for `ch7-build-e-but-2-ene` (`diastereomer`), an E build for `ch7-build-z-but-2-ene` (`diastereomer`) and a twisted Z build for it (`invalid-alkene-geometry`), the (E)-hex-3-ene product for `ch9-predict-lindlar-z-hex-3-ene` (`diastereomer`), the cis dibromide for `ch8-predict-br2-cyclohexene-trans` (`diastereomer`), an extra ethanol on the pad for `ch3-isomers-c4h10` (`extra-molecule`), attempt 3 on a select-atom (`attempts-exhausted`, `pointsEarned 0`), attempt 2 correct on a quiz (`pointsEarned === floor(points/2)`).

Selectors (`test/content/selectors.test.ts`): one fixture per `Selector.kind` from the roster (expected ids listed in `answerDescription`), plus heavy-atom fallback on the CH3 of ethanol (`no-hydrogens` is impossible there; the O of dimethyl ether under `'hydrogens'` yields `'no-hydrogens'`).

Reagents (`test/content/reagents.test.ts`): every `ReagentId` in `REAGENT_IDS` has exactly one card; every `reagentId`/`options` value in the roster is enabled by default.

## 12. Unresolved questions

1. *Resolved (this revision).* `acceptAlso` credit is half (`pointsForAttempt(points, 2, false)`, outcome `SolvedReduced`) and a later exact match upgrades to `SolvedFull` for the remainder (§1 `applyOutcome` rule (e), §2 item 3). Follow-ups owned by other packages: 04 §8.4 step 5 must read "half credit"; 08 §3.2 rule A3 and test P-A2 become the upgrade rule/test (`applyOutcome(applyOutcome(empty, 1, SolvedReduced, 2), 1, SolvedFull, 2)` → `solved 2n`, `reduced 0n`, `earned 4`; the reverse order leaves `earned 4`, `reduced 0n`).
2. `StereoExactRule` has no `display` field, so "build the enantiomer / a diastereomer of the shown molecule" (stereo-on-grid S5/S8) cannot be authored; proposed addition `display?: { smiles: string }` on `StereoExactRule` for v1.1.
3. `select-atom` `match: 'any'` is implemented as "non-empty and ⊆ answer set" (§1); if 07-ui allows multi-selection on `'any'` rules the contract wording "intersects" should be tightened to this.
4. `ch9-predict-acetylide-alkylation-ethyne` relies on `react` replacing exactly one terminal H of ethyne; 04-reaction-bench should confirm `NANH2_THEN_RX` reacts the first site only (helper rule "react one site and warn" would otherwise emit a spurious warning).
5. `KMNO4_HOT` on 2-methylbut-2-ene: the card must return acetone + acetic acid as `major` (not CO2); confirmed by reaction-bench RB-13 but the engine test vector should be added in 04.
6. The alkene-stability quiz quotes heats of hydrogenation as −127/−120/−116 kJ/mol (OpenStax 10e Table 7.2); mcmurry-orgo1 §9.4 lists −125/−119/−115 from an older edition; verify against the shipped edition before release and update both strings.
7. `MoleculeEntry.layout` cannot carry explicit H cells, so the four cis ring entries rely on `embedOnLattice` at runtime (≈ 1–2 ms each); if ghost builds for those need determinism, add `layoutH?: Record<string, [number,number,number][]>` to the contract.
8. Library size: 192 entries. The panel name index is built once (≈ 192 parses + hashes, < 50 ms); if start-up budget matters, entries used only for naming (Z isomers, 1,4-dimethylcyclohexanes, pentan-2/3-one) can be moved to a lazy second file.
9. `verify05.py` (RDKit library/roster/buildability verifier that produced §5.2, §5.3 and §6.2) lives only in the design session's scratchpad because this pass was not allowed to write other files; WP-05 must copy it into `tools/reference/` so the tables can be regenerated after any content edit.
