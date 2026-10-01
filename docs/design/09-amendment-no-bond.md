# 09 — Amendment: "no bond" between touching atom blocks

Status: **normative**. Records SCOPE.md Amendment 1 (2026-09-30). Where this document conflicts with 00–08 it wins; the targeted edits listed in §6 have been applied to those documents so that they no longer say the opposite, but if a stray sentence still does, this document is the authority. Nothing here edits the frozen type files (`src/chem/types.ts`, `src/content/types.ts`, `src/world/types.ts`, `src/app/events.ts`, `src/lms/types.ts`); every new type below is declared and exported by the module named in its comment, and §1.11 lists what a later contracts PR should fold into the frozen files.

## 0. The decision (do not relitigate)

1. **Placement still auto-bonds.** A newly placed atom block gets an order-1 bond to every face-adjacent atom block. Nothing is ever auto-suppressed.
2. **The bond wand can set a bond to order 0 = "no bond".** The wand cycle is `1 → 2 → 3 → 0 → 1`, subject to valence (§1.3).
3. **A no-bond pair is a *suppressed pair*** stored in the `MoleculeIndex` as a `Set<PairKey>`, disjoint from `bonds`. It is rendered with a visible break marker (§5.2), never appears in the extracted `MoleculeGraph`, and does not count toward valence.
4. **Removing either block clears the suppression; re-placing re-bonds** (order 1).
5. **Reason.** With mandatory bonding, any alkene with two substituents on the same side of the C=C (every Z-alkene, every cis-alkene Lindlar product, every tri- and tetrasubstituted alkene with defined E/Z) forced those substituents to touch and bond into a ring. 05-content marked them `NOT-BUILDABLE(stereo)` and demoted them to quizzes and choose-reagent challenges. That mark, 00-contracts note R3, the "induced subgraph" buildability rule of 05 §6.1 and the "phantom-bond rule" of 04 §7.1 are **replaced** by this document.

What does **not** change: `BondOrder` in graphs stays `1 | 2 | 3`; `extractMolecules`, `analyze`, `sameMolecule`, `assignRS`, `assignEZ`, `react` and every pure chemistry algorithm are untouched (they never see a suppressed pair); the H-block rules; the charge tool; the seesaw/octant R/S rules (§2.4); odd rings remain impossible (§3.1).

Vocabulary used below: two atom cells **touch** when they are face-adjacent (`faceAdjacent`) and both hold atom blocks; a touching pair is either **bonded** (in `index.bonds`) or **suppressed** (in `index.suppressed`), never both, never neither.

## 1. Contract additions (exact TypeScript; declared locally by the named module)

> Status (2026-10-01): folded into the frozen contracts during integration. `MoleculeIndex` and `BondChangeResult` in `src/world/types.ts` now carry this surface; `MoleculeIndexExt` and `BondChangeResultExt` survive only as aliases in `src/world/molecule-index.ts`, and the two bond events live in `src/app/events.ts`.

### 1.1 `src/world/molecule-index.ts` — the index

```ts
import type { BondOrder, Charge } from '../chem/types';
import type { CellKey, IndexedAtom, MoleculeIndex, PairKey } from './types';

/** Bond order as the wand sees it. 0 = "no bond" (a suppressed pair). Never stored in a MoleculeGraph. */
export type WandOrder = BondOrder | 0;

export interface MoleculeIndexExt extends MoleculeIndex {
  /** Touching atom pairs that are NOT bonded. Disjoint from `bonds`. Never contains a pair with an H endpoint. */
  readonly suppressed: ReadonlySet<PairKey>;
  isSuppressed(key: PairKey): boolean;
  /** Suppressed pairs with `key` as an endpoint, sorted by PairKey. */
  suppressedOf(key: CellKey): PairKey[];
  /** bonds.get(key)?.order ?? (suppressed.has(key) ? 0 : undefined); undefined = the cells do not touch. */
  wandOrder(key: PairKey): WandOrder | undefined;
  /** neighbours(key) minus the partners of suppressedOf(key) — the atoms that contribute to bondsOf(key). */
  bondedNeighbours(key: CellKey): IndexedAtom[];
  /** Moves an existing bond record out of `bonds` into `suppressed`. Throws Error('not a bond: ' + key) otherwise. */
  suppressBond(key: PairKey): void;
  /** Moves a suppressed pair back into `bonds` as {order: 1, diagonal: false}. Throws Error('not suppressed: ' + key) otherwise. */
  restoreBond(key: PairKey): void;
  /** As before, plus: after atoms and orders are restored, every pair of `keepSuppressed` whose two cells are atoms
   *  and touch is suppressed (others are dropped silently). */
  rebuildFromGrid(get: (x: number, y: number, z: number) => number, keepOrders: ReadonlyMap<PairKey, BondOrder>,
                  keepCharges: ReadonlyMap<CellKey, Charge>, keepSuppressed?: ReadonlySet<PairKey>): void;
}
export function createMoleculeIndex(): MoleculeIndexExt;   // the only factory; every caller receives the extended index
```

Invariants (replace 00-contracts §3 "MoleculeIndex" sentence "a bond exists iff two atom cells are face-adjacent and both are atoms"):

- **I1** `key ∈ bonds ∪ suppressed` ⇔ the two cells touch; `bonds ∩ suppressed = ∅`.
- **I2** No suppressed pair has an endpoint with `el === 'H'` (the wand refuses H bonds; `rebuildFromGrid` drops such keys).
- **I3** `bondsOf`, `bondOrderSum`, `componentOf`, `components` and extraction (02 §12.3) read `bonds` only. A suppressed pair therefore contributes nothing to valence, to connectivity or to the chemistry graph. Two molecules may touch across a suppressed pair and remain two components.
- **I4** `neighbours(key)` keeps its meaning "touching atoms" (placement validation counts them because every pair a *new* atom creates is bonded). Code that needs the bonded subset calls `bondedNeighbours`.
- **I5** Order defaults to 1 on creation: `addAtom` creates `{order: 1, diagonal: false}` for every touching atom and never consults `suppressed` (a cell that did not exist has no suppressed pairs, by I6).
- **I6** `removeAtom(key)` deletes every bond *and every suppressed pair* whose endpoint is `key`. Placing a block in that cell again therefore re-bonds.
- **I7** `setBondOrder(key, order)` requires `key ∈ bonds` (throws for a suppressed pair; callers go through `restoreBond` first). `suppressBond`/`restoreBond` are the only writers of `suppressed`.
- **I8** `components()` cache is invalidated by `suppressBond`/`restoreBond` exactly like by `setBondOrder` (it changes adjacency).

### 1.2 `src/world/world.ts` — engine writers (06 §1 `World`)

```ts
export class World {
  // ...unchanged members...
  readonly index: MoleculeIndexExt;
  /** Delegates to index.suppressBond / restoreBond; bumps editVersion; records a WorldEdit {kind:'bond', cells:[a,b]}. */
  suppressBond(key: PairKey): void;
  restoreBond(key: PairKey): void;
}
```
`World.setBlock` is still the only writer of atom cells; `World.setBondOrder`, `suppressBond`, `restoreBond` and `setCharge` are the only writers of the index-only data (orders, suppressed pairs, charges — R9 now names three things). `removeAtomBlock` clears suppressed pairs through `index.removeAtom` (I6).

### 1.3 The wand cycle — `validateBondChange` (replaces the paragraph in 02 §12.2)

```ts
export type BondChangeResultExt =
  | { readonly ok: true; readonly order: WandOrder; readonly previous: WandOrder }
  | { readonly ok: false; readonly refusal: BondChangeRefusal; readonly message: string };
export function validateBondChange(index: MoleculeIndexExt, key: PairKey, ctx: Pick<PlacementContext, 'lockedZones'>): BondChangeResultExt;
export const WAND_CYCLE: readonly WandOrder[] = [1, 2, 3, 0];
```

