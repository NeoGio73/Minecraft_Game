# Research: acids-bases-hybrid

_Source: workflow agent `research:acids-bases-hybrid`._

## Summary

Research and implementation-level design for the OrgoCraft chapter 1-2 features (hybridization/geometry, formal charge and charge tool, pKa rule engine, most-acidic-hydrogen and most-basic-site selection, acid-base reaction prediction, select-atom interaction, quiz panel, and 20 challenges). All McMurry numbers were verified against the OpenStax McMurry 10e source modules on GitHub (openstax.org itself is blocked by the egress proxy): Table 2.3, Appendix B (acidity constants), Table 9.1, Table 17.1, Table 20.3, Table 22.1, Tables 24.1/24.2, the formal-charge table, hybridization sections 1.6-1.10, carbocation structure (7.9), benzene (15.2) and amide planarity (26.4). HF (pKa 3.19) and water's 104.5 degree angle were verified from OpenStax Chemistry 2e. A handful of values McMurry does not tabulate (HBr, HI, H3O+, protonated alcohols/carbonyls, neutral amide N-H, allylic C-H) are general-textbook values and are marked unverified; they only affect ranking margins, never a challenge answer in the supplied list. IMPORTANT: the relayed user message says the user was never asked which topics to include. The topic list in the computed task (and docs/SCOPE.md) is therefore unconfirmed by the user; the spec is written so each topic is an independently switchable module and the challenge pool is data, so topics can be added or dropped after the user is consulted.

## Design specification

# OrgoCraft — Chapters 1–2 engine spec: hybridization/geometry, formal charge, acidity, select-atom challenges, quiz panel

## 0. Scope caveat (read first)

The user's relayed message for this run is: *"Wait, you didn't ask me what topics should be included."* The topic list in the computed task and in `docs/SCOPE.md` was therefore **not confirmed by the user**. This spec is written so that every topic below is an independently switchable module (`features.hybridization`, `features.formalCharge`, `features.acidity`, `features.quiz`) and all challenge content is data (JSON), so the orchestrator can confirm the topic list with the user and add/remove topics without re-architecting. Nothing here should be treated as user-approved scope.

Sources: all McMurry numbers below were read from the OpenStax *Organic Chemistry: A Tenth Edition* source modules (GitHub `openstax/osbooks-organic-chemistry`, module ids given as `mXXXXX`), because openstax.org is blocked from this environment. Section numbers: 1.6 = m00163, 1.8 = m00165, 1.9 = m00166, 1.10 = m00167, 1.12 = m00169, 2.3 = m00020, 2.5 = m00022, 2.7 = m00024, 2.8 = m00025, 2.9 = m00026, 2.10 = m00027, 2.11 = m00028, 7.9 = m00071, 9.7 = m00109, 15.2 = m00182, 17.2 = m00201, 18.8 = m00254, 20.2 = m00231, 22.5 = m00261, 24.2 = m00290, 24.3 = m00291, 24.4 = m00292, 26.4 = m00321, Appendix B = m00030. OpenStax *Chemistry 2e*: Appendix H = m68866, 7.6 = m68742.

---

## 1. Shared data contracts (TypeScript)

These must be reconciled with the chemistry-core contracts task; the names below are the ones this module needs.

```ts
export type Element = 'H'|'C'|'N'|'O'|'S'|'P'|'F'|'Cl'|'Br'|'I';
export type Charge = -1 | 0 | 1;
export type BondOrder = 1 | 2 | 3;

export interface Atom {
  id: number;                 // stable within a graph
  element: Element;
  charge: Charge;             // set by the charge tool; default 0
  pos: [number, number, number]; // lattice coords (integers)
}
export interface Bond { a: number; b: number; order: BondOrder; diagonal?: boolean }
export interface MoleculeGraph { atoms: Atom[]; bonds: Bond[] }

// One entry per heavy atom AND per explicit H block, produced by analyzeAtoms()
export interface AtomInfo {
  id: number; element: Element; charge: Charge;
  neighbors: number[];        // explicit neighbors (heavy atoms + explicit H blocks)
  heavyBondOrderSum: number;  // Σ order over explicit bonds
  implicitH: number;          // auto-filled H count (0 for explicit-H atoms and for H itself)
  sigma: number;              // neighbors.length + implicitH
  pi: number;                 // Σ (order - 1)
  lonePairs: number;          // derived from element+charge (Section 2)
  stericNumber: number;       // sigma + lonePairs, minus 1 if conjugatedLonePair
  conjugatedLonePair: boolean;
  hybridization: 'sp3'|'sp2'|'sp'|'none';
  geometry: 'tetrahedral'|'trigonal pyramidal'|'bent'|'trigonal planar'|'linear'|'terminal'|'none';
  idealAngle: 109.5|120|180|null;
  observedAngleNote?: string; // e.g. "measured ~104.5° in water"
  formalCharge: number;       // = charge by construction (see 3.3)
  valenceError?: string;      // set when heavyBondOrderSum > targetValence
}

export interface HydrogenSite {
  parentId: number;           // heavy atom carrying the H
  explicitAtomId?: number;    // present when the H is an explicit block
  slot?: number;              // 0..n-1 for implicit H on parentId
  pKa: number;
  classId: string;            // e.g. 'OH.carboxylic'
  classKey: string;           // classId + modifier signature; identical key ⇒ identical pKa
  label: string;              // human text: "O–H of a carboxylic acid"
  source: string;             // citation string for feedback panel
}
export interface BasicSite { atomId: number; pKaH: number; classId: string; classKey: string; label: string; source: string }
```

---

## 2. Element tables

### 2.1 Valence electrons (free atom)
`V = { H:1, C:4, N:5, O:6, S:6, P:5, F:7, Cl:7, Br:7, I:7 }`

### 2.2 Target valence (total bond order incl. implicit H) by element and charge — the valence limit used by the bond tool, the H auto-fill and the charge tool

| Element | charge −1 | charge 0 | charge +1 | Notes / McMurry 2.3 table (m00020) |
|---|---|---|---|---|
| H | 0 (hydride) | 1 | 0 (proton) | explicit H blocks only ever have charge 0 in v1 |
| C | 3 (carbanion, +1 LP) | 4 | 3 (carbocation, 0 LP) | C radical (3 bonds, 1 e⁻) not supported in v1 |
| N | 2 (amide ion, 2 LP) | 3 (1 LP) | 4 (ammonium, 0 LP) | matches N⁺ 4 bonds/0 nb, N⁻ 2 bonds/4 nb |
| O | 1 (alkoxide, 3 LP) | 2 (2 LP) | 3 (oxonium, 1 LP) | matches O⁺ 3/2, O⁻ 1/6 |
| S | 1 (thiolate, 3 LP) | 2 (2 LP) | 3 (sulfonium/sulfoxide S⁺, 1 LP) | lets DMSO be built as S⁺–O⁻ exactly as McMurry draws it; hypervalent S (sulfone) out of v1 |
| P | — | 3 (1 LP) | 4 (0 LP) | phosphate chemistry out of v1 |
| F, Cl, Br, I | 0 (halide ion, 4 LP) | 1 (3 LP) | — (halonium out of v1) | |

`targetValence(el, q)` returns `undefined` for unsupported combos; the charge tool refuses them.

