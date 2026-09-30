# 02 — Chemistry core

Pure TypeScript under `src/chem/` (all files except `stereo.ts`, `cip.ts`, `stereo-compare.ts`, `compare.ts`, `hybridization.ts`, `charge.ts`, `acidity.ts`, which are specified in `03-stereo-acidity-hybridization.md`), plus the grid-side data path that feeds it: `src/world/molecule-index.ts` and `src/world/extract.ts`. Implemented by WP-01 (core) and WP-12 (`analyze.ts`, `naming.ts`); the two world files belong to WP-06 but are specified here because their output is the input of everything below.

Contracts: `docs/design/00-contracts.md` and `src/chem/types.ts`, `src/world/types.ts` are normative. Names and shapes below are copied from them; additions are collected in section 1 and nowhere else.

Sources ported: `tools/reference/refimpl.py` (parser, H rule, WL, VF2), `arom_test.py` (six-ring perception), `fg.py` + `verify_smarts.py` (functional-group rules and pitfalls), `embed.py` (lattice embedding); `docs/research/orgo-content.md`, `mcmurry-orgo1.md` §5–6, §8, `acids-bases-hybrid.md` §2.2, `stereo-on-grid.md` §5.1–5.2, `reaction-bench.md` §4.2, `DESIGN-draft.md` §4, `critic-round1.md` items 4.5 and 4.8. Every expected value in section 16 was regenerated with RDKit 2026.03.6 while writing this document (script: `tools/reference/gen_core_expectations.py` — see unresolved question 10).

## 0. Conventions

- **Notation in predicates.** For atom `i` of graph `g` with `hydrogens` from `implicitHydrogens`: `el`, `q` (charge), `H` = `hydrogens[i]` (total H), `deg` = `g.adj[i].length` (heavy-atom degree), `X` = `deg + H` (total degree), `orders` = multiset of Kekulé orders on `i`, `s` = Σ orders (heavy bond-order sum), `pi` = Σ(order − 1), `arom` = `g.atoms[i].aromatic`. `carbonylC(i)` ⇔ `el = C`, `q = 0`, `!arom`, and some bond of order 2 to an `O` with `q = 0`, `deg = 1`. `sp3C(i)` ⇔ `el = C`, `!arom`, `pi = 0`.
- **Diagonal bonds.** `Bond.diagonal` is never inspected by any algorithm in this document except `embedOnLattice` (which decides the allowed lattice distance). Adjacency, rings, hashing, isomorphism and groups treat a diagonal bond exactly like a face bond.
- **Immutability.** Every function returns new objects; input graphs are never mutated. Every graph-producing function copies `pos`, `hPos`, `tet`, `ez`, `diagonal`, `explicitH` through unchanged unless the function's job is to change them.
- **Determinism.** Wherever a set is iterated, the order is ascending atom id or ascending bond index. Sorting of strings uses the default JavaScript comparison (all labels are ASCII).
- **Errors.** Structural misuse (bad ids, duplicate bonds) throws `Error`. Bad SMILES throws `SmilesError`. Chemistry never throws: valence problems become `Warning`s.

## 1. Contract additions

Exact TypeScript used by this section and not present in the type files. They are exported from the module named in the comment; nothing here edits the type files.

```ts
// src/chem/graph.ts
export interface BondInput {
  readonly a: number; readonly b: number; readonly order: BondOrder;
  readonly aromatic?: boolean; readonly diagonal?: boolean; readonly ez?: EzTag;
}
export function withTet(g: MoleculeGraph, atom: number, tet: TetTag | undefined): MoleculeGraph;
export function withEz(g: MoleculeGraph, bondIndex: number, ez: EzTag | undefined): MoleculeGraph;
export function bondOrderSum(g: MoleculeGraph, atom: number): number;
export function degree(g: MoleculeGraph, atom: number): number;
/** Same constitution with every `tet` and every `ez` removed (withTet(...,undefined) / withEz(...,undefined) over all atoms and bonds). */
export function withoutStereoTags(g: MoleculeGraph): MoleculeGraph;

// src/chem/aromatic.ts
/** Six-cycles (atoms in cycle order) that perceiveAromaticity marked aromatic. */
export function aromaticRings(g: MoleculeGraph): number[][];

// src/chem/formula.ts
/** Σ (order − 1) over bonds; equals dou − ringCount for neutral molecules. */
export function piBondCount(g: MoleculeGraph): number;
export function netCharge(g: MoleculeGraph): number;

// src/chem/isomorphism.ts
export interface IsomorphismSearch {
  readonly mappings: number[][];   // mapping[targetId] = studentId
  readonly states: number;         // recursive calls made
  readonly capped: boolean;        // true when maxStates stopped the search
}
export function findIsomorphismsDetailed(target: MoleculeGraph, student: MoleculeGraph, maxStates?: number, firstOnly?: boolean): IsomorphismSearch;
export const DEFAULT_MAX_STATES = 200_000;

// src/chem/wlhash.ts
export function atomLabel(atom: Atom, hydrogens: number): string;   // "el/H/charge/a|k"
export function bondLabel(bond: Bond): string;                       // "1" | "2" | "3" | "ar"

// src/chem/naming.ts
export interface NameSource { readonly id: string; readonly name: string; readonly smiles: string; }  // MoleculeEntry satisfies it
export interface NameEntry {
  readonly id: string; readonly name: string; readonly baseName: string;
  readonly graph: MoleculeGraph; readonly hydrogens: readonly number[]; readonly hasStereo: boolean;
}
export interface NameIndex { readonly byHash: ReadonlyMap<string, readonly NameEntry[]>; readonly size: number; }
export function buildNameIndex(entries: readonly NameSource[]): NameIndex;
/** library.ts calls this once at load; nameOf uses the registered index when none is passed. */
export function registerNameIndex(index: NameIndex | null): void;
export function nameOf(g: MoleculeGraph, index?: NameIndex): string | null;
export function baseNameOf(name: string): string;

// src/chem/analyze.ts  (compatible with ChemApi.analyze: the extra parameter is optional)
export function analyze(g: MoleculeGraph, extraWarnings?: readonly Warning[]): Analysis;
export function cageWarnings(g: MoleculeGraph): Warning[];
export function dedupeWarnings(ws: readonly Warning[]): Warning[];

// src/world/extract.ts
export interface ExtractedComponent {
  readonly id: ComponentId;
  readonly graph: WorldGraph;
  /** cells[atomId] = cell of that heavy atom. */
  readonly cells: readonly CellKey[];
  /** hCells[atomId][k] = cell of graph.atoms[atomId].hPos[k]. */
  readonly hCells: readonly (readonly CellKey[])[];
  readonly warnings: readonly Warning[];
  /** Common zone of every atom; 'world' when atoms disagree. */
  readonly zone: Zone;
}
export interface Extraction { readonly components: readonly ExtractedComponent[]; readonly orphanHydrogens: readonly CellKey[]; }
export function extractAll(index: MoleculeIndex, zone?: Zone): Extraction;

// src/world/molecule-index.ts
export interface PlacementContext {
  readonly getBlock: (x: number, y: number, z: number) => number;
  /** Remaining blocks per element; H is Infinity. */
  readonly inventory: Readonly<Record<BlockElement, number>>;
  /** Player feet position, or null when overlap is not checked (tests). */
  readonly player: { readonly x: number; readonly y: number; readonly z: number } | null;
  /** Zones that refuse mutations right now (['reactant'] while a bench challenge is active). */
  readonly lockedZones: readonly Zone[];
}
export function validatePlacement(index: MoleculeIndex, x: number, y: number, z: number, el: BlockElement, ctx: PlacementContext): PlacementResult;
export function validateBondChange(index: MoleculeIndex, key: PairKey, ctx: Pick<PlacementContext, 'lockedZones'>): BondChangeResult;
export function validateChargeChange(index: MoleculeIndex, key: CellKey, charge: Charge, ctx: Pick<PlacementContext, 'lockedZones'>): ChargeChangeResult;

// src/content/types.ts — one field ADDED to the existing MoleculeEntry (contracts PR; unresolved question 11).
// Every other MoleculeEntry field is unchanged.
export interface MoleculeEntry {
  // ...existing fields (id, name, commonNames, formula, smiles, chapters, requiresDiagonalBonds, labels?, layout?, meso?)...
  /**
   * Present, and always `false`, on exactly the entries whose constitution embeds but whose `tet`/`ez` tags
   * no lattice embedding realises (00-contracts R3; the 8 entries of 05-content §6.2). Absent everywhere else;
   * `true` is not a legal value. Tests and validate.ts read this field, never a prose list.
   */
  readonly stereoBuildable?: false;
}

// src/util/vec3.ts
export function add(a: Vec3, b: Vec3): Vec3; export function sub(a: Vec3, b: Vec3): Vec3; export function neg(a: Vec3): Vec3;
export function scale(a: Vec3, k: number): Vec3; export function dot(a: Vec3, b: Vec3): number; export function cross(a: Vec3, b: Vec3): Vec3;
export function equals(a: Vec3, b: Vec3): boolean; export function manhattan(a: Vec3, b: Vec3): number; export function isZero(a: Vec3): boolean;
```

## 2. `valence.ts`

```ts
export function targetValence(el: Element, charge: Charge): number | undefined { return TARGET_VALENCE[el][charge]; }
export function lonePairs(el: Element, charge: Charge): number {
  const tv = targetValence(el, charge);
  return tv === undefined ? 0 : (VALENCE_ELECTRONS[el] - charge - tv) / 2;
}
/** Neutral target valence: the number shown in the hotbar legend ("C: 4 bonds"). */
export function maxValence(el: Element): number { return TARGET_VALENCE[el][0] as number; }
```

Complete table (values from `TARGET_VALENCE`; `—` = unsupported, `canSetCharge` refuses):

| el | tv(−1) | tv(0) | tv(+1) | LP(−1) | LP(0) | LP(+1) | maxValence |
|---|---|---|---|---|---|---|---|
| H | — | 1 | — | 0 | 0 | 0 | 1 |
| C | 3 | 4 | 3 | 1 | 0 | 0 | 4 |
| N | 2 | 3 | 4 | 2 | 1 | 0 | 3 |
| O | 1 | 2 | 3 | 3 | 2 | 1 | 2 |
| S | 1 | 2 | 3 | 3 | 2 | 1 | 2 |
| P | — | 3 | 4 | 0 | 1 | 0 | 3 |
| F, Cl, Br, I | 0 | 1 | — | 4 | 3 | 0 | 1 |

There is no "next higher valence" (OpenSMILES N5/S4/S6): a neutral N with four bonds or a neutral S with a double bond to O is an `over-valence` state, and DMSO/nitro/phosphate must be written with charges (`C[S+](C)[O-]`, `[N+](=O)[O-]`).

## 3. `graph.ts`

### 3.1 buildGraph

```ts
export function buildGraph(atoms: readonly Atom[], bonds: readonly BondInput[]): MoleculeGraph
```
1. Assert `atoms[i].id === i` for all `i`; else `throw new Error('atom ids must be dense and in order')`.
2. For each input bond `k`: assert both endpoints in `[0, n)` and `a !== b` (`Error('bad bond endpoints')`). If `a > b`, swap them and swap `ez.refA`/`ez.refB` when `ez` is present. Set `aromatic = input.aromatic ?? false`; copy `diagonal` only when `true`; copy `ez`.
3. Assert no duplicate `(a,b)` pair (`Error('duplicate bond')`).
4. `adj[i]` = bond indices `k` with `i ∈ {a,b}`, ascending `k`. Bond indices keep input order (they are referenced by `ParsedSmiles.dbl`, `DoubleBondStereo.bond`, `Warning.bond`).