Algorithm, first failure wins:

1. `o = index.wandOrder(key)`; `o === undefined` → `{reason:'not-adjacent'}`, message `REFUSAL_TEXT.bondNotAdjacent`.
2. Either endpoint's `zoneOf(...) ∈ ctx.lockedZones` → `{reason:'locked-zone', zone}`, message `REFUSAL_TEXT.lockedZone`.
3. Either endpoint `el === 'H'` → `{reason:'h-block', cell}`, message `REFUSAL_TEXT.bondHBlock` (an H bond is always single and can never be suppressed).
4. Let `i = WAND_CYCLE.indexOf(o)`. For `n` in `WAND_CYCLE[(i+1)%4], WAND_CYCLE[(i+2)%4], WAND_CYCLE[(i+3)%4]` (i.e. the cycle `1 → 2 → 3 → 0 → 1`):
   - `n === 0` is always feasible (removing a bond never breaks valence).
   - `n ≥ 1` is feasible iff for both endpoints `e`: `index.bondOrderSum(e.key) − o + n ≤ targetValence(e.el, e.charge)` (`o = 0` when the pair is suppressed, and `bondOrderSum` already excludes it).
   - The first feasible `n` is returned: `{ ok: true, order: n, previous: o }`.
5. No feasible `n` (only reachable when `o === 0` and order 1 is refused, because 0 is always feasible from `o ≥ 1`): `{reason:'valence', cell, el, have: bondOrderSum(e) + 1, max: tv}` for the endpoint that blocked order 1 (lower `cellIndex` first), message `REFUSAL_TEXT.bondValence(el, tv)`.

Consequences students see: from a single bond one press gives double, the next triple, the next **no bond**, the next single again; a bond that cannot be doubled (say C–F) goes `1 → 0 → 1`; a suppressed pair whose endpoints have meanwhile filled their valence with other bonds refuses with "Valence full: …" and stays suppressed. There is no `REFUSAL_TEXT` addition.

Applying the result (`Game.ts`, 06 §10.4 wand row):

```
r = validateBondChange(index, pair, ctx)
if !r.ok               → emit block:refused { message: r.message } (flash, §5.4)
else if r.order === 0  → world.suppressBond(pair); emit bond:suppressed { pair, previous: r.previous as BondOrder }
else if r.previous === 0 → world.restoreBond(pair); if r.order > 1: world.setBondOrder(pair, r.order); emit bond:restored { pair, order: r.order }
else                   → world.setBondOrder(pair, r.order); emit bond:changed { pair, order: r.order, previous: r.previous as BondOrder }
```
(`restoreBond` followed by `setBondOrder` cannot happen through the wand — the cycle tries 1 first — but the rule is stated for completeness and for the debug hook.)

### 1.4 Events (`EngineEvents`, 06 §1; merged into `GameEvents` by the next contracts PR)

The frozen `'bond:changed'` event keeps `order: BondOrder; previous: BondOrder` and is emitted only for `1..3 → 1..3` transitions. Two events are added to `EngineEvents`:

```ts
'bond:suppressed': { pair: PairKey; previous: BondOrder };   // the pair is now a no-bond pair
'bond:restored':   { pair: PairKey; order: BondOrder };      // the pair is bonded again (order 1 through the wand)
```
Every consumer that marks itself dirty on `bond:changed` (molecule panel, target info, scene mirror, 07 §18) subscribes to these two as well. `State.ts` creates `createEmitter<GameEvents & EngineEvents>()` as 06 §1 already says.

### 1.5 Placement, removal, hydrogens, charges

- **Placement** (02 §12.2 `validatePlacement`): unchanged. Step 6 counts `index.neighbours(cell)` (touching atoms) because every one of them will be bonded by `addAtom`; `bondOrderSum(n.key)` of an existing neighbour excludes its suppressed pairs, so a suppressed pair frees valence exactly as if the atoms did not touch. `newBonds` lists every touching pair (all bonded). Nothing is ever auto-suppressed.
- **Removal**: I6. `World.removeAtomBlock` returns the removed cells as before; the suppressed pairs it cleared are not reported (the renderer rebuilds from the index).
- **H blocks**: unchanged. An H block must touch exactly one heavy atom (`h-block-needs-parent`), its bond is always order 1, and it can never be suppressed (§1.3 step 3). Implicit-H studs use `implicitHCell` (free = `Block.Air`), so a suppressed neighbour cell is never used for a stud; the implicit-H count `targetValence − bondOrderSum` excludes suppressed pairs and never exceeds the free faces (at most two suppressed partners per alkene carbon in any v1 target).
- **Charge tool**: unchanged; `validateChargeChange` compares `bondOrderSum` (bonds only) with the target valence.
- **Cage rule** (R15): unchanged; computed on the extracted graph, which has no suppressed pairs.

### 1.6 Persistence

The world grid is not serialized in v1 (only `ProgressState`, `Settings` and the inventory reach `localStorage`/SCORM; 08 §3, 07 §1.2), so there is nothing to save. Rules for the two paths that rebuild an index:

- `rebuildFromGrid(get, keepOrders, keepCharges, keepSuppressed)` (tests, and the debug `setBlock` hook of 06 §14.8, which passes `index.suppressed` as the fourth argument).
- Any future world snapshot must persist the three index-only maps together: bond orders, charges and suppressed pairs (R9).

### 1.7 Extraction (02 §12.3)

Unchanged: step 4 reads "every index bond between two heavy cells of `C`", and `bonds` never holds a suppressed pair. Add one exported helper so the UI never reads the index directly:

```ts
// src/world/extract.ts
/** Suppressed pairs touching any cell of component `id`, sorted by PairKey (may include pairs whose other endpoint is in another component). */
export function suppressedPairsOfComponent(index: MoleculeIndexExt, id: ComponentId): PairKey[];
```

### 1.8 Embedding (`src/chem/embed.ts`; replaces the "reject if not bonded → d ≠ 1" rule of 02 §13 step 5 and 04 §7.1 item 3)

```ts
export interface EmbedOptionsExt extends EmbedOptions {
  /** Allow touching, unbonded heavy-atom pairs (reported in suppressedPairs). Default true. false = induced embedding only. */
  readonly allowSuppressed?: boolean;
}
export interface EmbeddingExt extends Embedding {
  /** Heavy-atom id pairs [a, b], a < b, sorted lexicographically, that are face-adjacent in `pos` but not bonded in g.
   *  Empty for an induced embedding. H nodes never appear (an H cell touches only its parent). */
  readonly suppressedPairs: readonly (readonly [number, number])[];
}
export function embedOnLattice(g: MoleculeGraph, opts?: EmbedOptionsExt): EmbeddingExt | null;   // still satisfies ChemApi.embedOnLattice
/** Face-adjacent unbonded heavy pairs of any position list (pos[atomId]); used by layoutOf, the ghost renderer and tests. */
export function suppressedPairsOf(g: MoleculeGraph, pos: readonly Vec3[]): (readonly [number, number])[];
```
Algorithm: §3.1.

### 1.9 Content (`src/content/*`)

- `MoleculeEntry.stereoBuildable?: false` (02 §1 contract addition, unresolved item 02 §17.11) is **withdrawn**: it never landed in `types.ts` and no entry needs it. `validate.ts` reports `library:<id>: obsolete field stereoBuildable` if a JSON entry carries it.
- `layoutOf(entry): EmbeddingExt | null` (05 §1): when `entry.layout` is present, `pos = layout`, `hPos = empty`, `suppressedPairs = suppressedPairsOf(parseEntry(entry), layout)`; otherwise `embedOnLattice(parseEntry(entry))`.
- New exports in `validate.ts`:

```ts
export interface BuildReportRow { readonly where: string; readonly smiles: string; readonly nodesVisited: number; readonly suppressedPairs: readonly (readonly [number, number])[] }
/** One row per build target (exact-molecule, name-to-structure, stereo-exact target and accept[], isomer-set member,
 *  predict-product expected[] and acceptAlso[], quiz display, select-atom molecule, choose-reagent product) and per library entry. */
export function buildReport(library: MoleculeLibrary, roster: ChallengeRoster): BuildReportRow[];
```
`validateContent` fails a build target only when `embedOnLattice(T) === null` (message `<where>: not buildable on the lattice`); the number of required suppressions is reported, never a failure (test B2 caps it at 2, §4.4).

- Feedback (05 §9): `FeedbackParams` gains `extraRing?: 1` and `FEEDBACK['wrong-formula']` / `FEEDBACK['constitutional-isomer']` append `' ' + NO_BOND_HINT` when it is set, where
  `export const NO_BOND_HINT = 'Two touching atoms that should not be bonded have bonded into a ring: point the bond wand (B) at the bar between them and press E until it shows the red x break marker (no bond).'`
  Evaluators set `extraRing: 1` when `analyze(student).ringCount > analyze(target).ringCount` (§4.5).

### 1.10 UI / State (07 §1.1, 06 §1)

```ts
// src/app/State.ts — TargetState gains one field; EngineStateCommands.setAnalysis gains one optional argument
export interface TargetState { /* ...existing... */ readonly suppressed: readonly PairKey[]; }   // suppressedPairsOfComponent(index, component); [] when no target
setAnalysis(component: ComponentId, analysis: Analysis | null, zone: Zone, suppressed?: readonly PairKey[]): void;
/** Engine-only: State.suppressedOf(component) returns the last value passed for that component ([] when unknown). */

// src/app/Game.ts — HoverInfo bond variant (06 §1)
| { readonly kind: 'bond'; readonly pair: PairKey; readonly order: WandOrder }     // 0 = hovering a break marker
// DebugApi (06 §1), present only with ?debug=1
wand?(pair: PairKey): BondChangeResultExt;   // runs the real validateBondChange + apply path of §1.3 and emits the events
```
Strings are listed in §5.5–§5.7 and written into 06 §1 `ENGINE_TEXT` and 07 §19.2 `STRINGS`.

### 1.11 Requested changes to the frozen contracts (for the next contracts PR; nothing depends on them landing)

1. `src/world/types.ts`: `MoleculeIndex.suppressed`, `suppressedOf`, `wandOrder`, `bondedNeighbours`, `suppressBond`, `restoreBond`, the 4th parameter of `rebuildFromGrid`; `BondChangeResult` `order: BondOrder | 0` plus `previous`; export `WandOrder`.
2. `src/app/events.ts`: `'bond:suppressed'` and `'bond:restored'` in `GameEvents`.
3. `src/chem/types.ts`: `Embedding.suppressedPairs`, `EmbedOptions.allowSuppressed`.
4. `src/content/types.ts`: none (the `stereoBuildable` proposal is withdrawn).

## 2. Stereochemistry

### 2.1 E/Z geometry acceptance on the grid (03 §3.1–3.2 unchanged in code; the set of buildable cases grows)

For a C=C between `a` and `b`, `u = pos(b) − pos(a)` is a unit axis vector. Let `S(a)` be the explicit substituent vectors on `a` (heavy neighbours other than `b`, plus explicit H blocks) and likewise `S(b)`. `assignEZ` accepts the geometry iff:

1. **Perpendicular**: every `s ∈ S(a) ∪ S(b)` has `dot(s, u) = 0`; else `COLLINEAR` (the offending end is named).
2. **Opposite on one end**: `|S(a)| = 2 ⇒ s1 = −s2`; same for `b`; else `NOT_PLANAR`.
3. **Coplanar**: with `r(a) ∈ S(a)` and `r(b) ∈ S(b)` any explicit vectors, `r(a) ∥ r(b)` (`|dot(r(a), r(b))| = 1` on unit grid vectors); else `TWISTED`. Every substituent vector therefore lies in the one plane spanned by `u` and `r(a)`.

Then `Z` iff `dot(pa, pb) > 0` for the CIP-highest substituents `pa`, `pb`, else `E`; an end with two identical ligands gives `NO_EZ`; a ring of size ≤ 7 through the bond gives `RING`. These rules do not mention adjacency, so they are unchanged by this amendment. What changes is that arrangements with `dot(sa, sb) > 0` for some `sa ∈ S(a)`, `sb ∈ S(b)` are now legal builds: those two cells are face-adjacent (they sit at `pos(a) + v` and `pos(b) + v`, one cell apart along `u`), the auto-bond between them must be **suppressed**, and the panel and the acceptance rules then read the intended geometry.

Exact accepted arrangements for a C=C along `+x` with the substituent plane `xy` (`a` at the origin, `b` at `(1,0,0)`; every arrangement may be rotated/reflected onto any axis and any of the two planes through it; `v` = `(0,1,0)`, `−v` = `(0,−1,0)`):

| alkene class | `S(a)` | `S(b)` | label | pairs that touch and must be suppressed |
|---|---|---|---|---|
| monosubstituted (propene) | `{+v}` | `{}` | NO_EZ | none |
| 1,1-disubstituted | `{+v, −v}` | `{}` | NO_EZ | none |
| 1,2-disubstituted, opposite sides | `{+v}` | `{−v}` | E (trans) | none |
| 1,2-disubstituted, same side | `{+v}` | `{+v}` | Z (cis) | `(a+v, b+v)` |
| trisubstituted | `{+v}` | `{+v, −v}` | E or Z by CIP | `(a+v, b+v)` |
| tetrasubstituted | `{+v, −v}` | `{+v, −v}` | E or Z by CIP (or NO_EZ) | `(a+v, b+v)` and `(a−v, b−v)` |

A trisubstituted alkene always has exactly one same-side pair and a tetrasubstituted one exactly two, whatever the CIP outcome, so **every alkene with a defined E/Z is buildable** and the number of required suppressions is `0` (E-1,2-di), `1` (Z-1,2-di, tri) or `2` (tetra). Explicit H blocks on an alkene carbon obey the same table (an H block on the same side as a substituent of the other carbon would touch it; that H block is refused by placement — `h-block-needs-parent`/valence — so students leave that H implicit, which is what every v1 target does).

Verified layouts (RDKit `AssignStereochemistryFrom3D` + `rdCIPLabeler` from the grid coordinates ×1.5 Å, the method of `tools/reference/test2.py`; atom index = SMILES order; the suppressed pair is the only face-adjacent unbonded pair; these are the `layout` values added to 05 §5.3):

