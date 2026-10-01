# 03 — Stereochemistry, hybridization, formal charge, acidity

Implements `src/chem/cip.ts`, `src/chem/stereo.ts`, `src/chem/stereo-compare.ts` (WP-02) and `src/chem/hybridization.ts`, `src/chem/charge.ts`, `src/chem/acidity.ts` (WP-03). Every type name and signature is the one in `src/chem/types.ts` / `00-contracts.md`; additions are listed in section 12 and nowhere else. Sources: stereo-on-grid.md (all), acids-bases-hybrid.md 2–5, `tools/reference/cipref.py`, `test2.py`, `test3.py`, `test3c.py`.

## 0. Files, dependencies, constants

| File | Imports (all pure) | Exports (contract) | Exports (additions, §12) |
|---|---|---|---|
| `cip.ts` | `types`, `graph` | `cipRank`, `compareLigands` | `CIP_SPHERE_CAP` |
| `stereo.ts` | `types`, `graph`, `cip`, `isomorphism`, `util/vec3` | `assignRS`, `assignEZ`, `analyzeStereo`, `ringFace`, `signedVolume`, `classifyShape` | `parityInOrder`, `alkeneSides`, `tagsFromPositions`, `labelTargetStereo`, `stereoWarnings`, `STEREO_TEXT`, `EPS` |
| `stereo-compare.ts` | `types`, `stereo` | `compareStereo` | `permSign` |
| `hybridization.ts` | `types`, `valence`, `graph` | `atomInfo`, `hybridization`, `geometry` | `ANGLE_NOTES` |
| `charge.ts` | `types`, `valence`, `graph`, `hybridization` | `formalCharge`, `canSetCharge`, `withCharge` | `CHARGE_REFUSAL` |
| `acidity.ts` | `types`, `graph`, `hybridization` | `hydrogenSites`, `basicSites`, `acidity`, `predictAcidBase`, `PKA`, `PKA_SOURCES` | `PKA_MOD`, `PKA_TEXT_ONLY`, `BASIC`, `unverifiedWarnings` |

Import direction: `stereo-compare` → `stereo` → `cip`; `charge` → `hybridization`; `acidity` → `hybridization`. No module here imports `compare.ts` or `analyze.ts`. `compare.ts` (WP-02, described in 02-chemistry-core.md for the constitution part) calls `compareStereo` per isomorphism; its stereo semantics are fixed in §6.

Constants:

```ts
export const EPS = 1e-9;            // |V| <= EPS is "planar". Lattice coordinates are integers, so
                                    // every grid test is exact; EPS matters only for non-integer
                                    // previews (embedding output).
export const CIP_SPHERE_CAP = 500;  // nodes in one sphere list before compare() gives up (cipref.py used 200;
                                    // neither is reachable at <= 30 heavy atoms).
export const RING_EZ_EXEMPT_MAX = 7; // ring size <= 7 => C=C reported RING, no geometry check.
```

Vector helpers (from `src/util/vec3.ts`, WP-01): `add, sub, neg, dot, cross, equals`. Positions are `Vec3`; direction of neighbour `n` from centre `c` is `sub(pos(n), pos(c))`.

Hydrogen bookkeeping used everywhere below: `hydrogens[i]` (from `implicitHydrogens`) is the TOTAL H on atom `i`; on a `WorldGraph`, `atoms[i].hPos.length` of them are explicit blocks with known cells and `hydrogens[i] − hPos.length` are implicit. On a SMILES graph `hPos` is absent and every H is implicit.

---

## 1. CIP ranking (`src/chem/cip.ts`)

Rule 1a (atomic number) over the full hierarchical digraph = McMurry 5.5 Rules 1–3 (atomic number; first point of difference exploring outward; multiple bonds as duplicated atoms). Rules 2–5 (isotopes, Z/E, like/unlike, r/s) are not implemented; the engine detects when they would decide and reports `tieNeedsAdvancedRules`. Port of `cipref.py` line by line.

### 1.1 Digraph node

```ts
interface DNode {
  readonly atom: number;        // -1 = hydrogen node (implicit or collapsed explicit H)
  readonly dup: boolean;        // duplicate atom (multiple-bond or ring-closure duplicate)
  readonly parent: DNode | null;
  readonly Z: number;           // ATOMIC_NUMBER[el]; 1 for a hydrogen node
  readonly path: string;        // memo key: parent.path + '>' + atom + (dup ? 'd' : 'r'); root = '' + centre + 'r'
}
interface CipCtx {
  readonly g: MoleculeGraph;
  readonly hydrogens: readonly number[];
  readonly exclude: number | undefined;   // E/Z: the partner across the double bond, dropped from the ROOT only
  readonly memo: Map<string, -1 | 0 | 1>; // one Map per cipRank call
  capHit: boolean;
}
```

Phantom atoms (Z = 0) are never materialised: a duplicate node and a hydrogen node have no children, and every comparison pads the shorter list with Z = 0. This is IUPAC P-92.1.4 ("duplicated atoms carry three phantom atoms of atomic number zero").

### 1.2 `children(ctx, node): DNode[]`

1. If `node.dup || node.atom === -1` return `[]`.
2. `i = node.atom`; `ancestors` = set of `atom` over every non-dup node on the chain `node, node.parent, …, root` (includes `i` and the centre).
3. `kids = []`. For each bond index `bi` of `ctx.g.adj[i]`, with `j` the other endpoint and `o = bond.order` (a `diagonal` bond is treated identically):
   1. If `node.parent === null && j === ctx.exclude`: `continue` (drop the partner and its duplicates entirely).
   2. If `node.parent !== null && j === node.parent.atom && !node.parent.dup`: push `o − 1` duplicate nodes of `j`, then `continue` (the bond back to the parent contributes only its multiplicity duplicates).
   3. If `ancestors.has(j)`: push one duplicate node of `j` (ring closure); else push one real node of `j`.
   4. Push `o − 1` duplicate nodes of `j` (double bond +1, triple +2).
4. Push `ctx.hydrogens[i]` hydrogen nodes (`atom: -1, dup: false, Z: 1`).
5. Return `kids`.

Worked children lists (Z multisets before sorting): –CHO → C(O, O-dup, H); –CH=CH2 → C(C, C-dup, H), then that C(C-dup, H, H); –C≡CH → C(C, C-dup, C-dup), then C(C-dup, C-dup, H); phenyl (Kekulé) → C(C, C, C-dup) at sphere 2; cyclohexyl explored from C1 returns to C1 as a C-dup after five real atoms. Aromatic Kekulé forms are used as drawn (no averaged duplicates); library stereo entries never depend on it.

### 1.3 `compareLigands(ctx, a, b): -1 | 0 | 1` (exported as `compareLigands`; +1 = `a` ranks higher)

```
key = a.path + '|' + b.path; if memo.has(key) return it
la = [a]; lb = [b]
loop:
  // (1) this sphere in hierarchical order, phantom padding
  for k in 0 .. max(la.length, lb.length) − 1:
      za = la[k]?.Z ?? 0; zb = lb[k]?.Z ?? 0
      if za !== zb: return memo(za > zb ? 1 : −1)
  // (2) expand every node; sort each child set best-first by FULL recursive compare
  ca = la.map(x => children(ctx, x).sort((p, q) => −compareLigands(ctx, p, q)))
  cb = lb.map(x => children(ctx, x).sort((p, q) => −compareLigands(ctx, p, q)))
  // (3) compare child sets parent by parent (parents are aligned because step 1 passed => la.length === lb.length)
  for k in 0 .. la.length − 1:
      for m in 0 .. max(ca[k].length, cb[k].length) − 1:
          za = ca[k][m]?.Z ?? 0; zb = cb[k][m]?.Z ?? 0
          if za !== zb: return memo(za > zb ? 1 : −1)
  la = flatten(ca); lb = flatten(cb)
  if la.length === 0 && lb.length === 0: return memo(0)        // constitutionally identical
  if la.length > CIP_SPHERE_CAP || lb.length > CIP_SPHERE_CAP: ctx.capHit = true; return memo(0)
```

The sibling sort MUST use the full recursive compare, not Z alone: 3-methylbutan-2-yl vs 3-pentyl are both (C,C,H) at sphere 2; their best branches (C,C,H) vs (C,H,H) decide at sphere 3, and a flat multiset comparison would wrongly tie (test3.py A: RDKit and the reference both rank 3-methylbutan-2-yl higher). The comparator is a total preorder, so `Array.prototype.sort` is safe.

### 1.4 `cipRank(g, hydrogens, center, exclude?): CipRank`

1. `ctx = { g, hydrogens, exclude, memo: new Map(), capHit: false }`; `root = { atom: center, dup: false, parent: null, Z, path: center + 'r' }`.
2. `ligs = children(ctx, root).sort((p, q) => −compareLigands(ctx, p, q))`.
3. `tie = ∃ i < ligs.length − 1 : compareLigands(ctx, ligs[i], ligs[i+1]) === 0` (equal ligands are adjacent after sorting).
4. `tieNeedsAdvancedRules = tie && ∃ tied pair (p, q) : subtreeHasStereoElement(ctx, p) || subtreeHasStereoElement(ctx, q)`.
5. Return `{ ligands: ligs.map(n => n.atom === -1 ? 'H' : n.atom), tie, tieNeedsAdvancedRules, capHit: ctx.capHit }`.

`ligands` has one entry per digraph child of the root: a centre with a multiple bond lists its partner twice (real + dup, same id). `assignRS` never sees that (it requires `pi === 0`); `assignEZ` passes `exclude`.

