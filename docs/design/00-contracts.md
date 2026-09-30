# 00 — Shared contracts

Source of truth for every type and public function that more than one work package touches. The TypeScript files are normative; this document explains invariants and records decisions. Files:

| File | Holds |
|---|---|
| `src/chem/types.ts` | Element, Charge, TARGET_VALENCE, Atom/WorldAtom, Bond, MoleculeGraph, Warning, GroupHit, AtomInfo, stereo types, acidity types, Analysis, ReactionResult, Embedding, ParsedSmiles, `ChemApi` |
| `src/content/types.ts` | ReagentCard, Challenge + rule union, SubmitResult, SubmissionContext, MoleculeEntry, scoring constants |
| `src/world/types.ts` | Block table, chunk/world constants, zones, CellKey/PairKey, MoleculeIndex, placement/bond/charge validation results, REFUSAL_TEXT, MeshBuffers, VoxelHit, PLAYER, PlayerState |
| `src/app/events.ts` | GameEvents map, `Emitter`, `createEmitter` |
| `src/lms/types.ts` | ScormApi12, ProgressState, RosterInfo, ScoreSummary, LmsWrite, AdapterMode, storage keys, limits |

Precedence when this document and a research report disagree: `docs/SCOPE.md` > this document > research reports > `DESIGN-draft.md`.

## 0. The one rule

**Pure modules import nothing from `three` or the DOM.** Pure = everything under `src/chem`, `src/reactions`, `src/content`, `src/world` (data and algorithms), `src/player/physics.ts`, `src/input/keymap.ts`, `src/lms/Progress.ts`, `src/util`, `src/app/events.ts`, `src/app/State.ts`. They are unit-tested in vitest's `node` environment. `test/pure-imports.test.ts` (WP-11) greps every file in those folders for `from 'three'`, `document.`, `window.`, `localStorage` and fails on a hit. DOM/WebGL modules (`src/render`, `src/ui`, `src/input/*` except keymap, `src/lms/ScormAdapter.ts`, `src/lms/scorm-api.ts`, `src/lms/storage.ts`, `src/app/Game.ts`, `src/app/Settings.ts`, `src/main.ts`) are exercised by the Playwright smoke test only.

## 1. Chemistry types (`src/chem/types.ts`)

### Element, Charge, BondOrder, Vec3
`Element` is the closed union `H C N O F Cl Br I S P`. `P` is accepted by the parser and the valence table but has no block and no v1 content. `Charge` is `-1 | 0 | 1`; the charge tool cycles `0 → +1 → −1 → 0`. `BondOrder` is `1 | 2 | 3`; there is no order 0 (see Reconciliation note R3). `Vec3` is a readonly tuple; on world graphs every coordinate is an integer cell index.