| entry | SMILES | positions (atom 0, 1, …) | label | suppressed pair |
|---|---|---|---|---|
| `z-but-2-ene` | `C/C=C\C` | (0,1,0) (0,0,0) (1,0,0) (1,1,0) | 2=3 Z | [0,3] |
| `z-hex-3-ene` | `CC/C=C\CC` | (−1,1,0) (0,1,0) (0,0,0) (1,0,0) (1,1,0) (2,1,0) | 3=4 Z | [1,4] |
| `z-2-chlorobut-2-ene` | `C/C=C(\Cl)C` | (0,1,0) (0,0,0) (1,0,0) (1,1,0) (1,−1,0) | 2=3 Z | [0,3] |
| `e-2-chlorobut-2-ene` | `C/C=C(/Cl)C` | (0,1,0) (0,0,0) (1,0,0) (1,−1,0) (1,1,0) | 2=3 E | [0,4] |
| `e-3-methylpent-2-ene` | `C/C=C(\C)CC` | (0,1,0) (0,0,0) (1,0,0) (1,1,0) (1,−1,0) (2,−1,0) | 2=3 E | [0,3] |
| `z-3-methylpent-2-ene` | `C/C=C(/C)CC` | (0,1,0) (0,0,0) (1,0,0) (1,−1,0) (1,1,0) (2,1,0) | 2=3 Z | [0,4] |
| `z-1-2-dichloroethene` | `Cl/C=C\Cl` | (0,1,0) (0,0,0) (1,0,0) (1,1,0) | 2=3 Z | [0,3] |
| `e-1-2-dibromobut-1-ene` | `Br/C=C(/Br)CC` | (0,1,0) (0,0,0) (1,0,0) (1,−1,0) (1,1,0) (2,1,0) | 2=3 E | [0,4] |
| (04 row 40) | `CCC/C=C\CCC` | (−2,1,0) (−1,1,0) (0,1,0) (0,0,0) (1,0,0) (1,1,0) (2,1,0) (3,1,0) | 4=5 Z | [2,5] |
| (04 row 5) | `CC/C(Cl)=C/CC` | (−1,1,0) (0,1,0) (0,0,0) (0,−1,0) (1,0,0) (1,−1,0) (2,−1,0) | 3=5 Z | [3,5] |

### 2.2 Messages

The three geometry messages (`STEREO_TEXT.collinear(n)`, `notPlanar(n)`, `twisted`) and the feedback kinds `diastereomer` / `invalid-alkene-geometry` are unchanged. One new situation needs a message: the student built the correct cis arrangement but left the touching pair bonded, so the panel shows a ring (a 4-membered ring for a Z-1,2-disubstituted alkene) and the C=C is labelled `RING`; the formula has two hydrogens fewer than the target. Acceptance reports `wrong-formula` (or `constitutional-isomer` when the count happens to match) with `extraRing: 1`, and the template appends `NO_BOND_HINT` (§1.9). No new `Warning` kind and no new `FeedbackKind` are introduced (both unions are frozen).

### 2.3 What is unchanged

- **R/S** (03 §2): `assignRS`, `classifyShape` (`octant`, `T`, `seesaw`, `square-planar`) and the seesaw/octant embedding rule (04 §7.1 item 4) use only the vectors from the centre to its four substituents, which sit on faces of the centre cell and are pairwise at distance √2 — never face-adjacent to each other. A suppressed pair can only exist between substituents of *different* centres (vicinal), which no R/S rule inspects. Every fixture in 03 §2.5, §6.4 and 05 §5.3 remains an induced embedding and stays valid.
- 03 §6.4 "trap (2)": the build with both bromines at `+z` on a zigzag butane is now a *legal* build **provided** the Br|Br pair is suppressed; it still is not a fixture, and the four listed dibromobutane layouts (all induced) stay the fixtures.
- `test/helpers/lattice.ts` `assertBuildable(g: WorldGraph, suppressed?: ReadonlySet<PairKey>)`: for a heavy–heavy pair the rule becomes "face-adjacent ⇔ bonded, except that a face-adjacent unbonded pair is allowed when its pair key is in `suppressed`"; heavy–H and H–H rules unchanged; a suppressed key whose cells are not face-adjacent or are bonded throws `fixture: suppressed pair ${key} is not a touching unbonded pair`.
- `tagsFromPositions`, `compareStereo`, `sameMolecule`, ring faces, `analyzeStereo`: unchanged (they consume the extracted graph).

## 3. Embedding and the bench preview

### 3.1 `embedOnLattice` (02 §13, steps 5–7 replaced)

Two passes over the same search (steps 1–4 and 6 of 02 §13 unchanged):

- **Pass A (strict)** = the existing feasibility rule: bonded ⇒ `d === 1` (edge-diagonal when `diagonal`), not bonded ⇒ `d !== 1`. If it succeeds, return it (so every embedding that was induced before stays induced and bit-for-bit identical).
- **Pass B (relaxed)**, run only when pass A returns `null` and `opts.allowSuppressed !== false`: the feasibility rule for a placed node `q` and candidate `p` for node `i` becomes
  - bonded ⇒ `d === 1` (or the diagonal rule) — unchanged;
  - not bonded and `d === 1` ⇒ allowed iff **both** `i` and `q` are heavy-atom nodes (an H node may touch only its parent);
  - tetrahedral and E/Z constraints — unchanged.
  Candidate order in pass B: the pass-A order, stable-sorted by the number of *new* touching-unbonded pairs the candidate would create (0 first, then 1, …), so suppressions are introduced only where the stereo tags force them.
- **Budget**: each pass counts its own nodes against `budget`; `nodesVisited` is the sum. Pass B never runs for a graph with an odd ring (bonded pairs must still be adjacent, and no odd cycle is face-embeddable), so odd rings still return `null` and `relaxedLayout` (04 §7.3) still exists for them.
- **Result**: `suppressedPairs = suppressedPairsOf(g, pos)` computed from the final positions (canonical, sorted), not from the search; multi-component graphs are still laid 4 empty cells apart so no cross-component pair can touch.

Consequences (replace the last paragraph of 02 §13): every library entry (192) embeds; 184 embed induced (pass A); the 8 entries of §2.1 embed in pass B with exactly one suppressed pair each; the largest suppression count of any v1 build target is 1 (tetrasubstituted E/Z targets, which would need 2, are not in v1 content). `embedOnLattice(g, {allowSuppressed: false})` reproduces the pre-amendment behaviour exactly (test E1).

### 3.2 Bench preview (04 §7.2, §7.4; 06 §12.5)

```
previewFor(graph): { pos, hPos, suppressedPairs, buildable }
  e = embedOnLattice(graph, { origin: [0,0,0], nodeBudget: EMBED_NODE_BUDGET })      // allowSuppressed default true
  if e and it fits PRODUCT_MIN..PRODUCT_MAX after translation → { ...e, buildable: true }
  else → { pos: relaxedLayout(graph), hPos: empty, suppressedPairs: [], buildable: false }   // odd rings / oversize only
```
The ghost renderer draws a translucent break marker (§5.3) at the midpoint of every `suppressedPairs` entry, and the bench panel adds `BENCH.breakHint(n)` under the preview text when `n = Σ suppressedPairs.length > 0`:

`breakHint(n)` = `${n === 1 ? 'One pair of' : `${n} pairs of`} ghost atoms touch but are not bonded (red x marker): after placing the blocks, point the bond wand at the bar between them and press E until the marker appears.`

`BENCH.previewOnly` becomes `This product cannot be built on the grid (it needs a 3-membered ring); preview only.` (04 §8.7, 07 §19.1).

### 3.3 Locked placements and quiz displays (06 §10.6, 07 §1.1)

`placeLockedMolecule` step 3 becomes: atoms in id order (auto-bonded) → `world.suppressBond(pairKey(cell(a), cell(b)))` for every `[a, b]` of `emb.suppressedPairs` → charges → bond orders `> 1` → explicit H blocks. Locked cells refuse the wand as before (06 §10.4), so a locked suppressed pair cannot be restored by the student. A quiz `display` may now be any library entry (05 R13 no longer excludes Z entries).

### 3.4 Tests