### 3.2 Queries

- `neighborsOf(g, id): number[]` — the other endpoint of each bond in `adj[id]`, in `adj` order.
- `bondBetween(g, a, b): number | undefined` — index of the bond joining `a` and `b`.
- `degree(g, id)` = `adj[id].length`; `bondOrderSum(g, id)` = Σ `bonds[k].order` over `adj[id]`.
- `components(g): number[][]` — BFS from each unvisited atom in ascending id; each component's atoms sorted ascending; components ordered by their smallest atom id.
- `smallestRings(g, maxSize = 8): number[][]`:
  1. `found = new Map<string, number[]>()`.
  2. For each bond index `k` (ascending) with endpoints `a < b`: BFS from `a` to `b` in `g` with bond `k` removed (neighbours visited in `adj` order, parent pointers). If a path exists and its atom count `L ≤ maxSize`, the ring is `[a, …, b]` in path order; key = ascending atom ids joined by `,`; insert if absent.
  3. Return the rings sorted by (size ascending, key ascending).
  This is the "smallest ring through every bond"; it is what `IsomerSetRule`/`FormulaAndGroupsRule.ringSizes` and cage detection use. Cost O(|bonds|·(|atoms|+|bonds|)).
- `ringsThrough(g, a, b): number[][]` = `smallestRings(g)` entries containing both `a` and `b`.

### 3.3 Immutable edits

| function | effect |
|---|---|
| `withAtom(g, atom: Omit<Atom,'id'>)` | appends with `id = atoms.length` |
| `withoutAtom(g, id)` | removes the atom and every bond on it; ids `> id` decrease by 1 in `atoms`, `bonds`, `tet.order`, `ez.refA/refB`; a `tet` or `ez` that referenced the removed atom is dropped; bond indices are compacted (callers re-look-up) |
| `withBond(g, a, b, order, extra?: {diagonal?, ez?})` | appends the bond (`a<b` enforced as in 3.1); `Error` if it exists |
| `withoutBond(g, k)` | removes bond `k`; later indices decrease by 1 |
| `withBondOrder(g, k, order)` | replaces `order`; `aromatic` and `ez` kept |
| `withCharge(g, id, q)` | replaces `charge` only (no validation — `charge.ts` validates before calling) |
| `withTet(g, id, tet)` / `withEz(g, k, ez)` | sets or removes the tag |
| `withoutStereoTags(g)` | every `tet` and every `ez` removed; atoms, bonds and indices unchanged (used by E1 / 05 B1 to test the constitution of a `stereoBuildable: false` entry) |

All rebuild `adj` through `buildGraph`.

## 4. `hydrogens.ts`

```ts
export function implicitHydrogens(g: MoleculeGraph): { hydrogens: number[]; warnings: Warning[] }
```
For each atom `i` (ascending):
1. `s = bondOrderSum(g, i)` (Kekulé orders; aromatic flags ignored; diagonal bonds count).
2. `tv = targetValence(el, q)`. If `tv === undefined`: `hydrogens[i] = 0`; push `{kind:'charge-unsupported', atom:i, charge:q}`; continue.
3. If `explicitH !== null`: `hydrogens[i] = explicitH`; if `s + explicitH > tv` push `{kind:'over-valence', atom:i, have:s + explicitH, max:tv}`; continue.
4. If `s > tv`: `hydrogens[i] = 0`; push `{kind:'over-valence', atom:i, have:s, max:tv}`; else `hydrogens[i] = tv − s`.

Consequences: world atoms (always `explicitH: null`) get `tv − s`. The extracted graph has no H-block bonds (§12.3 removes H blocks from the graph and records their cells in `hPos`), so `s` is the heavy bond-order sum only and `tv − s` is the **total** (implicit + explicit) hydrogen count of the atom; `hPos` only records where the explicit ones sit. An implementer must not add H-block bonds to `s` — that would undercount (M12: methanol with one explicit H block still gives `[3, 1]`). Only the index-side `bondOrderSum` used by placement validation (§12.2) counts H blocks. An atom of element `H` (never produced by the parser or extraction; tolerated for robustness) gets `1 − s`.

## 5. `smiles.ts`

```ts
export function parseSmiles(smiles: string): ParsedSmiles
export { SmilesError } from './types';
```

### 5.1 Accepted grammar (OpenSMILES subset)

```
smiles        ::= chain ( '.' chain )*
chain         ::= branched_atom ( bond? branched_atom )*
branched_atom ::= atom ringbond* branch*
branch        ::= '(' bond? chain ')'
ringbond      ::= bond? ( DIGIT | '%' DIGIT DIGIT )
bond          ::= '-' | '=' | '#' | ':' | '/' | '\'
atom          ::= organic | aromatic | bracket
organic       ::= 'C' | 'N' | 'O' | 'S' | 'P' | 'F' | 'Cl' | 'Br' | 'I'
aromatic      ::= 'c' | 'n' | 'o' | 's'
bracket       ::= '[' isotope? symbol chiral? hcount? charge? class? ']'
isotope       ::= DIGIT+                         (accepted, ignored)
symbol        ::= organic | aromatic             ('H' is an error)
chiral        ::= '@' | '@@'
hcount        ::= 'H' DIGIT?                     (default 1 when 'H' present, 0 when absent)
charge        ::= '+' | '-' | '++' | '--' | '+' DIGIT | '-' DIGIT   (magnitude must be 1)
class         ::= ':' DIGIT+                     (accepted, ignored)
```
Whitespace is not allowed anywhere. `B`, `b`, `p`, `*`, `$`, `[H]`, `[2H]` are errors.

### 5.2 Parser state

```
atoms: Atom[]  bonds: BondInput[]  atomPos: number[]      // char offset of each atom token
prev: number | null      pending: BondOrder | 'ar' | null   // bond symbol waiting for the next atom
pendingDir: '/' | '\' | null
stack: (number | null)[]                                    // prev at each '('
ring: Map<number, { atom: number; order: BondOrder | 'ar' | null; index: number; slot: number }>
chiral: Map<number, { sign: 1 | -1; order: (number | 'H' | { ring: number })[]; index: number }>
dirs: { a: number; b: number; ch: '/' | '\'; index: number }[]   // a precedes b in the string
```

### 5.3 Scan (left to right, `i` = current offset)

1. `'('`: if `prev === null` → E1. Push `prev`; `i++`.
2. `')'`: if stack empty → E2. `prev = stack.pop()`; `pending = null`; `i++`.
3. `'-' '=' '#' ':'`: if `pending !== null` → E3. `pending = 1|2|3|'ar'`; `i++`.
4. `'/' '\'`: if `pending !== null` → E3. `pending = 1; pendingDir = ch`; `i++`.
5. `'.'`: `prev = null; pending = null; pendingDir = null`; `i++`.
6. `'%'` or a digit (ring bond). Requires `prev !== null` (E4). `num` = the digit or the two digits after `%` (E5 if not two digits). If `pendingDir !== null` → E6.
   - If `ring` has `num`: `{atom:a, order:o0}` = entry. If `a === prev` → E7. If both `o0` and `pending` are set and differ → E8. `order = pending ?? o0 ?? null`. Add bond `(a, prev)` with `order` resolved as in step 9. If a bond `(a, prev)` already exists → E9. Fill the chiral placeholder `{ring:num}` on `a` with `prev`, and on `prev` (if chiral) push `a` at this point. Delete `num` from `ring` (numbers are reusable).
   - Else: `ring.set(num, {atom: prev, order: pending, index: i, slot})`; if `prev` is chiral push `{ring:num}` onto its order list.
   - `pending = null`; advance `i` past the digits.
7. `'['` bracket atom: find `']'` (E10 if missing). Parse per 5.1 (E11 unknown symbol, E12 `[H]`, E13 charge magnitude > 1, E14 unsupported (el, charge) i.e. `TARGET_VALENCE[el][q] === undefined`, E15 bad chiral token such as `@TH1`, E16 anything left over before `]`). Create `{el, charge:q, explicitH:h, aromatic: symbol is lowercase}`. If chiral: `chiral.set(id, {sign: '@@' ? 1 : -1, order: [], index: i})`; if `h > 1` → E17.
8. Organic/aromatic atom: two-letter `Cl`/`Br` are tested before one-letter symbols. Unknown character → E18. Create `{el, charge:0, explicitH:null, aromatic: lowercase}`.
9. After creating atom `id` (steps 7–8): record `atomPos[id] = i_start`. If `prev !== null`: `order = pending`; if `order === null`: `order = (atoms[prev].aromatic && atoms[id].aromatic) ? 'ar' : 1`. Add bond `(prev, id, order)`; if `pendingDir` push `{a: prev, b: id, ch: pendingDir, index}`. If `prev` is chiral push `id` onto its order; if `id` is chiral its order starts as `[prev]` then `'H'` when `h === 1`. If `id` is chiral and `prev === null`, its order starts as `['H']` when `h === 1` else `[]`. `prev = id; pending = null; pendingDir = null`.
10. At end of input: stack non-empty → E2 at `smiles.length`; `ring` non-empty → E19 at the stored `index` of the lowest number; `pending !== null` → E20; empty input → E21.

Bonds with `order === 'ar'` are stored as `{order: 1, aromatic: true}`; bonds with a numeric order between two aromatic atoms (`c-c`, `c=c`) keep that order with `aromatic: false`.

### 5.4 Post-processing