### 2.3 Lone pairs (derived, never stored)
`lonePairs(el, q) = (V[el] − q − targetValence(el, q)) / 2`
Check: C 0→0, C⁺→0, C⁻→1, N→1, N⁺→0, N⁻→2, O→2, O⁺→1, O⁻→3, S→2, S⁺→1, S⁻→3, P→1, P⁺→0, X→3, X⁻→4, H→0. (These equal McMurry's "nonbonding electrons"/2 column.)

---

## 3. Derived per-atom quantities

### 3.1 Implicit hydrogens
```
heavyBondOrderSum = Σ order over explicit bonds of the atom (explicit H blocks count here)
implicitH = targetValence(el, q) − heavyBondOrderSum
if implicitH < 0 → valenceError = "too many bonds for <el> with charge <q>"
```
Explicit H blocks: element 'H', targetValence 1, implicitH 0; an H block with 0 or ≥2 bonds is a valence error.

### 3.2 Bond tool rule (order cycling 1→2→3→1)
Changing bond (a,b) from `old` to `new` is allowed iff for **both** endpoints `heavyBondOrderSum − old + new ≤ targetValence(el, charge)`. The tool skips disallowed orders in the cycle; if none is allowed it stays and shows "valence full". Consequence: C–O can reach order 2 (carbonyl) but not 3 unless O has charge +1 (out of v1: refuse triple to O, N⁺ only when the N⁺ has ≤1 other bond, i.e. nitrilium — allowed by the table, fine).

### 3.3 Formal charge
Textbook formula (McMurry 2.3, m00020): `FC = V − (nonbondingElectrons + bondingElectrons/2)`.
Engine: `formalCharge = V[el] − (2·lonePairs + heavyBondOrderSum + implicitH)`. Because lone pairs are derived from the set charge, this always equals `atom.charge` — it is a consistency check, not new information. Therefore **the learning objective "compute formal charge" is delivered as a quiz** (Section 9, C2-01): the challenge molecule is shown with `charge` hidden and lone-pair counts drawn as labels, and the student computes FC.

Rendering of lone pairs in Analyze mode: text badge `••×2` next to the atom (no 3D dots in v1).

### 3.4 Charge tool (key `C`, cycles 0 → +1 → −1 → 0 on the targeted atom)
```
apply(atom, newQ):
  tv = targetValence(atom.element, newQ)
  if tv === undefined → reject("<el> cannot carry charge <newQ> in this game")
  if atom.heavyBondOrderSum > tv → reject("remove a bond or an explicit H first: <el><q> allows <tv> bonds")
  atom.charge = newQ; recompute implicitH for this atom (H auto-fill adjusts)
```
Examples the student will do: CH₃OH → target O → −1: tv=1, heavy=1, implicitH 0 → methoxide. CH₃NH₂ → N → +1: tv=4, heavy=1, implicitH 3 → CH₃NH₃⁺. (CH₃)₃CH → central C → +1 refused while it has an explicit H block; with implicit H it is accepted (tv 3, heavy 3, implicitH 0) → tert-butyl cation. Molecule net charge = Σ charges, shown in the HUD.

### 3.5 Resonance (v1: not computed)
Rationale: `docs/SCOPE.md` excludes resonance structures; the pKa engine instead encodes resonance effects as environment classes (carboxylic O–H, enolizable C–H, phenol, amide N).
Minimal future feature (v1.x): `enumerateResonanceForms(graph)` = bounded BFS applying three electron-pushing moves, each producing a new graph with charges recomputed: (a) lone pair on X adjacent to Y=Z → X=Y, Z gets lone pair (X charge +1, Z charge −1); (b) π bond Y=Z adjacent to cation C⁺ → C=Y, Z⁺; (c) π bond C=O (or C=N) → C⁺–O⁻. Constraints (McMurry 2.5, m00022): no atom moves, no second-row atom exceeds an octet (`heavyBondOrderSum + implicitH + lonePairs·... ≤ 4 electron pairs`), max 6 forms, dedupe by canonical graph hash. Rank major contributor: fewest charges > negative charge on more electronegative atom > all octets. Use: show "resonance forms: n" badge; challenge "how many resonance forms" (MC).

---

## 4. Hybridization and geometry

### 4.1 Algorithm (per atom, from AtomInfo)
```
function hybridize(info, graph):
  if info.element === 'H' → hybridization 'none', geometry 'none'
  sigma = info.neighbors.length + info.implicitH
  pi    = Σ (order−1) over bonds
  LP    = lonePairs(element, charge)
  SN    = sigma + LP
  conjugated = false
  if LP > 0 and pi === 0 and (element ∈ {N,O,S} or (element==='C' and charge===-1)):
     // a lone pair next to a π system is in a p orbital (amide N, enamine/aniline N, ester/enol/phenol O, carboxylate O⁻, enolate C⁻)
     if ∃ neighbor n such that n has a bond of order ≥2 to some atom ≠ this atom: conjugated = true; SN -= 1
  hyb = SN ≥ 4 ? 'sp3' : SN === 3 ? 'sp2' : SN === 2 ? 'sp' : 'none'
  if sigma === 0 → hybridization 'none' (isolated ion)
  geometry:
     sigma ≤ 1            → 'terminal' (angle null)
     SN 4: sigma 4 → 'tetrahedral'; 3 → 'trigonal pyramidal'; 2 → 'bent'
     SN 3: sigma 3 → 'trigonal planar'; 2 → 'bent'
     SN 2: sigma 2 → 'linear'
  idealAngle: SN 4 → 109.5; SN 3 → 120; SN 2 → 180; terminal → null
  observedAngleNote (lookup, optional): (O, sigma2, LP2) → "≈104.5° in water (Chem 2e 7.6), 108.5° C–O–H in methanol (McMurry 1.10)";
     (N, sigma3, LP1, sp3) → "107.1° H–N–H in methylamine (McMurry 1.10)"; (C, sp2, sigma3) → "ethylene 117.4°/121.3° (McMurry 1.8)"
```
Decisions: halogens are always sp3 (SN 4) even on vinyl/aryl carbons (McMurry does not discuss; standard first-semester answer). Carbene/radicals unsupported. Diagonal (edge-adjacent) bonds, if enabled, count exactly like face bonds.

The analyzer must state in the HUD that **block angles (90°) are a lattice artifact**; the reported angle is the ideal VSEPR/hybridization angle (McMurry 1.6–1.10), not the on-screen angle.

### 4.2 Test table (unit tests; molecule built as graph, atom named)

| # | Molecule / atom | sigma | π | LP | conj | SN | hyb | geometry | ideal angle | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | methane C | 4 | 0 | 0 | – | 4 | sp3 | tetrahedral | 109.5 | 1.6 |
| 2 | ethene C | 3 | 1 | 0 | – | 3 | sp2 | trigonal planar | 120 | 1.8 |
| 3 | ethyne C | 2 | 2 | 0 | – | 2 | sp | linear | 180 | 1.9 |
| 4 | formaldehyde C | 3 | 1 | 0 | – | 3 | sp2 | trigonal planar | 120 | 1.8 example |
| 5 | formaldehyde O | 1 | 1 | 2 | – | 3 | sp2 | terminal | null | derived (standard) |
| 6 | acetonitrile N | 1 | 2 | 1 | – | 2 | sp | terminal | null | standard; sp like acetylide (9.7) |
| 7 | acetonitrile nitrile C | 2 | 2 | 0 | – | 2 | sp | linear | 180 | 1.9 analog |
| 8 | acetonitrile CH₃ C | 4 | 0 | 0 | – | 4 | sp3 | tetrahedral | 109.5 | 1.6 |
| 9 | water O | 2 | 0 | 2 | – | 4 | sp3 | bent | 109.5 (obs 104.5) | Chem 2e 7.6 |
| 10 | ammonia N | 3 | 0 | 1 | – | 4 | sp3 | trigonal pyramidal | 109.5 (obs ~107) | Chem 2e 7.6; 1.10 (107.1 in CH₃NH₂) |
| 11 | acetamide N | 3 | 0 | 1 | yes | 3 | sp2 | trigonal planar | 120 | 26.4 (planar amide), 24.3 |
| 12 | acetamide carbonyl C | 3 | 1 | 0 | – | 3 | sp2 | trigonal planar | 120 | 20.2 analog |
| 13 | dimethyl ether O | 2 | 0 | 2 | – | 4 | sp3 | bent | 109.5 | 1.10 (methanol 108.5) |
| 14 | allene central C | 2 | 2 | 0 | – | 2 | sp | linear | 180 | derived |
| 15 | allene terminal C | 3 | 1 | 0 | – | 3 | sp2 | trigonal planar | 120 | 1.8 |
| 16 | benzene C | 3 | 1 | 0 | – | 3 | sp2 | trigonal planar | 120 | 15.2 (unit test only; aromatics out of v1 builds) |
| 17 | methyl cation C (charge +1) | 3 | 0 | 0 | – | 3 | sp2 | trigonal planar | 120 | 7.9 |
| 18 | methyl anion C (charge −1) | 3 | 0 | 1 | – | 4 | sp3 | trigonal pyramidal | 109.5 | 9.7 ("alkyl anion sp3") |
| 19 | acetylide C⁻ (HC≡C⁻) | 1 | 2 | 1 | – | 2 | sp | terminal | null | 9.7 |
| 20 | ammonium N | 4 | 0 | 0 | – | 4 | sp3 | tetrahedral | 109.5 | 2.3 (N⁺ 4 bonds) |
| 21 | ester alkoxy O (methyl acetate O–CH₃) | 2 | 0 | 2 | yes | 3 | sp2 | bent | 120 | derived (conjugation rule) |
| 22 | enolate C⁻ of acetone | 3 | 0 | 1 | yes | 3 | sp2 | trigonal planar | 120 | 2.5 (resonance, no rehybridization) |
| 23 | vinyl chloride Cl | 1 | 0 | 3 | no (halogen) | 4 | sp3 | terminal | null | decision |
| 24 | DMSO S⁺ | 3 | 0 | 1 | – | 4 | sp3 | trigonal pyramidal | 109.5 | 2.3 |

---

## 5. Acidity model

### 5.1 Constant table `PKA` (all values with source; "MM" = OpenStax McMurry 10e)

**H–X**: HF 3.2 (Chem 2e App H, Ka 6.4e-4 → 3.19); HCl −7.0 (MM T2.3); HBr −9 (general, unverified); HI −10 (general, unverified).

**O–H**
- sulfonic acid R–SO₃H −1.8 (App B, CH₃SO₃H) — needs hypervalent S; only reachable if S with two =O is allowed (not in v1; keep constant).
- carboxylic acid base 4.8 (T2.3 4.76; App B 4.8). Modifiers (App B / T20.3): formic (H on carbonyl C) 3.7; aryl/vinyl on carbonyl C (benzoic 4.2, acrylic 4.2) → 4.2; each α-halogen: F −2.1, Cl −2.0, Br −1.9, I −1.6 (2.7/2.8/2.9/3.2); second α-Cl → 1.3 total, third → 0.5 (CHCl₂CO₂H 1.3, CCl₃CO₂H 0.5; CF₃CO₂H 0.5 App B / 0.23 T20.3); α-OH −1.1 (3.7), α-OCH₃ −1.2 (3.6), α-CN −2.3 (2.5), α-NO₂ −3.5 (1.3), α-C=O (pyruvic) −2.4 (2.4); β-halogen −0.8 (4.0); α-carbonyl of another acid (oxalic 1.2, malonic 2.8) → use App B constants when pattern matches; tert-alkyl +0.2 (5.0). Clamp result to [0.2, 5.2].
- peracid R–CO₃H 8.2 (App B CH₃CO₃H; HCO₃H 7.1).
- phenol / enol O–H 10 (phenol 9.9 App B, 9.89 T17.1). Para modifiers (T17.1): NH₂ +0.6 (10.46), CH₃ +0.3 (10.17), Cl −0.5 (9.38), CHO −2.0 (7.9), NO₂ −2.7 (7.15). v1 has no aromaticity detection, so the class fires on "O bonded to a C that has a C=C double bond" (covers phenol drawn with alternating bonds and true enols; both ≈10).
- water 15.74 (T2.3).
- alcohol: by carbon substitution — methanol 15.5 (App B; 15.54 T17.1), primary 16.0, secondary 17.1, tertiary 18.0 (T17.1/App B). Modifiers: β-F −1.2 each (CF₃CH₂OH 12.43 T17.1); β-Cl: one −1.7 (14.3), two −3.1 (12.9), three −3.8 (12.2) (App B); allylic/benzylic −0.5 (allyl alcohol 15.5, benzyl alcohol 15.4 App B); gem-diol CH₂(OH)₂ 13.3 (App B).
- oxime =N–OH 12.4 (App B acetone oxime).
- hydroperoxide ~11.6 (general, unverified).
- oxonium O⁺–H: hydronium −1.7 (general; consistent with MM's 55.4 M water: −log 55.4 = −1.74); ROH₂⁺ −2.4; R₂OH⁺ −3.5; protonated carbonyl −7; protonated carboxylic acid −6; protonated amide −1 (all general, unverified).

**N–H**
- ammonium N⁺–H: NH₄⁺ 9.26 (T24.1); primary alkyl RNH₃⁺ 10.6 (10.64/10.75), secondary 11.0 (10.98), tertiary 10.8 (10.76); N on vinyl/aryl carbon (anilinium) 4.6 (4.63), para modifiers from T24.2 (NH₂ 6.15, OCH₃ 5.34, CH₃ 5.08, Cl 3.98, Br 3.86, CN 1.74, NO₂ 1.00); sp2 ring N⁺–H (pyridinium) 5.25, imidazolium 6.95, pyrrolium 0.4, pyrimidinium 1.3 (T24.1; 5- and aromatic rings are not buildable in v1 — constants kept for quiz text).
- neutral amide N–H (N bonded to a C=O carbon) 17 (general, unverified; MM gives no value — it only says amides are nonbasic). Imide (N between two C=O) 9 (general, unverified). Sulfonamide 10 (general, unverified).
- aniline N–H (N on sp2 C, no C=O) 30 (general, unverified).
- amine N–H: NH₃ 36, RNH₂ 36, R₂NH 40 (App B; T22.1 uses 36 for diisopropylamine; text in 9.7 says 35). Use 36 for primary/ammonia, 40 for secondary.
- N⁻–H (amide ion): 60+ ("not acidic").

**S–H**: thiol 10.3 (App B, T17.1, 18.8); thiophenol 6.6 (App B); H₂S 7.0 (general, unverified); benzyl mercaptan 9.4 (App B).

**C–H** (in order of precedence)
- H–C≡N (HCN, H on nitrile carbon) 9.31 (T2.3).
- terminal alkyne C–H 25 (T9.1, App B).
- α to activating groups (count activating neighbors G of the carbon; a neighbor is activating if it is a carbonyl C (any C=O), a nitrile C (C≡N), a nitro N⁺(=O)O⁻, a sulfonyl or sulfinyl S). Single-group values (T22.1 unless noted): aldehyde 17; ketone 19 (acetone 19.3); acid chloride 16; thioester 21; ester 25; nitrile 25; N,N-dialkylamide 30; carboxylic acid/carboxylate α-C–H 25 (estimate, treat like ester; unverified); nitro: 10.3 primary CH₃, 8.5 secondary CH₂, 7.7 tertiary CH (App B); sulfone 28; sulfoxide 35 (App B). Two groups: lookup on the sorted pair — {ketone,ketone} 9 (T22.1; App B 9.0), {ketone,ester} 11 (10.6), {ester,ester} 13 (12.9), {nitrile,nitrile} 11.2 (App B), {aldehyde,ketone} 5.8 (App B 2-formylcyclopentanone) , {ketone,nitro} 5.1 (App B), {ester,nitro} 5.8 (App B), {ketone,sulfoxide} 10.0 (App B), {ketone,aldehyde-like CHO} 11.0 (CH₃COCHO); unknown pair → min(single values) − 8. Three groups → 0.1 (App B trinitromethane) if all nitro, else min(single) − 12.
- vinylic C–H 44 (T9.1); aromatic C–H 43 (App B) (aromatic detection stub → treated as vinylic 44 in v1).
- allylic/benzylic C–H: one C=C or aryl neighbor 41 (toluene, App B; propene ≈43 general — use 41 for any allylic in v1), two aryl 34, three aryl 32 (App B).
- alkane C–H 60 (T9.1 CH₄ 60; App B ~60; MM 22.5 says ethane ≈60). Note: older McMurry editions print ethane ≈50; expose `PKA.alkane` as a single constant so the instructor can flip it.
- C–H on a carbanion carbon: 99 (never acidic).

### 5.2 Classification algorithm
```
function hydrogenSites(graph): HydrogenSite[]
  info = analyzeAtoms(graph)
  for each atom X with (implicitH > 0) or explicit H neighbors:
     env = classify(X, info, graph)      // returns {classId, pKa, modifiers[], label, source}
     classKey = classId + '|' + modifiers.sort().join(',')
     emit one HydrogenSite per implicit slot and per explicit H neighbor, all sharing env
classify(X):
  switch X.element:
   'F','Cl','Br','I' → HX class
   'O' → if X.charge=+1: oxonium rules (has C=O neighbor? protonated carbonyl : neighbors all H ? hydronium : ...)
         else if ∃ neighbor C with a double bond to another O (carbonyl C bonded to X) → carboxylic (apply α-modifiers by inspecting that carbonyl C's other neighbor)
         else if neighbor is O → peroxide/peracid
         else if neighbor is N with N=C → oxime
         else if neighbor C has any C=C bond → phenol/enol
         else if X bonded to two H → water
         else alcohol (degree = number of carbon neighbors of the C attached to X; modifiers from that carbon's substituents)
   'N' → if charge=+1: ammonium rules (neighbor on sp2 carbon? anilinium : degree by carbon count)
         else if ∃ neighbor C with C=O → amide (imide if two)
         else if neighbor is S with S=O → sulfonamide
         else if ∃ neighbor C with C=C → aniline-type
         else amine (NH3 / primary 36; secondary 40)
   'S' → charge 0: neighbor C with C=C ? thiophenol : thiol
   'C' → if charge=-1 → 99
         if X has a triple bond to N and sigma==2 → HCN class
         if X has a triple bond to C → terminal alkyne
         G = activating neighbors (see 5.1); if G.length ≥ 1 → α-C–H rules
         if X.pi ≥ 1 → vinylic
         if ∃ neighbor C with C=C (and X sp3) → allylic/benzylic (count aryl-like neighbors)
         else alkane
```
Explicit H blocks attached to a heavy atom are classified by their parent exactly like implicit ones.

### 5.3 Most acidic hydrogen and equivalence
```
sites = hydrogenSites(graph); min = Math.min(...sites.map(s=>s.pKa))
correct = sites.filter(s => s.pKa <= min + 0.05)   // numeric tie ⇒ equivalent
```
Equivalence is thus "identical pKa environment class" (same classKey ⇒ same pKa by construction); an accidental cross-class tie (ester α-H 25 vs terminal alkyne 25) is also accepted because the model cannot rank it. **Content validator** (runs when a select-H challenge loads or in a build-time test): the second-lowest distinct pKa must be ≥ 3 units above `min`, otherwise the challenge is rejected with an error naming both classes. All H on the same parent atom share one classKey (diastereotopic H's are not distinguished).

### 5.4 Basic sites (`basicSites(graph)`), pKaH = pKa of the conjugate acid
Candidates: atoms with lonePairs > 0 or charge −1. Values: alkyl carbanion 60; acetylide 25; enolate C 19 (ketone) / O 19; amide ion N⁻ 36 (R₂N⁻ 40); amine N: NH₃ 9.26, primary 10.6, secondary 11.0, tertiary 10.8 (T24.1); aniline-type N 4.6 (+T24.2 para modifiers); imine N 7 (general, unverified); amide N −1 (MM: nonbasic; actual protonation on O; unverified number); nitrile N −10 (unverified); alkoxide O⁻ 16/17.1/18 by degree, methoxide 15.5; hydroxide 15.74; phenoxide/enolate O 10; carboxylate 4.8; alcohol O −2.4, ether O −3.5, water O −1.7, carbonyl O −7 (ketone/aldehyde), ester C=O −6.5, amide O −1, carboxylic acid C=O −6 (all general, unverified); thiolate 10.3, thiol/sulfide S −7 (unverified); halide ions F⁻ 3.2, Cl⁻ −7, Br⁻ −9, I⁻ −10; halogen in C–X: −10 (negligible). Most basic site = max pKaH; ties within 0.05 equivalent. "Which nitrogen is more basic" restricts candidates to `element === 'N'`. Validator margin ≥ 3.

### 5.5 Predicting whether an acid–base reaction proceeds (MM 2.9)
```
predict(acidGraph, baseGraph):
  a = min pKa over hydrogenSites(acidGraph)         // the H that will be donated
  b = max pKaH over basicSites(baseGraph)           // pKa of the base's conjugate acid
  delta = b − a; Keq = 10^delta
  verdict = delta > 0 ? 'favors products' : 'favors reactants'
  text: "Reactant acid pKa a → product conjugate acid pKa b. Equilibrium favors the weaker acid (higher pKa)."
```
Yes/No answer = `delta > 0`. Authoring rule: |delta| ≥ 2 for every yes/no item. Optional bench tool `protonTransfer(acid, hSite, base, bSite)`: delete the H (decrement implicitH by setting acid atom charge −1, or remove the explicit H block and set charge −1), set base atom charge +1 (auto-fills one implicit H), return both product graphs plus Keq — this reuses the charge tool rules and needs no new chemistry.

---

## 6. Select-atom interaction (answering "which hydrogen is most acidic")

**Recommendation: render hydrogens as targetable mini-blocks in Select mode (primary), with heavy-atom fallback.** Reason: the learning objective is to *see* which H is meant; clicking the heavy atom is ambiguous for atoms carrying several H's of different classes only in edge cases we exclude, but it also hides the H's the student must reason about.

Implicit-H placement (deterministic, also used by the "show H" toggle): candidate positions = free face-neighbor cells of the parent; order `[+y, −y, +z, −z, +x, −x]`; take the first `implicitH` cells. Mini-block: 0.4 × block size, centered on the cell center, colour #F2F2F2, 65 % opacity outside Select mode, 100 % inside. Explicit H blocks render at 0.55 scale.

Modes and keys (align with the player-controller key map; suggested defaults):
- `Tab` toggle Analyze mode (tooltip on hovered atom: element, charge, hybridization, geometry, ideal angle, lone pairs, formal charge, H count, and for each H class on the atom "pKa ≈ n (label)").
- `H` toggle H visibility (forced on in Select mode).
- `E` (or left click) select the hovered target; `Enter` submit; `Esc` clear; `[` / `]` cycle through candidate targets in deterministic order (keyboard-only accessibility; the cycled target is treated as hovered).
- Heavy-atom fallback: with a heavy atom hovered, `E` selects "the H's on this atom" (all of them); accepted iff that atom has ≥1 H and every H on it is in the correct set. If the atom has no H: toast "this atom has no hydrogens".
Highlight rendering: hover = yellow emissive (#FFD54F) + 2 px outline pass; selected = cyan (#4DD0E1) + label "selected"; after submit: correct set pulses green (#66BB6A) twice; a wrong pick turns red (#EF5350) while the correct set flashes green; feedback panel prints the pKa and class label for the picked H and for the correct H with the McMurry citation string.
For "most basic site" challenges the target is the heavy atom itself (same keys, no H blocks needed).

Acceptance rule (select-H): `correct.some(s => s.parentId === pick.parentId && (pick.slot == null || s.slot === pick.slot || s.explicitAtomId === pick.explicitAtomId))`. Any H in the equivalence class of the answer is accepted (Section 5.3).

---

## 7. Quiz panel (multiple choice and yes/no)

DOM overlay (not WebGL), `<aside id="quiz" role="dialog" aria-live="polite">` anchored bottom-centre, max-width 640 px, semi-opaque dark card, always readable inside the D2L iframe (no fixed heights, font 16 px min).
Structure: `.quiz-prompt` (question text, may reference the world with "the marked atom" — marked atom rendered with a pulsing orange outline and a floating "?" sprite), `.quiz-options` list of 2–5 `<button>` items each prefixed with its number badge `1`–`5` (Yes/No uses `1 Yes` / `2 No`, also `Y`/`N` keys), `.quiz-feedback` (explanation + citation), `.quiz-actions` (`Enter` submit, `Esc` skip/close when allowed).
State machine: `idle → open(question) → optionSelected(i) → submitted(correct|wrong) → (attempt<max ? open : closed)`. Digit key selects and highlights (does not submit); `Enter` or pressing the same digit again submits. Pointer lock stays engaged; keyboard is the primary input; if the player unlocks (Esc), clicking buttons also works.
Events: `quiz:open {challengeId, stepId}`, `quiz:answer {choice, correct, attempt}`, `quiz:close`. Challenge system listens and scores.
Data: `{ kind:'mc', prompt, options:[{id,text}], correct:['b'] | ['b','c'] (any-of), shuffle:true, maxAttempts:2, explanation, source }` and `{ kind:'yesno', prompt, correct:true|false, maxAttempts:1, explanation }`. Options shuffle with a seed = hash(challengeId + studentId) so retries keep order.

---

## 8. Challenge schema and scoring

```ts
type Step =
 | { kind:'build'; accept: BuildAccept; hints: string[] }
 | { kind:'select-h' | 'select-atom'; moleculeId: string; target: 'mostAcidicH'|'mostBasicSite'|'mostBasicN'; maxAttempts: 3 }
 | { kind:'mc'; ... } | { kind:'yesno'; ... };
type BuildAccept =
 | { type:'isomorphic'; target: MoleculeGraph; compareCharge: true }
 | { type:'predicate'; expr: PredicateSpec }   // e.g. {countBy:{element:'C',hyb:'sp'}, min:1}
interface Challenge { id; chapter:1|2; title; steps: Step[]; points: 10; }
```
Build steps require: no `valenceError`, exactly one connected component, and for `isomorphic` a match by the chemistry-core `isIsomorphic(a,b,{compareCharge:true})`. Scoring per challenge (10 pts): MC/yes-no first try 10, second 5, then 0 and reveal; select-H first 10, second 5, third 0; build 10 minus 2 per hint used (floor 4); multi-step challenges average their steps. SCORM score = Σ earned / Σ possible over attempted challenges.

---

## 9. Challenge list (chapters 1–2)

Molecule ids refer to a library of prebuilt graphs (`molecules/ch1-2.json`); marked atoms are given by atom id.

**Chapter 1**
1. **C1-01 Methane and sp3** — build: predicate (1 C, no other heavy atoms, charge 0). Then MC "hybridization of the carbon": options sp, sp2, sp3, unhybridized → **sp3**. Expl: four σ bonds, 109.5°.
2. **C1-02 Ethene** — build: isomorphic to C2H4. MC hybridization → **sp2**; MC geometry → **trigonal planar**; MC angle (90, 109.5, 120, 180) → **120**.
3. **C1-03 Ethyne** — build: isomorphic to C2H2. MC → **sp**, **linear**, **180**.
4. **C1-04 Mixed hybridization** — "Build any molecule containing at least one sp carbon and at least one sp3 carbon." Predicate: count(C,sp)≥1 ∧ count(C,sp3)≥1 ∧ valid. Examples: propyne, acetonitrile, 1-butyne.
5. **C1-05 Exactly three sp2 carbons** — predicate: count(C,sp2)=3 ∧ count(C,sp)=0 ∧ net charge 0. Examples: propenal CH₂=CH–CHO, propenoic acid; acetone fails (1), butadiene fails (4).
6. **C1-06 Heteroatom hybridization** — "Build a molecule with an sp3 oxygen and an sp nitrogen." Predicate: ∃O sp3 ∧ ∃N sp. Example: HO–CH₂–C≡N.
7. **C1-07 Identify hybridization of the marked atom** (MC, pool, one drawn per attempt): acetonitrile nitrile C → sp; acetone carbonyl C → sp2; allene central C → sp; dimethyl ether O → sp3; acetamide N → sp2 (explanation: lone pair conjugated with C=O, planar amide); trimethylamine N → sp3.
8. **C1-08 Identify geometry of the marked atom** (MC: tetrahedral / trigonal pyramidal / bent / trigonal planar / linear): trimethylamine N → trigonal pyramidal; dimethyl ether O → bent; formaldehyde C → trigonal planar; HCN C → linear; ammonium N → tetrahedral.
9. **C1-09 Ideal bond angle at the marked atom** (MC 90/109.5/120/180): methane C 109.5; ethene C 120; ethyne C 180; water O 109.5 (feedback: observed 104.5).
10. **C1-10 tert-Butyl cation** — build isomorphic to (CH₃)₃C⁺ (central C charge +1; needs charge tool). Then MC hybridization of the cationic carbon → **sp2** (McMurry 7.9), geometry → trigonal planar.

**Chapter 2**
11. **C2-01 Formal charge** (MC −2/−1/0/+1/+2; molecule shown with lone-pair badges, charges hidden): hydronium O → +1; methoxide O → −1; ammonium N → +1; nitromethane N → +1 and single-bonded O → −1; DMSO S → +1, O → −1 (McMurry's worked example); methyl cation C → +1; methyl anion C → −1.
12. **C2-02 Conjugate base of acetic acid** — build isomorphic to acetate (either O may carry −1; graph isomorphism handles it). Feedback: resonance-stabilized carboxylate (2.10).
13. **C2-03 Conjugate acid of methylamine** — build CH₃NH₃⁺ (N charge +1, 4 bonds). 
14. **C2-04 Conjugate base of ethanol** — build ethoxide CH₃CH₂O⁻. Variant pool: conjugate base of methanethiol (CH₃S⁻), conjugate acid of water (H₃O⁺).
15. **C2-05 Most acidic hydrogen** (select-H; pool with expected class): 3-hydroxypropanoic acid → carboxylic O–H (4.8 vs alcohol 16 vs α-CH 25); 2-mercaptoethanol → S–H (10.3 vs 16); 1-butyne → terminal alkyne C–H (25 vs 60); 2,4-pentanedione → central CH₂ (9 vs 19); propargyl alcohol → O–H (15.5 vs 25); acetic acid → O–H (4.8 vs 25); 2-ammonioethanol HOCH₂CH₂NH₃⁺ → N⁺–H (10.6 vs 16); butanone → any α-H on either side (both class ketone-α 19; demonstrates equivalence); ethylamine → N–H (36 vs 60); propanamide → N–H (17 vs α-CH 30; value unverified but ordering robust).
16. **C2-06 Most basic site / which nitrogen is more basic** (select-atom): 2-aminoethanol → N (10.6 vs O −2.4); 4-aminobutan-2-one → amine N (vs carbonyl O −7); 3-aminopropanamide → amine N (10.6) not amide N (−1) — explanation quotes 24.3 "amides are nonbasic"; N-(2-aminoethyl)acetamide → terminal amine N; ethylamine vs ethenamine (enamine) pool item → alkyl amine N.
17. **C2-07 Will this reaction proceed as written?** (yes/no, text only): CH₃CO₂H + OH⁻ → yes (4.76 < 15.74); HC≡CH + OH⁻ → no (25 > 15.74, McMurry worked example); CH₃OH + NH₂⁻ → yes (15.5 < 36); HCN + CH₃CO₂⁻ → no (9.31 > 4.76); CH₃SH + CH₃CH₂O⁻ → yes (10.3 < 16); NH₄⁺ + CH₃CO₂⁻ → no (9.26 > 4.76); CH₃COCH₃ + CH₃CH₂O⁻ → no (19.3 > 16; 22.5 says ~0.1 %); CH₃COCH₃ + LDA → yes (19.3 < 36); phenol + NaOH → yes (9.89 < 15.74); HCl + H₂O → yes (−7 < −1.7).
18. **C2-08 Strongest / weakest acid** (MC from Table 2.3 / App B): {ethanol 16, acetic acid 4.76, phenol 9.9, acetylene 25} strongest → acetic acid; weakest → acetylene; {HCN 9.31, NH₄⁺ 9.26 — excluded as a tie}; {water 15.74, methanol 15.5, tert-butanol 18, CF₃CH₂OH 12.43} strongest → CF₃CH₂OH.
19. **C2-09 Lewis acids and bases** (MC): "In BF₃ + (CH₃)₂O, the Lewis acid is" → BF₃; "Which is a Lewis base?" {AlCl₃, CH₃NH₂, Mg²⁺, H⁺} → CH₃NH₂; "Which species accepts an electron pair?" etc. (2.11).
20. **C2-10 Brønsted roles** (MC): "In H₂O + NH₃ ⇌ OH⁻ + NH₄⁺ water acts as" {acid, base, neither} → acid; "the conjugate base of water is" → OH⁻; "the conjugate acid of CH₃NH₂ is" → CH₃NH₃⁺ (2.7).

---

## 10. Unit tests to write
- `lonePairs`/`targetValence` table equals Section 2 for every (element, charge).
- Hybridization test table rows 1–24.
- Charge tool: methoxide, methylammonium, hydronium, tert-butyl cation, refusal when heavy bonds exceed target.
- pKa engine: every molecule in C2-05 yields the expected classId and margin ≥ 3; constants equal Section 5.1; butanone yields one equivalence class covering both α carbons.
- basicSites for C2-06; predict() for all C2-07 rows (sign and Keq exponent).
- Select-H acceptance with heavy-atom fallback on CH₃ groups.
- Validator rejects a select-H challenge whose margin < 3 (e.g. glycolamide: alcohol 15.5 vs amide 17).

## 11. Source map for feedback strings
`MM 2.8 T2.3 (m00025)`, `MM App B (m00030)`, `MM 9.7 T9.1 (m00109)`, `MM 17.2 T17.1 (m00201)`, `MM 20.2 T20.3 (m00231)`, `MM 22.5 T22.1 (m00261)`, `MM 24.3 T24.1 / 24.4 T24.2 (m00291/m00292)`, `MM 18.8 (m00254)`, `MM 2.3 (m00020)`, `MM 1.6–1.10 (m00163–m00167)`, `MM 7.9 (m00071)`, `MM 15.2 (m00182)`, `MM 26.4 (m00321)`, `Chem 2e App H (m68866)`, `Chem 2e 7.6 (m68742)`; anything marked "general, unverified" must be shown to students only as "≈" and never as a graded answer.

## Facts

- [verified] OpenStax McMurry Table 2.3 (section 2.8, module m00025) lists exactly eight acids: ethanol 16.00, water 15.74, hydrocyanic acid 9.31, dihydrogen phosphate ion 7.21, acetic acid 4.76, phosphoric acid 2.16, nitric acid -1.3, hydrochloric acid -7.0 (weaker acids at top, stronger at bottom; conjugate bases listed). _(source: https://raw.githubusercontent.com/openstax/osbooks-organic-chemistry/main/modules/m00025/index.cnxml (Table 2.3))_
- [verified] McMurry 2.8 states Ka ranges from about 10^15 for the strongest acids to about 10^-60 for the weakest; pKa = -log Ka; the water pKa of 15.74 comes from Ka = (1e-7)(1e-7)/55.4 = 1.8e-16. _(source: module m00025 (section 2.8))_
- [verified] McMurry 2.9 rule: H+ always goes from the stronger acid to the stronger base; an acid donates a proton to the conjugate base of a weaker acid; equivalently the product conjugate acid must be weaker than the starting acid and the product conjugate base weaker than the starting base. Worked example: water (15.74) is a stronger acid than acetylene (25), so hydroxide does not react significantly with acetylene; acetic acid Ka = 1.74e-5 from pKa 4.76. _(source: module m00026 (section 2.9))_
- [verified] McMurry 2.10 cites methanol pKa 15.54, acetic acid 4.76, acetone 19.3; organic acids are O-H acids or C-H acids alpha to C=O; organic bases are lone-pair atoms, chiefly nitrogen (methylamine), oxygen compounds are bases only toward sufficiently strong acids; amino acids exist as zwitterions. _(source: module m00027 (section 2.10))_
- [verified] McMurry 2.7 Bronsted-Lowry definitions: acid donates H+, base accepts H+; Cl- is the conjugate base of HCl, H3O+ the conjugate acid of H2O; example reactions HCl + H2O, CH3CO2H + OH-, H2O + NH3. _(source: module m00024 (section 2.7))_
- [verified] McMurry 2.11 Lewis definitions: Lewis acid accepts an electron pair (H+, Mg2+, Li+, BF3, AlCl3, TiCl4, FeCl3, ZnCl2, SnCl4; also proton donors like water, carboxylic acids, phenol); Lewis base donates an electron pair (water, alcohols, ethers, aldehydes/ketones, acid chlorides, carboxylic acids, esters, amides, amines, sulfides, organotriphosphate ions). _(source: module m00028 (section 2.11))_
- [verified] McMurry 2.3 formal charge = (number of valence electrons in the free atom) - (half the bonding electrons + all nonbonding electrons). Summary table: C 3 bonds/1 nonbonding e = 0 (radical); C 3 bonds/0 = +1; C 3 bonds/2 = -1; N 4 bonds/0 = +1; N 2 bonds/4 = -1; O 3 bonds/2 = +1; O 1 bond/6 = -1; S 3 bonds/2 = +1; S 1 bond/6 = -1; P 4 bonds/0 = +1. DMSO: S owns 5 of 6 valence electrons (+1), O owns 7 (-1). _(source: module m00020 (section 2.3))_
- [verified] McMurry resonance rules (2.5): forms are imaginary, the hybrid is real; forms differ only in placement of pi or nonbonding electrons, never atom positions or hybridization; nonequivalent forms both contribute and the hybrid resembles the more stable form; forms obey normal valency/octet rules. _(source: module m00022 (section 2.5))_
- [verified] Methane: H-C-H angle 109.5 degrees (tetrahedral angle), C-H 439 kJ/mol, 109 pm; sp3 orbitals from one s and three p orbitals. _(source: module m00163 (section 1.6))_
- [verified] Ethylene is planar with H-C-H and H-C-C angles of approximately 120 degrees (measured 117.4 and 121.3); C=C 134 pm, 728 kJ/mol; sigma from sp2-sp2 overlap, pi from p-p sideways overlap; formaldehyde carbon is sp2. _(source: module m00165 (section 1.8))_
- [verified] Acetylene is linear with H-C-C angles of 180 degrees; C-C 120 pm, ~965 kJ/mol; sp orbitals 180 degrees apart; one sigma plus two pi bonds. _(source: module m00166 (section 1.9))_
- [verified] Methylamine nitrogen is sp3 with one sp3 orbital holding the lone pair; H-N-H 107.1 degrees, C-N-H 110.3 degrees. Methanol oxygen is sp3 with two lone pairs; C-O-H 108.5 degrees. Organophosphate O-P-O 110-112 degrees (sp3). Methanethiol C-S-H 96.5, dimethyl sulfide C-S-C 99.1 degrees. _(source: module m00167 (section 1.10))_
- [verified] Skeletal-structure rules (1.12): carbons not shown, hydrogens on carbon not shown, atoms other than C and H are shown; the correct number of hydrogens is supplied mentally. _(source: module m00169 (section 1.12))_
- [verified] Carbocations are planar; the trivalent carbon is sp2-hybridized with 120 degree angles and a vacant p orbital perpendicular to the plane. _(source: module m00071 (section 7.9))_
- [verified] Benzene is planar, regular hexagon, all C-C-C angles 120 degrees, all carbons sp2, C-C 139 pm. _(source: module m00182 (section 15.2))_
- [verified] Alkylamine nitrogen is sp3, trigonal pyramidal with lone pair at the fourth corner; trimethylamine C-N-C 108 degrees; pyramidal inversion passes through a planar sp2 state (barrier ~25 kJ/mol). _(source: module m00290 (section 24.2))_
- [verified] Amide nitrogen is nonbasic because its lone pair is delocalized into the carbonyl; the nitrogen p orbital overlaps the carbonyl p orbitals, the C-N bond has partial double-bond character and the amide bond is planar. _(source: modules m00321 (26.4) and m00291 (24.3))_
- [verified] Table 9.1: alkyne (HC≡CH) pKa 25, alkene (H2C=CH2) 44, alkane (CH4) 60; text says methane ~60, ethylene 44, acetylene 25, ammonia 35 (amide ion deprotonates terminal alkynes). Acetylide anion is sp (50% s), vinylic anion sp2, alkyl anion sp3. _(source: module m00109 (section 9.7))_
- [verified] Appendix B (Acidity Constants for Some Organic Compounds) values used: CH3SO3H -1.8; CF3CO2H 0.5; CCl3CO2H 0.5; CHCl2CO2H 1.3; CH2FCO2H 2.7; CH2ClCO2H 2.8; CH2BrCO2H 2.9; CH2ICO2H 3.2; HCO2H 3.7; benzoic acid 4.2; H2C=CHCO2H 4.2; CH2BrCH2CO2H 4.0; CH3CO2H 4.8; CH3CH2CO2H 4.8; (CH3)3CCO2H 5.0; thiophenol 6.6; CH3CO3H 8.2; HCO3H 7.1; CH3COCH2COCH3 9.0; phenol 9.9; CH3NO2 10.3; CH3CH2NO2 8.5; (CH3)2CHNO2 7.7; CH3SH 10.3; CH3COCH2CO2CH3 10.6; CH2(CN)2 11.2; CH2(CO2CH3)2 12.9; CCl3CH2OH 12.2; CHCl2CH2OH 12.9; CH2ClCH2OH 14.3; acetone oxime 12.4; cyclopentadiene 15.0; benzyl alcohol 15.4; CH3OH 15.5; allyl alcohol 15.5; CH3CH2OH 16.0; CH3CH2CH2OH 16.1; cyclohexanone 16.7; CH3CHO 17; (CH3)2CHOH 17.1; (CH3)3COH 18.0; CH3COCH3 19.3; fluorene 23; CH3CO2CH2CH3 25; HC≡CH 25; CH3CN 25; CH3SO2CH3 28; Ph3CH 32; Ph2CH2 34; CH3SOCH3 35; NH3 36; CH3CH2NH2 36; (CH3CH2)2NH 40; toluene 41; benzene 43; H2C=CH2 44; CH4 ~60. _(source: module m00030 (Appendix B))_
- [verified] Table 17.1: (CH3)3COH 18, CH3CH2OH 16, H2O 15.74, CH3OH 15.54, CF3CH2OH 12.43, p-aminophenol 10.46, CH3SH 10.3, p-methylphenol 10.17, phenol 9.89, p-chlorophenol 9.38, p-nitrophenol 7.15; nonafluoro-tert-butyl alcohol 5.4; p-hydroxybenzaldehyde 7.9; phenols about a million times more acidic than alcohols (resonance-stabilized phenoxide). _(source: module m00201 (section 17.2))_
- [verified] Table 20.3 (carboxylic acids): CF3CO2H 0.23, HCO2H 3.75, HOCH2CO2H 3.84, C6H5CO2H 4.19, H2C=CHCO2H 4.25, CH3CO2H 4.76 (Ka 1.75e-5), CH3CH2CO2H 4.87, ethanol (16); carboxyl carbon is sp2 with ~120 degree angles (C-C=O 119, O=C-OH 122). _(source: module m00231 (section 20.2))_
- [verified] Table 22.1 (alpha-hydrogen acidity): carboxylic acid O-H 5; 1,3-diketone 9; 3-keto ester 11; 1,3-diester 13; alcohol 16; acid chloride 16; aldehyde 17; ketone 19; thioester 21; ester 25; nitrile 25; N,N-dialkylamide 30; dialkylamine (diisopropylamine) 36. Acetone 19.3 vs ethane ~60; ethoxide deprotonates acetone only ~0.1%; LDA deprotonates completely. _(source: module m00261 (section 22.5))_
- [verified] Table 24.1 (pKa of ammonium ions): NH4+ 9.26; CH3NH3+ 10.64; CH3CH2NH3+ 10.75; (CH3CH2)2NH2+ 10.98; pyrrolidinium 11.27; (CH3CH2)3NH+ 10.76; anilinium 4.63; pyridinium 5.25; pyrimidinium 1.3; pyrrolium 0.4; imidazolium 6.95. pKa + pKb = 14; larger ammonium pKa means stronger amine base; amides are nonbasic. _(source: module m00291 (section 24.3))_
- [verified] Table 24.2 (p-substituted anilinium pKa): NH2 6.15, OCH3 5.34, CH3 5.08, H 4.63, Cl 3.98, Br 3.86, CN 1.74, NO2 1.00. _(source: module m00292 (section 24.4))_
- [verified] Thiols are weakly acidic; pKa of CH3SH is 10.3; thiolate + alkyl halide gives sulfides by SN2. _(source: module m00254 (section 18.8))_
- [verified] HF Ka = 6.4e-4 (pKa 3.19); binary acid order HF < HCl < HBr < HI and CH4 < NH3 < H2O < HF. _(source: OpenStax Chemistry 2e Appendix H (module m68866) and section 14.3 (m68805), raw.githubusercontent.com/openstax/osbooks-chemistry-bundle)_
- [verified] Water is bent with a 104.5 degree bond angle (tetrahedral electron-pair geometry); ammonia is trigonal pyramidal with H-N-H slightly smaller than 109.5 degrees. _(source: OpenStax Chemistry 2e section 7.6 (module m68742))_
- [likely] Ammonia H-N-H angle is about 107 degrees. _(source: General chemistry textbooks (Chemistry 2e only says 'slightly smaller than 109.5'); consistent with McMurry's 107.1 for methylamine)_
- [unverified] Older McMurry editions list ethane pKa ~50 in the hydrocarbon acidity table; OpenStax 10e uses ~60 for methane/ethane. _(source: Task statement plus module m00261 ('ethane (pKa ≈ 60)') and Table 9.1 (CH4 60); the 50 value was not directly read in any edition)_
- [unverified] Values not tabulated by McMurry, taken from general pKa compilations: HBr ≈ -9, HI ≈ -10, H3O+ ≈ -1.7, ROH2+ ≈ -2.4, R2OH+ ≈ -3.5, protonated ketone ≈ -7, protonated amide ≈ -1 (O-protonated), neutral primary amide N-H ≈ 17, aniline N-H ≈ 30, allylic C-H (propene) ≈ 43, H2S ≈ 7.0, imine conjugate acid ≈ 7, nitrile conjugate acid ≈ -10. _(source: General organic chemistry pKa tables (Evans/Reich); those sites were blocked by the proxy so not re-read in this session)_
- [verified] The project repo currently contains only a Vite/TS/Three toolchain scaffold (src/main.ts stub, placeholder test) and docs/SCOPE.md, which records the instructor topic list and states aromaticity and resonance structures are out of v1 and that a small quiz panel is needed for chapter 1-2 objectives. _(source: /home/user/Minecraft_Game/docs/SCOPE.md, /home/user/Minecraft_Game/package.json, /home/user/Minecraft_Game/src/main.ts)_
- [verified] The relayed user request for this run is 'Wait, you didn't ask me what topics should be included.' The topic list was supplied by the workflow script, not confirmed by the user. _(source: Workflow harness user-request relay in this task)_

## Recommendations

- Before implementation, have the orchestrator ask the user which topics to include: the relayed user message explicitly objects that they were never asked. Keep the topic modules and challenge pool as switchable data so the answer can be applied cheaply.
- Implement lone pairs, implicit H count and formal charge as pure functions of (element, charge, bond orders) per Section 2-3; store only `charge` on atoms. This keeps the bond tool, charge tool and H auto-fill consistent with McMurry's formal-charge table.
- Use the conjugation adjustment (lone pair adjacent to a pi bond -> sp2) only for N, O, S and carbanion C; keep halogens sp3. Document this in the Analyze tooltip so students see the rule McMurry uses for amides.
- Deliver the formal-charge objective as a quiz with lone pairs displayed and charges hidden, since derived formal charge always equals the set charge in the builder.
- Render implicit hydrogens as 0.4-scale mini-blocks in Select mode and let students target them with the crosshair (E to select, Enter to submit, [ ] to cycle for keyboard-only use); allow heavy-atom fallback that selects all H on that atom.
- Accept any hydrogen whose pKa ties the minimum within 0.05 (identical environment class), and enforce a content validator requiring a >= 3 pKa margin to the next class so no graded answer depends on unverified constants.
- Expose the alkane C-H constant (60 in OpenStax 10e, 50 in older McMurry editions) and all 'general, unverified' constants in one config object the instructor can edit.
- Keep aromatic molecules (benzene, phenol, pyridine) out of build challenges per docs/SCOPE.md; the pKa engine's enol/phenol class (10) still gives correct answers for phenol drawn with alternating bonds if it is ever loaded, and the hybridization test for benzene is unit-test only.
- Build the quiz panel as a DOM overlay driven by keyboard digits 1-5 (select) plus Enter (submit), Y/N for yes/no, with pointer lock retained; emit quiz:answer events into the shared challenge/scoring system used by SCORM.
- Add the optional protonTransfer bench tool later; it reuses the charge tool rules and turns the 2.9 prediction into a buildable reaction for the reaction bench.

## Risks

- Topic scope is unconfirmed: the user says they were not asked which topics to include, so the chapter 1-2 feature set (and the whole v1 topic table in docs/SCOPE.md) may change after the user is consulted.
- openstax.org, LibreTexts, Wikipedia and common pKa-table sites are blocked from this environment; values were verified from the OpenStax GitHub source repositories instead. About a dozen constants McMurry does not tabulate (HBr, HI, H3O+, ROH2+, protonated carbonyl/amide, neutral amide N-H, aniline N-H, allylic C-H, H2S, imine and nitrile conjugate acids) are general-textbook values marked unverified; the challenge list avoids graded answers that hinge on them, but the ranking engine uses them for margins.
- McMurry's own tables are internally inconsistent in places (NH3 35 in 9.7 text vs 36 in Appendix B; CF3CO2H 0.5 in App B vs 0.23 in Table 20.3; acetic acid 4.76 vs 4.8; alkane ~60 in 10e vs ~50 in older editions). The engine picks one value per class; the instructor should be shown the constant table.
- Odd-membered and aromatic rings cannot be built on the cubic lattice with face adjacency; phenol, pyridine, pyrrole, imidazole and cyclopentadiene examples from Tables 17.1/24.1/App B are therefore quiz-text only unless diagonal bonds are enabled.
- The cubic lattice shows 90-degree angles for every atom; students may conflate on-screen angles with hybridization angles. The HUD must state that reported angles are ideal values from McMurry 1.6-1.10, not the block geometry.
- The formal-charge learning objective cannot be assessed in the builder itself (the derived formal charge is tautologically the set charge); it depends on the quiz panel being built.
- Explicit-H blocks and implicit H must be treated identically by the pKa engine and the select-atom acceptance; mixing the two on one atom (e.g. one explicit H placed, one implicit) is a likely source of bugs and should be covered by tests.
- Amide N-H (~17) and alcohol O-H (15.5-16) are too close to rank reliably; the content validator's 3-unit margin rule must be enforced or such molecules will produce disputed answers.