- `test/chem/embed.test.ts`: E1 and E3 rewritten (§4.4); **E12** each row of the §2.1 table: `embedOnLattice(g)` non-null, `suppressedPairs` equals the listed pair, `assignEZ` on the world graph built from `pos` gives the listed label; `embedOnLattice(g, {allowSuppressed:false}) === null`; **E13** `C/C=C/C` and every §5.3 layout: pass A succeeds, `suppressedPairs = []`, positions identical to the pre-amendment expectation; **E14** `suppressedPairsOf(g, layout)` for `z-but-2-ene` = `[[0,3]]`, for `e-but-2-ene` = `[]`; **E15** `C1CC1` still `null` with and without `allowSuppressed`.
- 04 §9.6 item 2 is replaced: `CCC/C=C\CCC` → `embedOnLattice` non-null with `suppressedPairs = [[2,5]]`, `buildable: true`; `relaxedLayout` is exercised with `C1CC1` (odd ring) instead.
- 04 §9.1 row 40 note "embed → null (sticks)" becomes "embeds, suppressedPairs [[2,5]]"; rows 5 and 13 gain "suppressedPairs [[3,5]]" and "[[0,4]]".

## 4. Content

### 4.1 Library (05 §5.2, §5.3, §6.2)

- Remove the `NOT-BUILDABLE(stereo)` flag from all 8 entries (`z-but-2-ene`, `e-3-methylpent-2-ene`, `z-3-methylpent-2-ene`, `z-2-chlorobut-2-ene`, `e-2-chlorobut-2-ene`, `z-hex-3-ene`, `z-1-2-dichloroethene`, `e-1-2-dibromobut-1-ene`); the flags column of §5.2 is now empty for every entry and the sentence defining the flag is deleted.
- Add the 8 verified layouts of §2.1 to §5.3 (they need no explicit H, so `MoleculeEntry.layout` can express them; the required suppression is derived by `suppressedPairsOf`).
- §6.2 becomes "Entries that need a suppressed pair" (the 8 rows with their pair), and the text "every other entry (184) is fully buildable" becomes "every entry is buildable".

### 4.2 Challenge records (05 §4.7, §4.9) — complete records

Because v1 has not shipped, records may still be inserted at their pedagogical position; from the first release on, 00-contracts §2's append-only rule applies.

**Chapter 7.** Insert after `ch7-build-e-but-2-ene`:

```json
{"id":"ch7-build-z-but-2-ene","chapter":7,"section":"7.4","topic":"E/Z","title":"(Z)-But-2-ene",
 "instruction":"Build (Z)-but-2-ene (cis-2-butene) on the lab pad: the two methyl groups on the SAME side of the C=C, all four carbons in one plane (a U shape). The two methyl blocks touch and bond into a ring at first: point the bond wand (B) at the bar between them and press E until it becomes a red x break marker (no bond). Target and submit. The panel labels the double bond E or Z.",
 "objective":"Z = higher-priority groups on the same side. On the block grid a cis pair of substituents touches, so the automatic bond between them must be broken with the wand; the two methyls are then not bonded and the molecule is an open-chain alkene.",
 "hint":"CH3 above C2, C2=C3 across, CH3 above C3. Cycle the bar between the two CH3 blocks with the wand (B, then E: double, triple, no bond) until the red x marker shows, then set C2=C3 to double.",
 "difficulty":"medium","points":4,
 "rule":{"type":"stereo-exact","target":"C/C=C\\C","mode":"absolute"},"source":"MM 7.4 (m00066)",
 "feedback":{"diastereomer":"Your double bond is E (trans): the two methyl groups are on opposite sides. Move one methyl so both are on the same side of the C=C, then break the bond between them with the wand."}}
```

Replace `ch7-quiz-ez-2-chlorobut-2-ene` (the quiz existed only because the Z isomer was unbuildable) at the same position by:

```json
{"id":"ch7-build-z-2-chlorobut-2-ene","chapter":7,"section":"7.5","topic":"E/Z","title":"Build (Z)-2-chlorobut-2-ene",
 "instruction":"Build (Z)-2-chlorobut-2-ene, CH3-C(Cl)=CH-CH3, on the lab pad. Rank the two groups on each alkene carbon (Cl versus CH3 on C2; CH3 versus H on C3): Z means the two higher-priority groups are on the same side of the C=C. Keep every substituent beside its alkene carbon, all in one plane. Two blocks on the same side touch and bond at first: break that bond with the bond wand (B, then E until the red x marker). Target and submit.",
 "objective":"E/Z for a trisubstituted alkene: rank the substituents on each carbon by atomic number (Cl > C on C2; C > H on C3); Z when the higher-ranked groups are on the same side (McMurry 7.5).",
 "hint":"McMurry's own example. Chlorine outranks methyl on C2; methyl outranks hydrogen on C3. Put the Cl and the C3 methyl on the same side (Z, zusammen: on ze zame zide); the C2 methyl goes opposite the Cl. The Cl block and the C3 methyl block touch: cycle that bar to no bond.",
 "difficulty":"hard","points":8,
 "rule":{"type":"stereo-exact","target":"C/C=C(\\Cl)C","mode":"absolute"},"source":"MM 7.5 (m00067)",
 "feedback":{"diastereomer":"Your double bond is E: the chlorine (highest priority on C2) and the C3 methyl (highest on C3) are on opposite sides. Z puts them on the same side; the C2 methyl then sits opposite the chlorine."}}
```
`ch7-quiz-alkene-stability` stays (it tests a distinct objective). Chapter 7 is now **10 challenges, 46 points** (formula-and-groups, name-to-structure, stereo-exact ×4, quiz(mc), select-atom, predict-product ×2).

**Chapter 9.** Insert after `ch9-predict-hbr-2-equiv-hex-1-yne` (section 9.3 order; restores research RB-18):

```json
{"id":"ch9-predict-br2-1-equiv-but-1-yne","chapter":9,"section":"9.3","topic":"alkyne-addition","title":"One Br2 on an alkyne: trans dibromide",
 "instruction":"Reaction bench: but-1-yne is locked in the reactant zone. Apply the Br2 / CH2Cl2 card with the equivalents switch on 1. Build the product in the product zone with the correct geometry: the two bromines on opposite sides of the new C=C (anti addition), every substituent beside its alkene carbon, all in one plane. The Br on C1 and the ethyl group on C2 end up on the same side and touch: break that bond with the bond wand (B, then E until the red x marker). Submit.",
 "objective":"One equivalent of X2 adds anti across a triple bond to give the (E)-1,2-dihaloalkene (McMurry 9.3).",
 "hint":"(E)-1,2-dibromobut-1-ene, BrCH=C(Br)CH2CH3: Br above C1, Br below C2, the ethyl CH2 above C2 next to the first Br. Cycle the Br-CH2 bar to no bond, then set C1=C2 to double.",
 "difficulty":"hard","points":8,
 "rule":{"type":"predict-product","reactant":"C#CCC","reagentId":"X2_BR2","equiv":1,"expected":["Br/C=C(/Br)CC"],"stereoCheck":"ez"},"source":"MM 9.3 (m00105)",
 "feedback":{"diastereomer":"Your two bromines are on the same side (Z). Br2 adds anti to an alkyne: the bromines end up on opposite sides of the C=C (E).","invalid-alkene-geometry":"The double bond is not planar or a substituent is in line with it. Put both bromines and the ethyl group beside their alkene carbons in one plane, and break the bond where the Br and the ethyl group touch."}}
```

Replace `ch9-choose-lindlar-z-hex-3-ene` (existed only because the Z product was unbuildable; RB-21) at the same position by:

```json
{"id":"ch9-predict-lindlar-z-hex-3-ene","chapter":9,"section":"9.5","topic":"reduction","title":"Alkyne to cis alkene",
 "instruction":"Reaction bench: hex-3-yne is locked in the reactant zone. Apply the H2 / Lindlar catalyst card. Build (Z)-hex-3-ene (cis-3-hexene) in the product zone with the correct geometry: both ethyl groups beside their alkene carbons, in one plane, on the SAME side. The two ethyl groups touch where they meet: break that bond with the bond wand (B, then E until the red x marker) so they stay separate. Submit.",
 "objective":"Lindlar's poisoned catalyst delivers both hydrogens to the same face (syn addition) and stops at the cis (Z) alkene; Li/NH3 gives the trans alkene and Pd/C the alkane.",
 "hint":"A U shape: CH2 above C3, C3=C4 across, CH2 above C4, each CH3 continuing outward. The two CH2 blocks touch: cycle their bar to no bond. Then set C3=C4 to double.",
 "difficulty":"hard","points":8,
 "rule":{"type":"predict-product","reactant":"CCC#CCC","reagentId":"H2_LINDLAR","expected":["CC/C=C\\CC"],"stereoCheck":"ez"},"source":"MM 9.5 (m00107)",
 "feedback":{"diastereomer":"Your alkene is E (trans). Lindlar hydrogenation is syn: both hydrogens add to the same face, so the two ethyl groups end up on the same side (Z).","invalid-alkene-geometry":"The double bond is not planar or a substituent is in line with it. Put both ethyl groups beside their carbons in the same plane as the C=C, on the same side, and break the bond where they touch."}}
```
`ch9-predict-li-nh3-hex-3-yne` is unchanged (E, `stereoCheck: 'ez'`, already a build). Chapter 9 is now **9 challenges, 50 points** (predict-product ×7, choose-reagent, select-atom). RB-38 (3-hexyne + 1 equiv HCl → (Z)-3-chlorohex-3-ene) stays out of the roster as the research marked it optional; it is now buildable and remains the engine vector 04 §9.1 row 5.

Unchanged elsewhere: `ch9-predict-hbr-1-equiv-hex-1-yne` (terminal alkyne product has no E/Z) and every ch8/ch11 record; `ch11-predict-e2-2-bromobutane` keeps `stereoCheck: 'none'` (the E2 geometry is deliberately ungraded there, 04 §5.8.3).

### 4.3 Roster totals (05 §2, §4, §4.12; the literals in 07 and 08)

| | before | after |
|---|---|---|
| records | 89 | **91** |
| easy / medium / hard | 25 / 51 / 13 | 25 / **50** / **16** |
| total points | 358 | **378** (50 + 200 + 128) |
| first `earned` with `raw ≥ 70` | 249 | **263** (`round(100·263/378) = 70`; 262 → 69) |
| chapter 7 | 9 / 38 | 10 / 46 |
| chapter 9 | 8 / 38 | 9 / 50 |

`totalPoints` is still computed from the roster (never a literal in code); the literal appears only in 05 §2, the R3 assertion message and the 07 examples. 08 §3's suspend-data bound with `n = 91` is unchanged (`⌈91/4⌉ = 23`).

### 4.4 Buildability rule and validator (05 §6.1, §11; 04 §7.5)

**Definition.** A target graph `T` is buildable iff `embedOnLattice(T) !== null`: there is an injective `pos: atoms(T) → Z³` such that every bonded heavy pair is face-adjacent, the `tet`/`ez` tags are realised (with explicit H cells where a tetrahedral centre needs them), and every face-adjacent *unbonded* heavy pair is recorded as a required suppression (`suppressedPairs`). Touching is no longer forbidden; only odd rings (no odd cycle in the cubic lattice) and fused/bridged cases without diagonals remain unbuildable. Consequence 3 of 05 §6.1 becomes: an sp2 carbon's substituents sit perpendicular to the C=C axis in one plane; a same-side pair touches and needs its auto-bond suppressed; E-, Z-, tri- and tetrasubstituted alkenes with defined geometry are all buildable.

**Validator / test changes** (05 §11 ids):
- **L8** `layout`: length = heavy-atom count; every bonded pair face-adjacent; `suppressedPairsOf(g, layout)` is what `layoutOf` reports (touching unbonded pairs are allowed, not an error); the world graph built from `layout` with those pairs suppressed compares `SAME` under `stereo:'absolute'`.
- **R4** "shuffle false when option order is meaningful (the formal-charge scale)" — the E/Z quiz is gone.
- **R6** unchanged in wording; the two new `ez` records satisfy "every expected graph carries an `ez` tag".
- **R10** `stereo-exact` / `name-to-structure` / `exact-molecule` targets: `embedOnLattice` succeeds (suppression allowed) on the full graph for `stereo-exact` and on the stereo-stripped graph otherwise; the report row lists `suppressedPairs`.
- **R12** the number of records is **91**.
- **R13** quiz `display` must embed (`layoutOf !== null`); the Z restriction and its negative fixture are deleted; new negative fixture: `display: {smiles: "C1CC1"}` → `… display C1CC1 is not buildable`.
- **B1** every library entry embeds; the 8 entries of §2.1 return exactly one `suppressedPairs` entry (the listed one) and `null` under `{allowSuppressed:false}`; every other entry returns `suppressedPairs.length === 0`. The list lives in `test/content/fixtures/suppressions.ts` (`NEEDS_SUPPRESSION: Readonly<Record<string, readonly [number, number]>>`, 8 keys), not in prose.
- **B2** every build-rule SMILES embeds within `EMBED_NODE_BUDGET`; `nodesVisited ≤ 10 000`; `suppressedPairs.length ≤ 2` (regression guard); `buildReport` prints the table.
- **B3** end-to-end: place the embedding through `World.setBlock` (plus H blocks), call `world.suppressBond` for every `suppressedPairs` entry, set bond orders, `extractMolecules`, `evaluate` → `passed === true` for every `exact-molecule`, `name-to-structure`, `stereo-exact` and `predict-product` record — including the four records of §4.2; additionally for `ch7-build-z-but-2-ene`: the same placement *without* the suppression evaluates to `wrong-formula` and the message ends with `NO_BOND_HINT`.
- **Acceptance negatives** (05 §11 "Acceptance"): add an E build for `ch7-build-z-but-2-ene` (`diastereomer`), a twisted Z build (`invalid-alkene-geometry`), and the (E) product for `ch9-predict-lindlar-z-hex-3-ene` (`diastereomer`).
- 04 §7.5: "every `expected`/`acceptAlso` graph must satisfy `embedOnLattice(...) !== null` when `stereoCheck !== 'none'`" now holds with suppression allowed; `choose-reagent` products likewise embed except odd rings.

### 4.5 Feedback (05 §7.2, §7.5, §7.7, §9)

`evaluateExactMolecule`, `evaluateStereoExact` and `evaluatePredictProduct` pass `extraRing: 1` in the failure params when `analyze(student).ringCount > analyze(target).ringCount` (`target` = the rule target, the primary `stereo-exact` target, or the expected molecule the diagnostic compares against). `FEEDBACK['wrong-formula']` and `FEEDBACK['constitutional-isomer']` append `' ' + NO_BOND_HINT` when `p.extraRing` is set. `FEEDBACK['wrong-ring-count']` (formula-and-groups) appends the same hint when `yours > expected`.

## 5. Engine and rendering

### 5.1 Wand tool (06 §10.1, §10.2, §10.4; 07 §3)

- Key **B** selects the wand (slot 9); **E / right button** cycles the hovered pair; **Q / left button** does nothing except show `ENGINE_TEXT.bondWandPrimary` (no accidental mining). Unchanged bindings.
- Hover (06 §10.2 step 3): the bond pick mesh now carries one instance per bond **and** one per suppressed pair, so a break marker is targetable; `pairOf(instanceId)` returns either kind and the hover is `{ kind: 'bond', pair, order: index.wandOrder(pair) }` (`order 0` for a suppressed pair).
- Apply: §1.3. A refusal emits `block:refused` and flashes the hover shell (§5.4). Locked cells: any pair touching a locked cell is refused with the locked message before validation (06 §10.4), so placed Z molecules keep their suppression.
- `ENGINE_TEXT` (06 §1): `hover.bond: (a, b, order: WandOrder) => order === 0 ? `No bond ${a}-${b}: the atoms touch but are not bonded (E: bond them)` : `Bond ${a}-${b}, order ${order} (E: cycle)``; `noBondHere: 'Point at a bond bar or a break marker and press E.'`.