`subtreeHasStereoElement(ctx, p)`: `S` = atoms reachable from `p.atom` in `g` without passing through `center` (and without `exclude`). Return true iff some `a ∈ S` is a Rule-1a centre — `el === 'C'`, `pi(a) === 0`, `deg(a) + hydrogens[a] === 4`, `hydrogens[a] ≤ 1`, and `cipRankBasic(a).tie === false` (`cipRankBasic` = steps 1–3 only, no step 4, so there is no recursion) — or some non-aromatic C=C in `S` has, on each end, two Rule-1a-distinct ligands (`cipRankBasic(end, exclude = otherEnd)` has 4 entries… exactly 2 ligands and `tie === false`). Consequences (matching RDKit's r/s cases reported as ties, stereo-on-grid 2.6): cis/trans-1,4-dimethylcyclohexane ring carbons and decalin fusion carbons → `NOT_CENTER`; C3 of pentane-2,3,4-triol (tied ligands contain the true centres C2/C4) → `CANNOT_ASSIGN`.

### 1.5 Verified priority outcomes (fixtures for `test/chem/cip.test.ts`, RDKit-confirmed)

| molecule | centre | priorities 1 > 2 > 3 > 4 |
|---|---|---|
| 2-butanol | C2 | OH > CH2CH3 > CH3 > H |
| 2-bromobutane | C2 | Br > CH2CH3 > CH3 > H |
| alanine | C2 | NH2 > COOH (O,O,O via dup) > CH3 > H |
| lactic acid | C2 | OH > COOH > CH3 > H |
| 2,3-dibromobutane | C2 and C3 | Br > CHBrCH3 (Br,C,H) > CH3 > H |
| 3-methylhexane | C3 | CH2CH2CH3 > CH2CH3 (tie at sphere 2 (C,H,H); propyl wins at sphere 3 (C,H,H) vs (H,H,H)) > CH3 > H |
| 1-bromo-2-methylcyclohexane | C1 | Br > C2 (C,C,H) > C6 (C,H,H) > H |
| 1-bromo-2-methylcyclohexane | C2 | C1 (Br,C,H) > C3 (C,H,H) > CH3 > H |
| glyceraldehyde | C2 | OH > CHO (O,O,H) > CH2OH (O,H,H) > H |
| but-3-en-2-ol | C2 | OH > CH=CH2 (C,C,H) > CH3 > H |
| 3-methylcyclohexene | C3 | CH=CH (C,C,H) > CH2 ring > CH3 > H |
| 2-methylcyclohexanone | C2 | C(=O) (O,O,C) > CH2 ring > CH3 > H |
| `O[C@H](C(CC)CC)C(C)C(C)C` | C1 (atom 1 in `parseSmiles` order: O0, C1, C2 = 3-pentyl, C3–C6 its ethyls, C7 = 3-methylbutan-2-yl, C8–C11) | O0 > 3-methylbutan-2-yl (atom 7) > 3-pentyl (atom 2) > H — `ligands = [0, 7, 2, 'H']` |
| 2-chloro-2-butene C2 (exclude C3) | C2 | Cl > CH3 |
| 3-methylpent-2-ene C3 (exclude C2) | C3 | CH2CH3 > CH3 |
| methylcyclohexane C1 | C1 | tie (two ring CH2), `tieNeedsAdvancedRules = false` |
| cis-1,4-dimethylcyclohexane C1 | C1 | tie, `tieNeedsAdvancedRules = false` |
| pentane-2,3,4-triol C3 | C3 | tie, `tieNeedsAdvancedRules = true` |

Timing target: cholesterol (27 heavy atoms, 8 centres) under 20 ms in Node.

---

## 2. Tetrahedral centres: R/S from grid vectors (`src/chem/stereo.ts`)

### 2.1 `signedVolume(v1, v2, v3, v4): number`

`V = dot(cross(sub(v2, v1), sub(v3, v1)), sub(v4, v1))` over the four substituent TIP positions (or, equivalently, direction vectors from the centre — the centre cancels). With tips in CIP priority order 1..4: `V > EPS → R`, `V < −EPS → S`, `|V| ≤ EPS → planar`. Verified on 178 ETKDG stereocentres + cholesterol 8/8 against RDKit's Hanson labeler (test1.py, test2.py). Equivalent form used by mcmurry-orgo1 §8.3, `T = (p1−p4)·((p2−p4)×(p3−p4))`, satisfies `T = −V` (a 4-cycle is odd), so `T < 0 ⇒ R` agrees.

Implicit-H shortcut (documentation only; the code always uses `signedVolume`): with `v4 = −(v1+v2+v3)`, `V = −4·det[v1,v2,v3]`, so `det = v1·(v2×v3) < 0 ⇒ R`, `> 0 ⇒ S`.

### 2.2 `classifyShape(dirs: readonly Vec3[]): CenterShape`

`dirs` = direction vectors of the EXPLICIT substituents (heavy neighbours + explicit H blocks), length 3 or 4.

- 3 dirs: `|det[d1,d2,d3]| > EPS` → `'octant'`; else `'T'`. On the face lattice this is exactly "no two dirs are negatives of each other": of the 20 three-subsets of {±x,±y,±z}, 8 are octant (mutually orthogonal) and 12 are T (contain an antiparallel pair). Proof of the implicit-H rule: placing H at a free cell `h` gives `sign(n·(h − a1))`; all free cells agree iff the centre is not in the tip plane iff `det ≠ 0`. For an octant trio the three free cells and the virtual tip give one sign; for a T trio they give +, −, 0 (test3.py B).
- 4 dirs: `|signedVolume(d1,d2,d3,d4)| > EPS` → `'seesaw'`; else `'square-planar'`. Of the 15 four-subsets, 12 are seesaw (the two empty positions are orthogonal) and 3 are square-planar (empty positions opposite). RDKit `AssignStereochemistryFrom3D` on the same coordinates agrees on every one of the 35 cases (test2.py A).
- Any other length: throw `RangeError('classifyShape: 3 or 4 directions')`.

Both enumerations are test fixtures (`test/chem/stereo.test.ts`: 8/12 trios, 12/3 quads).

### 2.3 `assignRS(g: WorldGraph, hydrogens, center): StereoCenter`

```
1. a = g.atoms[center]; heavy = neighbours of center (through adj, any bond incl. diagonal)
   pi = Σ (order − 1) over those bonds; nH = hydrogens[center]
2. if a.el !== 'C' or pi > 0 or heavy.length + nH !== 4 or nH > 1:
      return { atom, label: 'NOT_CENTER', shape: null,
               reason: 'needs four single-bonded groups with at most one hydrogen',
               hint: STEREO_TEXT.notCenter }
   (analyzeStereo never calls assignRS for such atoms; the guard makes the function total)
3. rank = cipRank(g, hydrogens, center)
4. if rank.capHit: return { atom, label: 'CANNOT_ASSIGN', shape: null, priorities: rank.ligands,
                            reason: 'digraph size cap', hint: STEREO_TEXT.cannotAssign }
5. if rank.tie:
      if rank.tieNeedsAdvancedRules: return { label: 'CANNOT_ASSIGN', shape: null, priorities,
                                              reason: 'tie needs CIP rules 3-5', hint: STEREO_TEXT.cannotAssign }
      else:                          return { label: 'NOT_CENTER', shape: null,
                                              reason: 'two identical groups (Rule 1a tie)', hint: STEREO_TEXT.notCenter }
6. c = a.pos; explicitDirs = heavy.map(n => sub(pos(n), c)) ++ a.hPos.map(h => sub(h, c))
   shape = classifyShape(explicitDirs)
7. v = rank.ligands.map(l => l === 'H' ? (a.hPos.length === 1 ? sub(a.hPos[0], c) : null) : sub(pos(l), c))
   assert: null appears only at index 3 (H always ranks last; otherwise throw Error('implicit H not lowest'))
8. if v[3] === null: v[3] = neg(add(add(v[0], v[1]), v[2]))
9. V = signedVolume(v[0], v[1], v[2], v[3])
10. if |V| <= EPS:
      shape is 'T' (3 explicit) or 'square-planar' (4 explicit) by construction
      return { atom, label: 'UNSPECIFIED', shape, priorities: rank.ligands, reason: 'planar: ' + shape,
               hint: shape === 'T' ? STEREO_TEXT.flatT : STEREO_TEXT.flatSquare,
               suggestedHPositions: shape === 'T' ? suggestH(g, center, explicitDirs) : undefined }
11. return { atom, label: V > 0 ? 'R' : 'S', shape, priorities: rank.ligands }
```

`suggestH(g, center, dirs)`: for `d` of `FACE_DIRS` ([1,0,0],[−1,0,0],[0,1,0],[0,−1,0],[0,0,1],[0,0,−1]) keep `d` when neither `d` nor `neg(d)` equals any explicit dir and the cell `add(c, d)` is not occupied by an atom or `hPos` entry of `g`. For a T trio this yields exactly the two cells perpendicular to the T's axis (for {+x,−x,+y}: ±z; the in-plane cell −y is excluded because its opposite is explicit).

### 2.4 Classification table and student text (`STEREO_TEXT`)

| explicit substituents | shape | label | `hint` |
|---|---|---|---|
| 3 mutually orthogonal + implicit H | `octant` | R/S | (none) |
| 3 with an opposite pair + implicit H | `T` | `UNSPECIFIED` | `flatT`: "This carbon is drawn flat: two of its groups are opposite each other and the hidden H could sit above or below. Bend the chain here (put the three groups at 90 degrees to each other) or place the H block explicitly above or below." |
| 4 explicit, empty positions orthogonal | `seesaw` | R/S | (none) |
| 4 explicit, empty positions opposite | `square-planar` | `UNSPECIFIED` | `flatSquare`: "This carbon is drawn planar; move one substituent up or down to make it a real tetrahedral center." |
| two Rule-1a-identical groups, no stereo element inside | — | `NOT_CENTER` | `notCenter`: "Not a chirality center: two of the groups are the same." |
| tie whose ligands contain a stereo element, or size cap | — | `CANNOT_ASSIGN` | `cannotAssign`: "Priorities on this carbon depend on advanced CIP rules (3-5) that this course does not cover." |

```ts
export const STEREO_TEXT = {
  notCenter: 'Not a chirality center: two of the groups are the same.',
  cannotAssign: 'Priorities on this carbon depend on advanced CIP rules (3-5) that this course does not cover.',
  flatT: 'This carbon is drawn flat: two of its groups are opposite each other and the hidden H could sit above or below. Bend the chain here (put the three groups at 90 degrees to each other) or place the H block explicitly above or below.',
  flatSquare: 'This carbon is drawn planar; move one substituent up or down to make it a real tetrahedral center.',
  noEz: (n: number) => `No E/Z isomerism: C${n} carries two identical groups (McMurry 7.3).`,
  collinear: (n: number) => `A group on C${n} lies in line with the double bond. An sp2 carbon is trigonal: move the group to the side (up, down, left or right of the carbon).`,
  notPlanar: (n: number) => `The two groups on C${n} are 90 degrees apart. They must be on opposite sides of the double bond, in one plane.`,
  twisted: 'The two ends of the double bond are in perpendicular planes. A pi bond needs both ends in the same plane.',
} as const;
```
`n` in the bond messages is `atom id + 1` (the panel numbers atoms from 1). `src/ui/strings.ts` re-exports these; it never retypes them.

### 2.5 Verified grid fixtures (2-butanol; atoms 0=CH3 1=C2 2=O 3=CH2 4=CH3; C2 at origin)

| build | positions (0,2,3,4 ; explicit H) | shape | label |
|---|---|---|---|
| octant: Me −x, O +z, Et +y | (−1,0,0) (0,0,1) (0,1,0) (0,2,0) | octant | **S** |
| mirror: O −z | (−1,0,0) (0,0,−1) (0,1,0) (0,2,0) | octant | **R** |
| T: Me −x, Et +x, O +y | (−1,0,0) (0,1,0) (1,0,0) (2,0,0) | T | UNSPECIFIED, suggested H (0,0,±1) |
| T + explicit H (0,0,1) | same + hPos [(0,0,1)] | seesaw | S |
| T + explicit H (0,0,−1) | same + hPos [(0,0,−1)] | seesaw | R |
| T + explicit H (0,−1,0) | same + hPos [(0,−1,0)] | square-planar | UNSPECIFIED |
| octant {+x Me, +y Et, +z O} + H at −x, −y or −z | (1,0,0) (0,0,1) (0,1,0) (0,2,0) + one hPos | seesaw | R in all three |
| built elsewhere (translated, other axes): C1 (0,0,0), C2 (1,0,0), O (1,−1,0), C3 (1,0,1), C4 (1,0,2) | | octant | **S** |
| its mirror: same with O (1,1,0) | | octant | **R** (the "R built at a different place/orientation" student of §6.4) |
| 05 §5.3 `r-butan-2-ol` layout: C1 (0,1,0), C2 (0,0,0), O (0,0,−1), C3 (1,0,0), C4 (2,0,0) | | octant | R |
| 05 §5.3 `s-butan-2-ol` layout: same with O (0,0,1) | | octant | S |

Hand check of row 1: priorities O(0,0,1), Et(0,1,0), Me(−1,0,0), H virtual (1,−1,−1); `V = ((0,1,−1)×(−1,0,−1))·(1,−1,−2) = (−1,1,1)·(1,−1,−2) = −4 → S`.

Hand check of the "built elsewhere" row (relative to C2): O (0,−1,0), Et (0,0,1), Me (−1,0,0), H virtual (1,1,−1); `V = ((Et−O)×(Me−O))·(H−O) = ((0,1,1)×(−1,1,0))·(1,2,−1) = (−1,−1,1)·(1,2,−1) = −4 → S` (an earlier draft printed R for this row; test3c.py itself prints `R_but2 label: S`). Every row of this table and of §3.3 was regenerated with `test2.py`'s `rd_from_grid` (RDKit `AssignStereochemistryFrom3D` + `AssignCIPLabels` on the grid coordinates × 1.5 Å) and the labels above are the script's output, not hand-derived; the fixture file must be regenerated the same way whenever a row changes.

---

## 3. Double bonds: E/Z from grid vectors

### 3.1 `alkeneSides(g: WorldGraph, hydrogens, bondIndex)` (shared by `assignEZ` and `compareStereo`)

Returns `{ ok: true, u, ends: [EndInfo, EndInfo] } | { ok: false, label: 'COLLINEAR' | 'NOT_PLANAR' | 'TWISTED', atom?: number }` where `EndInfo = { atom, subs: (number|'H')[], vec: (s: number|'H') => Vec3 }`.

For bond `(a, b)`, `u = sub(pos(b), pos(a))`. For each end `C ∈ {a, b}` with partner `P`:
1. `explicit` = heavy neighbours of `C` other than `P` (as ids) plus `C.hPos` entries (as `'H'` with a known vector); `implicitCount = hydrogens[C] − hPos.length`.
2. Every explicit vector `s` must satisfy `|dot(s, u)| ≤ EPS`; otherwise `{ ok: false, label: 'COLLINEAR', atom: C }`. This rejects a straight C–C=C–C build on purpose (sp2 lesson).
3. If two explicit vectors `s1, s2`: require `dot(s1, s2) = −|s1||s2|` (antiparallel, within EPS); otherwise `{ ok: false, label: 'NOT_PLANAR', atom: C }`.
4. If one explicit vector `s` and one implicit H: the H vector is `neg(s)`.
5. Zero explicit vectors (two implicit H): `vec` is undefined for both; the end contributes nothing to geometry.
6. Reference perpendicular `r(C)` = any explicit vector of the end (undefined for two implicit H).
7. Coplanarity: if both `r(a)` and `r(b)` exist, require `| |dot(r(a), r(b))| − |r(a)||r(b)| | ≤ EPS` (parallel); otherwise `{ ok: false, label: 'TWISTED' }`.

No lenient collinear mode exists in v1 (stereo-on-grid 3.4 is not implemented; there is no config flag).

### 3.2 `assignEZ(g: WorldGraph, hydrogens, bondIndex): DoubleBondStereo`

```
1. bond = g.bonds[bondIndex]; a = bond.a; b = bond.b   (caller guarantees order 2, both C, neither aromatic)
2. if ringsThrough(g, a, b).some(r => r.length <= RING_EZ_EXEMPT_MAX): return { bond, a, b, label: 'RING' }
   (ring C=C are cis by construction; McMurry does not label them; the cube-chair ring would otherwise
    read TWISTED. Layout hint for cyclohexene: planar 3x2 rectangle, C=C on a short edge.)
3. ra = cipRank(g, hydrogens, a, b); rb = cipRank(g, hydrogens, b, a)
   each must have exactly 2 ligands (an alkene carbon has 3 sigma partners incl. H); otherwise
   return { label: 'NO_EZ', hint: STEREO_TEXT.noEz(n) }   (valence errors only)
4. if ra.tie: return { label: 'NO_EZ', hint: STEREO_TEXT.noEz(a+1) }; same for rb with b
   (2-methylbut-2-ene, propene, terminal =CH2; McMurry 7.3)
5. sides = alkeneSides(g, hydrogens, bondIndex)
   if !sides.ok: return { label: sides.label, hint: STEREO_TEXT[collinear|notPlanar](atom+1) or STEREO_TEXT.twisted,
                          higherA: ra.ligands[0], higherB: rb.ligands[0] }
6. pa = vec of ra.ligands[0] on end a; pb = vec of rb.ligands[0] on end b    (never undefined here: a NO_EZ end has two H)
   d = dot(pa, pb)                       // components along u are zero by 3.1
   label = d > 0 ? 'Z' : 'E'
7. cisTrans: if each end has exactly one heavy substituent (1,2-disubstituted alkene) then
   cisTrans = dot(vec(heavyA), vec(heavyB)) > 0 ? 'cis' : 'trans'; else undefined
8. return { bond, a, b, label, higherA: ra.ligands[0], higherB: rb.ligands[0], cisTrans }
```

The panel prints `E (trans)` / `Z (cis)` when `cisTrans` is present.

### 3.3 Verified layouts (but-2-ene, atoms 0=CH3 1=C2 2=C3 3=CH3; test2.py C, RDKit agrees)

| build | positions | label |
|---|---|---|
| zigzag E | (0,1,0) (0,0,0) (1,0,0) (1,−1,0) | E (trans) |
| zigzag Z | (0,1,0) (0,0,0) (1,0,0) (1,1,0) | Z (cis) |
| twisted | (0,1,0) (0,0,0) (1,0,0) (1,0,1) | TWISTED |
| straight line | (−1,0,0) (0,0,0) (1,0,0) (2,0,0) | COLLINEAR (atom 0) |
| E in xz plane | (0,0,1) (0,0,0) (1,0,0) (1,0,−1) | E |
| 2-methylbut-2-ene (0,1,0) (0,0,0) (1,0,0) (1,1,0) (1,−1,0) | | NO_EZ (C3 tie) |
| but-2-ene with explicit H on C2 at (0,0,1), CH3 at (0,1,0) | | NOT_PLANAR (C2) |

Buildability (09-amendment-no-bond.md §2.1, replacing the former R3 note): the rules of §3.1–3.2 never mention adjacency, and with the bond wand's "no bond" setting every alkene with a defined E/Z is buildable. A same-side pair of substituents (every Z-1,2-disubstituted alkene, one pair of every trisubstituted alkene, two pairs of a tetrasubstituted one) occupies two face-adjacent cells; the student sets that auto-bond to no bond (a *suppressed pair*, excluded from the extracted graph) and the tests above read the intended geometry. The "zigzag Z" row of this table is therefore a legal build once the pair `C1|C4` is suppressed. 09 §2.1 tabulates RDKit-verified layouts for all eight Z / trisubstituted library entries (one suppressed pair each); the stereo code is unchanged.

---

## 4. Ring faces (cis/trans)

`ringFace(g: WorldGraph, ring: readonly number[], atom: number): 1 | -1 | 0` — `ring` is a cycle in traversal order (from `smallestRings(g, 8)`), `atom` a non-ring atom bonded to some ring member `r`:

```
centroid = mean(pos over ring)
normal   = Σ_k cross(sub(pos(ring[k]), centroid), sub(pos(ring[(k+1) % n]), centroid))   // Newell; NOT normalised
d = dot(sub(pos(atom), pos(r)), normal)
return |d| <= EPS ? 0 : (d > 0 ? 1 : -1)
```

`analyzeStereo` fills `ringFaces` with one `RingFace` per smallest ring of size ≤ 8: `{ ring, normal (normalised), subs: [{ atom, ringAtom, face }] }` for every heavy non-ring neighbour of every ring atom. cis = equal non-zero faces, trans = opposite; 0 = in-plane (flagged by the overlay). Reversing the ring order flips `normal` and every face together, so relations are invariant. For the cube chair `(0,0,0),(1,0,0),(1,1,0),(1,1,1),(0,1,1),(0,0,1)` the normal is `(1,−1,1)/√3` and the "up" free cells are atom0 −y, atom1 +z, atom2 +x, atom3 −y, atom4 +z, atom5 +x (test2.py E).

Verified chair fixture, 1-bromo-2-methylcyclohexane (Br on ring atom 0, CH3 on ring atom 1):

| build | labels (C–Br, C–Me) | relation |
|---|---|---|
| both up | (1S, 2R) | cis |
| both down | (1R, 2S) | cis |
| Br up, Me down | (1S, 2S) | trans |
| Br down, Me up | (1R, 2R) | trans |

cis-1,2-dimethylcyclohexane built the same way is meso (§7).

---

## 5. Labels from target SMILES tags (`labelTargetStereo`)

Targets have no positions; their stereo is `Atom.tet` / `Bond.ez` from `parseSmiles` (neighbour order: preceding atom, bracket H, ring-closure digits in digit order, then branches/next atom; `@@ ⇒ sign +1`, `@ ⇒ −1`, RDKit-verified: `N[C@@H](C)C(=O)O` gives V = +8.1).

`labelTargetStereo(g: MoleculeGraph, hydrogens): { centers: Map<number, CenterLabel>; bonds: Map<number, 'E' | 'Z' | 'NO_EZ'> }`

Centres: for every atom with `tet`:
1. `rank = cipRank(g, hydrogens, atom)`; tie/cap → `NOT_CENTER` / `CANNOT_ASSIGN` as in §2.3 steps 4–5.
2. `s = permSign(tet.order, rank.ligands)` (§6.1) — sign of the permutation from written order to priority order.
3. `Vp = tet.sign · s`; `Vp > 0 → R`, `< 0 → S`.

Check, L-alanine `N[C@@H](C)C(=O)O`: written (N, H, CH3, COOH), sign +1; priorities (N, COOH, CH3, H) = one transposition, `s = −1`, `Vp = −1 → S` (McMurry 5.5, RDKit).

Bonds: for every bond with `ez` (`refA` neighbour of `a`, `refB` of `b`, `cis`):
1. `ra = cipRank(g, hydrogens, a, b)`, `rb = cipRank(g, hydrogens, b, a)`; either tie → `NO_EZ`.
2. `cisHigh = ez.cis XOR (ra.ligands[0] !== ez.refA) XOR (rb.ligands[0] !== ez.refB)`.
3. `cisHigh → Z`, else `E`.

Check, `F/C=C/F`: refs F1, F2, `cis = false`; higher = F on both ends → `cisHigh = false → E`. `C/C=C(\Cl)C`: C1 before C2 with `/` → down; Cl after C3 with `\` → down; `cis = true`; higher on C2 is CH3 (= refA), on C3 is Cl (= refB) → Z.

Library validation (`test/content/library.test.ts`) compares `MoleculeEntry.labels` (keyed by 1-based SMILES atom position = atom id + 1) with this map; comparison for grading never uses these labels (Reconciliation R5).

---

## 6. Parity comparison under isomorphism (`src/chem/stereo-compare.ts`)

### 6.1 Primitives

`permSign(from: readonly (number|'H')[], to: readonly (number|'H')[]): 1 | -1` — `idx = to.map(x => from.indexOf(x))`; sign = (−1)^(number of inversions in `idx`). Both lists hold the same four distinct entries (three or four ids plus at most one `'H'`).

`parityInOrder(g: MoleculeGraph, hydrogens, atom, order): 1 | -1 | 0 | null` (in `stereo.ts`):
- If `hasPositions(g)`: `v = order.map(o => o === 'H' ? (hPos.length === 1 ? sub(hPos[0], c) : null) : sub(pos(o), c))`; if exactly one null, replace it by `neg(sum of the other three)`; if two or more nulls, or `order.length !== 4`, or some `o` is not a neighbour, return `null`. Return `sign(signedVolume(v0..v3))` with 0 for `|V| ≤ EPS`.
- Else if `g.atoms[atom].tet` exists: return `tet.sign · permSign(tet.order, order)` (requires the same entry set; else `null`).
- Else `null`.

`cisInMapping` (in `stereo-compare.ts`): for a target `ez` bond mapped onto student bond `(sa, sb)` with `sa = f(a)`, `sb = f(b)`:
- Student with positions: `sides = alkeneSides(student, hydS, sBondIndex)`; if `!sides.ok` → geometry failure. `cisS = dot(vecEnd(sa, f'(refA)), vecEnd(sb, f'(refB))) > 0` where `f'('H') = 'H'`, and the vector of `'H'` on an end with one explicit substituent is the negative of that substituent (two implicit H on an end cannot occur: the target tags a bond only when both ends have two different groups, and the isomorphism preserves H counts).
- Student without positions but with `bond.ez` on `(sa, sb)`: `cisS = sez.cis XOR (f'(refA) !== sez.refOn(sa)) XOR (f'(refB) !== sez.refOn(sb))` where `refOn` picks `refA`/`refB` of the student tag by end.
- Neither: unspecified.

### 6.2 `compareStereo(target, student, mapping): { verdict, differingCenters, differingBonds, offending }`

`mapping[targetId] = studentId` is one isomorphism from `findIsomorphisms(target, student)` (constitution + charge already equal). `hydT`, `hydS` are the H arrays of both graphs (from `normalize`).

```
tetra: boolean[] = []; dbl: boolean[] = []; differingCenters = []; differingBonds = []
for each target atom t with t.tet:
    order = t.tet.order.map(o => o === 'H' ? 'H' : mapping[o])
    p = parityInOrder(student, hydS, mapping[t.id], order)
    if p === null || p === 0: return { verdict: 'UNSPECIFIED', offending: { atom: mapping[t.id] } }
    ok = (p === t.tet.sign); tetra.push(ok); if !ok differingCenters.push(t.id)
for each target bond i with ez:
    r = cisInMapping(...)
    if r is geometry failure: return { verdict: 'INVALID_GEOMETRY', offending: { bond: studentBondIndex } }
    if r is unspecified:      return { verdict: 'UNSPECIFIED', offending: { bond: studentBondIndex } }
    ok = (r.cisS === ez.cis); dbl.push(ok); if !ok differingBonds.push(i)
if tetra.every(x) && dbl.every(x): verdict = 'SAME'
else if tetra.length > 0 && tetra.every(x => !x) && dbl.every(x): verdict = 'ENANTIOMER'
else verdict = 'DIASTEREOMER'
```

Target atoms without `tet` and bonds without `ez` are wildcards (never checked) — this is the "require specified only" semantics: a target written without a tag at a real centre accepts any configuration there. A target with no stereo tags at all returns `SAME` for every mapping.

### 6.3 `sameMolecule` stereo semantics (used by `compare.ts`)

After the constitution stage yields the mapping list `M` (empty → `DIFFERENT_CONSTITUTION`; formula/net-charge mismatch earlier → `DIFFERENT_FORMULA`):

1. Policy `'none'`: return `{ same: true, verdict: 'SAME', mapping: M[0] }` without calling `compareStereo` ("ignore").
2. Policy `'ez'`: `target' = target with every `tet` removed`; then as below with `target'`.
3. For every `m ∈ M` compute `r_m = compareStereo(target, student, m)`. Rank verdicts `SAME (0) > ENANTIOMER (1) > DIASTEREOMER (2) > UNSPECIFIED (3) > INVALID_GEOMETRY (4)`; pick the best (first on ties, so results are deterministic). `UNSPECIFIED` / `INVALID_GEOMETRY` therefore surface only when no mapping produces a full stereo verdict — a flat student atom that only ever maps onto untagged target atoms is harmless.
4. `same` by policy: `'relative'` → verdict ∈ {SAME, ENANTIOMER}; `'absolute'` → SAME; `'ez'` → SAME (with `tet` stripped, ENANTIOMER cannot occur). Charges were compared in the constitution stage for every policy.
5. Fill `mapping`, `differingCenters`, `differingBonds`, `offendingAtom`, `offendingBond` from the chosen `r_m`.

Mapping of the task's three option names: ignore = `'none'`; require-all-defined-labels-match = `'absolute'` (`'relative'` is the same up to a global mirror); require-specified-only is always in force (untagged target atoms are wildcards) and is the only behaviour — there is no mode that demands the student define centres the target leaves open.

A student graph with neither positions nor tags against a tagged target yields `UNSPECIFIED`, `same = false` for `'relative' | 'absolute' | 'ez'` (contract). A student graph with tags but no positions (reaction-engine output compared with an expected SMILES in `test/reactions/*`) is fully supported through the tag branch of `parityInOrder` / `cisInMapping`.

### 6.4 Verified verdicts (test3c.py C; fixtures for `test/chem/stereo-compare.test.ts`)

| target | student | verdict |
|---|---|---|
| (S)-2-butanol grid (§2.5 row 1) | same build | SAME |
| (S)-2-butanol (§2.5 row 1) | (R) build (§2.5 row 2) | ENANTIOMER |
| (R) build (§2.5 row 2) | (R) built at a different place/orientation (§2.5 "its mirror" row: C1 (0,0,0), C2 (1,0,0), O (1,1,0), C3 (1,0,1), C4 (1,0,2)) | SAME |
| (R) build (§2.5 row 2) | the §2.5 "built elsewhere" row with O (1,−1,0) (which is S) | ENANTIOMER (test3c.py prints exactly this: `R vs R2 (different placement): ENANTIOMER`) |
| (S)-2-butanol | T-shaped flat build | UNSPECIFIED |
| meso-2,3-dibromobutane `meso_a` | `meso_b` (its mirror image) | SAME |
| (2R,3R)-2,3-dibromobutane `rr` | (2S,3S) `ss` | ENANTIOMER |
| `meso_a` | `rr` | DIASTEREOMER |
| `meso_b` | `ss` | DIASTEREOMER |
| cis-1,4-dimethylcyclohexane (no CIP centres) | cis on the other face | SAME |
| trans-1,4 | trans flipped | SAME |
| cis-1,4 | trans-1,4 | DIASTEREOMER |
| (E)-but-2-ene `C/C=C/C` | Z grid build | DIASTEREOMER (differingBonds = [1]) |
| `C/C=C/C` | twisted build | INVALID_GEOMETRY |

Grid coordinates for the dibromobutane rows (atoms 0=C1 1=C2 2=Br 3=C3 4=Br 5=C4; the four builds are the 05-content §5.3 layouts `meso-2-3-dibromobutane`, `2r-3r-dibromobutane`, `2s-3s-dibromobutane` and the mirror image of the first; all four are RDKit-verified with `test2.py`'s `rd_from_grid` and all four are legal builds):

| build | C1 | C2 | Br on C2 | C3 | Br on C3 | C4 | labels (C2, C3) | `meso` |
|---|---|---|---|---|---|---|---|---|
| `meso_a` (05 `meso-2-3-dibromobutane`) | (0,1,0) | (0,0,0) | (0,0,1) | (1,0,0) | (1,0,−1) | (1,−1,0) | (S, R) | true |
| `meso_b` (mirror of `meso_a` in z) | (0,1,0) | (0,0,0) | (0,0,−1) | (1,0,0) | (1,0,1) | (1,−1,0) | (R, S) | true |
| `rr` (05 `2r-3r-dibromobutane`) | (0,1,0) | (0,0,0) | (0,0,−1) | (1,0,0) | (1,−1,0) | (1,0,1) | (R, R) | false, `chiral` |
| `ss` (05 `2s-3s-dibromobutane`) | (0,1,0) | (0,0,0) | (0,0,1) | (1,0,0) | (1,−1,0) | (1,0,−1) | (S, S) | false, `chiral` |

Two traps, both hit by an earlier draft of this table and both caught by RDKit: (1) on a zigzag chain C1 (0,−1,0), C2 (0,0,0), C3 (1,0,0), C4 (1,1,0), putting both Br at +z gives (R,R), not meso, and putting them at +z/−z gives the meso (R,S) form — the "same side" intuition from a Fischer projection does not transfer to the anti zigzag; (2) Br at (0,0,1) and (1,0,1) are face-adjacent cells, so on the grid the two bromines auto-bond and exceed valence 1; since 09-amendment-no-bond.md that build exists only with the `Br|Br` pair set to no bond with the wand, and it is still not a fixture (the four induced layouts above are). Hand check of `rr` at C2 (priorities Br (0,0,−1) > C3 (1,0,0) > C1 (0,1,0) > H virtual (−1,−1,1)): `V = ((C3−Br)×(C1−Br))·(H−Br) = ((1,0,1)×(0,1,1))·(−1,−1,2) = (−1,−1,1)·(−1,−1,2) = 4 → R`.

**Fixture legality assertion.** Every grid fixture in `test/chem/stereo.test.ts`, `stereo-compare.test.ts` and the §11 end-to-end rows passes `assertBuildable(g)` (test helper `test/helpers/lattice.ts`, a restatement of `embedOnLattice` step 5 in 02-chemistry-core §13) before any label is asserted, so an unbuildable fixture fails loudly instead of testing geometry the world cannot produce:

```ts
// test/helpers/lattice.ts — for every pair of cells (heavy atoms and hPos entries) of a WorldGraph:
//   manhattan(p, q) === 1  ⇔  the two cells are bonded (heavy–heavy: a bond in g.bonds that is not diagonal;
//                             heavy–H: the H is in that atom's hPos; H–H: never), and no two cells coincide —
//   except that a face-adjacent UNBONDED heavy–heavy pair is allowed when its PairKey is in `suppressed`
//   (09-amendment-no-bond.md §2.3: a "no bond" pair the student sets with the wand).
// Throws Error(`fixture not buildable: cells ${p} and ${q} are face-adjacent but unbonded`) (or the converse), and
// Error(`fixture: suppressed pair ${key} is not a touching unbonded pair`) for a bad `suppressed` entry.
export function assertBuildable(g: WorldGraph, suppressed?: ReadonlySet<PairKey>): void;
```

---

## 7. `analyzeStereo(g: WorldGraph, hydrogens): StereoAnalysis`

1. `centers`: for every atom `i` with `el === 'C'`, `pi === 0`, `deg + hydrogens[i] === 4`, `hydrogens[i] ≤ 1`: `assignRS(g, hydrogens, i)`, in ascending id.
2. `doubleBonds`: for every bond with `order === 2`, both ends `C`, `!bond.aromatic` and neither atom `aromatic`: `assignEZ(g, hydrogens, index)`, in ascending bond index.
3. `ringFaces` per §4.
4. `tagged = tagsFromPositions(g, hydrogens)` — a copy of `g` where every carbon with `pi === 0`, `deg + H === 4`, `H ≤ 1` and non-planar geometry gets `tet = { order: [heavy neighbours ascending, then 'H' if H === 1], sign: parityInOrder(g, …, order) }` (planar ones get no tag), and every non-ring, non-aromatic C=C whose `alkeneSides` is `ok` and whose ends each have at least one explicit substituent gets `ez = { refA, refB, cis }` with `refA`/`refB` = the lowest-id explicit substituent (or `'H'`) on each end and `cis = dot(vecA, vecB) > 0`. Tags go on ALL such carbons, including Rule-1a ties — this is what makes 1,4-ring and pseudo-asymmetric cases grade correctly (R5).
5. `hasRS = centers.some(c => c.label === 'R' || c.label === 'S')`; `anyFlat = centers.some(c => c.label === 'UNSPECIFIED')`.
6. `mirrorSame`: computed ONLY when `hasRS && !anyFlat`; otherwise `false` without any isomorphism search (this is the common path: most builds have no R/S centre, and steps 4–7 are the only part of `analyzeStereo` whose cost is not linear in the graph size). When it runs:
   - `mirror = tagged with every tet.sign negated` (`ez` unchanged: reflection preserves cis).
   - `search = findIsomorphismsDetailed(mirror, g, DEFAULT_MAX_STATES)`; `mirrorSame = !search.capped && search.mappings.some(m => compareStereo(mirror, g, m).verdict === 'SAME')` — evaluated with `g` as the student (positions). `some` stops calling `compareStereo` at the first SAME mapping; the enumeration itself cannot stop early because the SAME mapping need not be the first one, and `firstOnly` would return an arbitrary automorphism. A capped search reports `mirrorSame = false` (meso is not claimed; `findIsomorphismsDetailed` already returns `capped` for the panel's `isomorphism-cap` warning).
   - Cost bound: `mirror` and `g` have the same constitution, so the mappings are exactly the automorphisms of `g`; the search is bounded by `DEFAULT_MAX_STATES = 200 000` recursive states (02-chemistry-core §10) and each mapping costs one `compareStereo` (linear in the tag count). For every v1 library molecule that reaches this step the automorphism count is ≤ 2 (2,3-dibromobutane, tartaric acid, 1,2-dimethylcyclohexane: 2 each) and the search visits < 100 states. `analyze()` is not preemptible: 06-engine §14.4's `ANALYSIS_BUDGET_MS` (4 ms) bounds how many components are analysed per frame, not one analysis, so this bound is what justifies that budget — a worst-case free-play build (≤ 30 heavy atoms, high symmetry, several R/S centres) stays under the 200 000-state cap and therefore under ~50 ms in Node.
7. (steps 5–6 replace the former order "mirror, mirrorSame, hasRS, anyFlat"; nothing else changes.)
8. `meso = hasRS && !anyFlat && mirrorSame` (McMurry 5.7: achiral yet containing chirality centres; cis-1,4-dimethylcyclohexane is achiral but not meso because it has no R/S centre and never reaches the search).
9. `chiral = hasRS && !meso`. A molecule with one R/S centre and one flat centre is reported `chiral = true, meso = false`; the flat centre's warning tells the student what is undetermined.
10. Return `{ centers, doubleBonds, ringFaces, chiral, meso }`.

`stereoWarnings(s: StereoAnalysis): Warning[]` (called by `analyze`): one `{ kind: 'planar-center', atom, shape }` per `UNSPECIFIED` centre (`shape` is `'T'` or `'square-planar'`), one `{ kind: 'alkene-geometry', bond, label }` per bond labelled `COLLINEAR | NOT_PLANAR | TWISTED`.

Expected outputs: meso-2,3-dibromobutane grid (`meso_a` / `meso_b` of §6.4) → centers (S, R) / (R, S), `meso = true`, `chiral = false`; (2R,3R) (`rr` of §6.4) → `chiral = true`, `meso = false`; meso-tartaric → meso; cis-1,2-dimethylcyclohexane chair → meso; trans-1,2 → chiral; cis-1,4 → both `NOT_CENTER`, `chiral = false`, `meso = false`; (R)-2-butanol → chiral.

---

## 8. Hybridization and geometry (`src/chem/hybridization.ts`)

### 8.1 Lone-pair table (derived, never stored)

`lonePairs(el, q) = (VALENCE_ELECTRONS[el] − q − TARGET_VALENCE[el][q]) / 2` (from `valence.ts`):

| el | q −1 | q 0 | q +1 |
|---|---|---|---|
| H | — | 0 | — |
| C | 1 | 0 | 0 |
| N | 2 | 1 | 0 |
| O | 3 | 2 | 1 |
| S | 3 | 2 | 1 |
| P | — | 1 | 0 |
| F, Cl, Br, I | 4 | 3 | — |

### 8.2 `atomInfo(g, hydrogens): AtomInfo[]` — one entry per atom of `g` (heavy atoms only; analysed graphs never contain `H` atoms), in id order

```
for atom a (id i):
  neighbors = heavy neighbour ids (via adj)
  heavyBondOrderSum = Σ order over adj bonds (diagonal bonds count like face bonds)
  hydrogens_i = hydrogens[i]                       // 0 with valenceError when implicitHydrogens reported over-valence
  valenceError = heavyBondOrderSum > TARGET_VALENCE[el][charge]
                 ? `too many bonds for ${el} with charge ${charge}` : undefined
  sigma = neighbors.length + hydrogens_i
  pi    = Σ (order − 1) over adj bonds
  LP    = lonePairs(el, charge)
  conjugatedLonePair =
      LP > 0 && pi === 0
      && (el ∈ {N, O, S} || (el === 'C' && charge === −1))
      && ∃ neighbour n, ∃ bond (n, x) with x !== i and order >= 2
      // halogens: never (always sp3); aromatic flags are irrelevant because Kekulé orders are stored
  stericNumber = sigma + LP − (conjugatedLonePair ? 1 : 0)
  hybridization = sigma === 0 ? 'none' : SN >= 4 ? 'sp3' : SN === 3 ? 'sp2' : SN === 2 ? 'sp' : 'none'
  geometry:
      sigma === 0            → 'none'
      sigma === 1            → 'terminal'
      SN >= 4: sigma 4 → 'tetrahedral'; 3 → 'trigonal pyramidal'; 2 → 'bent'
      SN === 3: sigma 3 → 'trigonal planar'; 2 → 'bent'
      SN === 2: sigma 2 → 'linear'
      otherwise              → 'none'
  idealAngle = geometry ∈ {'terminal','none'} ? null : SN >= 4 ? 109.5 : SN === 3 ? 120 : 180
  observedAngleNote = ANGLE_NOTES lookup (8.3)
  formalCharge = VALENCE_ELECTRONS[el] − (2·LP + heavyBondOrderSum + hydrogens_i)   // === charge unless valenceError
```

`hybridization(info)` and `geometry(info)` are the two pure lookups above applied to an existing `AtomInfo` (used by selectors and quizzes).

### 8.3 `ANGLE_NOTES` (first matching row wins)

| condition | note |
|---|---|
| O, sigma 2, LP 2, not conjugated | "measured 104.5° in water (Chem 2e 7.6); C–O–H 108.5° in methanol (McMurry 1.10)" |
| N, sigma 3, LP 1, not conjugated | "measured 107.1° H–N–H in methylamine (McMurry 1.10)" |
| N, conjugated | "amide-type nitrogen is planar: its lone pair is delocalized into the neighbouring pi bond (McMurry 24.3, 26.4)" |
| C, charge +1, sigma 3 | "carbocations are planar, sp2, with a vacant p orbital (McMurry 7.9)" |
| C, sp2, sigma 3 | "measured 117.4° H–C–H and 121.3° H–C–C in ethylene (McMurry 1.8)" |
| S, sigma 2, LP 2 | "measured 96.5° C–S–H in methanethiol, 99.1° C–S–C in dimethyl sulfide (McMurry 1.10)" |

The HUD prefixes every angle with "ideal (McMurry 1.6–1.10); the 90° block angles are a lattice artifact" (string owned by `ui/strings.ts`).

### 8.4 Test table (`test/chem/hybridization.test.ts`; graphs from SMILES)

| # | molecule / atom | σ | π | LP | conj | SN | hyb | geometry | angle |
|---|---|---|---|---|---|---|---|---|---|
| 1 | methane C | 4 | 0 | 0 | – | 4 | sp3 | tetrahedral | 109.5 |
| 2 | ethene C | 3 | 1 | 0 | – | 3 | sp2 | trigonal planar | 120 |
| 3 | ethyne C | 2 | 2 | 0 | – | 2 | sp | linear | 180 |
| 4 | formaldehyde C | 3 | 1 | 0 | – | 3 | sp2 | trigonal planar | 120 |
| 5 | formaldehyde O | 1 | 1 | 2 | – | 3 | sp2 | terminal | null |
| 6 | acetonitrile N | 1 | 2 | 1 | – | 2 | sp | terminal | null |
| 7 | acetonitrile nitrile C | 2 | 2 | 0 | – | 2 | sp | linear | 180 |
| 8 | acetonitrile CH3 C | 4 | 0 | 0 | – | 4 | sp3 | tetrahedral | 109.5 |
| 9 | water O | 2 | 0 | 2 | – | 4 | sp3 | bent | 109.5 (note 104.5) |
| 10 | ammonia N | 3 | 0 | 1 | – | 4 | sp3 | trigonal pyramidal | 109.5 |
| 11 | acetamide N | 3 | 0 | 1 | yes | 3 | sp2 | trigonal planar | 120 |
| 12 | acetamide carbonyl C | 3 | 1 | 0 | – | 3 | sp2 | trigonal planar | 120 |
| 13 | dimethyl ether O | 2 | 0 | 2 | – | 4 | sp3 | bent | 109.5 |
| 14 | allene central C | 2 | 2 | 0 | – | 2 | sp | linear | 180 |
| 15 | allene terminal C | 3 | 1 | 0 | – | 3 | sp2 | trigonal planar | 120 |
| 16 | benzene C (Kekulé) | 3 | 1 | 0 | – | 3 | sp2 | trigonal planar | 120 |
| 17 | methyl cation C (+1) | 3 | 0 | 0 | – | 3 | sp2 | trigonal planar | 120 |
| 18 | methyl anion C (−1) | 3 | 0 | 1 | – | 4 | sp3 | trigonal pyramidal | 109.5 |
| 19 | acetylide C⁻ (HC≡C⁻) | 1 | 2 | 1 | – | 2 | sp | terminal | null |
| 20 | ammonium N | 4 | 0 | 0 | – | 4 | sp3 | tetrahedral | 109.5 |
| 21 | methyl acetate alkoxy O | 2 | 0 | 2 | yes | 3 | sp2 | bent | 120 |
| 22 | acetone enolate C⁻ | 3 | 0 | 1 | yes | 3 | sp2 | trigonal planar | 120 |
| 23 | vinyl chloride Cl | 1 | 0 | 3 | no | 4 | sp3 | terminal | null |
| 24 | DMSO S⁺ (`C[S+](C)[O-]`) | 3 | 0 | 1 | – | 4 | sp3 | trigonal pyramidal | 109.5 |

Extra rows: propene C1, C2 sp2 / C3 sp3 (answer set of `ch1-select-sp2-propene`); tert-butyl cation central C sp2 trigonal planar; carboxylic acid O–H oxygen conjugated sp2 bent; nitromethane N⁺ (σ 3, π 1, LP 0) sp2; chloride ion (σ 0) `none`/`none`.

---

## 9. Formal charge and the charge tool (`src/chem/charge.ts`)

### 9.1 `formalCharge(info: AtomInfo): number`

`VALENCE_ELECTRONS[el] − (2·lonePairs + heavyBondOrderSum + hydrogens)` = McMurry 2.3 `V − (nonbonding e⁻ + bonding e⁻/2)`. Equals `info.charge` whenever `valenceError` is undefined (lone pairs are derived from the stored charge). Because it is tautological in the builder, the "compute formal charge" objective is a quiz with charges hidden and lone pairs shown (05-content.md, C2-01); this function feeds that display and `test/chem/charge.test.ts` asserts `formalCharge === charge` for every library molecule.

### 9.2 Valence targets and what the bond tool may do

`TARGET_VALENCE` (types.ts) is the whole rule: at charge `q` an atom may hold at most `TARGET_VALENCE[el][q]` total bond order (heavy bonds + explicit H blocks + implicit H).

| el | q −1 | q 0 | q +1 | consequence for the bond wand (1→2→3→1, skipping forbidden orders) |
|---|---|---|---|---|
| C | 3 | 4 | 3 | C⁺/C⁻ with three heavy single bonds cannot take a double bond |
| N | 2 | 3 | 4 | N⁺ may reach order 4 total (ammonium, nitrilium); N⁻ at most 2 |
| O | 1 | 2 | 3 | O⁻ is terminal (order 1 only); C=O needs O at 0 or +1; C≡O⁺ is allowed by the table |
| S | 1 | 2 | 3 | DMSO is `S⁺–O⁻`; hypervalent S is unsupported |
| P | — | 3 | 4 | parser only |
| F Cl Br I | 0 | 1 | — | halide ion has no bonds; halogen never doubles |
| H | — | 1 | — | H blocks: always order 1, never charged |

Bond change `(a, b)` from `old` to `new` is legal iff for both endpoints `bondOrderSum − old + new ≤ TARGET_VALENCE[el][charge]` (with `bondOrderSum` counting explicit H blocks). That rule lives in `molecule-index.ts` (06-engine.md) and reuses `TARGET_VALENCE`; nothing in `charge.ts` is needed for it.

### 9.3 `canSetCharge(g, atom, q): { ok: true } | { ok: false; reason: string }`

```
1. a = g.atoms[atom]; if a.el === 'H': return { ok: false, reason: CHARGE_REFUSAL.hBlock }
2. tv = TARGET_VALENCE[a.el][q]; if tv === undefined: return { ok: false, reason: CHARGE_REFUSAL.unsupported(a.el, q) }
3. fixedH = a.hPos?.length ?? a.explicitH ?? 0          // explicit H blocks / bracket H are fixed, implicit H are free
   have = heavyBondOrderSum(g, atom) + fixedH
4. if have > tv: return { ok: false, reason: CHARGE_REFUSAL.valence(a.el, q, tv) }
5. return { ok: true }
```

```ts
export const CHARGE_REFUSAL = {
  hBlock: 'Hydrogen blocks cannot carry a charge.',
  unsupported: (el: string, q: number) => `${el} cannot carry charge ${q > 0 ? '+' : ''}${q} in this game.`,
  valence: (el: string, q: number, max: number) =>
    `Remove a bond first: ${el}${q > 0 ? '+' : q < 0 ? '-' : ''} allows ${max} bonds.`,
} as const;
```
`unsupported` and `valence` are byte-identical to `REFUSAL_TEXT.chargeUnsupported` / `chargeValence` in `src/world/types.ts`; `test/world/molecule-index.test.ts` asserts the equality so the two tables cannot drift (chem must not import world).

`withCharge(g, atom, q): MoleculeGraph` — calls `canSetCharge`; on refusal throws `Error('charge refused: ' + reason)`; otherwise returns `graph.withCharge(g, atom, q)` (the immutable edit from `graph.ts`). Implicit H are recomputed by the next `implicitHydrogens` call, never stored.

Charge-tool cycle in the world: `0 → +1 → −1 → 0`; a refused step is skipped, and if both non-zero charges are refused the tool reports the last refusal and leaves the atom at 0.

### 9.4 Charge-tool examples (fixtures)

| start | atom → q | tv | have | result |
|---|---|---|---|---|
| CH3OH | O → −1 | 1 | 1 | ok → methoxide, implicit H on O becomes 0 |
| CH3NH2 | N → +1 | 4 | 1 | ok → CH3NH3⁺ (3 implicit H) |
| H2O | O → +1 | 3 | 0 | ok → H3O⁺ |
| (CH3)3CH, H implicit | central C → +1 | 3 | 3 | ok → tert-butyl cation |
| (CH3)3CH with an explicit H block on the central C | central C → +1 | 3 | 4 | refused: "Remove a bond first: C+ allows 3 bonds." |
| CH3CH2OH | C1 → +1 | 3 | 1 | ok (a primary carbocation is legal to draw) |
| CH2=CH2 | C → −1 | 3 | 2 | ok → vinyl anion |
| CH3F | F → +1 | — | — | refused: "F cannot carry charge +1 in this game." |
| CH3CH3 | C → −1 | 3 | 1 | ok → ethyl anion |
| CH3–O–CH3 | O → −1 | 1 | 2 | refused: "Remove a bond first: O- allows 1 bonds." |
| H block | → any | — | — | refused: "Hydrogen blocks cannot carry a charge." |

Net charge of a molecule = Σ `charge`, appended to the Hill formula (`C2H3O2-`).

---

## 10. Acidity (`src/chem/acidity.ts`)

### 10.1 Sources

```ts
export const PKA_SOURCES = {
  T2_3: 'MM 2.8 T2.3 (m00025)', S2_10: 'MM 2.10 (m00027)', APP_B: 'MM App B (m00030)',
  T9_1: 'MM 9.7 T9.1 (m00109)', T17_1: 'MM 17.2 T17.1 (m00201)', S18_8: 'MM 18.8 (m00254)',
  T20_3: 'MM 20.2 T20.3 (m00231)', T22_1: 'MM 22.5 T22.1 (m00261)',
  T24_1: 'MM 24.3 T24.1 (m00291)', T24_2: 'MM 24.4 T24.2 (m00292)',
  CHEM2E_H: 'Chem 2e App H (m68866)',
  GENERAL: 'general textbook value, not tabulated by McMurry (unverified)',
} as const;
```

### 10.2 `PKA` — hydrogen classes (`verified: false` ⇒ shown as "≈" and never a graded answer, R12)

```ts
export interface PkaEntry { readonly id: string; readonly pKa: number; readonly label: string; readonly source: string; readonly verified: boolean; }
export const PKA: Readonly<Record<string, PkaEntry>> = { /* rows below */ };
```

| id | pKa | label | source | verified |
|---|---|---|---|---|
| `HX.F` | 3.2 | H–F | CHEM2E_H | yes |
| `HX.Cl` | −7.0 | H–Cl | T2_3 | yes |
| `HX.Br` | −9 | H–Br | GENERAL | no |
| `HX.I` | −10 | H–I | GENERAL | no |
| `OH.carboxylic` | 4.8 | O–H of a carboxylic acid | APP_B (T2.3: 4.76) | yes |
| `OH.peracid` | 8.2 | O–H of a peracid | APP_B | yes |
| `OH.enol` | 10.0 | O–H of an enol or phenol | APP_B (phenol 9.9), T17_1 (9.89) | yes |
| `OH.water` | 15.74 | O–H of water | T2_3 | yes |
| `OH.gemdiol` | 13.3 | O–H of a gem-diol | APP_B | yes |
| `OH.alcohol.methanol` | 15.5 | O–H of methanol | APP_B (T17.1: 15.54) | yes |
| `OH.alcohol.primary` | 16.0 | O–H of a primary alcohol | APP_B, T17_1 | yes |
| `OH.alcohol.secondary` | 17.1 | O–H of a secondary alcohol | APP_B | yes |
| `OH.alcohol.tertiary` | 18.0 | O–H of a tertiary alcohol | APP_B, T17_1 | yes |
| `OH.oxime` | 12.4 | O–H of an oxime | APP_B | yes |
| `OH.hydroperoxide` | 11.6 | O–H of a hydroperoxide | GENERAL | no |
| `OH.oxonium.hydronium` | −1.7 | O–H of H3O⁺ | GENERAL (consistent with MM 2.8 water 55.4 M) | no |
| `OH.oxonium.alcohol` | −2.4 | O–H of a protonated alcohol | GENERAL | no |
| `OH.oxonium.ether` | −3.5 | O–H of a protonated ether | GENERAL | no |
| `OH.oxonium.carbonyl` | −7 | O–H of a protonated aldehyde or ketone | GENERAL | no |
| `OH.oxonium.carboxylic` | −6 | O–H of a protonated carboxylic acid | GENERAL | no |
| `OH.oxonium.amide` | −1 | O–H of a protonated amide | GENERAL | no |
| `NH.ammonium.nh4` | 9.26 | N–H of NH4⁺ | T24_1 | yes |
| `NH.ammonium.primary` | 10.6 | N–H of a primary ammonium ion | T24_1 (10.64/10.75) | yes |
| `NH.ammonium.secondary` | 11.0 | N–H of a secondary ammonium ion | T24_1 (10.98) | yes |
| `NH.ammonium.tertiary` | 10.8 | N–H of a tertiary ammonium ion | T24_1 (10.76) | yes |
| `NH.anilinium` | 4.6 | N–H of an anilinium-type ion (N⁺ on an sp2 carbon) | T24_1 (4.63) | yes |
| `NH.amide` | 17 | N–H of an amide | GENERAL | no |
| `NH.imide` | 9 | N–H of an imide | GENERAL | no |
| `NH.sulfonamide` | 10 | N–H of a sulfonamide | GENERAL | no |
| `NH.aniline` | 30 | N–H of an aniline or enamine | GENERAL | no |
| `NH.amine.nh3` | 36 | N–H of ammonia | APP_B | yes |
| `NH.amine.primary` | 36 | N–H of a primary amine | APP_B | yes |
| `NH.amine.secondary` | 40 | N–H of a secondary amine | APP_B | yes |
| `NH.amide-ion` | 99 | N–H of an amide ion (not acidic) | GENERAL | no |
| `SH.thiol` | 10.3 | S–H of a thiol | APP_B, T17_1, S18_8 | yes |
| `SH.thiol.benzylic` | 9.4 | S–H of an allylic/benzylic thiol | APP_B (benzyl mercaptan) | yes |
| `SH.thiophenol` | 6.6 | S–H of a thiophenol or enethiol | APP_B | yes |
| `SH.h2s` | 7.0 | S–H of H2S | GENERAL | no |
| `SH.sulfonium` | −7 | S–H of a protonated thiol or sulfide | GENERAL | no |
| `CH.hcn` | 9.31 | C–H of HCN | T2_3 | yes |
| `CH.alkyne` | 25 | C–H of a terminal alkyne | T9_1, APP_B | yes |
| `CH.alpha.aldehyde` | 17 | C–H alpha to an aldehyde | T22_1 | yes |
| `CH.alpha.ketone` | 19 | C–H alpha to a ketone | T22_1 (acetone 19.3) | yes |
| `CH.alpha.acid-chloride` | 16 | C–H alpha to an acid chloride | T22_1 | yes |
| `CH.alpha.thioester` | 21 | C–H alpha to a thioester | T22_1 | yes |
| `CH.alpha.ester` | 25 | C–H alpha to an ester | T22_1 | yes |
| `CH.alpha.nitrile` | 25 | C–H alpha to a nitrile | T22_1 | yes |
| `CH.alpha.amide` | 30 | C–H alpha to an amide | T22_1 | yes |
| `CH.alpha.carboxylic` | 25 | C–H alpha to a carboxylic acid or carboxylate | GENERAL (treated like an ester) | no |
| `CH.alpha.nitro.0` | 10.3 | C–H of a nitromethyl group | APP_B | yes |
| `CH.alpha.nitro.1` | 8.5 | C–H of a primary nitroalkane CH2 | APP_B | yes |
| `CH.alpha.nitro.2` | 7.7 | C–H of a secondary nitroalkane CH | APP_B | yes |
| `CH.alpha.sulfoxide` | 35 | C–H alpha to a sulfoxide | APP_B | yes |
| `CH.alpha.sulfone` | 28 | C–H alpha to a sulfone | APP_B | yes (unbuildable in v1) |
| `CH.alpha.ketone+ketone` | 9 | C–H between two ketones | T22_1, APP_B | yes |
| `CH.alpha.ester+ketone` | 11 | C–H between a ketone and an ester | T22_1 (10.6) | yes |
| `CH.alpha.ester+ester` | 13 | C–H between two esters | T22_1 (12.9) | yes |
| `CH.alpha.nitrile+nitrile` | 11.2 | C–H between two nitriles | APP_B | yes |
| `CH.alpha.aldehyde+ketone` | 5.8 | C–H between an aldehyde and a ketone | APP_B | yes |
| `CH.alpha.ketone+nitro` | 5.1 | C–H between a ketone and a nitro group | APP_B | yes |
| `CH.alpha.ester+nitro` | 5.8 | C–H between an ester and a nitro group | APP_B | yes |
| `CH.alpha.ketone+sulfoxide` | 10.0 | C–H between a ketone and a sulfoxide | APP_B | yes |
| `CH.alpha.nitro+nitro+nitro` | 0.1 | C–H of trinitromethane | APP_B | yes |
| `CH.vinylic` | 44 | vinylic C–H | T9_1 | yes |
| `CH.allylic.1` | 41 | allylic, propargylic or benzylic C–H | APP_B (toluene) | no |
| `CH.allylic.2` | 34 | C–H flanked by two pi systems | APP_B (Ph2CH2) | no |
| `CH.allylic.3` | 32 | C–H flanked by three pi systems | APP_B (Ph3CH) | no |
| `CH.alkane` | 60 | alkane C–H | T9_1 (CH4 ≈ 60; older editions 50) | yes |
| `CH.carbanion` | 99 | C–H on a carbanion (not acidic) | GENERAL | no |
| `CH.carbocation` | 99 | C–H on a carbocation (not modeled) | GENERAL | no |
| `XH.other` | 99 | hydrogen in an environment this course does not tabulate | GENERAL | no |

`PKA_TEXT_ONLY` (quiz text, never classified; unbuildable rings or hypervalent S): CH3SO3H −1.8 (APP_B); pyridinium 5.25, imidazolium 6.95, pyrrolium 0.4, pyrimidinium 1.3 (T24_1); p-substituted phenols NH2 10.46, CH3 10.17, Cl 9.38, CHO 7.9, NO2 7.15 (T17_1); p-substituted anilinium NH2 6.15, OCH3 5.34, CH3 5.08, Cl 3.98, Br 3.86, CN 1.74, NO2 1.00 (T24_2); cyclopentadiene 15.0, fluorene 23 (APP_B); nonafluoro-tert-butyl alcohol 5.4 (T17_1).

### 10.3 `PKA_MOD` — modifiers (added to the class base; every row is a fixed number)

Carboxylic acid (`OH.carboxylic`, base 4.8; result clamped to [0.2, 5.2]). `Cα` = the carbon bonded to the carboxyl carbon; α-substituents = neighbours of `Cα` other than the carboxyl C:

| modifier key | condition | Δ | resulting pKa (verified value) | source |
|---|---|---|---|---|
| `formic` | carboxyl C carries an H (no Cα) | −1.1 | 3.7 | APP_B |
| `arylvinyl` | Cα has a bond of order ≥ 2 to a C | −0.6 | 4.2 (benzoic, acrylic) | APP_B, T20_3 |
| `aF1` | one α-F | −2.1 | 2.7 | APP_B |
| `aCl1` | one α-Cl | −2.0 | 2.8 | APP_B |
| `aBr1` | one α-Br | −1.9 | 2.9 | APP_B |
| `aI1` | one α-I | −1.6 | 3.2 | APP_B |
| `aCl2` | two α-Cl | override → 1.3 | 1.3 | APP_B |
| `aCl3` | three α-Cl | override → 0.5 | 0.5 | APP_B |
| `aF3` | three α-F | override → 0.5 | 0.5 (T20.3: 0.23) | APP_B |
| other multi-halogen | any other count/mix | Σ single Δ, clamp | — | `verified: false` |
| `aOH` | α-O bearing H | −1.0 | 3.8 | T20_3 (glycolic 3.84) |
| `aOR` | α-O bonded to C | −1.2 | 3.6 | APP_B |
| `aCN` | α-C≡N | −2.3 | 2.5 | APP_B |
| `aNO2` | α-nitro N⁺ | −3.5 | 1.3 | APP_B |
| `aCO` | α-C(=O) that is an aldehyde/ketone | −2.4 | 2.4 (pyruvic) | APP_B |
| `aCOOH` | α-C(=O)OH (malonic) | −2.0 | 2.8 | APP_B |
| `oxalic` | Cα is itself a carboxyl carbon | override → 1.2 | 1.2 | APP_B |
| `bX` | a halogen on a carbon bonded to Cα (β) | −0.8 | 4.0 | APP_B (β-Br) |
| `tert` | Cα has three carbon neighbours besides the carboxyl C | +0.2 | 5.0 | APP_B |

More than one non-halogen modifier at once ⇒ `verified: false` for the site. Peracid (`OH.peracid` 8.2): `formic` → 7.1 (APP_B, verified).

Alcohol (`OH.alcohol.*`, base by degree = number of carbon neighbours of the carbinol carbon: 0 methanol, 1 primary, 2 secondary, 3 tertiary):

| key | condition | Δ | check | source |
|---|---|---|---|---|
| `bF{n}` | n fluorines on carbons bonded to the carbinol C | −1.2·n | CF3CH2OH 16.0 − 3.6 = 12.4 (T17.1: 12.43) | T17_1 |
| `bCl1` / `bCl2` / `bCl3` | 1 / 2 / 3 β-Cl | −1.7 / −3.1 / −3.8 | 14.3 / 12.9 / 12.2 | APP_B |
| `bBr{n}`, `bI{n}` | β-Br / β-I | as Cl | — | `verified: false` |
| `allylic` | carbinol C bonded to a C with a bond of order ≥ 2 | −0.5 | allyl 15.5, benzyl 15.4 | APP_B |

A carbon with two O–H groups → `OH.gemdiol` (no degree). Result clamped to [5.0, 18.0].

Alpha C–H two-group pair lookup uses the ids above; an unlisted pair → `min(single values) − 8`, `verified: false`, id `CH.alpha.<a>+<b>` (sorted). Three groups: all nitro → `CH.alpha.nitro+nitro+nitro`; otherwise `min(single) − 12`, `verified: false`. Allylic count `n` = number of neighbouring carbons with a bond of order ≥ 2 to another carbon, capped at 3.

### 10.4 Site predicates (shared by 10.5 and 10.7)

```
carbonylOf(c): c.el === 'C' and ∃ bond (c, o) order 2 with o.el === 'O'        // any charge on O
carbonylKind(c): among neighbours of c other than the =O, first match in this order:
   F/Cl/Br/I → 'acid-chloride' ; S → 'thioester' ; N → 'amide' ;
   O single-bonded with another heavy neighbour → 'ester' ; O single-bonded (H or charge −1) → 'carboxylic' ;
   otherwise hydrogens[c] >= 1 → 'aldehyde' else 'ketone'
nitrileC(c): c.el === 'C' and ∃ bond order 3 to an N
nitroN(n): n.el === 'N' and n.charge === +1 and ∃ bond order 2 to O and ∃ bond order 1 to an O with charge −1
sulfinylS(s): s.el === 'S' and s.charge === +1 and ∃ single bond to an O with charge −1      // DMSO drawing
hasCCpi(c): c.el === 'C' and ∃ bond order >= 2 to a C
activating(n): carbonylOf(n) → carbonylKind(n) ; nitrileC(n) → 'nitrile' ; nitroN(n) → 'nitro' ; sulfinylS(n) → 'sulfoxide' ; else null
carbonDegree(c) = number of C neighbours of c
```

### 10.5 `hydrogenSites(g, info): HydrogenSite[]`

For every atom `X` (id order) with `info[X].hydrogens > 0`: `env = classify(X)`; emit `info[X].hydrogens` sites with `slot = 0..n−1`, the first `hPos.length` slots carrying `explicitPos = hPos[slot]`; all share `parentId = X`, `classId`, `classKey = classId + '|' + modifiers.sort().join(',')`, `pKa`, `label`, `source`, `verified`. `classKey` never contains the atom id, so butanone's two α-carbons share one key.

`classify(X)` — first matching rule wins, per element:

**F, Cl, Br, I** → `HX.<el>`.

**O**
1. `charge === +1`: neighbours all H (0 heavy) → `OH.oxonium.hydronium`; a bond of order 2 to a C → that C is bonded to an N → `OH.oxonium.amide`; to another O → `OH.oxonium.carboxylic`; else `OH.oxonium.carbonyl`; one heavy neighbour → `OH.oxonium.alcohol`; two → `OH.oxonium.ether`.
2. neighbour C with `carbonylOf` and X single-bonded to it → `OH.carboxylic` (+ modifiers 10.3; `carbonylKind` of that C must be `'carboxylic'`; if it is another kind, e.g. O–H on an ester is impossible, fall through).
3. neighbour O: that O bonded to a carbonyl C → `OH.peracid` (+ `formic`); else `OH.hydroperoxide`.
4. neighbour N with a bond of order 2 to a C → `OH.oxime`.
5. neighbour C with `hasCCpi` → `OH.enol`.
6. no heavy neighbour: charge 0 → `OH.water`; charge −1 (hydroxide) → `XH.other` (not an acidic site; chemistry review minor 11).
7. neighbour C bearing a second O–H → `OH.gemdiol`.
8. else `OH.alcohol.<degree>` + modifiers.

**N**
1. `charge === +1`: neighbour C with `hasCCpi` → `NH.anilinium`; else by `carbonDegree(X)`: 0 → `nh4`, 1 → `primary`, 2 → `secondary`, 3 → `tertiary`.
2. `charge === −1` → `NH.amide-ion`.
3. neighbours that are carbonyl C: two → `NH.imide`; one → `NH.amide`.
4. neighbour S with a double-bonded O or `sulfinylS` → `NH.sulfonamide`.
5. neighbour C with `hasCCpi` → `NH.aniline`.
6. `carbonDegree` 0 → `NH.amine.nh3`; 1 → `NH.amine.primary`; else `NH.amine.secondary`.

**S**
1. `charge === +1` → `SH.sulfonium`.
2. no heavy neighbour → `SH.h2s`.
3. neighbour C with `hasCCpi` → `SH.thiophenol`.
4. neighbour C bonded to a C with `hasCCpi` → `SH.thiol.benzylic`.
5. else `SH.thiol`.

**C**
1. `charge === −1` → `CH.carbanion`; `charge === +1` → `CH.carbocation`.
2. `nitrileC(X)` and `hydrogens === 1` → `CH.hcn`.
3. a bond of order 3 to a C → `CH.alkyne`.
4. `info[X].pi >= 1` → `CH.vinylic` (also the formyl C–H of an aldehyde). This rule is evaluated BEFORE the activating-neighbour rule on purpose: an sp2 C–H next to a carbonyl, nitrile or nitro group (propenal C2–H, acrylonitrile, acrylic acid, glyoxal, any enone) is vinylic, not an α-hydrogen — McMurry's α-hydrogens (22.1) are on sp3 carbons and only those can be removed to an enolate.
5. `G = neighbours n with activating(n) !== null` (X is sp3 here by rule 4), kinds sorted; if `G.length === 1` → `CH.alpha.<kind>` (nitro: `CH.alpha.nitro.<carbonDegree(X)>`, capped at 2); `=== 2` → pair id; `>= 3` → triple rule.
6. `n = count of neighbouring C with hasCCpi or a triple bond`, `n >= 1` → `CH.allylic.<min(n,3)>`.
7. else `CH.alkane`.

Negative fixtures for rule order 4 → 5 (`test/chem/acidity.test.ts`): propenal `C=CC=O`, acrylonitrile `C=CC#N`, acrylic acid `C=CC(=O)O`, glyoxal `O=CC=O` — no `HydrogenSite` has a `classId` starting with `CH.alpha.`; every C–H is `CH.vinylic` 44.

**P, H, anything else** → `XH.other`.

### 10.6 Most acidic hydrogen, equivalence, validation

`acidity(g, info)`: `hydrogens = hydrogenSites`, `basicSites = basicSites`, `min = min pKa`, `mostAcidic = sites with pKa ≤ min + PKA_TIE` (0.05), `mostBasic = sites with pKaH ≥ max − PKA_TIE`. Equivalence = identical `classKey` (identical pKa by construction); an accidental cross-class tie (ester α-H 25 vs terminal alkyne 25) is also accepted because the model cannot rank it. Diastereotopic H on one parent are not distinguished.

Content validation (`src/content/validate.ts`, 05-content.md) for every `select-atom` challenge with `most-acidic-h` / `most-basic-*`: reject when any site of the answer class has `verified: false` (warning `{ kind: 'unverified-pka', classId }`), and reject when the second-lowest DISTINCT pKa over ALL sites (verified or not) is less than `min + PKA_MIN_MARGIN` (3). `unverifiedWarnings(a: AcidityAnalysis): Warning[]` returns one `unverified-pka` warning per distinct unverified `classId` among `mostAcidic ∪ mostBasic`; `analyze` appends them.

Consequence for the C2-05 pool: propanamide (answer `NH.amide` 17, unverified) is rejected and must not be shipped as a graded select-H item; glycolamide (alcohol 15.5 vs amide 17) is rejected on margin.

### 10.7 `basicSites(g, info): BasicSite[]` and the `BASIC` table

Candidates: atoms with `lonePairs > 0 && charge !== +1`, or `charge === −1`. First matching rule per element:

| id | condition | pKaH | source | verified |
|---|---|---|---|---|
| `B.C.acetylide` | C⁻ with a triple bond | 25 | T9_1 | yes |
| `B.C.vinyl` | C⁻ with `pi ≥ 1` | 44 | T9_1 | yes |
| `B.C.enolate` | C⁻ bonded to a carbonyl C (the C⁻ resonance form of an enolate; the O⁻ form is `B.O.enolate`, same value) | 19 | T22_1 | yes |
| `B.C.alkyl` | other C⁻ | 60 | T9_1 | yes |
| `B.N.amide-ion.primary` | N⁻ with ≤ 1 C neighbour | 36 | APP_B | yes |
| `B.N.amide-ion.secondary` | N⁻ with 2 C neighbours (LDA) | 40 | APP_B | yes |
| `B.N.amide` | N bonded to a carbonyl C | −1 | GENERAL (MM 24.3: "nonbasic") | no |
| `B.N.nitrile` | N with a triple bond | −10 | GENERAL | no |
| `B.N.imine` | N with a double bond | 7 | GENERAL | no |
| `B.N.conjugated` | N bonded to a C with `hasCCpi` (aniline, enamine) | 4.6 | T24_1 (anilinium) | yes |
| `B.N.amine.nh3` / `.primary` / `.secondary` / `.tertiary` | by `carbonDegree` 0/1/2/3 | 9.26 / 10.6 / 11.0 / 10.8 | T24_1 | yes |
| `B.O.hydroxide` | O⁻, no heavy neighbour | 15.74 | T2_3 | yes |
| `B.O.carboxylate` | O (either one) on a carboxyl C whose other O is O⁻ or O–H … i.e. `carbonylKind === 'carboxylic'` and molecule has that O⁻ | 4.8 | APP_B | yes |
| `B.O.phenoxide` | O⁻ on a C with `aromatic === true` (`analyze` runs `perceiveAromaticity` before `acidity`, 02-chemistry-core §15 step 2; a phenoxide drawn in Kekulé form on the grid is perceived) | 10 | APP_B (phenol) | yes |
| `B.O.enolate` | O⁻ on a non-aromatic C with `hasCCpi` — the O⁻ resonance form of an enolate | 19 | T22_1 (the ketone α-C–H value; same ion as `B.C.enolate`, so `CC([O-])=C` and `CC(=O)[CH2-]` report the same conjugate-acid pKa, McMurry 2.5/22.1) | yes |
| `B.O.alkoxide.<degree>` | other O⁻: methoxide 15.5, primary 16.0, secondary 17.1, tertiary 18.0 | | APP_B, T17_1 | yes |
| `B.O.amide` | O double-bonded to a C bonded to N | −1 | GENERAL | no |
| `B.O.ester` | O (either) of an ester group | −6.5 | GENERAL | no |
| `B.O.acid` | O (either) of a carboxylic acid group | −6 | GENERAL | no |
| `B.O.carbonyl` | O double-bonded to C (aldehyde/ketone) | −7 | GENERAL | no |
| `B.O.water` | O with no heavy neighbour, charge 0 | −1.7 | GENERAL | no |
| `B.O.alcohol` | O with one heavy neighbour | −2.4 | GENERAL | no |
| `B.O.ether` | O with two heavy neighbours | −3.5 | GENERAL | no |
| `B.S.thiolate` | S⁻ | 10.3 | APP_B | yes |
| `B.S.thiol` | neutral S (thiol, sulfide) | −7 | GENERAL | no |
| `B.X.halide.<el>` | halide ion: F 3.2, Cl −7, Br −9, I −10 | | as `HX.*` | F/Cl yes, Br/I no |
| `B.X.bound` | halogen in C–X | −10 | GENERAL | no |
| `B.other` | anything else (O⁻ on S⁺, nitro O⁻, P) | −10 | GENERAL | no |

`BasicSite.label` = "lone pair on <description>", e.g. "lone pair on a primary amine nitrogen"; `classKey = classId + '|'`. The `most-basic-n` selector restricts candidates to `el === 'N'` before taking the maximum.

### 10.8 `predictAcidBase(acid, base)` (McMurry 2.9)

```
infoA = atomInfo(acid, hA); infoB = atomInfo(base, hB)
sA = hydrogenSites(acid, infoA); if empty → throw Error('acid has no hydrogens')
sB = basicSites(base, infoB);   if empty → throw Error('base has no basic site')
a = min pKa over sA (site hA); b = max pKaH over sB (site hB)
delta = b − a; favorsProducts = delta > 0
approx = (!hA.verified || !hB.verified) ? '≈' : ''
text = `Reactant acid pKa ${approx}${fmt(a)} (${hA.label}) → product conjugate acid pKa ${approx}${fmt(b)} (${hB.label}). ` +
       `Equilibrium favors the weaker acid (higher pKa), so the reaction ${favorsProducts ? 'favors products' : 'favors reactants'} (Keq ≈ 10^${fmt(delta)}).`
return { pKaAcid: a, pKaConjugate: b, delta, favorsProducts, text }
```
`fmt` prints at most two decimals, no trailing zeros, ASCII minus. Yes/no quiz answers are `favorsProducts`; authoring rule |delta| ≥ 2.

Fixtures (C2-07): CH3CO2H + OH⁻ yes (4.8 → 15.74); HC≡CH + OH⁻ no (25 → 15.74); CH3OH + NH2⁻ yes (15.5 → 36); HCN + CH3CO2⁻ no (9.31 → 4.8); CH3SH + EtO⁻ yes (10.3 → 16.0); NH4⁺ + CH3CO2⁻ no (9.26 → 4.8); acetone + EtO⁻ no (19 → 16.0); acetone + LDA yes (19 → 40); phenol (`OC1=CC=CC=C1`) + OH⁻ yes (10 → 15.74); HCl + H2O yes (−7 → ≈−1.7, text carries "≈").

---

## 11. Test matrix

Columns: R/S (from tags via §5 and, where a grid layout is given, from positions via §2), E/Z, notable hybridizations, most acidic H (class, pKa), most basic site (class, pKaH). SMILES atom numbers are 1-based.

| # | molecule | SMILES | R/S | E/Z | hybridization | most acidic H | most basic site |
|---|---|---|---|---|---|---|---|
| 1 | (R)-2-butanol | `C[C@@H](O)CC` | C2 R | – | all C sp3, O sp3 bent | `OH.alcohol.secondary` 17.1 | `B.O.alcohol` −2.4 (unv) |
| 2 | (S)-2-butanol, grid Me(−1,0,0) C2(0,0,0) O(0,0,1) C3(0,1,0) C4(0,2,0) | `C[C@H](O)CC` | C2 S, shape octant | – | as 1 | as 1 | as 1 |
| 3 | (S)-2-bromobutane | `C[C@H](Br)CC` | C2 S | – | Br sp3 terminal | `CH.alkane` 60 (all 9 H one class) | `B.X.bound` −10 (unv) |
| 4 | (S)-alanine | `N[C@@H](C)C(=O)O` | C2 S | – | N sp3 trig. pyr., C4 sp2, O5 sp2 terminal, O6 conjugated sp2 bent | `OH.carboxylic` 4.8 | `B.N.amine.primary` 10.6 |
| 5 | (R)-lactic acid | `C[C@@H](O)C(=O)O` | C2 R | – | | `OH.carboxylic|aOH` 3.8 | `B.O.alcohol` −2.4 (unv) |
| 6 | (R)-glyceraldehyde | `O=C[C@H](O)CO` | C3 R | – | C2 sp2 | `OH.alcohol.primary` 16.0 (runner-up `CH.alpha.aldehyde` 17: margin 1, not a valid select-H item) | `B.O.alcohol` −2.4 |
| 7 | meso-2,3-dibromobutane | `C[C@H](Br)[C@H](Br)C` | C2 S, C4 R; meso = true, chiral = false | – | | `CH.alkane` 60 | `B.X.bound` |
| 8 | (2R,3R)-2,3-dibromobutane | `C[C@@H](Br)[C@H](Br)C` | R, R; chiral | – | | | |
| 9 | (R)-3-methylhexane | `CCC[C@H](C)CC` | C4 R (propyl > ethyl at sphere 3) | – | | `CH.alkane` 60 | none (no lone pairs) |
| 10 | cis-1-bromo-2-methylcyclohexane (chair, both up) | `C[C@H]1CCCC[C@H]1Br` | C2 S, C7 R; ring faces equal | – | | | |
| 11 | trans-1,2-dimethylcyclohexane | `C[C@@H]1CCCC[C@H]1C` | R, R; chiral | – | | | |
| 12 | cis-1,2-dimethylcyclohexane | `C[C@H]1CCCC[C@H]1C` | S, R; meso | – | | | |
| 13 | cis-1,4-dimethylcyclohexane | `C[C@H]1CC[C@@H](C)CC1` | C2, C5 NOT_CENTER; chiral = false, meso = false | – | | | |
| 14 | meso-tartaric acid | `OC(=O)[C@H](O)[C@H](O)C(=O)O` | C4 R, C6 S; meso | – | | `OH.carboxylic|aOH` 3.8 (both, one class) | |
| 15 | L-threonine | `C[C@@H](O)[C@H](N)C(=O)O` | C2 R, C4 S | – | | `OH.carboxylic` 4.8 | `B.N.amine.primary` 10.6 |
| 16 | (S)-2-methylcyclohexanone | `C[C@H]1CCCCC1=O` | C2 S | – | C7 sp2 | `CH.alpha.ketone` 19 (C2–H and C6–H2, one class) | `B.O.carbonyl` −7 (unv) |
| 17 | (R)-3-methylcyclohexene | `C[C@H]1C=CCCC1` | C2 R | bond C3=C4 RING | C3, C4 sp2 | `CH.allylic.1` 41 (unv) | none |
| 18 | (E)-but-2-ene, grid (0,1,0)(0,0,0)(1,0,0)(1,−1,0) | `C/C=C/C` | – | E (trans) | C2, C3 sp2 120° | `CH.allylic.1` 41 (unv) | none |
| 19 | (Z)-2-chloro-2-butene | `C/C=C(\Cl)C` | – | Z | Cl sp3 terminal | `CH.allylic.1` 41 (unv) | `B.X.bound` |
| 20 | (E)-3-methylpent-2-ene | `C/C=C(\C)CC` | – | E (ethyl > methyl on C3) | | | |
| 21 | (2E,4E)-hexa-2,4-diene | `C/C=C/C=C/C` | – | E, E | | `CH.allylic.1` 41 (unv) | |
| 22 | (E)-1,2-dichloroethene | `Cl/C=C/Cl` | – | E | | `CH.vinylic` 44 | `B.X.bound` |
| 23 | 2-methylbut-2-ene | `CC=C(C)C` | – | NO_EZ (C3) | | | |
| 24 | propene | `CC=C` | – | NO_EZ | C1, C2 sp2; C3 sp3 | `CH.allylic.1` 41 (unv) | |
| 25 | 3-hydroxypropanoic acid | `OC(=O)CCO` | – | – | | `OH.carboxylic` 4.8; runner-up 16.0 | `B.O.alcohol` −2.4 (unv) |
| 26 | 2-mercaptoethanol | `OCCS` | – | – | S sp3 bent | `SH.thiol` 10.3; runner-up 16.0 | `B.O.alcohol` −2.4 |
| 27 | 1-butyne | `CCC#C` | – | – | C3, C4 sp; C1, C2 sp3 | `CH.alkyne` 25; runner-up `CH.allylic.1` 41 | none |
| 28 | 2,4-pentanedione | `CC(=O)CC(=O)C` | – | – | | `CH.alpha.ketone+ketone` 9; runner-up 19 | `B.O.carbonyl` −7 |
| 29 | propargyl alcohol | `OCC#C` | – | – | | `OH.alcohol.primary|allylic` 15.5; runner-up 25 | `B.O.alcohol` |
| 30 | acetic acid | `CC(=O)O` | – | – | O4 conjugated sp2 | `OH.carboxylic` 4.8; runner-up `CH.alpha.carboxylic` 25 | `B.O.acid` −6 (unv) |
| 31 | 2-ammonioethanol | `OCC[NH3+]` | – | – | N sp3 tetrahedral | `NH.ammonium.primary` 10.6; runner-up 16.0 | `B.O.alcohol` −2.4 |
| 32 | butanone | `CCC(C)=O` | – | – | | `CH.alpha.ketone` 19 on C2 and C4, ONE classKey; C1 `CH.alkane` 60 | `B.O.carbonyl` |
| 33 | ethylamine | `CCN` | – | – | N sp3 trig. pyr. | `NH.amine.primary` 36 | `B.N.amine.primary` 10.6 |
| 34 | propanamide | `CCC(N)=O` | – | – | N sp2 (conjugated) trigonal planar | `NH.amide` 17 (unv → challenge rejected) | `B.O.amide` −1 / `B.N.amide` −1 tie (unv) |
| 35 | 2-aminoethanol | `OCCN` | – | – | | `OH.alcohol.primary` 16.0 | `B.N.amine.primary` 10.6 vs O −2.4 |
| 36 | 4-aminobutan-2-one | `CC(=O)CCN` | – | – | | `CH.alpha.ketone` 19 | `B.N.amine.primary` 10.6 vs `B.O.carbonyl` −7 |
| 37 | 3-aminopropanamide | `NCCC(N)=O` | – | – | amide N sp2, amine N sp3 | `NH.amide` 17 (unv) | `B.N.amine.primary` 10.6 vs `B.N.amide` −1 |
| 38 | acetonitrile | `CC#N` | – | – | C1 sp3, C2 sp linear, N sp terminal | `CH.alpha.nitrile` 25 | `B.N.nitrile` −10 (unv) |
| 39 | acetamide | `CC(N)=O` | – | – | N sp2 trigonal planar (conjugated), C2 sp2 | `NH.amide` 17 (unv) | |
| 40 | DMSO | `C[S+](C)[O-]` | – | – | S⁺ sp3 trigonal pyramidal; formal charges S +1, O −1 | `CH.alpha.sulfoxide` 35 | `B.other` −10 (unv) |
| 41 | tert-butyl cation | `C[C+](C)C` | – | – | C2 sp2 trigonal planar, formalCharge +1 | `CH.alkane` 60 | none |
| 42 | methyl anion | `[CH3-]` | – | – | sp3 trigonal pyramidal, formalCharge −1 | `CH.carbanion` 99 | `B.C.alkyl` 60 |
| 43 | ammonium | `[NH4+]` | – | – | sp3 tetrahedral, formalCharge +1 | `NH.ammonium.nh4` 9.26 | none |
| 44 | hydronium | `[OH3+]` | – | – | sp3 trigonal pyramidal, +1 | `OH.oxonium.hydronium` −1.7 (unv) | none |
| 45 | methoxide | `C[O-]` | – | – | O sp3, −1 | `CH.alkane` 60 | `B.O.alkoxide.methoxide` 15.5 |
| 46 | propenal (acrolein) | `C=CC=O` | – | NO_EZ (C1 =CH2) | C1, C2, C3 sp2; O sp2 terminal | `CH.vinylic` 44 (all four C–H, one classKey; C2–H is NOT `CH.alpha.aldehyde` 17 — §10.5 rule 4 precedes rule 5) | `B.O.carbonyl` −7 (unv) |
| 47 | acrylonitrile | `C=CC#N` | – | NO_EZ | C3 sp, N sp terminal | `CH.vinylic` 44 (no `CH.alpha.nitrile` site) | `B.N.nitrile` −10 (unv) |
| 48 | acrylic acid | `C=CC(=O)O` | – | NO_EZ | | `OH.carboxylic|arylvinyl` 4.2; runner-up `CH.vinylic` 44 (no `CH.alpha.carboxylic` site) | `B.O.acid` −6 (unv) |
| 49 | acetone enolate, C⁻ form | `CC(=O)[CH2-]` | – | – | C3 sp2 (conjugated C⁻, row 22 of §8.4) | `CH.alpha.ketone` 19 (C1–H3) | `B.C.enolate` 19 |
| 50 | acetone enolate, O⁻ form | `CC([O-])=C` | – | NO_EZ | O⁻ on sp2 C | `CH.vinylic` 44 (=CH2) and `CH.allylic.1` 41 (CH3) → most acidic `CH.allylic.1` 41 (unv) | `B.O.enolate` 19 (same value as row 49) |
| 51 | phenoxide (Kekulé) | `[O-]C1=CC=CC=C1` | – | – (aromatic C=C are skipped by §7 step 2) | ring C sp2, `aromatic` after `perceiveAromaticity` | `CH.vinylic` 44 | `B.O.phenoxide` 10 (not 19: the C bearing O⁻ is aromatic) |

Grid builds tested end to end (extract → analyzeStereo): rows 2, 7 (the 05 §5.3 `meso-2-3-dibromobutane` layout `meso_a` and its mirror `meso_b` of §6.4, both `meso = true`), 8 (`rr` of §6.4; `ss` gives (S,S)), 10 (four chair builds), 13 (cis on either face), 18 (five but-2-ene layouts), plus the T-shaped 2-butanol build (UNSPECIFIED, `suggestedHPositions` = (0,0,±1), warning `planar-center` T) and the square-planar build (warning `planar-center` square-planar). Every one of these builds first passes `assertBuildable` (§6.4); the expected labels are the `test2.py`/`test3c.py` RDKit outputs, never hand-derived.

---

## 12. Contract additions (exact TypeScript; not in `types.ts`)

```ts
// src/chem/cip.ts
export const CIP_SPHERE_CAP = 500;
/** cipRank returns CipRank plus capHit (assignable to CipRank; ChemApi check still passes). */
export type CipRankResult = CipRank & { readonly capHit: boolean };
export function cipRank(g: MoleculeGraph, hydrogens: readonly number[], center: number, exclude?: number): CipRankResult;
export function compareLigands(ctx: CipCtx, a: DNode, b: DNode): -1 | 0 | 1;

// src/chem/stereo.ts
export const EPS: number;                       // 1e-9
export const RING_EZ_EXEMPT_MAX: number;        // 7
export const STEREO_TEXT: { /* §2.4 */ };
export function parityInOrder(g: MoleculeGraph, hydrogens: readonly number[], atom: number, order: readonly (number | 'H')[]): 1 | -1 | 0 | null;
export type AlkeneSides =
  | { readonly ok: true; readonly u: Vec3; readonly ends: readonly [AlkeneEnd, AlkeneEnd] }
  | { readonly ok: false; readonly label: 'COLLINEAR' | 'NOT_PLANAR' | 'TWISTED'; readonly atom?: number };
export interface AlkeneEnd { readonly atom: number; readonly subs: readonly (number | 'H')[]; vec(s: number | 'H'): Vec3 | undefined; }
export function alkeneSides(g: WorldGraph, hydrogens: readonly number[], bondIndex: number): AlkeneSides;
export function tagsFromPositions(g: WorldGraph, hydrogens: readonly number[]): MoleculeGraph;   // tet/ez on every non-planar centre and planar-checked alkene
export function labelTargetStereo(g: MoleculeGraph, hydrogens: readonly number[]): { centers: Map<number, CenterLabel>; bonds: Map<number, 'E' | 'Z' | 'NO_EZ'> };
export function stereoWarnings(s: StereoAnalysis): Warning[];
export function ringFace(g: WorldGraph, ring: readonly number[], atom: number): 1 | -1 | 0;

// src/chem/stereo-compare.ts
export function permSign(from: readonly (number | 'H')[], to: readonly (number | 'H')[]): 1 | -1;
export interface StereoCompareResult {
  readonly verdict: 'SAME' | 'ENANTIOMER' | 'DIASTEREOMER' | 'UNSPECIFIED' | 'INVALID_GEOMETRY';
  readonly differingCenters: readonly number[];   // target ids
  readonly differingBonds: readonly number[];     // target bond indices
  readonly offending?: { readonly atom?: number; readonly bond?: number };  // student ids
}
export function compareStereo(target: MoleculeGraph, student: MoleculeGraph, mapping: readonly number[]): StereoCompareResult;

// src/chem/hybridization.ts
export function geometry(info: AtomInfo): Geometry;
export const ANGLE_NOTES: readonly { readonly when: (i: AtomInfo) => boolean; readonly note: string }[];

// src/chem/charge.ts
export const CHARGE_REFUSAL: { hBlock: string; unsupported(el: string, q: number): string; valence(el: string, q: number, max: number): string };
export function withCharge(g: MoleculeGraph, atom: number, charge: Charge): MoleculeGraph;   // throws on refusal

// src/chem/acidity.ts
export interface PkaEntry { readonly id: string; readonly pKa: number; readonly label: string; readonly source: string; readonly verified: boolean; }
export const PKA: Readonly<Record<string, PkaEntry>>;
export const PKA_TEXT_ONLY: Readonly<Record<string, PkaEntry>>;
export const PKA_MOD: Readonly<Record<string, { readonly delta?: number; readonly override?: number; readonly verified: boolean; readonly source: string }>>;
export const BASIC: Readonly<Record<string, PkaEntry>>;   // pKa field = pKaH; ids include 'B.O.enolate' (19) and 'B.O.phenoxide' (10), §10.7
export function unverifiedWarnings(a: AcidityAnalysis): Warning[];
```

`CipRankResult` is assignable to `CipRank`, `withCharge` in `charge.ts` wraps `graph.withCharge`; `ChemApi` conformance checks (`Pick<ChemApi, …>`) pass unchanged.

---

## 13. Unresolved questions

1. `withCharge` is listed for both `graph.ts` (WP-01) and `charge.ts` (WP-03) in 00-contracts §5. Resolved here as: `charge.ts` validates then delegates to `graph.ts`; confirm that WP-01 keeps the unchecked edit under the same name (a rename to `graph.setCharge` would be cleaner).
2. `CHARGE_REFUSAL` duplicates two `REFUSAL_TEXT` strings because `src/chem` must not import `src/world`; the cross-package equality test lives in WP-06. Alternatively move both into `src/util/strings-pure.ts`.
3. Carboxylic α-OH modifier: research gave −1.1 (→ 3.7) without a citation; Table 20.3 lists glycolic acid 3.84, so this doc uses −1.0 (→ 3.8). Either value keeps every margin; confirm.
4. Ketone α-C–H uses 19 (Table 22.1) while McMurry 2.10 quotes acetone 19.3; the acetone + ethoxide prediction is "no" with both.
5. Propanamide is in the research C2-05 pool but its answer class (`NH.amide` 17) is unverified, so §10.6 rejects it; 05-content.md must drop it or replace it with a verified item (e.g. ethylamine).
6. Meso for molecules with an `UNSPECIFIED` centre is defined as `false` and `chiral` as "≥1 R/S": acceptable for the panel, but the `meso` quiz should only use fully specified builds.
7. `StereoAnalysis` has no `warnings` field; `stereoWarnings` / `unverifiedWarnings` are separate helpers that `analyze` (WP-12) must call. If the facade owner prefers, the contract could add `warnings` to `StereoAnalysis` and `AcidityAnalysis`.
8. Extending the allylic class to propargylic C–H (41, unverified) is a decision made here so propargyl alcohol ranks as the research expects (15.5 vs 25); it changes no graded answer.
9. `test3c.py`'s comment calls its second 2-butanol placement "R built with a different placement", but the script prints `R_but2 label: S` and `R vs R2: ENANTIOMER`; §2.5 and §6.4 now record the script's output and add the genuine mirror build (O at (1,1,0)) for the SAME row. The script's `meso_a`/`meso_b` names are likewise wrong (they are (R,R)/(S,S) and unbuildable); §6.4 uses the 05 §5.3 layouts instead. The script should be updated to match (not part of this document).
10. Step 6 of §7 needs `compareStereo` inside `analyzeStereo`, which inverts the `stereo-compare → stereo` import direction listed in §0; the two files may be merged or `analyzeStereo` moved to `stereo-compare.ts` at implementation time. Public names and the `ChemApi` are unaffected.