1. `g = buildGraph(atoms, bonds)`.
2. If any atom is aromatic: `g = kekulize(g)` (section 6). A `SmilesError` from kekulize is rethrown with `smiles` set and `index = atomPos[error.index]`.
3. Tetrahedral tags: for each chiral atom, replace every `{ring}` placeholder with the partner atom (all are filled after step 10). If the order length is not 4 → E22. Set `tet = {order, sign}` on the atom (`'H'` entries kept as `'H'`). `tetra` mirrors `{atom, order, sign}`.
4. Double-bond tags: for each bond `k` of order 2 whose endpoints `a < b` are both non-aromatic carbons or nitrogens: collect directional entries touching `a` (other than bond `k`) and those touching `b`. For a directional entry `{x, y, ch}` (x before y in the string) and alkene carbon `c ∈ {x, y}`, the substituent is the other endpoint and its side is:

   | substituent written before `c` (`X/c`, `X\c`) | substituent written after `c` (`c/X`, `c\X`, `c(/X)`) |
   |---|---|
   | `/` → DOWN, `\` → UP | `/` → UP, `\` → DOWN |

   If two entries on the same carbon give the same side → E23. If both carbons have at least one entry: `refA` = substituent of the entry with the smallest `index` on `a`, `refB` likewise on `b`, `cis = (sideA === sideB)`; set `bond.ez = {refA, refB, cis}` and push to `dbl`. A carbon with entries on only one end produces no tag (unspecified geometry). Directional bonds not adjacent to any double bond are plain single bonds. A single `/` between two double bonds (dienes `C/C=C/C=C/C`) serves both bonds.
5. Return `{graph, tetra, dbl}`.

The parser never checks valence (that is `implicitHydrogens`) and never sets `pos`.

### 5.5 Error table

`SmilesError(message, smiles, index)`; `index` is the offset of the offending character (or the atom token for E22/E23).

| code | message |
|---|---|
| E1 | `branch has no preceding atom` |
| E2 | `unbalanced parenthesis` |
| E3 | `two bond symbols in a row` |
| E4 | `ring-closure digit has no preceding atom` |
| E5 | `'%' must be followed by two digits` |
| E6 | `directional bond on a ring closure is not supported` |
| E7 | `ring closure to the same atom` |
| E8 | `ring-closure bond orders disagree` |
| E9 | `duplicate bond` |
| E10 | `unterminated bracket atom` |
| E11 | `unknown element '<sym>'` |
| E12 | `explicit hydrogen atoms are not supported; use a bracket H count such as [CH3]` |
| E13 | `charge magnitude greater than 1 is not supported` |
| E14 | `<el> cannot carry charge <q>` |
| E15 | `unsupported chirality token; use @ or @@` |
| E16 | `unexpected text in bracket atom` |
| E17 | `a chiral atom may carry at most one hydrogen` |
| E18 | `unexpected character '<ch>'` |
| E19 | `unclosed ring bond <num>` |
| E20 | `bond symbol at end of input` |
| E21 | `empty SMILES` |
| E22 | `chiral atom must have exactly four neighbours (including H)` |
| E23 | `conflicting double-bond directions` |
| E24 | `cannot kekulize` (from section 6) |

### 5.6 Neighbour order for `@`/`@@` (RDKit-verified, stereo-on-grid 5.1)

1. the preceding atom, if any; 2. the implicit H (`'H'`) when the bracket has `H`; 3. ring-closure partners in the order their digits appear on this atom; 4. branch atoms and the next chain atom in string order. `sign = +1` for `@@`, `−1` for `@`; meaning: `sign` = sign of `((p1−p0)×(p2−p0))·(p3−p0)` over the four tips in that order in any right-handed realisation. Examples: `N[C@@H](C)C(=O)O` → atom 1: order `[0,'H',2,3]`, sign `+1`; `[C@@H](F)(Cl)Br` → order `['H',1,2,3]`, sign `+1`; `C[C@H]1CCCC[C@H]1Br` → atom 1 order `[0,'H',6,2]` sign `−1`, atom 6 order `[5,'H',1,7]` sign `−1`.

## 6. `kekulize.ts`

```ts
export function kekulize(g: MoleculeGraph): MoleculeGraph   // throws SmilesError('cannot kekulize', '', atomId)
```
1. `A` = atoms with `aromatic = true`. If `A` is empty return `g`.
2. For each `i ∈ A`: `deficit = targetValence(el, q) − Σ(orders of non-aromatic bonds) − (number of aromatic bonds) − (explicitH ?? 0)`. Needy set `Nd = { i : deficit ≥ 1 }`. (`c` with two ring bonds: 4−2−0 = 2 → needy, its remaining valence becomes H after matching; `[nH]`: 3−2−1 = 0 → not needy; `n` with two ring bonds: 1 → needy (pyridine); `o`/`s`: 0; `c` fusion atom with three aromatic bonds: 1 → needy; `deficit ≥ 2` on N/O/S or `deficit < 0` is left to `implicitHydrogens`.)
3. Candidate edges = aromatic bonds whose both endpoints are in `Nd`.
4. Perfect matching by backtracking: pick the lowest-id unmatched atom `i ∈ Nd`; for each candidate edge on `i` in ascending bond index whose other endpoint `j` is unmatched: match `(i,j)`, recurse; on failure unmatch. Success when `Nd` is exhausted. No matching → throw with `index` = lowest-id atom of `Nd` that could not be matched at the top level.
5. Matched bonds get `order: 2`; every other aromatic bond `order: 1`; `aromatic` flags on atoms and bonds are kept (perception will recompute them).

Results (RDKit-verified): `c1ccncc1` → `C1=CC=NC=C1`, H `[1,1,1,0,1,1]`; `c1cc[nH]c1` → `C1=CNC=C1`, H `[1,1,1,1,1]`; `c1ccc1` → `C1=CC=C1` (two double bonds; OpenSMILES allows it); `c1ccoc1` → `C1=COC=C1`, H `[1,1,1,0,1]`; `Cn1cnc2c1c(=O)n(C)c(=O)n2C` → H `[3,0,1,0,0,0,0,0,0,3,0,0,0,3]`; `cC` → E24 (no aromatic bond on atom 0).

## 7. `aromatic.ts`

```ts
export function perceiveAromaticity(g: MoleculeGraph): MoleculeGraph
export function aromaticRings(g: MoleculeGraph): number[][]
```
Rule of DESIGN-draft 4.6, applied identically to targets and student graphs (Kekulé input):
1. Clear `aromatic` on every atom and bond of a copy.
2. Enumerate simple 6-cycles: DFS from each start atom `s`, extending only to atoms `j > s` not on the path; at length 6 accept if the last atom is adjacent to `s`. Deduplicate by ascending-id key. Keep the cycle order.
3. A cycle is a **candidate** if every atom has `el ∈ {C, N}`, exactly one bond of order 2 (to any partner) and no bond of order 3.
4. A candidate is **aromatic** if for every atom its order-2 partner lies in this cycle, or in another candidate that shares a bond with this cycle.
5. For every aromatic cycle set `aromatic = true` on its six atoms and on the six ring bonds (bonds between consecutive cycle atoms). Kekulé orders are untouched.
6. `aromaticRings(g)` returns the aromatic cycles of step 4 in cycle order, sorted by smallest atom id; it must be called on the output of `perceiveAromaticity`.

Verified outcomes: both Kekulé forms of benzene, toluene, o-xylene, salicylic acid, aspirin, naphthalene (both rings), pyridine perceive; 1,3-cyclohexadiene, 1,3,5-hexatriene, benzoquinone, styrene's vinyl bond do not.

## 8. `formula.ts`

```ts
export function elementCounts(g, hydrogens): Record<Element, number>   // every one of the 10 keys present
export function hillFormula(g, hydrogens): string
export function degreesOfUnsaturation(counts): number
export function ringCount(g): number
export function piBondCount(g): number
export function netCharge(g): number
```
- `elementCounts`: `counts[el]++` per atom; `counts.H += hydrogens[i]` (plus 1 per atom of element `H`, which never occurs).
- `hillFormula`: if `counts.C > 0`: `C`, then `H`, then every other element with count > 0 in alphabetical symbol order `Br, Cl, F, I, N, O, P, S`; if `counts.C === 0`: `H` first (when `counts.H > 0`), then every other element with count > 0 in the same alphabetical order `Br, Cl, F, I, N, O, P, S` — this is RDKit `CalcMolFormula`'s order, which 05 §5.1 makes the library standard (test L2), so `hydrogen-chloride` stores `HCl`, `hydroxide` `HO-`, `ammonium` `H4N+`: `H2O`, `H3N`, `HCl`, `HBr`, `HI`, `HF`, `H2S`, `H3P`, `O2S`, `HO-`, `H4N+`, `Cl-`. Count 1 prints no digit. Suffix for `netCharge n`: `''` (0), `'+'` (1), `'-'` (−1), `'2+'`, `'2-'` … (|n|>1). Examples: `C9H8O4`, `CHCl3`, `CH2Cl2`, `CH3O-`, `CH6N+`, `C2H3O2-`, `C4H9+`, `C2H-` (00-contracts' example "CH5N+" is a typo for methylammonium; unresolved question 4).
- `degreesOfUnsaturation(counts) = (2·C + 2 + N − H − X) / 2`, `X = F + Cl + Br + I`; O, S, P ignored; charge ignored. Ions give half-integers (methoxide 0.5, methylammonium −0.5, acetate 1.5); the value is stored as computed and the panel (07) prints it with one decimal for ions. For neutral molecules `dou = ringCount + piBondCount` (RDKit-verified on the whole library).
- `ringCount(g) = bonds.length − atoms.length + components(g).length`.
- `piBondCount(g) = Σ (order − 1)`; `netCharge(g) = Σ charge`.

## 9. `wlhash.ts`

```ts
export function fnv1a64(s: string): string      // 16 lowercase hex chars
export function atomLabel(atom: Atom, hydrogens: number): string
export function bondLabel(bond: Bond): string
export function wlHash(g: MoleculeGraph, hydrogens: readonly number[]): { hash: string; classes: number[] }
```
- `fnv1a64`: FNV-1a, 64-bit, BigInt (`target ES2022`): `h = 0xcbf29ce484222325n; for each char c: h ^= BigInt(c.charCodeAt(0) & 0xff); h = (h * 0x100000001b3n) & 0xffffffffffffffffn`; return `h.toString(16).padStart(16,'0')`. Labels are ASCII so char codes equal UTF-8 bytes. Vectors: `''` → `cbf29ce484222325`, `'a'` → `af63dc4c8601ec8c`, `'foobar'` → `85944171f73967e8`, `'C/4/0/k'` → `4b894161bdb29000`, `'hello world'` → `779a65e7023cd2e7`.
- `atomLabel = el + '/' + hydrogens + '/' + charge + '/' + (aromatic ? 'a' : 'k')` (e.g. `C/3/0/k`, `N/0/1/k`, `C/1/0/a`). `bondLabel = aromatic ? 'ar' : String(order)`. `tet`, `ez`, `pos`, `diagonal` are ignored: the hash is constitution + charge only.
- WL refinement:
  ```
  L[i] = atomLabel(atoms[i], hydrogens[i]);  distinct = |set(L)|
  repeat at most atoms.length times:
     L2[i] = fnv1a64(L[i] + '|' + adj[i].map(k => bondLabel(bonds[k]) + ':' + L[other(k,i)]).sort().join('|'))
     d2 = |set(L2)|;  L = L2
     if d2 === distinct: break        // partition stable (refinement never merges classes)
     distinct = d2
  hash = fnv1a64(`${atoms.length}|${bonds.length}|` + [...L].sort().join('|'))
  classes[i] = index of L[i] in the ascending list of distinct final labels
  ```
  Equal `classes` values = constitutionally equivalent atoms (the 13C signal count is `max(classes)+1`). The empty graph hashes `'0|0|'`.
- The hash is a filter only; `findIsomorphisms` is the arbiter (WL cannot separate some regular graphs). It must be computed on the perceived graph (section 7) so both Kekulé forms of o-xylene collide.

## 10. `isomorphism.ts`

```ts
export function findIsomorphisms(target, student, maxStates = DEFAULT_MAX_STATES): number[][]
export function findIsomorphismsDetailed(target, student, maxStates = DEFAULT_MAX_STATES, firstOnly = false): IsomorphismSearch
export function isIsomorphic(a, b): boolean       // findIsomorphismsDetailed(a, b, DEFAULT_MAX_STATES, true).mappings.length > 0
```
Port of `refimpl.vf2_iso`, returning every mapping.
1. `hT = implicitHydrogens(target).hydrogens`, `hS` likewise (warnings ignored). Labels `lT[i] = atomLabel(...)`, `lS[j]`; bond labels via `bondLabel`. Neighbour maps `nbT[i] = Map<neighbourId, bondLabel>`, `nbS[j]`.
2. Quick reject (return `{mappings:[], states:0, capped:false}`): `atoms.length` differ; `bonds.length` differ; sorted `lT ≠` sorted `lS`; sorted degree lists differ; sorted bond-label lists differ.
3. Order of target atoms: BFS started from the unvisited atom of highest degree (ties: lowest id), neighbours in `adj` order; repeated until every component is covered.
4. `m12 = Array(n).fill(-1)`, `m21` likewise. `rec(k)`:
   - `states++`; if `states > maxStates` → `capped = true`; return.
   - if `k === n`: push `[...m12]`; return (return `true` to stop when `firstOnly`).
   - `u = order[k]`. Candidates: intersection over mapped neighbours `w` of `u` of `{ x ∈ nbS[m12[w]] : m21[x] === -1 }`; if `u` has no mapped neighbour, all unmapped student atoms in ascending id.
   - For each candidate `v` (ascending id): feasible iff `lT[u] === lS[v]`, `degT[u] === degS[v]`, for every mapped neighbour `w` of `u`: `nbS[v].get(m12[w]) === nbT[u].get(w)`, and for every mapped neighbour `x` of `v`: `nbT[u].get(m21[x]) === nbS[v].get(x)`. If feasible: map, recurse, unmap.
5. Return `{mappings, states, capped}`. `findIsomorphisms` returns `mappings` only; the cap is surfaced by `compare.ts` (03) as `Warning{kind:'isomorphism-cap', states}`.

Mapping counts equal automorphism counts when `target === student`: methane 1, ethane 2, propane 2, isobutane 6, neopentane 24, cyclohexane 12, benzene 12, cyclobutane 8, 2-propanol 2, hexane 2, 2,2,4-trimethylpentane 12 (RDKit `GetSubstructMatches(uniquify=False)`).

## 11. `groups.ts`

```ts
export function functionalGroups(g: MoleculeGraph, hydrogens: readonly number[]): GroupHit[]
```
`g` must be perceived (section 7). Rules run in `GROUP_IDS` order; each hit claims the listed heavy atoms; a match that would claim an already-claimed atom is skipped, except that arene rings may overlap each other (fused rings). Within one rule, matches are enumerated by ascending anchor atom id (or bond index). Each match is emitted once (deduplicated by its claimed-atom set). `alkane`/`cycloalkane` fire only when the hit list is empty **and** every atom is C with `q = 0` (`cycloalkane` when `ringCount > 0`). A molecule with heteroatoms and no hit reports `[]` (water, ammonia, HCl, urea, nitrobenzene's nitro group).

### 11.1 Rule table

Predicates use the notation of section 0. "claims" lists the atoms of the hit. The SMARTS column is the RDKit oracle used by `test/chem/groups.test.ts` fixtures (verified to give exactly the hits in section 16.10).

| # | id | anchor and predicate (plain words) | SMARTS oracle | claims |
|---|---|---|---|---|
| 1 | carboxylic-acid | `carbonylC(c)` with a single bond to `O` (`q0, deg1, H1`) | `[CX3;+0](=[OX1;+0])[OX2H1;+0]` | c, =O, OH |
| 2 | acid-anhydride | `carbonylC(c1)`–`O`(`q0, deg2, H0`)–`carbonylC(c2)` | `[CX3](=[OX1])[OX2H0][CX3](=[OX1])` | c1, =O1, O, c2, =O2 |
| 3 | ester | `carbonylC(c)`–`O`(`q0, deg2, H0, !arom`)–`C'` where `C'` is any carbon that is not `carbonylC`; the third substituent of `c` is a carbon or `H` (excludes carbonates and carbamates) | `[CX3;$(C[#6]),$([CH1])](=[OX1])[OX2H0;+0][#6;!$(C=O)]` | c, =O, O |
| 4 | thioester | as 3 with `S`(`q0, deg2, H0`) in place of `O` | `[CX3;$(C[#6]),$([CH1])](=[OX1])[SX2H0;+0][#6;!$(C=O)]` | c, =O, S |
| 5 | acyl-halide | `carbonylC(c)`–`X` (`F/Cl/Br/I`, `q0, deg1`) | `[CX3](=[OX1])[F,Cl,Br,I;X1]` | c, =O, X |
| 6 | amide | `carbonylC(c)`–`N`(`q0, !arom, pi0, X3`); third substituent of `c` is a carbon or `H` (excludes urea, carbamates) | `[CX3;$(C[#6]),$([CH1])](=[OX1])[NX3;+0;!a]` | c, =O, N |
| 7 | nitrile | `C`(`q0, X2`) with a triple bond to `N`(`q0, deg1, H0`) | `[CX2;+0]#[NX1;+0]` | C, N |
| 8 | aldehyde | `carbonylC(c)` with `H ≥ 1` | `[CX3;H1,H2;+0](=[OX1;+0])` | c, =O |
| 9 | ketone | `carbonylC(c)` with `deg3, H0` and both other neighbours carbon | `[#6][CX3;+0](=[OX1;+0])[#6]` | c, =O |
| 10 | imine | `C`(`!arom`) with a double bond to `N`(`q0, X2`) | `[CX3;!a]=[NX2;+0]` | C, N |
| 11 | sulfoxide | `S`(`q+1, deg3, H0`) single-bonded to `O`(`q−1, deg1`) and to two carbons | `[#6][S+;X3]([O-;X1])[#6]` | S, O |
| 12 | alcohol | `O`(`q0, deg1, H1`) bonded to a carbon `C'` (not `carbonylC` — those are claimed by 1–6) | `[#6][OX2H1;+0]` | O |
| 13 | thiol | `S`(`q0, deg1, H1`) bonded to a carbon | `[#6][SX2H1;+0]` | S |
| 14 | disulfide | `C`–`S`(`q0, deg2, H0`)–`S`(`q0, deg2, H0`)–`C` | `[#6][SX2H0][SX2H0][#6]` | both S |
| 15 | ether | `O`(`q0, deg2, H0, !arom`) whose two neighbours are carbons, neither `carbonylC` | `[#6;!$(C=O)][OX2H0;+0;!a][#6;!$(C=O)]` | O |
| 16 | sulfide | `S`(`q0, deg2, H0`) whose two neighbours are carbons | `[#6][SX2H0;+0][#6]` | S |
| 17 | amine | `N`(`q0, !arom, pi0, X3`) with ≥ 1 carbon neighbour and no `carbonylC` neighbour | `[NX3;+0;!a;!$(N-C=O);!$(N=*);!$(N#*)][#6]` | N |
| 18 | halide | `X`(`F/Cl/Br/I`, `q0, deg1`) bonded to a carbon that is not `carbonylC` | `[#6;!$(C=O)][F,Cl,Br,I;X1;+0]` | X (merged per carbon, 11.3) |
| 19 | arene | each ring of `aromaticRings(g)` | `a1aaaaa1` | 6 ring atoms (overlap allowed) |
| 20 | alkyne | bond of order 3 between two carbons, both `q0` | `[CX2;+0]#[CX2;+0]` | both C |
| 21 | alkene | bond of order 2 between two carbons, both `q0`, both `!arom` | `[#6;+0;!a;X3,X2]=[#6;+0;!a;X3,X2]` | both C |
| 22 | phosphate | `P` with ≥ 3 `O` neighbours, at least one of which is bonded to a carbon | `[#6][OX2]P(~O)(~O)~O` | P and its O neighbours |
| 23 | carboxylate | `carbonylC(c)` single-bonded to `O`(`q−1, deg1`) | `[CX3](=[OX1])[O-;X1]` | c, =O, O⁻ |
| 24 | alkoxide | `O`(`q−1, deg1`) bonded to a carbon that is not `carbonylC` | `[#6;!$(C=O)][O-;X1]` | O⁻ |
| 25 | thiolate | `S`(`q−1, deg1`) bonded to a carbon | `[#6][S-;X1]` | S⁻ |
| 26 | ammonium | `N`(`q+1, pi0, X4`) | `[N+;X4;!$(N=*);!$(N#*)]` | N |
| 27 | oxonium | `O`(`q+1, pi0, X3`) | `[O+;X3;!$(O=*)]` | O |
| 28 | carbocation | `C`(`q+1`) | `[C+]` | C |
| 29 | carbanion | `C`(`q−1`) with no bond of order 3 | `[C-;!$(C#*)]` | C |
| 30 | amide-ion | `N`(`q−1, X2`) | `[N-;X2]` | N |
| 31 | acetylide | `C`(`q−1`) with a triple bond to a carbon | `[C-]#C` | both C |
| 32 | alkane | no hit, all atoms neutral C, `ringCount = 0` | — | all atoms |
| 33 | cycloalkane | no hit, all atoms neutral C, `ringCount > 0` | — | all atoms |

Why the order works: the carbonyl carbon and its oxygens are claimed by 1–6 before 8, 9, 12, 15, 17 can see them (RCO2H is never ketone + alcohol, RCO2R never ketone + ether, RCONH2 never ketone + amine); nitrile precedes alkyne by element; arene (19) precedes alkene (21) and the perceived ring bonds are aromatic, so benzene is never three alkenes while styrene's vinyl bond still is one; alkene/alkyne require neutral carbons so `HC≡C⁻` reaches rule 31 and a vinyl cation reaches 28; the sulfoxide S⁺–O⁻ is claimed before 24 could look at the O⁻.

### 11.2 Subtypes

| group | subtype rule (on the carbon `C'` bonded to the anchor unless stated) |
|---|---|
| alcohol | `C'` aromatic → `phenol`; else `C'` has a double bond to a carbon → `enol`; else with `n` = number of carbon neighbours of `C'`: `n = 0` and `H(C') = 3` → `methanol`; `n ≤ 1` → `primary`; `n = 2` → `secondary`; `n ≥ 3` → `tertiary` |
| amine | some carbon neighbour aromatic → `aryl`; else `deg(N) = 1` → `primary`, `2` → `secondary`, `3` → `tertiary` |
| halide | `C'` aromatic → `aryl`; `C'` has a bond of order ≥ 2 to a carbon → `vinyl`; else by `n` (carbon neighbours of `C'`): 0 `methyl`, 1 `primary`, 2 `secondary`, 3 `tertiary` |
| carbocation | `arom` → `aryl`; a bond of order 2 → `vinyl`; else by carbon-neighbour count 0/1/2/3 → `methyl`/`primary`/`secondary`/`tertiary` |
| aldehyde | `H(c) = 2` → `formaldehyde` |
| ester | `H(c) = 1` → `formate` |
| alkene | either carbon has a second bond of order 2 → `cumulated` (allene, critic 4.8; the second C=C of an allene touches a claimed carbon and is skipped, so 1,2-butadiene reports exactly one hit `alkene (cumulated)`) |

### 11.3 Labels

```ts
const GROUP_NAME: Record<GroupId, string> = {
  'carboxylic-acid': 'carboxylic acid', 'acid-anhydride': 'acid anhydride', ester: 'ester', thioester: 'thioester',
  'acyl-halide': 'acid halide', amide: 'amide', nitrile: 'nitrile', aldehyde: 'aldehyde', ketone: 'ketone', imine: 'imine',
  sulfoxide: 'sulfoxide', alcohol: 'alcohol', thiol: 'thiol', disulfide: 'disulfide', ether: 'ether', sulfide: 'sulfide',
  amine: 'amine', halide: 'alkyl halide', arene: 'arene', alkyne: 'alkyne', alkene: 'alkene', phosphate: 'phosphate',
  carboxylate: 'carboxylate', alkoxide: 'alkoxide', thiolate: 'thiolate', ammonium: 'ammonium', oxonium: 'oxonium',
  carbocation: 'carbocation', carbanion: 'carbanion', 'amide-ion': 'amide ion', acetylide: 'acetylide',
  alkane: 'alkane', cycloalkane: 'cycloalkane',
};
```
`label = subtype ? `${GROUP_NAME[group]} (${subtype})` : GROUP_NAME[group]` with these overrides: acyl-halide → `acid chloride` / `acid bromide` / `acid fluoride` / `acid iodide` by the halogen; halide with subtype `aryl` → `aryl halide`, `vinyl` → `vinyl halide`; alcohol with subtype `phenol` → `phenol`, `enol` → `enol`. Halide hits on the same carbon are merged into one `GroupHit` claiming all of that carbon's halogens; when the count `k > 1` the label gets the suffix ` ×k` (chloroform: `alkyl halide (methyl) ×3`, dichloromethane: `alkyl halide (methyl) ×2`). Every other group emits one hit per match (ethylene glycol: two `alcohol (primary)`).

## 12. Grid side: `molecule-index.ts` and `extract.ts`

### 12.1 MoleculeIndex internals

`createMoleculeIndex(): MoleculeIndex` holds `atoms: Map<CellKey, IndexedAtom>`, `bonds: Map<PairKey, IndexedBond>`, `adjacency: Map<CellKey, Set<PairKey>>`, and a component cache invalidated by every mutation.

- `neighbours(key)`: the atoms at `key + d` for `d ∈ FACE_DIRS` (in that order) that exist in `atoms`.
- `bondsOf(key)`: bonds in `adjacency.get(key)` sorted by `PairKey`.
- `bondOrderSum(key)`: Σ `order` over `bondsOf(key)` (H blocks contribute 1 each because every H bond has order 1).
- `addAtom(atom)`: insert; for each face neighbour that is an atom create `{key: pairKey(a,b), a, b, order: 1, diagonal: false}` and register it in both adjacency sets. Refuse nothing (validation is separate).
- `removeAtom(key)`: delete every bond in its adjacency set from both sides, then the atom.
- `setBondOrder(key, order)`: replace the bond record (`Error` if absent). `setCharge(key, q)`: replace the atom record.
- `components()`: lazily: iterate atoms sorted by `cellIndex`; BFS each unvisited atom over `bondsOf`; assign the next dense id; the id order therefore follows each component's minimum `cellIndex`. `componentOf(key)` reads the cache.
- `rebuildFromGrid(get, keepOrders, keepCharges)`: clear; for `y, z, x` over the world, if `isAtom(get(x,y,z))` call `addAtom({key, el: elementOf(id), x, y, z, charge: keepCharges.get(key) ?? 0})`; then for every bond `setBondOrder(key, keepOrders.get(key) ?? 1)`.

### 12.2 Validation (refuse, never drop a bond)

`validatePlacement(index, x, y, z, el, ctx)` returns the first failing check, in this order:
1. bounds: `0 ≤ x < WORLD_W, 0 ≤ y < WORLD_H, 0 ≤ z < WORLD_D` else `{reason:'out-of-bounds'}`, message `REFUSAL_TEXT.outOfBounds`.
2. `ctx.getBlock(x,y,z) !== Block.Air` → `'occupied'`.
3. `ctx.player` and the cell box `[x,x+1)×[y,y+1)×[z,z+1)` intersects `[px−halfW, px+halfW]×[py, py+height]×[pz−halfW, pz+halfW]` (`PLAYER`) → `'player-overlap'`.
4. `zoneOf(x,y,z) ∈ ctx.lockedZones` → `'locked-zone'`.
5. `ctx.inventory[el] ≤ 0` → `'inventory-empty'`, message `inventoryEmpty(el)`.
6. valence: `nbs = index.neighbours(cellKey)`; if `nbs.length > targetValence(el, 0)` → `'valence'` for the new cell with `have = nbs.length, max = tv`; then for each `n ∈ nbs` (in FACE_DIRS order): `have = index.bondOrderSum(n.key) + 1`, `max = targetValence(n.el, n.charge)`; `have > max` → `'valence'` for `n.key` (an H block that already has its parent fails here with `max = 1`).
7. H-block parent rule: `el === 'H'` and the number of neighbours with `el !== 'H'` is not exactly 1 → `'h-block-needs-parent'`.
Success: `newBonds` = the pair keys that `addAtom` will create; `cage` = some ring of `smallestRings(extractComponent(index, c).graph)` contains ≥ 3 of the new atom's neighbours, for the component `c` that holds ≥ 3 of them (critic 4.5: inner cube vertices of the chair hexagon are legal for C/N and flagged).

`validateBondChange(index, key, ctx)`: bond absent → `'not-adjacent'`; either endpoint in a locked zone → `'locked-zone'`; either endpoint `el === 'H'` → `'h-block'` (message `bondHBlock`); with current order `o`, try `o+1`, `o+2` (wrapping in 1..3): the first `n` with `bondOrderSum(e) − o + n ≤ targetValence(e.el, e.charge)` for both endpoints is returned `{ok:true, order:n}`; none → `'valence'` naming the endpoint that blocked `o+1`, message `bondValence(el, max)`.

`validateChargeChange(index, key, q, ctx)`: locked zone → `'locked-zone'`; `el === 'H'` → `'h-block'`; `targetValence(el, q) === undefined` → `'unsupported'` (`chargeUnsupported`); `bondOrderSum(key) > tv` → `'valence'` (`chargeValence(el, q, tv)`); else `{ok:true, charge:q}`.

`World` (06) removes an H block whose parent is removed (it is returned to the unlimited H slot), so orphan H blocks exist only transiently.

### 12.3 Extraction

```ts
export function extractAll(index: MoleculeIndex, zone?: Zone): Extraction
export function extractMolecules(index: MoleculeIndex, zone?: Zone): WorldGraph[]   // extractAll(...).components.map(c => c.graph)
export function extractComponent(index: MoleculeIndex, id: ComponentId): WorldGraph
```
For each component id (ascending) with cells `C`:
1. `heavy` = cells with `el !== 'H'` sorted by `cellIndex`; `hs` = the others. If `heavy` is empty: every cell of `hs` goes to `orphanHydrogens`; skip the component.
2. Atom ids: `id(cell) = position in heavy`. Atoms: `{id, el, charge, explicitH: null, aromatic: false, pos: [x,y,z], hPos: []}`. If `targetValence(el, charge) === undefined` push `Warning{kind:'charge-unsupported', atom, charge}` (the charge is kept).
3. H blocks: for each `h ∈ hs` (ascending `cellIndex`): `parents` = its bonded heavy cells sorted by `cellIndex`. If `parents.length === 0` → `orphanHydrogens` (cannot happen inside a component with heavy atoms unless bonded only to other H blocks; those H–H bonds are dropped). Append `h`'s position to `hPos` of `parents[0]` (and its key to `hCells`). If `parents.length ≥ 2` push `Warning{kind:'h-block-valence', atom: id(parents[0]), bonds: parents.length}`.
4. Bonds: every index bond between two heavy cells of `C`, ordered by the pair `(min id, max id)`: `{a, b, order, aromatic: false}` plus `diagonal: true` when the index bond is diagonal.
5. `graph = buildGraph(atoms, bonds)`; `zone` = the common `zoneOf` of all cells (heavy and H) or `'world'`.
6. With a `zone` argument, keep only components whose `zone` equals it.

Atom ids within a component are therefore ascending `cellIndex`, and component ids follow minimum `cellIndex`, so extraction is a pure function of the grid state. Collapsing does not change hydrogen counts: the graph atom's bond-order sum covers heavy bonds only, so `implicitHydrogens` returns `tv − s_heavy`, which is the total (implicit + explicit) hydrogen count of that atom; `hPos` only records where the explicit ones sit, and the index's `bondOrderSum` (which counts H blocks) is used solely by placement validation.

## 13. `embed.ts`

```ts
export function embedOnLattice(g: MoleculeGraph, opts: EmbedOptions = {}): Embedding | null
```
Port of `embed.py` with the stereo constraints of reaction-bench 4.2. `origin = opts.origin ?? [0,0,0]`, `budget = opts.nodeBudget ?? EMBED_NODE_BUDGET`, `diag = opts.allowDiagonal ?? false`.

1. **Nodes.** One node per heavy atom. Add one H node for each atom `c` with `tet` whose `order` contains `'H'`, and for each atom referenced as `'H'` by an `ez` tag; an H node is bonded (face) only to its parent. `hasNode(atom) → nodeId`, `parentOf(hNode)`.
2. **Components.** `components(g)`; each is embedded independently by steps 3–6 at the origin and then translated in `x` so that component `k+1` starts 4 empty cells after the maximum `x` of component `k` (`shift = maxX_prev + 5 − minX_this`).
3. **Order.** BFS from the node of maximum degree (ties: lowest id); neighbours enqueued in descending degree (ties: lowest id); H nodes count as degree-1 neighbours. Record `parent[node]` (BFS tree).
4. **Candidates** for node `i` at depth `k > 0`: `pos[parent] + d` for `d ∈ FACE_DIRS`, plus the 12 edge-diagonal directions `(±1,±1,0),(±1,0,±1),(0,±1,±1)` when `diag`. Sorted with the straight continuation `pos[parent] − pos[grandparent]` first when a grandparent exists, then the remaining `FACE_DIRS` order, then diagonals. Node 0 is placed at `origin`.
5. **Feasibility** of `p` for `i`:
   - `p` not occupied.
   - For every placed node `q`: let `d = manhattan(p, pos[q])`, `bonded = bondBetween(i,q) !== undefined` (H node: bonded only to its parent). Require: if bonded and the bond is not diagonal → `d === 1`; if bonded and diagonal → `p − pos[q]` is an edge-diagonal; if not bonded → `d !== 1` (a diagonal non-bond is allowed: diagonal adjacency is not a bond unless declared).
   - Tetrahedral: for every atom `c ∈ {i} ∪ neighbours(i)` with `tet` whose four order entries (`'H'` → its H node) are all placed: `V = ((p1−p0)×(p2−p0))·(p3−p0)` over the tips in `tet.order`; require `sign(V) === tet.sign` (`V === 0` rejects).
   - E/Z: for every bond `(a,b)` with `ez` whose `a`, `b`, `refA`, `refB` are placed: `u = pos[b]−pos[a]`, `va = pos[refA]−pos[a]`, `vb = pos[refB]−pos[b]`; require `dot(va,u) === 0`, `dot(vb,u) === 0`, `cross(va,vb) = 0` (same perpendicular axis), and `(dot(va,vb) > 0) === ez.cis`.
6. **Search.** `place(k)`: `nodesVisited++`; if `nodesVisited > budget` abort the whole call (return `null`); if `k === nodes.length` succeed; else try each candidate in order, commit, recurse, undo. 
7. **Result.** `pos[atomId]` for heavy atoms; `hPos: Map<parentId, Vec3[]>` for H nodes; `nodesVisited`. `null` on exhaustion or budget.

Consequences recorded in 00-contracts R3: every Z alkene and every tri-/tetrasubstituted alkene with a defined E/Z fails with its `ez` tag (a cis pair across the C=C would be face-adjacent but unbonded), odd rings fail without `allowDiagonal`, E-1,2-disubstituted / monosubstituted / 1,1-disubstituted alkenes succeed. Over the library (05 §5.2, 192 entries): every entry not flagged `stereoBuildable: false` (184 of 192) embeds with its stereo tags; the 8 flagged entries (05 §6.2: `z-but-2-ene`, `z-hex-3-ene`, `z-2-chlorobut-2-ene`, `e-2-chlorobut-2-ene`, `e-3-methylpent-2-ene`, `z-3-methylpent-2-ene`, `z-1-2-dichloroethene`, `e-1-2-dibromobut-1-ene`) return `null` as written and embed after `withoutStereoTags` (constitution only). Max 297 nodes over the library with the plain embedder; stereo constraints add backtracking but stay far below the budget.

## 14. `naming.ts` (WP-12)

1. `buildNameIndex(entries)`: for each `NameSource` (ascending `id`): `parsed = parseSmiles(smiles)`; `hydrogens = implicitHydrogens(parsed.graph).hydrogens`; `graph = perceiveAromaticity(parsed.graph)`; `hash = wlHash(graph, hydrogens).hash`; `hasStereo` = some atom has `tet` or some bond has `ez`; `baseName = baseNameOf(name)`; append to `byHash[hash]`. A `SmilesError` propagates (the library test catches it with the entry id).
2. `baseNameOf(name)` strips one leading stereo descriptor: the regex `/^(?:\((?:\d*[RSEZ]|[+\-±]|meso|rac|rel)(?:,\s*(?:\d*[RSEZ]|[+\-±]))*\)|meso|cis|trans|rac|erythro|threo)-/i` (`(R)-butan-2-ol` → `butan-2-ol`, `(2R,3S)-…` → `…`, `cis-1,2-dimethylcyclohexane` → `1,2-dimethylcyclohexane`, `(E)-but-2-ene` → `but-2-ene`).
3. `nameOf(g, index = registered)`: `null` when no index. `hydrogens`, `gp = perceiveAromaticity(g)`, `h = wlHash(gp, hydrogens).hash`; `cands = (byHash.get(h) ?? []).filter(e => isIsomorphic(e.graph, gp))`. If empty → `null`. If `hasPositions(g)`: for each candidate with `hasStereo`, `sameMolecule(g, e.graph, {stereo:'absolute'}).verdict === 'SAME'` → return `e.name` (first such by id). Otherwise return the `name` of the first candidate without stereo, else the `baseName` of the first candidate. (So (R)-2-butanol built as R names `(R)-butan-2-ol`, built as S or flat names `butan-2-ol`.)

`naming.ts` imports `compare.ts` (WP-02); it never imports `molecules.json`.

## 15. `analyze.ts` (WP-12)

```ts
export function analyze(g: MoleculeGraph, extraWarnings: readonly Warning[] = []): Analysis
```
1. `{hydrogens, warnings: wH} = implicitHydrogens(g)`.
2. `gp = perceiveAromaticity(g)` (keeps `pos`, `hPos`, `tet`, `ez`, `diagonal`).
3. `counts = elementCounts(gp, hydrogens)`, `formula = hillFormula(gp, hydrogens)`, `netCharge = netCharge(gp)`, `dou = degreesOfUnsaturation(counts)`, `components = components(gp).length`, `ringCount = ringCount(gp)`.
4. `groups = functionalGroups(gp, hydrogens)`.
5. `hash = wlHash(gp, hydrogens).hash`.
6. `atoms = atomInfo(gp, hydrogens)` (03).
7. `stereo = gp.atoms.length > 0 && hasPositions(gp) ? analyzeStereo(gp, hydrogens) : null` (03).
8. `acidity = acidity(gp, atoms)` (03).
9. `name = nameOf(gp)`.
10. `warnings = dedupeWarnings([...extraWarnings, ...wH, ...cageWarnings(gp), ...stereoWarnings, ...pkaWarnings])` where `stereoWarnings` = `{kind:'planar-center', atom, shape}` for each centre with `label === 'UNSPECIFIED'` (shape `T` or `square-planar`) and `{kind:'alkene-geometry', bond, label}` for each double bond labelled `COLLINEAR | NOT_PLANAR | TWISTED`; `pkaWarnings` = `{kind:'unverified-pka', classId}` for each site in `acidity.mostAcidic ∪ acidity.mostBasic` with `verified === false`.
11. Return `{formula, counts, hydrogens, netCharge, dou, ringCount, components, groups, warnings, name, hash, atoms, stereo, acidity}`.

`cageWarnings(g)`: for each atom `i` with `deg ≥ 3`: `g' = withoutAtom(g, i)`; `N` = neighbours of `i` renumbered into `g'`; if some ring of `smallestRings(g')` contains ≥ 3 atoms of `N`, push `{kind:'cage', atom: i, ringAtoms: ring ids mapped back to g}`. This is the static form of the placement rule in 12.2 (same molecule ⇒ same verdict: for the chair hexagon plus an inner-vertex carbon, removing that carbon leaves the 6-ring containing all three of its neighbours).

`dedupeWarnings`: keep the first occurrence of each key `kind + '|' + (atom ?? bond ?? classId ?? states ?? '')`.

Empty graph: `formula ''`, all counts 0, `dou 0`, `components 0`, `ringCount 0`, `groups []`, `hash = fnv1a64('0|0|')`, `atoms []`, `stereo null`, `acidity` empty, `name null`.

### 15.1 Warning text (owned by `src/ui/strings.ts`, written here so 07 copies it)

| kind | text |
|---|---|
| over-valence | `{el} has {have} bonds but can have at most {max}. Remove a neighbour or lower a bond order.` |
| h-block-valence | `A hydrogen block touches {bonds} heavy atoms; it must touch exactly one.` |
| charge-unsupported | `{el} cannot carry charge {q} in this game. Reset the charge.` |
| cage | `This atom is bonded to three atoms of one ring (a cage). Build rings one block above the floor and keep substituents outside the ring.` |
| isomorphism-cap | `Comparison stopped after {states} steps because the molecule is too symmetric or too large. Simplify it.` |

(`planar-center`, `alkene-geometry`, `unverified-pka` texts are in 03.)

## 16. Test matrix

Every expected value below is RDKit 2026.03.6 output or a direct consequence of the algorithm as specified. SMILES atom ids are 0-based positions in the string. "H" lists are per-atom total hydrogens.

### 16.1 `valence.ts` (`test/chem/valence.test.ts`)

| case | call | expected |
|---|---|---|
| V1 | `targetValence('C', 0)` | 4 |
| V2 | `targetValence('C', 1)` | 3 |
| V3 | `targetValence('N', -1)` | 2 |
| V4 | `targetValence('O', 1)` | 3 |
| V5 | `targetValence('S', 1)` | 3 |
| V6 | `targetValence('Cl', -1)` | 0 |
| V7 | `targetValence('P', -1)` / `('F', 1)` / `('H', 1)` | undefined ×3 |
| V8 | `lonePairs('O',0)`, `('O',-1)`, `('N',1)`, `('C',-1)`, `('Cl',-1)`, `('S',1)`, `('P',0)` | 2, 3, 0, 1, 4, 1, 1 |
| V9 | `maxValence` for C N O S P F Cl Br I H | 4 3 2 2 3 1 1 1 1 1 |

### 16.2 `graph.ts` (`test/chem/graph.test.ts`)

| case | input | expected |
|---|---|---|
| G1 | `buildGraph` with bond `{a:3,b:1}` | stored as `a:1,b:3`; `adj[1]` and `adj[3]` both hold its index |
| G2 | bond `{a:3,b:1, ez:{refA:2, refB:0, cis:true}}` | stored `ez = {refA:0, refB:2, cis:true}` |
| G3 | duplicate bond / self bond / id gap | `Error` |
| G4 | `components(parse('C.CC.O').graph)` | `[[0],[1,2],[3]]` |
| G5 | `smallestRings` of cyclohexane, naphthalene (`c1ccc2ccccc2c1`), cyclobutane, hexane | sizes `[6]`, `[6,6]`, `[4]`, `[]` |
| G6 | `smallestRings` of `C12C3CC1CC2C3` (chair + inner-vertex carbon) | three rings of size 4 |
| G7 | `ringsThrough(naphthalene, 3, 8)` (fusion bond) | 2 rings |
| G8 | `withoutAtom(parse('CC(C)O').graph, 0)` | 3 atoms `C,C,O` ids 0..2, 2 bonds, `bondBetween(0,2)` defined |
| G9 | `withoutAtom` on `N[C@@H](C)C(=O)O` removing atom 0 | atom 0 (old 1) has no `tet` |
| G10 | `withBondOrder(g, k, 2)` then `bondOrderSum` | endpoint sums increase by 1 |

### 16.3 `parseSmiles` (`test/chem/smiles.test.ts`)

| case | input | expected |
|---|---|---|
| S1 | `CC(C)C` | 4 atoms, bonds (0,1),(1,2),(1,3) order 1 |
| S2 | `C1CCCCC1`, `C%10CCCCC%10`, `C2CCCCC2` | 6 bonds each, incl. (0,5); all three isomorphic |
| S3 | `C=1CCCCC1`, `C1CCCCC=1`, `C=1CCCCC=1` | bond (0,5) order 2 |
| S4 | `C=1CCCCC-1` | E8 |
| S5 | `O=C1CCCCC1` vs `C1(=O)CCCCC1` | isomorphic; O has one order-2 bond |
| S6 | `[NH3+]C` | atom 0: N, charge 1, explicitH 3 |
| S7 | `C[O-]` | atom 1: O, charge −1, explicitH 0 |
| S8 | `[13CH4]`, `[CH3:7]` | isotope/class ignored; explicitH 4 / 3 |
| S9 | `C.C` | 2 atoms, 0 bonds |
| S10 | `N[C@@H](C)C(=O)O` | `tetra = [{atom:1, order:[0,'H',2,3], sign:1}]` |
| S11 | `[C@@H](F)(Cl)Br` | order `['H',1,2,3]`, sign 1 |
| S12 | `F[C@H](Cl)Br` | order `[0,'H',2,3]`, sign −1 |
| S13 | `C[C@H]1CCCC[C@H]1Br` | atom 1 order `[0,'H',6,2]`; atom 6 order `[5,'H',1,7]`; both sign −1 |
| S14 | `F/C=C/F` | `dbl = [{bond:1, refA:0, refB:3, cis:false}]` |
| S15 | `F/C=C\F` | cis true |
| S16 | `C(\F)=C/F` | cis false |
| S17 | `C/C(\F)=C/F` | E23 |
| S18 | `C/C=C/C=C/C` | two `dbl` entries, both cis false |
| S19 | `C/1CCCCC1` | E6 |
| S20 | `C1CCC` / `C(C` / `CC)` / `` / `C$C` / `[Xe]` / `[H]` / `[C+2]` / `[Cl+]` / `C11` / `C1C1` / `cC` / `[C@TH1]` | E19 idx 1 / E2 / E2 / E21 / E18 / E11 / E12 / E13 / E14 / E7 / E9 / E24 idx 0 / E15 |
| S21 | `c1ccccc1` | 6 atoms aromatic, orders alternate 1/2 (three order-2 bonds) |
| S22 | `C/C=C/C` then `perceive` | `ez` survives on the bond |

### 16.4 `kekulize` (`test/chem/kekulize.test.ts`)

| case | input | expected H / orders |
|---|---|---|
| K1 | `c1ccncc1` | H `[1,1,1,0,1,1]`, 3 double bonds |
| K2 | `c1cc[nH]c1` | H `[1,1,1,1,1]`, 2 double bonds |
| K3 | `c1ccc1` | 2 double bonds, H `[1,1,1,1]` |
| K4 | `c1ccoc1` | H `[1,1,1,0,1]` |
| K5 | `[n]1ccccc1` | same as K1 |
| K6 | `Cc1ccccc1` | H `[3,0,1,1,1,1,1]` |
| K7 | `c1ccc2ccccc2c1` | 5 double bonds, H `[1,1,1,0,1,1,1,1,0,1]` |
| K8 | `Cn1cnc2c1c(=O)n(C)c(=O)n2C` | H `[3,0,1,0,0,0,0,0,0,3,0,0,0,3]` |
| K9 | `cC`, `c1cc1` | E24 |
| K10 | graph with no aromatic atoms | returned unchanged (same bonds) |

### 16.5 `implicitHydrogens` (`test/chem/hydrogens.test.ts`)

| case | input | hydrogens | warnings |
|---|---|---|---|
| H1 | `C` | `[4]` | — |
| H2 | `CC(=O)O` | `[3,0,0,1]` | — |
| H3 | `CC#N` | `[3,0,0]` | — |
| H4 | `ClC(Cl)Cl` | `[0,1,0,0]` | — |
| H5 | `C[NH3+]` | `[3,3]` | — |
| H6 | `C[C+](C)C` | `[3,0,3,3]` | — |
| H7 | `[C-]#C` | `[0,1]` | — |
| H8 | `C[S+](C)[O-]` | `[3,0,3,0]` | — |
| H9 | `CC(C)(C)(C)C` | atom 1 → 0 | `over-valence {atom:1, have:5, max:4}` |
| H10 | `CN(C)(C)C` | atom 1 → 0 | `over-valence {atom:1, have:4, max:3}` |
| H11 | `CS(=O)(=O)C` (neutral sulfone) | atom 1 → 0 | `over-valence {atom:1, have:6, max:2}` |
| H12 | `[CH3](C)C` (bracket H count plus two heavy bonds) | atom 0 → 3 | `over-valence {atom:0, have:5, max:4}` |
| H13 | world atom with `charge` lacking a target (built by hand: `Cl`, charge 1) | 0 | `charge-unsupported {atom:0, charge:1}` |
| H14 | `O`, `N`, `Cl` | `[2]`, `[3]`, `[1]` | — |

### 16.6 `formula.ts` (`test/chem/formula.test.ts`)

| case | SMILES | formula | dou | rings | pi |
|---|---|---|---|---|---|
| F1 | `CC(=O)Oc1ccccc1C(=O)O` | `C9H8O4` | 6 | 1 | 5 |
| F2 | `NC(N)=O` | `CH4N2O` | 1 | 0 | 1 |
| F3 | `ClC(Cl)Cl` / `ClCCl` | `CHCl3` / `CH2Cl2` | 0 / 0 | 0 | 0 |
| F4 | `O` / `N` / `Cl` / `Br` | `H2O` / `H3N` / `HCl` / `HBr` | 0 | 0 | 0 |
| F4b | `S` / `P` / `O=S=O` | `H2S` / `H3P` / `O2S` (H first, then alphabetical; never `SH2`, `PH3`, `SO2`; `O=S=O` also yields one `over-valence` warning on S per §2 — `hydrogens` 0 — and the formula is still printed) | 0 / −0.5 / 1 | 0 | 0 / 0 / 2 |
| F4c | `[OH-]` / `[NH4+]` / `[Cl-]` | `HO-` / `H4N+` / `Cl-` | 0.5 / −0.5 / 0.5 | 0 | 0 |
| F5 | `C[O-]` / `C[NH3+]` / `CC(=O)[O-]` / `C[C+](C)C` / `[C-]#C` | `CH3O-` / `CH6N+` / `C2H3O2-` / `C4H9+` / `C2H-` | 0.5 / −0.5 / 1.5 / 0.5 / 2.5 | 0 | 0/0/1/0/2 |
| F6 | `c1ccc2ccccc2c1` | `C10H8` | 7 | 2 | 5 |
| F7 | `O=[N+]([O-])c1ccccc1` | `C6H5NO2` | 5 | 1 | 4 |
| F8 | `C12C3CC1CC2C3` | `C7H10` | 3 | 3 | 0 |
| F9 | `CC(C)Cc1ccc(cc1)C(C)C(=O)O` | `C13H18O2` | 5 | 1 | 4 |
| F10 | `C.C` | `C2H8`, components 2 | 0 | 0 | 0 |
| F11 | every entry of `molecules.json` | `formula` field equal; `dou === ringCount + piBondCount` when `netCharge === 0` | | | |

### 16.7 `perceiveAromaticity` (`test/chem/aromatic.test.ts`) — compared through `wlHash` equality and `aromaticRings`

| case | pair / input | expected |
|---|---|---|
| A1 | `c1ccccc1` vs `C1=CC=CC=C1` | equal hash; `aromaticRings` length 1 |
| A2 | `CC1=C(C)C=CC=C1` vs `CC1C(C)=CC=CC=1` (o-xylene) | equal hash |
| A3 | `CC(=O)Oc1ccccc1C(=O)O` vs `CC(=O)OC1C(C(=O)O)=CC=CC=1` | equal |
| A4 | `OC(=O)C1=CC=CC=C1O` vs `OC(=O)C1C(O)=CC=CC=1` | equal |
| A5 | `c1ccc2ccccc2c1` vs `C1=CC=C2C=CC=CC2=C1` | equal; 2 aromatic rings on both |
| A6 | `c1ccncc1` vs `C1=CC=NC=C1` | equal |
| A7 | `c1ccccc1` vs `C1=CC=CCC1` / vs `C=CC=CC=C` | different; the latter two have 0 aromatic rings |
| A8 | `O=C1C=CC(=O)C=C1` | 0 aromatic rings |
| A9 | `C=Cc1ccccc1` | 1 ring; bond (0,1) `aromatic false` |
| A10 | `Cc1ccccc1C` vs `Cc1cccc(C)c1` vs `Cc1ccc(C)cc1` | pairwise different |
| A11 | parsed `c1cc[nH]c1` then perceive | all flags false (5-ring) |
| A12 | perceive preserves `pos`/`hPos`/`tet`/`ez` on a hand-built world graph | fields identical |

### 16.8 `wlhash.ts` (`test/chem/wlhash.test.ts`)

| case | input | expected |
|---|---|---|
| W1 | `fnv1a64('')`, `('a')`, `('foobar')`, `('C/4/0/k')`, `('hello world')` | `cbf29ce484222325`, `af63dc4c8601ec8c`, `85944171f73967e8`, `4b894161bdb29000`, `779a65e7023cd2e7` |
| W2 | `CCCCC(C)` vs `CCCCCC`; `OCCCC` vs `CCCCO`; `O=C1CCCCC1` vs `C1(=O)CCCCC1`; `C1CCCCC1` vs `C%10CCCCC%10` | equal hashes |
| W3 | C4H10 (2), C5H12 (3), C6H14 (5), C3H8O (3), C4H10O (7), C4H8 (5), C4H8O carbonyl (3) families | pairwise different within each family |
| W4 | `CCO` vs `CC[O-]`; `CN` vs `C[NH3+]` | different (charge and H in the label) |
| W5 | `classes` of ethanol / propane / neopentane / benzene / 2-propanol / 2,2,4-trimethylpentane | 3 / 2 / 2 / 1 / 3 / 5 distinct classes |
| W6 | empty graph | `fnv1a64('0|0|')` |
| W7 | hash of a world graph equals hash of the same SMILES graph | equal (positions ignored) |
| W8 | `C[C@@H](O)CC` vs `C[C@H](O)CC` | equal (stereo ignored) |
| W9 | every library pair with equal hash | `isIsomorphic` true (no false positives on the library) |

### 16.9 `isomorphism.ts` (`test/chem/isomorphism.test.ts`)

| case | input | expected |
|---|---|---|
| I1 | `findIsomorphisms(g, g)` for `C`, `CC`, `CC(C)C`, `CC(C)(C)C`, `C1CCCCC1`, `c1ccccc1`, `C1CCC1`, `CC(C)O`, `CCCCCC`, `CC(C)CC(C)(C)C` | 1, 2, 6, 24, 12, 12, 8, 2, 2, 12 mappings; every mapping is a bijection preserving labels and bond labels |
| I2 | `CCCC` vs `CC(C)C` | `[]` |
| I3 | `CC1=C(C)C=CC=C1` vs `CC1C(C)=CC=CC=1` after perception | ≥ 1 mapping; without perception 0 |
| I4 | `Cc1ccccc1C` vs `Cc1cccc(C)c1` | `[]` |
| I5 | `c1ccccc1` vs `C1=CC=CCC1` | `[]` (quick reject: H labels) |
| I6 | `C=CCC` vs `CC=CC` | `[]` |
| I7 | `C[O-]` vs `CO` | `[]` |
| I8 | `N[C@@H](C)C(=O)O` vs `C[C@H](N)C(=O)O` | 1 mapping `[2,1,0,3,4,5]` (target id → student id) |
| I9 | `findIsomorphismsDetailed(ethanol, ethanol, 1)` | `capped true`, `mappings []` |
| I10 | `isIsomorphic` on every library pair vs RDKit canonical equality (stereo stripped) | 0 disagreements |
| I11 | two-component `C.CC` vs `CC.C` | 2 mappings |

### 16.10 `functionalGroups` (`test/chem/groups.test.ts`) — labels in detection order

| case | SMILES | expected labels | claimed atoms |
|---|---|---|---|
| FG1 | `CC(=O)O` | `carboxylic acid` | (1,2,3) |
| FG2 | `CC(=O)OCC` / `COC=O` | `ester` / `ester (formate)` | (1,2,3) / (1,2,3) |
| FG3 | `CC(=O)OC(C)=O` | `acid anhydride` | (1,2,3,4,6) |
| FG4 | `CC(=O)SC` | `thioester` | (1,2,3) |
| FG5 | `CC(=O)Cl` | `acid chloride` | (1,2,3) |
| FG6 | `CC(N)=O` / `CC(=O)NC` / `CN(C)C=O` | `amide` ×1 each | (1,2,3) / (1,2,3) / (1,3,4) |
| FG7 | `CC#N` / `C#N` | `nitrile` | (1,2) / (0,1) |
| FG8 | `CC=O` / `C=O` | `aldehyde` / `aldehyde (formaldehyde)` | (1,2) / (0,1) |
| FG9 | `CC(C)=O` / `CCCC(C)=O` / `O=C1CCCCC1` | `ketone` | (1,3) / (3,5) / (0,1) |
| FG10 | `CC(C)=N` | `imine` | (1,3) |
| FG11 | `C[S+](C)[O-]` | `sulfoxide` | (1,3) |
| FG12 | `CO` / `CCO` / `CC(C)O` / `CC(C)(C)O` / `OC1CCCCC1` | `alcohol (methanol)` / `alcohol (primary)` / `alcohol (secondary)` / `alcohol (tertiary)` / `alcohol (secondary)` | O only |
| FG13 | `Oc1ccccc1` | `phenol`, `arene` | (0), ring |
| FG14 | `C=CO` | `enol`, `alkene` | (2), (0,1) |
| FG15 | `OCCO` | `alcohol (primary)` ×2 | (0), (3) |
| FG16 | `CCS` / `CSC` / `CSSC` | `thiol` / `sulfide` / `disulfide` | (2) / (1) / (1,2) |
| FG17 | `CCOCC` / `COc1ccccc1` | `ether` / `ether`, `arene` | (2) / (1), ring |
| FG18 | `CN` / `CNC` / `CN(C)C` / `CCNC` | `amine (primary)` / `amine (secondary)` / `amine (tertiary)` / `amine (secondary)` | N |
| FG19 | `Nc1ccccc1` | `amine (aryl)`, `arene` | (0), ring |
| FG20 | `CCl` / `CCCl` / `CC(C)Cl` / `CC(C)(C)Br` / `CCC(C)Br` | `alkyl halide (methyl)` / `(primary)` / `(secondary)` / `(tertiary)` / `(secondary)` | X |
| FG21 | `ClC(Cl)Cl` / `ClCCl` | `alkyl halide (methyl) ×3` / `alkyl halide (methyl) ×2` | (0,2,3) / (0,2) |
| FG22 | `Clc1ccccc1` / `C=CCl` | `aryl halide`, `arene` / `vinyl halide`, `alkene` | |
| FG23 | `c1ccccc1` / `C1=CC=CC=C1` / `c1ccncc1` / `c1ccc2ccccc2c1` | `arene` / `arene` / `arene` / `arene` ×2 | |
| FG24 | `C#C` / `CC#C` / `CC#CC` | `alkyne` | |
| FG25 | `CC=C` / `C=CC=C` / `C1CCC=CC1` / `C=CC=CC=C` | `alkene` / ×2 / ×1 / ×3 | |
| FG26 | `CC=C=C` | `alkene (cumulated)` exactly once | (1,2) |
| FG27 | `C=Cc1ccccc1` | `arene`, `alkene` | ring, (0,1) |
| FG28 | `O=C1C=CC(=O)C=C1` | `ketone` ×2, `alkene` ×2 | |
| FG29 | `CC(=O)Oc1ccccc1C(=O)O` | `carboxylic acid`, `ester`, `arene` | (10,11,12), (1,2,3), ring |
| FG30 | `CC(=O)Nc1ccc(O)cc1` | `amide`, `phenol`, `arene` | (1,2,3), (8), ring |
| FG31 | `CC(O)C(=O)O` / `CC(N)C(=O)O` / `CC(O)CBr` | acid + `alcohol (secondary)` / acid + `amine (primary)` / `alcohol (secondary)` + `alkyl halide (primary)` | |
| FG32 | `CC(=O)[O-]` / `CC[O-]` / `CC[S-]` / `C[NH3+]` / `C[O+](C)C` | `carboxylate` / `alkoxide` / `thiolate` / `ammonium` / `oxonium` | |
| FG33 | `C[C+](C)C` / `CC[C+]C` / `[CH3-]` / `C[N-]C` / `[C-]#C` | `carbocation (tertiary)` / `carbocation (secondary)` / `carbanion` / `amide ion` / `acetylide` | |
| FG34 | `C` / `CCCCCC` / `C1CCCCC1` / `C12C3CC1CC2C3` | `alkane` / `alkane` / `cycloalkane` / `cycloalkane` | |
| FG35 | `NC(N)=O` / `O` / `N` / `Cl` / `O=[N+]([O-])c1ccccc1` | `[]` / `[]` / `[]` / `[]` / `arene` only | |
| FG36 | the 40-molecule set of `fg.py` | names mapped through `GROUP_NAME` equal `fg.py`'s output (with `acid_chloride → acid chloride`, `alkane`), except urea-type rows listed in FG35 | |

### 16.11 `molecule-index.ts` / `extract.ts` (`test/world/molecule-index.test.ts`, `extract.test.ts`)

| case | action | expected |
|---|---|---|
| M1 | add C at (10,10,10) and (11,10,10) | one bond `10,10,10|11,10,10`, order 1; `bondOrderSum` 1 on both |
| M2 | add C at (10,10,10),(11,10,10),(11,11,10),(11,11,11),(10,11,11),(10,10,11) (cube-vertex chair hexagon) | 6 bonds, no chord, ring count 1, `smallestRings` = one 6-ring |
| M3 | planar 2×3 hexagon (10..11 × 10..12 in one plane, six cells) | 7 bonds (chord), ring count 2 |
| M4 | `validatePlacement` of a 5th C neighbour around a C | `{reason:'valence', have:5, max:4}` naming the centre cell |
| M5 | O with two C neighbours, then a third | refused `valence` for the O cell (`have 3, max 2`) |
| M6 | H at a cell with two heavy neighbours | `'h-block-needs-parent'`; H with one heavy neighbour ok; second H next to that H → `valence` on the H (`max 1`) |
| M7 | C placed at (10,11,10), the inner cube vertex of M2's chair (face-adjacent to (10,10,10), (11,11,10), (10,11,11)) | `ok, cage: true`, 3 `newBonds`; ring count becomes 3; `cageWarnings` on the extracted graph has one entry for that atom |
| M8 | `validateBondChange` on methanol's C–O at order 1 / at order 2; on fluoromethane's C–F; on a C–H block bond | returns `order 2` / returns `order 1` (3 refused by O); `valence` (`F`, max 1); `'h-block'` |
| M9 | `validateChargeChange` O→−1 on methanol O | ok; O→+1 with three bonds → `valence`; Cl→+1 → `unsupported` |
| M10 | reactant-zone cell with `lockedZones:['reactant']` | `'locked-zone'` |
| M11 | `rebuildFromGrid` after M2 with order map `{pair:2}` and charge map `{cell:1}` | order and charge preserved |
| M12 | extraction of methanol C(10,10,10) O(11,10,10) with H block at (10,11,10) | one component; atom 0 C `pos [10,10,10]`, `hPos [[10,11,10]]`; `implicitHydrogens` → `[3,1]` |
| M13 | two molecules, one on the pad and one in the world | `extractAll(index,'pad')` returns only the pad one; component ids ascend with min `cellIndex` |
| M14 | H block bonded to two heavy atoms (via `rebuildFromGrid`) | attached to the lower `cellIndex` parent, warning `h-block-valence {bonds:2}` |
| M15 | isolated H block after rebuild | `orphanHydrogens` has its key; no component |
| M16 | diagonal index bond (set by test) | extracted `Bond.diagonal === true`; face bonds have no `diagonal` key |

### 16.12 `embedOnLattice` (`test/chem/embed.test.ts`)

| case | input | expected |
|---|---|---|
| E1 | every entry `e` of `molecules.json` (all have `requiresDiagonalBonds:false`), `g = parseEntry(e)` | `embedOnLattice(g) !== null` **iff** `e.stereoBuildable === undefined`; for every non-null result every bonded pair face-adjacent and no unbonded pair face-adjacent; for the 8 entries with `stereoBuildable: false` (05 §6.2) `embedOnLattice(g) === null` and `embedOnLattice(withoutStereoTags(g)) !== null`. The flag is the only data the test reads (no prose list). 05's `validate.ts` (check B1 there, and the build-target checks R10/R13) rejects a flagged entry used as `exact-molecule`, `name-to-structure`, `stereo-exact`, `isomer-set` member, `predict-product` `expected`/`acceptAlso` or quiz `display` (message `library:<id>: stereoBuildable:false entry used as build target by <challengeId>`). |
| E2 | `C1CC1`, `CC1CC1`, `C1CCCC1` | `null` with `allowDiagonal:false` |
| E3 | `C/C=C\C` (Z) | `null`; `C/C=C/C` (E) non-null with `refA`/`refB` on opposite sides |
| E4 | `C[C@@H](O)CC` | non-null; `hPos` has one entry for atom 1; `V` over `tet.order` positive; `assignRS` (03) on the resulting world graph gives `R` |
| E5 | `C[C@H](O)CC` | `S` under the same check |
| E6 | `C[C@H](Br)[C@@H](Br)C` (meso) | non-null; both centres satisfied |
| E7 | `nodeBudget: 1` on ethanol | `null`; `nodesVisited` would exceed |
| E8 | `C.CC` | two components; all atoms of the second have `x ≥ maxX(first) + 5` |
| E9 | `origin:[52,9,64]` | every position equals the default embedding translated by the origin |
| E10 | `CC(C)(C)C` (neopentane) | non-null (four face neighbours of the centre) |
| E11 | `CC(C)(C)C(C)(C)C` | non-null (two quaternary carbons, each with three free faces) |

### 16.13 `naming.ts` (`test/chem/naming.test.ts`)

| case | input | expected |
|---|---|---|
| N1 | `baseNameOf('(R)-butan-2-ol')`, `('(2R,3S)-2,3-dibromobutane')`, `('cis-1,2-dimethylcyclohexane')`, `('(E)-but-2-ene')`, `('meso-tartaric acid')`, `('butane')` | `butan-2-ol`, `2,3-dibromobutane`, `1,2-dimethylcyclohexane`, `but-2-ene`, `tartaric acid`, `butane` |
| N2 | index over the library; `nameOf(parse(entry.smiles).graph)` for every non-stereo entry | `entry.name` |
| N3 | stereo entry (no positions) | `baseName` |
| N4 | `nameOf` of `C1=CC=CC=C1` with benzene stored as `c1ccccc1` | `benzene` |
| N5 | `nameOf` of `CC1C(C)=CC=CC=1` when o-xylene is in the index | its name |
| N6 | unknown molecule `CCCCCCCCC` | `null` |
| N7 | `registerNameIndex(null)`; `nameOf(g)` | `null` |
| N8 | world graph of (R)-2-butanol from E4 with `(R)-butan-2-ol` in the index | `(R)-butan-2-ol`; the mirror build → `butan-2-ol` |

### 16.14 `analyze` (`test/chem/analyze.test.ts`)

| case | input | expected |
|---|---|---|
| Z1 | `parse('CC(=O)Oc1ccccc1C(=O)O').graph` | formula `C9H8O4`, dou 6, ringCount 1, components 1, 3 groups, `stereo null`, `name` `aspirin` when indexed |
| Z2 | world graph of methanol (M12) | `stereo` non-null; hydrogens `[3,1]`; `name` `methanol` |
| Z3 | `CC(C)(C)(C)C` | warnings contain exactly one `over-valence` |
| Z4 | `analyze(g, [w])` with `w` an `h-block-valence` | `w` present first; passing `[w, w]` yields it once |
| Z5 | `C12C3CC1CC2C3` | one `cage` warning, `ringCount 3` |
| Z6 | empty graph | formula `''`, hash `fnv1a64('0|0|')`, `stereo null` |
| Z7 | `C[NH3+]` | `netCharge 1`, formula `CH6N+`, groups `ammonium`, dou −0.5 |
| Z8 | `C.CC` | components 2, formula `C3H10`, groups `alkane` (whole graph) |
| Z9 | `hash` equals `wlHash(perceive(g), hydrogens).hash` and `counts.H === hydrogens.reduce(+)` | true |

## 17. Unresolved questions

1. **Ungrouped molecules.** Urea, carbamates, carbonates, nitro compounds, water, ammonia and hydrogen halides report `groups: []` because `GROUP_IDS` is closed. 05 must not reference these in `formula-and-groups` rules; the panel (07) needs the string `No functional group recognised`.
2. **`embed.ts` ownership.** WP-01 owns the file, so its algorithm is specified here (section 13); 04-reaction-bench should reference this section rather than restate reaction-bench 4.2.
3. **Contract additions to fold into 00-contracts.** `analyze(g, extraWarnings?)`, `extractAll`/`ExtractedComponent`, `findIsomorphismsDetailed`, `aromaticRings`, `piBondCount`, `netCharge`, `registerNameIndex`, `PlacementContext`, the validation signatures, `withoutStereoTags` and `MoleculeEntry.stereoBuildable` (section 1).
4. **Typo in 00-contracts §1 Analysis.** The charged-formula example `CH5N+` should read `CH6N+` (methylammonium); `C2H3O2-` is correct.
5. **`maxValence(el)`** is defined here as the neutral target valence (hotbar legend); if 06/07 need the maximum over charge states (N⁺ 4), rename or add `maxValenceAnyCharge`.
6. **Isomer-set storage.** `IsomerSetRule.isomers` should hold SMILES and be hashed at load (`wlHash` after `parseSmiles` + perception) rather than literal hash strings, so a change to the label format never invalidates content.
7. **Halide subtype for alkynyl halides** is reported as `vinyl`; no v1 content uses it.
8. **Carbocation subtypes** reuse `GroupSubtype` literals (`methyl|primary|secondary|tertiary|vinyl|aryl`); the comment in `types.ts` lists only alcohol/amine/halide, but the union allows it.
9. **DoU for ions** is stored as a half-integer; 07 must format it (one decimal) and 05 must not set `piBonds` on charged targets.
10. **Expectation script.** The RDKit script used to regenerate section 16 (`gen.py` in the session scratchpad) should be committed as `tools/reference/gen_core_expectations.py` by WP-01 so the fixtures can be regenerated.
11. **`MoleculeEntry.stereoBuildable`.** The contracts PR adds the optional field of section 1 to `src/content/types.ts`; 05 sets `stereoBuildable: false` on its 8 §6.2 entries (and nowhere else), rewrites B1 to read the flag instead of "entries not listed in §6.2" (B1's "seven" is a miscount: the §6.2 table has 8 entries, one row holds two), and adds the validate.ts build-target check named in E1 (section 16.12).