### 5.2 Break marker (06 §12.4 `BondRenderer`)

```ts
export const BREAK_SIZE = 0.44, BREAK_THICK = 0.04, BREAK_RED = 0xd32f2f;
```
- **Geometry**: one `InstancedMesh(BoxGeometry(BREAK_SIZE, BREAK_SIZE, BREAK_THICK), materials, capacity 256, doubling)`: a thin square plate whose normal is the pair axis, centred at the midpoint of the two cell centres (0.5 from each centre, 0.19 clear of each 0.62-scale atom face). Instance matrix `compose(mid, quaternion.setFromUnitVectors(+Z, axis), (1,1,1))` with `axis = unit(b − a)`.
- **Materials**: a 6-entry material array — the two `±z` faces `MeshLambertMaterial({ map: breakTexture() })`, the four edge faces `MeshLambertMaterial({ color: BREAK_RED })`. `breakTexture()` (`element-texture.ts`): a 64×64 canvas filled `BREAK_RED` with a 4-px white border and a white "×" made of two 8-px-wide diagonals (the glyph is the non-colour cue; the missing bar is the second one). `NearestFilter`, sRGB, shared by the ghost variant.
- **Bars**: a suppressed pair draws **no** bar and no order glyph; the plate replaces it. Bonded pairs are drawn exactly as before.
- **Visibility**: whenever the pair is in `index.suppressed`, for every tool and at every distance (frustum culling only). It is not toggled by the wand, by `showGlyphs` or by any setting.
- **Pick**: the invisible pick mesh gets one instance per suppressed pair (same `BoxGeometry(PICK_W, PICK_W, BAR_LEN)` at `mid` with the pair quaternion); `instanceId → PairKey` covers bonds first (sorted by `PairKey`), then suppressed pairs (sorted by `PairKey`), so ids are stable for equal content.
- `update(index, warnPairs, showGlyphs)` signature unchanged; it iterates `index.bonds` then `index.suppressed`.
- Draw-call budget (06 §13): +1 mesh.

### 5.3 Ghost break marker (06 §12.5)

`showGhost(previews, anchor)` receives `previews[k].suppressedPairs`; for each pair it adds an instance to a ghost plate mesh (same geometry and texture as §5.2, `transparent: true, opacity: 0.35, depthWrite: false`) at the translated positions. Hovering a ghost cell that is an endpoint of a ghost suppressed pair shows `STRINGS.targetGhostBreak(el)` (§5.5). The sticks preview (odd rings only) draws no markers.

### 5.4 Highlight (06 §12.6)

- Hover on a suppressed pair: a frame `Mesh(BoxGeometry(BREAK_SIZE + 0.14, BREAK_SIZE + 0.14, BREAK_THICK + 0.12), MeshBasicMaterial({ color: SHELL.hover, transparent: true, opacity: 0.6, depthWrite: false }))` at the plate's mid/quaternion (replaces the bond hover box for that pair).
- Refused wand action (either kind): the hover box/frame flashes `SHELL.wrong` and fades back over `FLASH_MS`, with the same reduced-motion rule as the block outline.
- Target shells, selected shells and result shells: unchanged (they are per atom).

### 5.5 Target info (07 §7) and strings (07 §19.2)

| hit | text |
|---|---|
| bond bar, bond wand | `Bond C2–O3, order 1 — E: make it double` … `order 3 — E: break it (no bond)`; ` — valence full` when no order is allowed |
| break marker, bond wand | `No bond C1–C4 (touching) — E: make it single` / ` — valence full` |
| bond bar, other slot | `Bond C2–O3, order 1 — B: bond wand` |
| break marker, other slot | `No bond C1–C4 (touching) — B: bond wand` |
| ghost block that is an endpoint of a ghost suppressed pair | `Ghost: place Carbon here — it touches a neighbour it must not bond to (red x)` |

```ts
const ORDER_WORD: Record<number, string> = { 0: 'no bond', 1: 'single', 2: 'double', 3: 'triple' };
bondWand: 'Bond wand: cycle bond order single, double, triple, no bond; key B',
targetBond: (a: string, b: string, order: WandOrder, next: WandOrder | null) =>
  `${order === 0 ? `No bond ${a}–${b} (touching)` : `Bond ${a}–${b}, order ${order}`} — ${next === null ? 'valence full' : next === 0 ? 'E: break it (no bond)' : `E: make it ${ORDER_WORD[next]}`}`,
targetBondOtherTool: (a: string, b: string, order: WandOrder) => `${order === 0 ? `No bond ${a}–${b} (touching)` : `Bond ${a}–${b}, order ${order}`} — B: bond wand`,
targetGhostBreak: (el: BlockElement) => `Ghost: place ${ELEMENT_NAME[el]} here — it touches a neighbour it must not bond to (red x)`,
bondSet: (a: string, b: string, order: BondOrder) => `Bond ${a}–${b} is now ${ORDER_WORD[order]}.`,
bondBroken: (a: string, b: string) => `Bond ${a}–${b} removed: the atoms touch but are not bonded.`,
bondRestored: (a: string, b: string) => `Bond ${a}–${b} restored (single).`,
noBondPairs: (n: number) => `${n} touching pair${n === 1 ? '' : 's'} not bonded (red x break marker)`,
```
Atom labels are `element + (id + 1)` in each atom's own component (a suppressed pair between two components uses each side's own label).

### 5.6 Live region, molecule panel, scene mirror (07 §8, §16)

- `bond:changed` → polite `STRINGS.bondSet(a, b, order)`; `bond:suppressed` → polite `STRINGS.bondBroken(a, b)`; `bond:restored` → polite `STRINGS.bondRestored(a, b)` (added to the "what is announced" list of 07 §16.1; the events also mark the molecule panel, target info and mirror dirty, 07 §18).
- Molecule panel: a new fact row `<dt>No-bond pairs</dt><dd class="mp-nobond">…</dd>` shown only when `state.target.suppressed.length > 0`, text `STRINGS.noBondPairs(n)` followed by the pair labels (`C1–C4`); dirty on the three bond events.
- Scene mirror: the targeted-molecule block gains the same line; the pad-molecule list is unchanged.
- Analyze (`F`) summary: unchanged (chemistry only).

### 5.7 Help overlay (07 §14, `STRINGS.help`)

- `buildingBody` gains: `Touching atom blocks bond automatically. To keep two touching atoms apart, point the bond wand at the bar between them and press E until it becomes a red x break marker: the atoms then touch but are not bonded, and they do not count toward each other's bonds. Removing either block clears the marker; placing a block there again bonds it.` (The wand sentence becomes: `The bond wand (B) cycles a bond through single, double, triple and no bond; …`.)
- `stereoBody` last sentence becomes: `For E/Z, put the substituents of both alkene carbons beside their carbons, all in one plane: opposite sides for E (trans), the same side for Z (cis). Two groups on the same side touch — break the bond between them with the wand so they stay separate.`

### 5.8 Settings

None. The break marker has no toggle; it follows the reduced-motion and low-graphics rules of its parent meshes (no animation to disable).

### 5.9 `Game.ts` obligations (06 §14)

- `syncComponents` (§14.3): the component signature already changes whenever a pair is suppressed or restored (`bondsOf(c)` changes), so re-analysis needs no extra key; `setAnalysis` receives `suppressedPairsOfComponent(index, id)` as its 4th argument.
- `placeLockedMolecule`: §3.3. `bench:cleared`: unchanged (removing the atoms clears their pairs).
- Debug: `setBlock` rebuilds with `keepSuppressed = index.suppressed`; `wand(pair)` (§1.10) runs the §1.3 path.