### TARGET_VALENCE, VALENCE_ELECTRONS, ATOMIC_NUMBER
`TARGET_VALENCE[el][charge]` is the total bond order (heavy bonds + hydrogens) an atom must reach; `undefined` means the (element, charge) pair is unsupported and `canSetCharge` refuses it. Values (acids-bases-hybrid 2.2): H {0:1}; C {−1:3, 0:4, +1:3}; N {−1:2, 0:3, +1:4}; O {−1:1, 0:2, +1:3}; S {−1:1, 0:2, +1:3}; P {0:3, +1:4}; F/Cl/Br/I {−1:0, 0:1}. Lone pairs are never stored: `lonePairs(el,q) = (VALENCE_ELECTRONS[el] − q − TARGET_VALENCE[el][q]) / 2`. There is no "advanced sulfur" flag in v1 (DESIGN-draft 4.2's `{4,6}` is dropped; DMSO is built as S⁺–O⁻ exactly as McMurry draws it).

### Atom / WorldAtom
Invariants: `id` equals the atom's index in `atoms`; ids are dense `0..n−1`. `explicitH` is non-null only on SMILES-derived atoms with a bracket H count; on world atoms it is always `null` because explicit H blocks are collapsed by `extractMolecules` into `hPos` (their cell positions) and contribute nothing to the H count that valence arithmetic would not already give (total H = targetValence − heavy bond-order sum, both with and without H blocks). `aromatic` is set only by `perceiveAromaticity`; parsers set it from lowercase SMILES and Kekulize before returning. `tet` appears only on target graphs (SMILES `@`/`@@`, or produced by `react`). `WorldAtom` is `Atom` with `pos` and `hPos` required and `explicitH: null`; `hasPositions(g)` is the type guard that turns a `MoleculeGraph` into a `WorldGraph`. `WorldGraph` is the only input `assignRS`, `assignEZ` and `analyzeStereo` accept.

### TetTag / EzTag
`TetTag.order` lists four neighbours (`'H'` = the implicit hydrogen; at most one). `sign` is the sign of `V = ((p1−p0)×(p2−p0))·(p3−p0)` over the tips in that order in any right-handed realisation: SMILES `@@` ⇒ `+1`, `@` ⇒ `−1` (stereo-on-grid 5.1, RDKit-verified). Swapping two entries flips `sign`; implementers must keep the pair consistent when they renumber. `EzTag` names one reference neighbour per end and whether they are cis; a bond carries at most one `EzTag`; ring double bonds never carry one.

### Bond
`a < b` always. `order` is the Kekulé order and stays editable even when `aromatic` is true. `diagonal` is reserved: no v1 code sets it, the world never creates it, but every graph algorithm (adjacency, rings, CIP, embedding, isomorphism) must treat a diagonal bond exactly like a face bond so the flag can ship in v2 without touching them.

### MoleculeGraph
`adj[atomId]` lists bond indices, both endpoints list the bond. A graph may hold several connected components (SMILES with `.`, ozonolysis fragments); `analyze` reports `components` and `ringCount = bonds − atoms + components`. Graphs are immutable values; every transformation returns a new graph.

### Warning
Closed union with eight kinds. `over-valence` (atom, have, max) comes from `implicitHydrogens`; `h-block-valence` from extraction (an H block with 0 or ≥2 bonds); `charge-unsupported` from extraction when a stored charge has no target valence; `planar-center` (shape `T` or `square-planar`) and `alkene-geometry` (`COLLINEAR | NOT_PLANAR | TWISTED`) from `analyzeStereo`; `cage` from the ring-count jump rule (an atom bonded to three atoms of one ring, critic item 4.5); `isomorphism-cap` from `findIsomorphisms` when the state budget is hit; `unverified-pka` when the acidity answer rests on a constant marked unverified. The molecule panel renders warnings verbatim through one `warningText(w)` table in `src/ui/strings.ts`.

### GROUP_IDS / GroupHit
`GROUP_IDS` is the detection order and the closed id set: the 23 McMurry Table 3.1 entries (mono- and diphosphate merged into `phosphate`, `acid chloride` generalised to `acyl-halide`), then eight ion groups that fire on charged atoms after the neutral rules, then `alkane`/`cycloalkane` which fire only when nothing else did. A `GroupHit` claims heavy atoms; a later rule that touches a claimed atom is skipped (the exclusion order is the array order). Subtypes refine the label: alcohol `methanol|primary|secondary|tertiary|phenol|enol`; amine `primary|secondary|tertiary|aryl`; halide `methyl|primary|secondary|tertiary|vinyl|aryl`; aldehyde `formaldehyde`; ester `formate`; alkene `cumulated` (allene). `label` is the exact panel string, e.g. `alcohol (secondary)`. Groups are a set: aspirin reports acid + ester + arene.

### AtomInfo
One entry per heavy atom (world H blocks are collapsed, so no `H` entries; the SMILES parser never produces `H` atoms). Derivation order: `neighbors`, `heavyBondOrderSum`, `hydrogens = targetValence − heavyBondOrderSum` (or 0 with `valenceError` when negative), `sigma = neighbors.length + hydrogens`, `pi = Σ(order−1)`, `lonePairs`, `conjugatedLonePair` (lone pair, `pi = 0`, element ∈ {N,O,S} or C⁻, and a neighbour has a bond of order ≥2 to a third atom; halogens never), `stericNumber = sigma + lonePairs − (conjugated ? 1 : 0)`, `hybridization` (SN ≥4 sp3, 3 sp2, 2 sp, else none; `sigma = 0` ⇒ none), `geometry` and `idealAngle` per acids-bases-hybrid 4.1, `formalCharge = V − (2·lonePairs + heavyBondOrderSum + hydrogens)` which equals `charge` by construction. The HUD must state that reported angles are ideal McMurry 1.6–1.10 values, not the 90° lattice.

### StereoCenter / DoubleBondStereo / StereoAnalysis
`StereoAnalysis.centers` has one entry for every carbon with four σ-partners (heavy + H) and at most one H, labelled `R | S | UNSPECIFIED | NOT_CENTER | CANNOT_ASSIGN`; `shape` classifies the explicit substituent directions (`octant`/`T` with an implicit H, `seesaw`/`square-planar` with four explicit). `UNSPECIFIED` is exactly `T` or `square-planar`; `NOT_CENTER` is a Rule-1a tie between two ligands without stereo elements; `CANNOT_ASSIGN` is a tie that would need CIP rules 3–5 or the digraph size cap. `priorities` lists neighbours best-first (`'H'` = implicit H, always last when present). `hint` is the student message from stereo-on-grid 1.5, written out in `src/ui/strings.ts`. `doubleBonds` has one entry per C=C between non-aromatic carbons, labelled `E | Z | NO_EZ | RING | COLLINEAR | NOT_PLANAR | TWISTED`; `RING` means both carbons share a ring of size ≤ 7 and no geometry check ran. `cisTrans` is the chain-continuation relation reported next to E/Z. `ringFaces` gives, per ring, the Newell normal and each substituent's face sign for cis/trans feedback. `chiral` = at least one R/S centre and not `meso`; `meso` = the molecule equals its own mirror image (all parities flipped, `sameMolecule(..., {stereo:'absolute'})` still SAME).

### StereoPolicy / CompareVerdict / CompareResult
`sameMolecule(student, target, {stereo})` returns a verdict and `same`. Verdict order of preference over all isomorphisms: `SAME > ENANTIOMER > DIASTEREOMER`; `UNSPECIFIED` when a target centre maps onto a flat student centre, `INVALID_GEOMETRY` when a target `ez` bond maps onto a non-planar student alkene, `DIFFERENT_CONSTITUTION` when no isomorphism exists, `DIFFERENT_FORMULA` when the formula or net charge differs. `same` is: policy `none` → verdict ∈ {SAME, ENANTIOMER, DIASTEREOMER, UNSPECIFIED, INVALID_GEOMETRY} (constitution only); `relative` → SAME or ENANTIOMER; `absolute` → SAME; `ez` → SAME or ENANTIOMER with every `ez` bond matching (tetrahedral centres ignored). Charges are always compared. Without positions on the student graph and a target with stereo tags, `absolute`/`relative`/`ez` return `UNSPECIFIED` with `same = false`.

### HydrogenSite / BasicSite / AcidityAnalysis
One `HydrogenSite` per hydrogen (explicit blocks first, `slot` 0..n−1 per parent). All hydrogens on one parent share `classKey`; identical `classKey` ⇒ identical `pKa`. `mostAcidic` = sites with `pKa ≤ min + PKA_TIE` (0.05). `verified: false` marks constants McMurry does not tabulate (HBr, HI, H3O⁺, ROH2⁺, protonated carbonyl/amide, neutral amide N–H 17, aniline N–H 30, allylic C–H, H2S, imine/nitrile conjugate acids); a challenge whose answer depends on one gets an `unverified-pka` warning at content-validation time and is rejected. `PKA_MIN_MARGIN` (3) is the required gap between the answer class and the runner-up class for every select-H / select-basic challenge (validated by `test/content/challenges.test.ts`). `BasicSite.pKaH` is the conjugate acid's pKa; `mostBasic` = max within the tie.

### Analysis
The full panel record. `formula` is Hill order (`C`, `H`, then alphabetical; all alphabetical when no C) with net charge appended as `+`, `-`, `2-`… when non-zero. `hydrogens[i]` is the total H on atom i. `dou = (2C + 2 + N − H − X)/2` over the counts (charge ignored). `hash` is FNV-1a 64-bit hex over the WL refinement of labels `el/H/charge/aromatic` with bond labels `1|2|3|ar`; it ignores stereo. `stereo` is `null` unless the input passed `hasPositions`. `name` comes from the library index (hash filter + isomorphism confirm) and is `null` for unknowns.

### ReactOptions / ReactionResult
`react(substrate, card, opts)` never throws for chemistry reasons: it returns `noReaction: true` with a `justification` (rule text) or products. `major` lists every molecule the student must build (fragments), or the alternatives of a textbook mixture when `mixture: true` (the challenge decides whether any-of is accepted). `stereo` is `racemic` when exactly one new centre forms under no-stereo control (`tet` left undefined), `relative` when syn/anti templates set `tet`/`ez` on an achiral reactant, `absolute` only when the reactant carried defined centres that are retained or inverted (SN2). `warnings` are student-facing sentences (mixture, rearrangement, slow reaction). Reactant graphs are SMILES-derived (bench reactants are always library molecules), so `tet`/`ez` on the reactant come from the target SMILES, not from grid geometry (Reconciliation R6).

### EmbedOptions / Embedding
`embedOnLattice` ports `tools/reference/embed.py` plus the stereo constraints of reaction-bench 4.2: BFS from the max-degree atom, six face candidates (twelve more with `allowDiagonal`), reject if `faceAdjacent(p,q) ≠ bonded(i,q)` for any placed q, reject stereo violations (`tet.sign`, `ez.cis`), budget `EMBED_NODE_BUDGET` = 50 000 nodes. Explicit H are embedded only at stereocentres (needed for a definite parity) and returned in `hPos`. Multi-component graphs are embedded per component with a 4-cell offset. Returns `null` on failure (Z-alkenes, odd rings without diagonals) — callers fall back to the ball-and-stick preview.

### ParsedSmiles / SmilesError
`parseSmiles` implements the OpenSMILES subset of DESIGN-draft 4.6 plus bracket charges (`[O-]`, `[NH3+]`; magnitude > 1 is an error), `@`/`@@` (neighbour order: preceding atom, bracket H, ring-closure digits in digit order, then branches/next atom) and `/` `\` on bonds adjacent to a double bond (table in stereo-on-grid 5.2). Directional bonds on ring-closure digits are a `SmilesError`. Lowercase aromatic input is Kekulized by perfect matching; failure is a `SmilesError('cannot kekulize')`. `SmilesError.index` is the character offset for library-validation messages.

### ChemApi
The signature list every implementer codes against; see section 5. Modules export plain functions with these exact names and parameter orders; `ChemApi` is not instantiated (it exists so tsc checks each module against the contract via `const _check: Pick<ChemApi,'parseSmiles'> = { parseSmiles }` at the bottom of each module).

## 2. Content types (`src/content/types.ts`)

### REAGENT_IDS / ReagentCard
Canonical ids are the uppercase ids of reaction-bench.md section 1 (mcmurry-orgo1's lowercase ids are dropped; the mapping is in 04-reaction-bench.md). Cards are data in `src/content/reagents.json`, validated against `REAGENT_IDS` by a test. `enabledByDefault` follows SCOPE.md, not the research default: `HBR_ROOR` (radical HBr) is **on** because SCOPE lists it; `MCPBA`, `EPOXIDE_H3O`, `CH2I2_ZNCU`, `CHCL3_KOH` are **off** with `requiresDiagonalBonds: true` (SCOPE excludes cyclopropanation and epoxidation); `KMNO4_COLD`, `HIO4`, `SN2_NAN3`, `SN2_NASH`, `SN2_NH3`, `SN2_NAOAC`, `ROH_HF_PYR`, `HCOOH_H2O`, `MEOH_HEAT` are off (optional in the research); `TBUOK` is on but its Hofmann orientation is labelled "(not in McMurry 10e)". `nuc.fragment` is a SMILES written from the attaching atom so the substitution builder can parse and graft it. `rule` selects the transformation in `src/reactions/*`; one rule serves several cards (`HX_ADD` serves HX_HCL/HBR/HI, `SUBST_ELIM` serves every ch-11 card and runs the decision table).

### Challenge and rules
A `Challenge` is one record in `src/content/challenges.json`; `id` is permanent because progress bitmasks are indexed by roster order (new challenges are appended, never inserted). `points` must equal `POINTS_BY_DIFFICULTY[difficulty]` (test). `requiresDiagonalBonds: true` challenges are hidden in v1 (data model open, content excluded). The rule union:

| type | parameters | accepted when |
|---|---|---|
| `exact-molecule` | `target` SMILES | `sameMolecule(targeted, target, {stereo:'none'}).same` and the targeted molecule has no warnings of kind `over-valence`/`h-block-valence` |
| `formula-and-groups` | `formula`, `required[]`, `forbidden[]`, `ringCount?`, `piBonds?`, `ringSizes?`, `netCharge?`, `atomCounts?` | formula equal; every required GroupId present; no forbidden GroupId; counts equal when given; every `ringSizes` entry occurs among smallest rings; each `atomCounts` predicate's count within [min,max] |
| `isomer-set` | `formula`, `isomers[]`, `count`, `optionalDiagonalIsomers?` | each submission: formula equal → hash ∈ isomers (or optional set when diagonals enabled) → not already done; passes when `isomersDone.size ≥ count` (or `≥ count + optional` when diagonals enabled and the student built them) |
| `name-to-structure` | `names[]` (both locant spellings), `target` | as exact-molecule |
| `stereo-exact` | `target`, `mode`, `accept?[]` | `sameMolecule(targeted, t, {stereo: mode}).same` for `t` = target or any of `accept` |
| `select-atom` | `molecules[]`, `selector`, `target`, `match`, `maxAttempts`, `answerDescription` | selected set equals the answer set (`match:'all'`) or intersects it (`'any'`); for `most-acidic-h`/`most-basic-*` any member of the equivalence class counts; heavy-atom fallback: selecting a heavy atom means "all its hydrogens" and passes iff all of them are in the answer set |
| `predict-product` | `reactant`, `reagentId`, `equiv?`, `rx?`, `expected[]`, `stereoCheck`, `acceptAlso?`, `acceptAny?` | product-zone components, as a multiset, match `expected` under `stereoCheck` (or any one of them when `acceptAny`); an `acceptAlso` match passes with feedback kind `correct-reduced` and its note; extra components fail with `extra-molecule` |
| `choose-reagent` | `reactant`, `product`, `options[]`, `correct[]`, `maxAttempts`, `rejections?` | `chosenReagent ∈ correct` |
| `quiz` (`kind:'mc'`) | `prompt`, `options[]`, `correct[]`, `shuffle`, `maxAttempts`, `explanation`, `display?` | `quizAnswer ∈ correct` |
| `quiz` (`kind:'yesno'`) | `prompt`, `correct`, `maxAttempts`, `explanation`, `display?` | `quizAnswer === correct` |

Every build rule additionally requires: the targeted molecule lies on the pad (all atoms `x,z ∈ [52,76)`, `y ≥ 9`) or, for `predict-product`, in the product zone; pad rules ignore other pad components except `isomer-set` and `predict-product`, which fail with `extra-molecule` naming the stray component's formula.

### SubmitResult / SubmissionContext / FeedbackKind
`SubmitResult.kind` is a closed union; `message` is the fully written student sentence produced by `src/content/feedback.ts` from one table (overridable per challenge through `Challenge.feedback`). `pointsEarned` is 0 when the challenge was already solved or the attempt multiplier is 0. `SubmissionContext` is the only thing the evaluator sees; the UI assembles it from `MoleculeIndex` + selection state. Evaluators are pure: `evaluate(challenge, ctx): SubmitResult`.

### MoleculeEntry / MoleculeLibrary
`smiles` is Kekulé (no lowercase) and may carry stereo tags. `formula`, `labels` and `meso` are validated at test time by the engine (`test/content/library.test.ts`: parse → analyze → compare); `layout` is a verified lattice embedding used for ghost builds and select-atom placement (falls back to `embedOnLattice` when absent). No two entries may be isomorphic under `stereo:'absolute'`.

### Scoring constants
`POINTS_BY_DIFFICULTY = {easy:2, medium:4, hard:8}`; `ATTEMPT_MULTIPLIER = [1, 0.5, 0]` for quiz / select-atom / choose-reagent (full, half, none); build rules have unlimited attempts at full points. `rawScore(earned,total) = round(100·earned/total)`; `total` is the sum over enabled challenges, computed from the roster (never a literal — critic item 5.1). `DEFAULT_PASS_MARK = 70` (also the manifest `masteryscore`, read from `orgocraft.config.json`).

## 3. World types (`src/world/types.ts`)

### Block table
Uint8 ids: 0 Air, 1 Bedrock, 2 Stone, 3 Dirt, 4 Grass, 5 Sand, 6 Glass, 7 LabTile, 8 LabTileEdge, 9 Bench, 10 BenchReactantTile, 11 BenchProductTile, 32–39 ores (C N O S F Cl Br I), 64–72 atoms (C N O S F Cl Br I H). Hydrogen has no ore and an unlimited hotbar count. `isOpaque` excludes Air, Glass and atoms (atoms render at 0.62 scale separately, so terrain faces behind them are emitted). Unbreakable: Bedrock, LabTile, LabTileEdge, Bench, both bench tiles. Ore yield 3. `CPK_HEX`/`CPK_TEXT` are the only colour source for atom textures and the legend.

### Chunk and world constants
8×8 chunks of 16×32×16, x fastest (`cidx`), 128×32×128 cells, seed 1337. Lab pad `x,z ∈ [52,76)`, floor `y = 8`, spawn `(64, 9, 64)` facing −z. Bench zones south of the pad: `z ∈ [36,48)`, reactant `x ∈ [52,64)` (locked: no placing, removing, bonding or charging), product `x ∈ [64,76)`; console blocks at `(63,9,49)` and `(64,9,49)`. `zoneOf(x,y,z)` is the single membership function; a molecule belongs to a zone iff every atom does.

### CellKey / PairKey
Strings: `CellKey = "x,y,z"`, `PairKey = "<a>|<b>"` with `a` the cell of smaller `cellIndex` (x fastest). Chosen over packed numbers because keys appear in events, logs, test fixtures and the scene-description mirror; `Map<string>` cost is irrelevant at ≤ 1024 atoms (Reconciliation R8).

### MoleculeIndex
Derived from the grid but **authoritative for bond orders and charges** (the Uint8 grid stores neither; critic item 6.4c). Invariants: a bond exists iff two atom cells are face-adjacent (`faceAdjacent`) and both are atoms; order defaults to 1 on creation; `bondOrderSum(key)` counts explicit H blocks as 1 each; `componentOf` ids are dense and ordered by the component's minimum `cellIndex` so extraction is deterministic; `rebuildFromGrid` (context restore, tests) must be passed the previous order and charge maps and preserve them for surviving pairs/cells. H blocks: `addAtom` of an H block is legal only when it will have exactly one heavy neighbour after placement (checked by placement validation).

### Placement / bond / charge validation
Every mutation is validated first and refused with a typed reason plus a student sentence from `REFUSAL_TEXT` (never silently drop a bond). Placement checks in order: bounds → occupied → player overlap → locked zone → inventory → valence of the new atom and of every neighbour it would bond to (`have = bondOrderSum + 1 > TARGET_VALENCE[el][charge]`) → H-block parent rule. Placement succeeds with `cage: true` when the new atom bonds to three atoms of one existing ring (panel warning). Bond wand cycles `1→2→3→1` and skips orders that either endpoint's valence forbids; if none is allowed it stays and reports `bondValence`. Charge tool follows acids-bases-hybrid 3.4: refuse unsupported pairs, refuse when `bondOrderSum > targetValence(el, newQ)`.

### MeshBuffers / VoxelHit / PLAYER / PlayerState / FrameInput
Unchanged from DESIGN-draft 6.3–6.5 and voxel-engine.md; placed here so `src/world/mesher.ts`, `src/world/raycast.ts`, `src/player/physics.ts` and the renderers share one definition. `PICK_DISTANCE` = 6.

## 4. Events (`src/app/events.ts`) and LMS (`src/lms/types.ts`)

`GameEvents` is the closed map; `createEmitter()` is synchronous and exception-isolating (a throwing listener is logged; the others still run). `State.ts` owns the one emitter instance; DOM modules subscribe, pure modules emit only through `State`.

`ScormApi12` is the eight-function SCORM 1.2 surface. `ProgressState` v2 stores three bigint bitmasks over roster index (`attempted ⊇ solved ⊇ reduced`), `earned`, monotonic `reportedRaw`, `currentChallengeId`, `studentId`, and `isomersDone` (localStorage only). Codec: `v2|<hex attempted>|<hex solved>|<hex reduced>|<earned>|<reportedRaw>|<currentChallengeId>`; all-solved for an 80-challenge roster is under 120 characters (`SUSPEND_DATA_BUDGET` = 512, hard limit 4096). Storage key `orgocraft.v1.progress.<studentId>` with `studentId = cmi.core.student_id` in LMS mode and `local` in standalone mode; a mirror whose `studentId` differs from the launched learner is ignored (critic blocker 2.6). `ResumeDecision.restoredFromLocal = true` forbids an automatic score commit: the score is committed only on the next earned milestone. `LmsWrite.scoreRaw` is `null` while raw is 0 or not above `reportedRaw`. `lessonStatus`: `incomplete` until `raw ≥ passMark` → `passed`; `failed` only at Save & Exit when `allAttempted && raw < passMark`. `exit`: `suspend` unless `allSolved`, then `''` — never `logout`. Save & Exit never calls `window.close()`; after `LMSFinish` the UI shows "Progress saved — use the player's Exit button".

## 5. Public API per module

Signatures are in `ChemApi` (`src/chem/types.ts`); this table maps them to files and states what each returns.

| Module | Exports |
|---|---|
| `src/chem/valence.ts` | `targetValence(el, q)`, `lonePairs(el, q)`, `maxValence(el)` |
| `src/chem/graph.ts` | `buildGraph(atoms, bonds): MoleculeGraph` (sorts a<b, builds adj), `neighborsOf(g, id)`, `bondBetween(g, a, b)`, `components(g): number[][]`, `smallestRings(g, maxSize=8): number[][]`, `ringsThrough(g, a, b)`, `withAtom/withoutAtom/withBond/withoutBond/withBondOrder/setCharge` (immutable edits; `setCharge` is the unchecked charge replacement — the validating entry point is `charge.withCharge`) |
| `src/chem/smiles.ts` | `parseSmiles(smiles): ParsedSmiles`, `SmilesError` |
| `src/chem/kekulize.ts` | `kekulize(g): MoleculeGraph` (perfect matching; throws SmilesError) |
| `src/chem/hydrogens.ts` | `implicitHydrogens(g): {hydrogens, warnings}` |
| `src/chem/aromatic.ts` | `perceiveAromaticity(g): MoleculeGraph` (6-ring C/N rule of DESIGN-draft 4.6; retained so library Kekulé forms compare equal) |
| `src/chem/formula.ts` | `elementCounts`, `hillFormula`, `degreesOfUnsaturation`, `ringCount` |
| `src/chem/groups.ts` | `functionalGroups(g, hydrogens): GroupHit[]` |
| `src/chem/wlhash.ts` | `wlHash(g, hydrogens): {hash, classes}`, `fnv1a64(s): string` |
| `src/chem/isomorphism.ts` | `findIsomorphisms(target, student, maxStates=200000): number[][]` (all mappings, VF2-style), `isIsomorphic(a, b): boolean` |
| `src/chem/compare.ts` | `sameMolecule(student, target, opts): CompareResult`, `normalize(g): {graph, hydrogens}` (Kekulé → H → perceive) |
| `src/chem/cip.ts` | `cipRank(g, hydrogens, center, exclude?): CipRank`, `compareLigands(...)` (port of `cipref.py`) |
| `src/chem/stereo.ts` | `assignRS`, `assignEZ`, `analyzeStereo`, `ringFace(g, ring, atom)`, `signedVolume(v1,v2,v3,v4)`, `classifyShape(dirs): CenterShape` |
| `src/chem/stereo-compare.ts` | `compareStereo(target, student, mapping): {verdict, differingCenters, differingBonds, offending}` (used by `compare.ts`) |
| `src/chem/hybridization.ts` | `atomInfo(g, hydrogens): AtomInfo[]`, `hybridization(info)`, `geometry(info)` |
| `src/chem/charge.ts` | `formalCharge(info)`, `canSetCharge(g, atom, q)`, `withCharge(g, atom, q)` (validates via `canSetCharge`, throws on refusal, then delegates to `graph.setCharge`) |
| `src/chem/acidity.ts` | `hydrogenSites`, `basicSites`, `acidity`, `predictAcidBase`, `PKA` constant table, `PKA_SOURCES` |
| `src/chem/analyze.ts` | `analyze(g): Analysis` (pipeline: normalize → counts/formula/DoU/rings → groups → hash → atomInfo → stereo (if positions) → acidity → name → warnings) |
| `src/chem/naming.ts` | `buildNameIndex(library): NameIndex`, `nameOf(g, index?)` |
| `src/chem/embed.ts` | `embedOnLattice(g, opts): Embedding \| null` |
| `src/reactions/react.ts` | `react(substrate, card, opts): ReactionResult` |
| `src/reactions/decision.ts` | `decide(substrate, cX, card): {mechanisms: Mechanism[]; rule: 'R0'..'R6'; justification}` |
| `src/reactions/helpers.ts` | `findAlkenes`, `findAlkynes`, `findCX`, `findCOH`, `alkylCount`, `substrateClass`, `isAllylic`, `isBenzylic`, `isNeopentyl`, `addAcross`, `tautomerize`, `substituteInvert`, `substituteRacemize`, `eliminate`, `checkShift` |
| `src/reactions/additions.ts`, `alkynes.ts`, `substitution.ts`, `elimination.ts`, `oxidation.ts`, `radical.ts`, `alcohols.ts` | one exported `apply<Rule>(substrate, card, opts): ReactionResult` per RuleId |
| `src/content/library.ts` | `loadLibrary(): MoleculeLibrary`, `entryById`, `parseEntry(entry): MoleculeGraph` (memoised) |
| `src/content/reagents.ts` | `loadReagents(): ReagentCard[]`, `cardById(id)` |
| `src/content/challenges.ts` | `loadRoster(config): Challenge[]` (applies `disabledChallenges`, hides `requiresDiagonalBonds`), `rosterInfo(roster, config): RosterInfo` |
| `src/content/acceptance.ts` | `evaluate(challenge, ctx): SubmitResult`, one `evaluate<RuleType>` per rule |
| `src/content/feedback.ts` | `feedbackText(kind, params): string`, `FEEDBACK` table |
| `src/content/selectors.ts` | `answerSet(selector, graphs, analyses): Set<{molecule, atom, hSlot?}>` |
| `src/content/validate.ts` | `validateContent(library, roster, reagents): string[]` (run by tests: SMILES parse, formula, labels, pKa margins, buildability via `embedOnLattice`, points = difficulty) |
| `src/world/molecule-index.ts` | `createMoleculeIndex(): MoleculeIndex`, `validatePlacement(...)`, `validateBondChange(...)`, `validateChargeChange(...)` |
| `src/world/extract.ts` | `extractMolecules(index, zone?): WorldGraph[]`, `extractComponent(index, id): WorldGraph` (collapses H blocks into `hPos`; atom ids in ascending `cellIndex`) |
| `src/world/world.ts` | `World` (getBlock/setBlock/dirty marking; calls index mutations) |
| `src/world/worldgen.ts` | `generate(world, seed)` |
| `src/world/mesher.ts` | `buildChunkMesh`, `FACES` |
| `src/world/raycast.ts` | `raycastVoxels` |
| `src/player/physics.ts` | `stepPlayer(p, input, dt, isSolid)` |
| `src/lms/Progress.ts` | `encode(state)`, `decode(s, studentId)`, `applyOutcome(state, index, outcome, points)`, `summarize(state, roster): ScoreSummary`, `lmsWrite(state, roster, atExit)`, `resume(lmsString, localString, studentId, roster): ResumeDecision` |
| `src/lms/scorm-api.ts` | `discover(): ScormApi12 \| null` |
| `src/lms/ScormAdapter.ts` | `class ScormAdapter { start(): Promise<AdapterMode>; milestone(state); commit(); saveAndExit(); mode; studentId }` |
| `src/app/State.ts` | `class State` (roster, progress, inventory, current challenge, targeted component, selection, emitter) |

## 6. Folder tree

DESIGN-draft section 8 extended. Pure files marked `(pure)`.

```
index.html                         stage, canvas tabindex=0, HUD roots, live regions
orgocraft.config.json              passMark, disabledChallenges[], enabledReagents?, diagonalBonds:false, version
scorm/imsmanifest.template.xml     {{FILES}}, {{MASTERY}}, {{VERSION}}
scorm/xsd/*.xsd                    imscp_rootv1p1p2, adlcp_rootv1p2, imsmd_rootv1p2p1, ims_xml
scripts/check-relative-paths.mjs   fails if dist/ has root-absolute URLs or restricted extensions
scripts/package-d2l.mjs            dist/ -> release/orgocraft-v<ver>-d2l.zip (versioned folder inside)
scripts/package-scorm.mjs          dist/ + manifest + XSDs -> release/orgocraft-v<ver>-scorm12.zip (root level)
scripts/smoke.mjs                  Playwright smoke (nested path + fake window.API parent)
src/main.ts                        entry; no-WebGL message
src/app/Game.ts                    composition root (DOM/WebGL); RAF loop; fixed-step physics
src/app/State.ts          (pure)   roster, progress, inventory, target, selection; owns the emitter
src/app/events.ts         (pure)   GameEvents, createEmitter
src/app/Settings.ts                settings schema + localStorage
src/chem/types.ts         (pure)   contracts
src/chem/valence.ts       (pure)
src/chem/graph.ts         (pure)
src/chem/smiles.ts        (pure)
src/chem/kekulize.ts      (pure)
src/chem/hydrogens.ts     (pure)
src/chem/aromatic.ts      (pure)
src/chem/formula.ts       (pure)
src/chem/groups.ts        (pure)
src/chem/wlhash.ts        (pure)
src/chem/isomorphism.ts   (pure)
src/chem/compare.ts       (pure)
src/chem/cip.ts           (pure)   CIP Rule 1a hierarchical digraph (port of cipref.py)
src/chem/stereo.ts        (pure)   R/S, E/Z, shapes, ring faces
src/chem/stereo-compare.ts (pure)  parity comparison under an isomorphism
src/chem/hybridization.ts (pure)   AtomInfo, hybridization, geometry
src/chem/charge.ts        (pure)   formal charge, charge tool rules
src/chem/acidity.ts       (pure)   PKA table, hydrogen/basic sites, predictAcidBase
src/chem/analyze.ts       (pure)
src/chem/naming.ts        (pure)
src/chem/embed.ts         (pure)   lattice embedding (port of embed.py + stereo constraints)
src/reactions/react.ts    (pure)   dispatch by card.rule
src/reactions/decision.ts (pure)   SN1/SN2/E1/E2 table R0-R6
src/reactions/helpers.ts  (pure)
src/reactions/additions.ts (pure)  HX_ADD, RADICAL_HBR, X2_ADD, HOX_ADD, HYDRATION, OXYMERC, HYDROBORATION, H2, SYN_DIOL, ANTI_DIOL, EPOXIDATION, EPOXIDE_OPEN, CYCLOPROPANATION
src/reactions/alkynes.ts  (pure)   ALKYNE_HYDRATION_HG, ALKYNE_HYDROBORATION, LINDLAR, DISSOLVING_METAL, ACETYLIDE_ALKYLATION, DOUBLE_E2 (+ HX/X2 on alkynes)
src/reactions/oxidation.ts (pure)  OZONOLYSIS, KMNO4_CLEAVAGE, DIOL_CLEAVAGE
src/reactions/substitution.ts (pure) SN1/SN2 builders
src/reactions/elimination.ts (pure) E1/E2 builders (Zaitsev/Hofmann), DEHYDRATION
src/reactions/radical.ts  (pure)   ALLYLIC_BROMINATION, RADICAL_HALOGENATION
src/reactions/alcohols.ts (pure)   ROH_TO_RX
src/reactions/rearrangement.ts (pure) checkShift
src/content/types.ts      (pure)
src/content/molecules.json         library
src/content/challenges.json        roster
src/content/reagents.json          reagent cards
src/content/library.ts    (pure)
src/content/reagents.ts   (pure)
src/content/challenges.ts (pure)
src/content/acceptance.ts (pure)
src/content/selectors.ts  (pure)
src/content/feedback.ts   (pure)
src/content/validate.ts   (pure)
src/world/types.ts        (pure)
src/world/blocks.ts       (pure)   palette hex table for terrain, ore names
src/world/chunk.ts        (pure)
src/world/world.ts        (pure)
src/world/worldgen.ts     (pure)
src/world/mesher.ts       (pure)
src/world/raycast.ts      (pure)
src/world/molecule-index.ts (pure)
src/world/extract.ts      (pure)
src/player/physics.ts     (pure)
src/player/camera.ts               FirstPersonCamera (three)
src/input/InputManager.ts          keys, focus, preventDefault policy
src/input/pointerlock.ts
src/input/look-modes.ts
src/input/keymap.ts       (pure)
src/render/Renderer.ts             WebGLRenderer, lowGfx, resize, context loss, __orgocraft
src/render/ChunkRenderer.ts
src/render/AtomRenderer.ts         per-element InstancedMesh, H studs, charge badges, target tint
src/render/BondRenderer.ts         bars, pick mesh (visible=false), instanceId -> PairKey
src/render/StereoOverlay.ts        R/S halos, E/Z sprites, ghost H at T centres, ring face discs
src/render/GhostRenderer.ts        translucent target/ghost-build blocks (bench previews, enantiomer mirror)
src/render/Highlight.ts
src/render/element-texture.ts
src/render/palette.ts
src/render/lights.ts
src/ui/hud.ts                      mounts panels, throttled updates from State
src/ui/strings.ts                  every student-facing string not in content/feedback.ts
src/ui/toolbar.ts
src/ui/hotbar.ts                   elements, H slot, bond wand, charge tool, select tool
src/ui/molecule-panel.ts           Analysis, groups, per-atom table, stereo labels, warnings
src/ui/challenge-panel.ts          roster nav, submit, feedback, progress
src/ui/quiz-panel.ts               MC / yes-no dialog (digits, Enter, Y/N)
src/ui/bench-panel.ts              reagent cards, equiv toggle, react, product preview, mechanism text
src/ui/select-atom.ts              select mode: H mini-blocks, [ ] cycling, heavy-atom fallback
src/ui/settings-panel.ts
src/ui/pause-menu.ts
src/ui/help.ts                     controls, chair-hexagon diagram, "bend at sp3, zigzag at C=C"
src/ui/live-region.ts
src/ui/styles.css
src/lms/types.ts          (pure)
src/lms/Progress.ts       (pure)
src/lms/scorm-api.ts
src/lms/ScormAdapter.ts
src/lms/storage.ts
src/util/prng.ts          (pure)
src/util/noise.ts         (pure)
src/util/throttle.ts      (pure)
src/util/vec3.ts          (pure)   add, sub, neg, dot, cross, equals
test/chem/*.test.ts, test/reactions/*.test.ts, test/content/*.test.ts, test/world/*.test.ts,
test/player/physics.test.ts, test/lms/*.test.ts, test/app/*.test.ts, test/pure-imports.test.ts
docs/design/00..08-*.md, docs/INSTRUCTOR.md
```

## 7. Reconciliation notes

- **R1 Scope.** SCOPE.md wins over DESIGN-draft: stereo, charges, acids/bases, hybridization and the reaction bench are v1; aromatic/carbonyl-derivative challenges C18–C25 of the draft are dropped. Aromaticity perception is kept in the comparator only so that the few Kekulé-drawn arenes in the library (benzene for the `arene` group) compare equal in both forms; no v1 challenge targets an arene.
- **R2 Atom model.** Three research reports proposed three Atom shapes (`element` vs `el`, required `pos`, `explicitH?: number`). Chosen: `el`, `charge`, `explicitH: number|null` (SMILES only), `aromatic`, optional `tet`, and `pos`/`hPos` required only on `WorldAtom`. Explicit H blocks are collapsed at extraction into `hPos`; they never appear as `Element 'H'` atoms in analysed graphs. This keeps formula, groups, hashing and isomorphism H-agnostic while stereo keeps every H position.
- **R3 No bond order 0.** reaction-bench.md asked for a "no-bond override" so Z-alkenes can be built. SCOPE fixes "face-adjacent atom blocks are bonded". Consequence accepted and recorded: only E-1,2-disubstituted alkenes have buildable E/Z geometry; every Z or tri/tetrasubstituted E/Z target is a choose-reagent or quiz challenge (05-content.md lists them); `predict-product` rules for Lindlar / 1-equiv HX or X2 on internal alkynes use `stereoCheck: 'none'`. `BondOrder` stays `1|2|3`.
- **R4 Odd rings.** Excluded from v1 content; `Bond.diagonal`, `EmbedOptions.allowDiagonal`, `Challenge.requiresDiagonalBonds`, `ReagentCard.requiresDiagonalBonds`, `IsomerSetRule.optionalDiagonalIsomers` keep the model open. `orgocraft.config.json.diagonalBonds` is `false` and there is no diagonal wand in v1.
- **R5 Stereo comparison.** Parity comparison under isomorphism (stereo-on-grid 5.4) is the arbiter; CIP labels are feedback only. This makes meso and 1,4-ring cases grade correctly without CIP rules 3–5. `sameMolecule` therefore takes a `stereo` policy and returns a verdict rather than a boolean.
- **R6 Bench reactants are library molecules.** The bench locks a library reactant (with `tet`/`ez` from SMILES) in the reactant zone; `react` reads stereo from tags, never from grid geometry. Students build only products. This removes the "reactant alkene geometry undefined" branch of reaction-bench 2.1 from v1.
- **R7 Rearrangements.** `react` detects and warns by default (`rearrangement: 'warn'`), listing both products with `mixture: true`; the only graded rearrangement challenge (ch7-rearrangement-3-methylbut-1-ene) uses `acceptAlso` for the unrearranged product.
- **R8 Keys as strings.** `CellKey`/`PairKey` are strings (`"x,y,z"`, `"a|b"`), replacing the packed numbers of DESIGN-draft 4.4, per the contracts brief; ordering uses `cellIndex`.
- **R9 Bond orders and charges live in MoleculeIndex.** The Uint8 grid holds block ids only; `rebuildFromGrid` must be given the previous order and charge maps (critic 6.4c).
- **R10 Scoring.** Points 2/4/8 by difficulty (doubling the draft's 1/2/4 so half credit stays integral); quiz/select/choose earn full → half → nothing by attempt; build rules unlimited full credit (acids-bases-hybrid's "10 minus 2 per hint" is dropped: there are no hint deductions). Total is computed from the roster. Partial credit is persisted through the `reduced` bitmask.
- **R11 Progress and grade integrity.** Per-student localStorage key, no auto-commit after a local restore, `exit` never `logout`, `failed` only when every enabled challenge was attempted, no `window.close()` (critic 2.6 items). Codec v2 adds `attempted`, `reduced` and `earned`.
- **R12 pKa constants.** One `PKA` table in `src/chem/acidity.ts` with a `source` and `verified` flag per class; `alkane` C–H = 60 (OpenStax 10e) exposed as a single constant; unverified values are shown with "≈" and never decide a graded answer (content validator enforces `PKA_MIN_MARGIN` against verified classes only).
- **R13 Reagent ids.** Uppercase reaction-bench ids are canonical; SCOPE's "radical HBr" puts `HBR_ROOR` on by default despite not being in OpenStax 10e (the card label says so).
- **R14 Functional-group order.** orgo-content's SMARTS table and the draft's ordered predicates are merged into `GROUP_IDS` order with atom claiming: acid → anhydride → ester → thioester → acyl halide → amide → nitrile → aldehyde → ketone → imine → sulfoxide → alcohol → thiol → disulfide → ether → sulfide → amine → halide → arene → alkyne → alkene → phosphate → ions → alkane. Allene C=C is reported as `alkene (cumulated)` (critic 4.8); polyhalomethanes are `halide (methyl)` with count in the label.
- **R15 Cage warning.** Placing an atom inside the chair hexagon is legal for C/N; the panel warns `cage` from a ring-count jump (critic 4.5); the Help overlay tells students to build rings one block above the pad floor.
- **R16 Framed layout.** Inside a frame the stage uses `height: 100vh` (the iframe's own height); `aspect-ratio` only when top-level (critic 2.4).

## 8. Contract additions

Additions agreed during review; they extend, never replace, the types in `src/chem/types.ts`.

### 8.1 `graph.setCharge` replaces `graph.withCharge` (rename)

`withCharge` was exported by both `src/chem/graph.ts` (unchecked immutable edit) and `src/chem/charge.ts` (validating, throws). Two modules exporting the same name with different semantics invites the wrong import (03 §13 item 1). The graph primitive is renamed; only `charge.ts` exports `withCharge`.

```ts
// src/chem/graph.ts — unchecked immutable edit. Not part of ChemApi.
// Replaces atoms[id].charge only; no valence or lone-pair validation; every other field of the atom,
// all bonds, tet and ez tags are kept. Throws RangeError if id is not an atom index of g.
export function setCharge(g: MoleculeGraph, id: number, q: Charge): MoleculeGraph;

// src/chem/charge.ts — the only exported `withCharge`. Calls canSetCharge(g, atom, q); on refusal throws
// Error('charge refused: ' + reason); otherwise returns setCharge(g, atom, q) from graph.ts.
export function withCharge(g: MoleculeGraph, atom: number, charge: Charge): MoleculeGraph;
```

Rules:

1. No module other than `src/chem/charge.ts` may import `setCharge` from `graph.ts` (checked by `test/pure-imports.test.ts`: any `import { … setCharge … } from '../chem/graph'` outside `charge.ts` and `test/chem/graph.test.ts` fails the test).
2. `World.setCharge(key, charge)` in `src/world` (06 §3) is unrelated: it is the world-index writer keyed by `CellKey` and is only called after `validateChargeChange` succeeds.
3. Wherever another design document (02 §3.3, 03 §9.3, 03 §12–13) says `graph.withCharge`, read `graph.setCharge`.