### 5.10 Smoke (06 §15.2, new step 17a, after step 17)

`goToChallenge('ch7-build-z-but-2-ene')`; `place` `'C'` at `(60,9,60)`, `(60,9,61)`, `(61,9,61)`, `(61,9,60)` (a 2×2 square: C1–C2, C2–C3, C3–C4 and the unwanted C1–C4 all bonded); `w = __orgocraft.wand('60,9,60|61,9,60')` three times → results `order 2`, `3`, `0`; then `__orgocraft.wand('60,9,61|61,9,61')` → `order 2`; expect `state().target.suppressed` to equal `['60,9,60|61,9,60']`, `#status` to contain `removed: the atoms touch` within `LIVE_POLITE_MS + 500 ms`, `#molecule-panel .mp-name` to read `(Z)-but-2-ene`, then `Enter` → `.cp-feedback` starts with `Correct:`. Before the third wand call, `Enter` must give `.cp-feedback` starting with `Not yet:` and containing `break marker` (the `NO_BOND_HINT`).

## 6. Deltas applied to the other design documents

Each line is "heading → what changed"; the edits are targeted and keep the surrounding text.

**00-contracts.md**
- §1 "Element, Charge, BondOrder, Vec3" → the "no order 0" sentence now says graphs stay `1|2|3` and the world represents "no bond" as a suppressed pair (R3, 09).
- §1 "EmbedOptions / Embedding" → embedding may return non-induced results with `suppressedPairs`; `null` only for odd rings without diagonals / budget.
- §3 "MoleculeIndex" → invariants I1–I8 in one paragraph.
- §3 "Placement / bond / charge validation" → wand cycle `1→2→3→0→1`, "no bond" semantics, refusal rule.
- §4 → `bond:suppressed` / `bond:restored` named as `EngineEvents` additions.
- §5 rows `src/world/molecule-index.ts`, `src/world/extract.ts`, `src/chem/embed.ts`, `src/content/validate.ts` → new exports.
- §7 R3 → rewritten ("No bond = suppressed pair"); R9 → three index-only maps.
- §8 → new §8.2 pointing to this document and listing §1.11.

**02-chemistry-core.md**
- §1 → `stereoBuildable` block replaced by a withdrawal note; `MoleculeIndexExt`, `WandOrder`, `BondChangeResultExt`, `suppressedPairsOfComponent`, `EmbedOptionsExt`, `EmbeddingExt`, `suppressedPairsOf` added.
- §12.1 → `suppressed` set, `suppressBond`/`restoreBond`, `removeAtom` clears pairs, `rebuildFromGrid` 4th argument.
- §12.2 → `validateBondChange` paragraph replaced by the §1.3 cycle.
- §12.3 → note that extraction reads `bonds` only; helper listed.
- §13 → steps 5–7 two-pass rule; consequences paragraph rewritten.
- §16.11 → M8 rewritten; M17–M20 added. §16.12 → E1/E3 rewritten; E12–E15 added.
- §17 item 11 → withdrawn.

**03-stereo-acidity-hybridization.md**
- §3.3 → closing R3 paragraph replaced by the buildability statement of §2.1 and a pointer to the verified table.
- §6.4 → trap (2) note and `assertBuildable` signature updated (§2.3).

**04-reaction-bench.md**
- §7.1 items 3 and 5 → touching pairs allowed and reported; Z buildable.
- §7.2 → `previewFor` returns `suppressedPairs`.
- §7.3 heading → "(fallback for odd rings)"; §7.4 sticks row → odd rings only; ghost row → break markers.
- §7.5 → validation wording.
- §8.7 → `previewOnly` text; `breakHint(n)` added.
- §9.1 rows 5, 13, 40 → notes. §9.6 item 2 → replaced.

**05-content.md**
- §1 → `layoutOf` return type; `buildReport`; `NO_BOND_HINT` / `extraRing`.
- §2 items 2, 5 → 91 / 378 / 263. §4 lead → 91 records.
- §4.7 heading and records → Z-but-2-ene inserted; quiz replaced by the Z-2-chlorobut-2-ene build.
- §4.9 heading and records → RB-18 inserted; choose-reagent replaced by the Lindlar predict-product.
- §4.12 table and "Dropped" paragraph → new counts; the three "unbuildable" drop reasons removed.
- §5.2 → flag sentence deleted; 8 flags removed. §5.3 → 8 layouts added with the suppression note.
- §6.1 → definition and consequence 3 rewritten. §6.2 → "Entries that need a suppressed pair".
- §7.2, §7.5, §7.7 → `extraRing`. §9 → templates and `NO_BOND_HINT`.
- §11 → L8, R4, R10, R12, R13, B1, B2, B3, acceptance negatives.

**06-engine.md**
- §1 → `World.suppressBond/restoreBond`, `HoverInfo` order, `EngineEvents` additions, `ENGINE_TEXT.hover.bond`/`noBondHere`, `DebugApi.wand`, `setAnalysis` 4th argument.
- §4 → three index-only maps; debug rebuild passes `suppressed`.
- §10.2 step 3 → pick mesh includes suppressed pairs. §10.4 wand rows → §1.3 apply rule. §10.6 step 3 → suppressions placed.
- §12.4 → break marker; §12.5 → ghost marker; §12.6 → frame and flash; §13 → +1 mesh.
- §14.3/§14.8 → `setAnalysis` argument; debug hooks. §15.1 → world tests 6–7. §15.2 → step 17a.

**07-ui.md**
- §3 "Place / use tool" → wand cycle text. §7 → four rows. §8.1/§8.2 → `.mp-nobond`.
- §12.2 → `previewOnly`/`breakHint`. §14 → paragraphs 3 and 5. §16.1 → announced list. §16.3 → mirror line.
- §18 → `bond:suppressed`/`bond:restored` row. §19.2 → strings of §5.5, `ORDER_WORD`, help bodies. §20 → strings test covers the new keys; examples "of 89" / "358" → 91 / 378.

**08-deployment.md** — one literal (`n = 89` → `n = 91` in the suspend-data bound; the bound itself is unchanged).

## 7. Test summary (new or changed cases, by file)

| file | cases |
|---|---|
| `test/world/molecule-index.test.ts` | M8 (cycle incl. 0), M17 suppress/restore round trip and `bondOrderSum`, M18 `removeAtom` clears pairs and re-placing re-bonds, M19 `rebuildFromGrid` keeps suppressed pairs, M20 wand refusal from 0 when valence is full (02 §16.11) |
| `test/world/extract.test.ts` | Z-but-2-ene square with the C1–C4 pair suppressed extracts as an open chain C4H8; without the suppression as a 4-ring; `suppressedPairsOfComponent` |
| `test/world/world.test.ts` | 6: `suppressBond` bumps `editVersion`, drains a `'bond'` edit; 7: `removeAtomBlock` clears the pair (06 §15.1) |
| `test/chem/embed.test.ts` | E1, E3, E12–E15 (§3.4) |
| `test/chem/stereo.test.ts` | the ten §2.1 layouts through `assignEZ` (label) and `assertBuildable(g, suppressed)` |
| `test/content/buildable.test.ts` | B1–B3 (§4.4) |
| `test/content/acceptance.test.ts` | §4.4 negatives; `NO_BOND_HINT` appended on the ring build |
| `test/content/challenges.test.ts` | R3 (378), R4, R12 (91), R13 |
| `test/ui/strings.test.ts` | non-empty `bondSet`, `bondBroken`, `bondRestored`, `noBondPairs`, `targetBond` for orders 0–3 and `next` 0–3/null, `targetGhostBreak`, `BENCH.breakHint` |
| `scripts/smoke.mjs` | step 17a (§5.10) |
