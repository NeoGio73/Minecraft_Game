# 04 — Reaction bench (`src/reactions/`)

Pure TypeScript under `src/reactions/` (WP-04): `react.ts` (dispatch), `decision.ts` (SN1/SN2/E1/E2 table), `helpers.ts` (site finders, graph operations, stereo template, warning and justification tables), `additions.ts`, `alkynes.ts`, `oxidation.ts`, `substitution.ts`, `elimination.ts`, `radical.ts`, `alcohols.ts`, `rearrangement.ts`. Data: `src/content/reagents.json` (WP-05, shape fixed here). The product-preview embedding is `embedOnLattice` (`src/chem/embed.ts`, WP-01, specified in 02 §13); section 7 states how the bench uses it. The bench interaction protocol (section 8) binds `src/app/State.ts`/`Game.ts` (WP-11), `src/ui/bench-panel.ts` (WP-09), `src/render/GhostRenderer.ts` (WP-08) and `src/content/acceptance.ts` (WP-05).

Contracts: `00-contracts.md`, `src/chem/types.ts` (`ReactOptions`, `ReactionResult`, `Mechanism`, `ReactionStereo`, `TetTag`, `EzTag`, `EmbedOptions`, `Embedding`), `src/content/types.ts` (`ReagentCard`, `Nucleophile`, `RuleId`, `SubstrateClass`, `PredictProductRule`, `ChooseReagentRule`, `SubmissionContext`), `src/world/types.ts` (zones, `Block.Bench`), `src/app/events.ts` (`bench:reacted`, `bench:cleared`). Names below are copied from them; additions are in section 1 only.

Sources: `docs/research/reaction-bench.md` (all), `mcmurry-orgo1.md` §7 and §9.5, `tools/reference/embed.py`, `stereo-on-grid.md` §5, `critic-round1.md`. Every product SMILES in section 9 was re-parsed with RDKit 2026.03.6 while writing this document (`verify04.py` in the session scratchpad: formula balance, canonical SMILES, CIP labels); the stereo template of §4.5 and the anti-periplanar rule of §5.8.4 were checked numerically against RDKit `AssignStereochemistryFrom3D` and against an explicit Newman-projection construction (results quoted where used).

Dependencies allowed (01-work-packages): `src/chem/graph.ts`, `smiles.ts`, `hydrogens.ts`, `isomorphism.ts`, `formula.ts` (WP-01); `compare.ts` (`sameMolecule`), `cip.ts` (`cipRank`), `stereo.ts` (`parityInOrder`, `tagsFromPositions` — protocol only) (WP-02). `react` never imports `analyze`, `groups`, `acidity`.

## 0. Conventions

- **Notation.** For graph `g`: `H(i)` = `implicitHydrogens(g).hydrogens[i]`; `deg(i)` = `g.adj[i].length` (heavy neighbours); `sp3(i)` ⇔ `el = C`, `!aromatic`, no bond of order ≥ 2; `carbonylC(i)` as in 02 §0. `partner` of an alkene/alkyne carbon = the other carbon of the π bond. `cls(c)` for a C–X or C–OH carbon = `deg(c) − 1` (0 methyl, 1 primary, 2 secondary, 3 tertiary).
- **Immutability.** Every builder returns a new `MoleculeGraph`; ids are re-densified by `graph.ts` edits. Because `withoutAtom` shifts ids above the removed one and drops any `tet`/`ez` that referenced it, every builder that removes an atom captures the tags it needs **before** the removal and restores them with remapped ids (`remap(i) = i > removed ? i − 1 : i`).
- **New atoms** are appended (`withAtom`), so ids of existing atoms never change during additions; bond indices never change unless a bond is removed. Builders that remove bonds (`OZONOLYSIS`, `DIOL_CLEAVAGE`, epoxide opening) re-look-up bond indices with `bondBetween` after each removal.
- **Hydrogens are implicit**: "gains an H" / "loses an H" is never a graph edit; valence arithmetic does it. `explicitH` on reactant atoms (from bracket SMILES) is cleared to `null` on every product atom whose bonding changed (otherwise the bracket count would be wrong). Simplest correct rule, used everywhere: **products carry `explicitH: null` on every atom** (`stripExplicitH`, §4.1); charged atoms keep `charge`.
- **Determinism.** Sites are visited in ascending bond index (`findAlkenes` etc. are sorted); candidate products in ascending atom id; ties broken by lowest id.
- **Aromatic rings are inert** (McMurry 8.3, 8.6): `findAlkenes` skips bonds with `aromatic: true` or with an aromatic endpoint; no rule touches an aromatic atom except as a passive neighbour (benzylic detection).
- **Chemistry never throws.** Every "cannot react" is `noReaction: true` with a justification. Structural misuse (card with unknown `rule`, `rx` missing for `NANH2_THEN_RX` is *not* misuse — it is a `noReaction`) throws `Error`.
- **Reactants are SMILES-derived library molecules** (00-contracts R6): stereo is read from `tet`/`ez` tags only. Free-play reactants built on the grid are converted with `tagsFromPositions` (03 §12) by the protocol layer before `react` sees them (§8.6).

## 1. Contract additions

Exact TypeScript used by this section and absent from the type files. Exported from the module named in the comment.

```ts
// src/reactions/helpers.ts
export interface PiBond { readonly bond: number; readonly a: number; readonly b: number; readonly order: 2 | 3; }
export interface CXSite { readonly c: number; readonly x: number; readonly bond: number; readonly halogen: 'F' | 'Cl' | 'Br' | 'I'; }
export interface COHSite { readonly c: number; readonly o: number; readonly bond: number; }
export type Cls = 0 | 1 | 2 | 3;
export interface SubstrateInfo {
  readonly c: number; readonly x: number; readonly cls: Cls;
  readonly allylic: boolean; readonly benzylic: boolean; readonly neopentyl: boolean;
  /** C–X carbon is sp2 (vinylic) or aromatic (aryl). */
  readonly sp2: boolean;
  /** Number of beta carbons (sp3, ≥1 H). */
  readonly betaH: number;
  /** A carbonyl carbon is bonded to a beta carbon (E1cB flag, warn only). */
  readonly betaCarbonyl: boolean;
}
/** 'H' = add nothing (implicit H); otherwise a fragment SMILES written from the attaching atom. */
export type Group = 'H' | string;
export type AddMode = 'syn' | 'anti' | 'none';
export type Orientation = 'zaitsev' | 'hofmann';
export interface RuleResult {
  readonly major: MoleculeGraph[]; readonly minor?: MoleculeGraph[];
  readonly mechanism: Mechanism; readonly stereo: ReactionStereo;
  readonly warnings: string[]; readonly justification: string;
  readonly mixture?: boolean; readonly noReaction?: boolean;
  /** true for cleavage rules (OZONOLYSIS, KMNO4_CLEAVAGE, DIOL_CLEAVAGE): `major` is a multiset of fragments and `react` must not dedupe it. */
  readonly fragments?: boolean;
}
export type RuleFn = (substrate: MoleculeGraph, card: ReagentCard, opts: Required<Pick<ReactOptions, 'equiv' | 'rearrangement'>> & Pick<ReactOptions, 'rx'>) => RuleResult;

export function hydrogensOf(g: MoleculeGraph): number[];                       // implicitHydrogens(g).hydrogens
export function stripExplicitH(g: MoleculeGraph): MoleculeGraph;
export function findAlkenes(g: MoleculeGraph): PiBond[];                        // order 2, C=C, non-aromatic, ascending bond index
export function findAlkynes(g: MoleculeGraph): PiBond[];                        // order 3, C≡C
export function findCX(g: MoleculeGraph): CXSite[];                             // single C–{F,Cl,Br,I}, any C
export function findCOH(g: MoleculeGraph): COHSite[];                           // single C–O, O has deg 1, charge 0 (H(o) = 1)
export function substrateClasses(g: MoleculeGraph): Set<SubstrateClass>;
export function alkylCount(g: MoleculeGraph, c: number, partner: number): number;  // deg(c) − 1
export function substrateClass(g: MoleculeGraph, c: number, partner: number): Cls;  // deg(c) − 1 clamped to 0..3
export function isAllylic(g: MoleculeGraph, c: number, partner: number): boolean;
export function isBenzylic(g: MoleculeGraph, c: number, partner: number): boolean;
export function isNeopentyl(g: MoleculeGraph, c: number, partner: number): boolean;
export function substrateInfo(g: MoleculeGraph, site: CXSite): SubstrateInfo;
export function markovnikov(g: MoleculeGraph, pi: PiBond): { readonly more: number; readonly less: number; readonly tie: boolean };
export function attachFragment(g: MoleculeGraph, atom: number, fragment: string, order?: BondOrder): { readonly graph: MoleculeGraph; readonly attached: number };
export function graftGraph(g: MoleculeGraph, atom: number, frag: MoleculeGraph, fragAtom: number): { readonly graph: MoleculeGraph; readonly attached: number; readonly offset: number };
export function addAcross(g: MoleculeGraph, pi: PiBond, toA: Group, toB: Group): { readonly graph: MoleculeGraph; readonly newA: number | 'H'; readonly newB: number | 'H' };
export function applyAdditionStereo(g: MoleculeGraph, pi: PiBond, newA: number | 'H', newB: number | 'H', mode: AddMode, reactant: MoleculeGraph): { readonly graph: MoleculeGraph; readonly stereo: ReactionStereo; readonly warnings: string[] };
export function tautomerize(g: MoleculeGraph, enolC: number, partnerC: number, o: number): MoleculeGraph;
export function substituteInvert(g: MoleculeGraph, site: CXSite, fragment: string): MoleculeGraph;
export function substituteRacemize(g: MoleculeGraph, site: CXSite, fragment: string): MoleculeGraph;
export function eliminate(g: MoleculeGraph, cX: number, beta: number, x: number): { readonly graph: MoleculeGraph; readonly a: number; readonly b: number; readonly bond: number };
export function splitComponents(g: MoleculeGraph): MoleculeGraph[];             // one dense graph per component, ascending min id
export function sameProduct(a: MoleculeGraph, b: MoleculeGraph): boolean;        // sameMolecule(a, b, { stereo: 'none' }).same
export function dedupe(list: readonly MoleculeGraph[]): MoleculeGraph[];         // keeps first of each sameProduct class
export function isStereocenter(g: MoleculeGraph, hydrogens: readonly number[], atom: number): boolean;
export function noReaction(justification: string, warnings?: string[]): RuleResult;
export const WARN: { /* §5.9.2 */ };
export const JUSTIFY: { /* §5.9.3 */ };
export const RADICAL_WEIGHTS: Readonly<Record<'Cl' | 'Br', Readonly<Record<1 | 2 | 3, number>>>>;  // §5.4.2

// src/reactions/decision.ts
export type DecisionRule = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';
export interface Decision { readonly mechanisms: Mechanism[]; readonly rule: DecisionRule; readonly justification: string; readonly warnings: string[]; readonly orientation: Orientation; }
export function decide(substrate: MoleculeGraph, cX: number, card: ReagentCard): Decision;   // contract signature; returns Decision (superset)

// src/reactions/rearrangement.ts
export interface Shift { readonly kind: 'hydride' | 'methyl'; readonly from: number; readonly to: number; readonly migrating?: number; readonly newClass: number; }
export function cationClass(g: MoleculeGraph, c: number): number;               // deg(c) + allylic/benzylic bonus
export function checkShift(g: MoleculeGraph, c: number): Shift | null;
export function applyShift(g: MoleculeGraph, shift: Shift): MoleculeGraph;      // graph after the 1,2-shift (cation now at shift.to)

// src/reactions/react.ts
export const RULES: Readonly<Record<RuleId, RuleFn>>;
export const ROH_MECHANISM: Readonly<Record<'ROH_HX_HCL' | 'ROH_HX_HBR' | 'ROH_SOCL2' | 'ROH_PBR3' | 'ROH_HF_PYR', 'SN1' | 'SN2'>>;
export const LEGACY_REAGENT_IDS: Readonly<Record<string, ReagentId>>;          // §2.4

// src/reactions/helpers.ts — preview fallback (pure; used by GhostRenderer through State)
export function relaxedLayout(g: MoleculeGraph): Vec3[];                        // §7.5

// src/app/State.ts (WP-11) — bench state read by the panel and the renderer
export interface BenchState {
  readonly mode: 'idle' | 'predict' | 'choose' | 'free';
  readonly challengeId: string | null;
  readonly reactant: MoleculeGraph | null;          // SMILES-derived (with tags) or tagsFromPositions(free play)
  readonly rx: MoleculeGraph | null;
  readonly cardId: ReagentId | null;               // predict: fixed; choose/free: last chosen
  readonly equiv: 1 | 2;
  readonly result: ReactionResult | null;
  readonly preview: 'hidden' | 'ghost' | 'sticks';
  readonly previews: readonly { readonly graph: MoleculeGraph; readonly pos: readonly Vec3[]; readonly hPos: ReadonlyMap<number, readonly Vec3[]>; readonly buildable: boolean }[];
}
```

`Decision` is assignable to the contract's `{ mechanisms; rule; justification }`. `RuleResult` lacks only `reagentId`, which `react` adds; `fragments` is consumed by `react` (§5.9) and not copied into `ReactionResult`.

## 2. Reagent cards

### 2.1 Card table (all 56 `REAGENT_IDS`, data in `src/content/reagents.json`)

Columns: `substrates` (`SubstrateClass[]`), `rule`, `hal` (`halogen`), `eq` (default `equiv`), `sol` (`solvent`), `heat`, flags (`M` = `notInMcMurry10e`, `D` = `requiresDiagonalBonds`), `on` = `enabledByDefault` (SCOPE.md decides). `nuc` rows are in §2.2. Section numbers are OpenStax 10e.

| id | label | reagentText | ch | section | substrates | rule | hal | eq | sol | heat | flags | on |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| HX_HCL | HCl | HCl, ether | 7 | 7.7 | alkene, alkyne | HX_ADD | Cl | 1 | — | — | | yes |
| HX_HBR | HBr | HBr, ether | 7 | 7.7 | alkene, alkyne | HX_ADD | Br | 1 | — | — | | yes |
| HX_HI | HI | HI (KI, H3PO4) | 7 | 7.7 | alkene, alkyne | HX_ADD | I | 1 | — | — | | yes |
| HX_2EQ_HBR | 2 HBr | 2 HBr, ether | 9 | 9.3 | alkyne | HX_ADD | Br | 2 | — | — | | yes |
| HX_2EQ_HCL | 2 HCl | 2 HCl, ether | 9 | 9.3 | alkyne | HX_ADD | Cl | 2 | — | — | | yes |
| HBR_ROOR | HBr, peroxides | HBr, ROOR | 8 | 8.10 (not in 10e) | alkene | RADICAL_HBR | Br | 1 | — | — | M | yes |
| X2_BR2 | Br2 | Br2, CH2Cl2 | 8 | 8.2 / 9.3 | alkene, alkyne | X2_ADD | Br | 1 | — | — | | yes |
| X2_CL2 | Cl2 | Cl2, CH2Cl2 | 8 | 8.2 / 9.3 | alkene, alkyne | X2_ADD | Cl | 1 | — | — | | yes |
| HOX_BR2_H2O | Br2, H2O | Br2, H2O (or NBS, H2O/DMSO) | 8 | 8.3 | alkene | HOX_ADD | Br | 1 | — | — | | yes |
| HOX_CL2_H2O | Cl2, H2O | Cl2, H2O | 8 | 8.3 | alkene | HOX_ADD | Cl | 1 | — | — | | yes |
| H3O_HYDRATION | H3O+ | H2O, H2SO4 (cat.) | 8 | 8.4 | alkene | HYDRATION | — | 1 | protic | — | | yes |
| OXYMERC | oxymercuration | 1) Hg(OAc)2, H2O/THF 2) NaBH4 | 8 | 8.4 | alkene | OXYMERC | — | 1 | — | — | | yes |
| HYDROBORATION | hydroboration–oxidation | 1) BH3, THF 2) H2O2, NaOH | 8 | 8.5 | alkene | HYDROBORATION | — | 1 | — | — | | yes |
| H2_PD | H2, Pd/C | H2, Pd/C (or PtO2) | 8 | 8.6 / 9.5 | alkene, alkyne | H2 | — | 1 | — | — | | yes |
| MCPBA | epoxidation | RCO3H (m-CPBA), CH2Cl2 | 8 | 8.7 | alkene | EPOXIDATION | — | 1 | — | — | D | no |
| EPOXIDE_H3O | epoxide hydrolysis | H3O+ | 8 | 8.7 | epoxide | EPOXIDE_OPEN | — | 1 | protic | — | D | no |
| ANTI_DIHYDROXYLATION | 1) RCO3H 2) H3O+ | 1) m-CPBA 2) H3O+ | 8 | 8.7 | alkene | ANTI_DIOL | — | 1 | — | — | | yes |
| OSO4 | syn dihydroxylation | 1) OsO4 2) NaHSO3, H2O | 8 | 8.7 | alkene | SYN_DIOL | — | 1 | — | — | | yes |
| KMNO4_COLD | KMnO4, cold, OH− | KMnO4, NaOH, 0 °C | 8 | 8.7 (not in 10e) | alkene | SYN_DIOL | — | 1 | — | — | M | no |
| O3_ZN | ozonolysis | 1) O3 2) Zn, H3O+ | 8 | 8.8 | alkene | OZONOLYSIS | — | 1 | — | — | | yes |
| KMNO4_HOT | KMnO4, H3O+ | KMnO4, H3O+, heat | 8 | 8.8 / 9.6 | alkene, alkyne | KMNO4_CLEAVAGE | — | 1 | — | yes | | yes |
| HIO4 | periodic acid | HIO4, H2O | 8 | 8.8 | diol | DIOL_CLEAVAGE | — | 1 | — | — | | no |
| CH2I2_ZNCU | Simmons–Smith | CH2I2, Zn(Cu), ether | 8 | 8.9 | alkene | CYCLOPROPANATION | — | 1 | — | — | D | no |
| CHCL3_KOH | dichlorocarbene | CHCl3, KOH | 8 | 8.9 | alkene | CYCLOPROPANATION | Cl | 1 | — | — | D | no |
| HGSO4_HYDRATION | Hg-catalysed hydration | H2O, H2SO4, HgSO4 | 9 | 9.4 | alkyne | ALKYNE_HYDRATION_HG | — | 1 | protic | — | | yes |
| HYDROBORATION_ALKYNE | alkyne hydroboration–oxidation | 1) BH3 (Sia2BH), THF 2) H2O2, NaOH | 9 | 9.4 | alkyne | ALKYNE_HYDROBORATION | — | 1 | — | — | | yes |
| H2_LINDLAR | Lindlar hydrogenation | H2, Lindlar catalyst | 9 | 9.5 | alkyne | LINDLAR | — | 1 | — | — | | yes |
| LI_NH3 | Li, NH3 | Li (or Na), NH3(l) | 9 | 9.5 | alkyne | DISSOLVING_METAL | — | 1 | — | — | | yes |
| NANH2_THEN_RX | 1) NaNH2 2) R–Br | 1) NaNH2, NH3 2) R–Br (R = CH3 or primary) | 9 | 9.8–9.9 | terminal-alkyne | ACETYLIDE_ALKYLATION | — | 1 | — | — | | yes |
| NANH2_2EQ_DIHALIDE | 2 NaNH2, then H3O+ | 2 NaNH2, NH3; then H3O+ | 9 | 9.2 | vicinal-dihalide | DOUBLE_E2 | — | 2 | — | — | | yes |
| NBS_HV | NBS, hν | NBS, hν, CCl4 | 10 | 10.3 | allylic-alkene | ALLYLIC_BROMINATION | Br | 1 | — | — | | yes |
| CL2_HV | Cl2, hν | Cl2, hν | 10 | 10.2 | alkane | RADICAL_HALOGENATION | Cl | 1 | — | — | | yes |
| BR2_HV | Br2, hν | Br2, hν | 10 | 10.2 | alkane | RADICAL_HALOGENATION | Br | 1 | — | — | | yes |
| ROH_HX_HCL | HCl (on alcohols) | HCl, ether, 0 °C | 10 | 10.5 | alcohol | ROH_TO_RX | Cl | 1 | protic | — | | yes |
| ROH_HX_HBR | HBr (on alcohols) | HBr, ether, 0 °C | 10 | 10.5 | alcohol | ROH_TO_RX | Br | 1 | protic | — | | yes |
| ROH_SOCL2 | SOCl2 | SOCl2, pyridine | 10 | 10.5 | alcohol | ROH_TO_RX | Cl | 1 | aprotic | — | | yes |
| ROH_PBR3 | PBr3 | PBr3, ether | 10 | 10.5 | alcohol | ROH_TO_RX | Br | 1 | aprotic | — | | yes |
| ROH_HF_PYR | HF–pyridine | HF, pyridine | 10 | 10.5 | alcohol | ROH_TO_RX | F | 1 | aprotic | — | | no |
| SN2_NAOH | NaOH | NaOH, H2O/DMSO | 11 | 11.2–11.3 | alkyl-halide | SUBST_ELIM | — | 1 | protic | — | | yes |
| SN2_NAOCH3 | NaOCH3 | NaOCH3, CH3OH | 11 | 11.3 / 11.7 | alkyl-halide | SUBST_ELIM | — | 1 | protic | — | | yes |
| SN2_NAOET | NaOEt | NaOCH2CH3, CH3CH2OH | 11 | 11.7 | alkyl-halide | SUBST_ELIM | — | 1 | protic | — | | yes |
| SN2_NAI | NaI | NaI, acetone | 11 | 11.3 | alkyl-halide | SUBST_ELIM | — | 1 | aprotic | — | | yes |
| SN2_NACN | NaCN | NaCN, DMSO | 11 | 11.3 | alkyl-halide | SUBST_ELIM | — | 1 | aprotic | — | | yes |
| SN2_NAN3 | NaN3 | NaN3, DMF | 11 | 11.3 | alkyl-halide | SUBST_ELIM | — | 1 | aprotic | — | | no |
| SN2_NASH | NaSH | NaSH, ethanol | 11 | 11.3 | alkyl-halide | SUBST_ELIM | — | 1 | protic | — | | no |
| SN2_NH3 | NH3 | NH3 (excess) | 11 | 11.3 | alkyl-halide | SUBST_ELIM | — | 1 | protic | — | | no |
| SN2_NAOAC | NaOAc | CH3CO2Na, CH3CO2H/H2O | 11 | 11.5 | alkyl-halide | SUBST_ELIM | — | 1 | protic | — | | no |
| SN2_ACETYLIDE | Na+ −C≡CCH3 | NaC≡CCH3, NH3 | 11 | 9.9 / 11.3 | alkyl-halide | SUBST_ELIM | — | 1 | protic | — | | yes |
| TBUOK | KOtBu | KOC(CH3)3, tBuOH | 11 | 11.12 | alkyl-halide | SUBST_ELIM | — | 1 | protic | — | M | yes |
| NANH2_BASE | NaNH2 | NaNH2, NH3 | 11 | 11.8 | alkyl-halide | SUBST_ELIM | — | 1 | protic | — | | yes |
| KOH_ETOH | KOH, ethanol | KOH, CH3CH2OH, heat | 8 | 8.1 / 11.7 | alkyl-halide | SUBST_ELIM | — | 1 | protic | yes | | yes |
| H2O_HEAT | H2O, heat | H2O, heat | 11 | 11.4 / 11.10 | alkyl-halide | SUBST_ELIM | — | 1 | protic | yes | | yes |
| ETOH_HEAT | ethanol, heat | CH3CH2OH, heat | 11 | 11.5 / 11.10 | alkyl-halide | SUBST_ELIM | — | 1 | protic | yes | | yes |
| MEOH_HEAT | methanol, heat | CH3OH, heat | 11 | 11.5 | alkyl-halide | SUBST_ELIM | — | 1 | protic | yes | | no |
| HCOOH_H2O | HCO2H, H2O | HCO2H, H2O | 11 | 11.12 | alkyl-halide | SUBST_ELIM | — | 1 | protic | — | | no |
| H2SO4_HEAT_ROH | H2SO4, heat (dehydration) | H2SO4, H2O/THF, 50 °C | 8 | 8.1 | alcohol | DEHYDRATION | — | 1 | protic | yes | | yes |

`TBUOK` is on (SCOPE lists ch 11 bases) but its Hofmann orientation carries the "(not in McMurry 10e)" tag in the panel; `HBR_ROOR` is on because SCOPE lists radical HBr (00-contracts R13). `label` is the hotbar text; the panel shows `label` + `reagentText` + "McMurry §section".

### 2.2 Nucleophile attributes (`card.nuc`, SUBST_ELIM cards only; OpenStax Table 11.1 and 11.12 text)

| id | atom | fragment | strength | basicity | bulky | charged |
|---|---|---|---|---|---|---|
| SN2_NAOH | O | `O` | strong | strong | false | true |
| SN2_NAOCH3 | O | `OC` | strong | strong | false | true |
| SN2_NAOET | O | `OCC` | strong | strong | false | true |
| SN2_NAI | I | `I` | strong | weak | false | true |
| SN2_NACN | C | `C#N` | strong | weak | false | true |
| SN2_NAN3 | N | `N=[N+]=[N-]` | strong | weak | false | true |
| SN2_NASH | S | `S` | strong | weak | false | true |
| SN2_NH3 | N | `N` | moderate | weak | false | false |
| SN2_NAOAC | O | `OC(C)=O` | moderate | weak | false | true |
| SN2_ACETYLIDE | C | `C#CC` | strong | strong | false | true |
| TBUOK | O | `OC(C)(C)C` | strong | strong | true | true |
| NANH2_BASE | N | `N` | strong | strong | false | true |
| KOH_ETOH | O | `O` | strong | strong | false | true |
| H2O_HEAT | O | `O` | weak | weak | false | false |
| ETOH_HEAT | O | `OCC` | weak | weak | false | false |
| MEOH_HEAT | O | `OC` | weak | weak | false | false |
| HCOOH_H2O | O | `OC=O` | weak | weak | false | false |

Fragments are parsed with `parseSmiles` at load; atom 0 of the fragment is the attaching atom. `test/content/reagents.test.ts` asserts: every id in `REAGENT_IDS` appears exactly once; every SUBST_ELIM card has `nuc` and `solvent`; every fragment parses; `halogen` is set on HX_ADD, X2_ADD, HOX_ADD, RADICAL_HBR, ALLYLIC_BROMINATION, RADICAL_HALOGENATION, ROH_TO_RX cards; `requiresDiagonalBonds` ⇒ `enabledByDefault: false`.

### 2.3 Substrate class perception (`substrateClasses(g)`)

| class | present iff |
|---|---|
| `alkene` | `findAlkenes(g).length > 0` |
| `alkyne` | `findAlkynes(g).length > 0` |
| `terminal-alkyne` | some alkyne with `H(a) = 1` or `H(b) = 1` |
| `allylic-alkene` | some alkene carbon has a neighbour `n` (≠ partner) with `sp3(n)` and `H(n) ≥ 1` |
| `alkyl-halide` | some `CXSite` whose carbon is `sp3` |
| `vicinal-dihalide` | two `CXSite`s on bonded sp3 carbons each with `H ≥ 1`, or one `CXSite` on an alkene carbon whose partner has `H ≥ 1` |
| `alcohol` | some `COHSite` with `sp3(c)` |
| `diol` | two `COHSite`s on bonded carbons |
| `epoxide` | a 3-ring (`smallestRings(g, 3)`) of two C and one O |
| `alkane` | every atom is C with charge 0, every bond order 1, no aromatic atoms, and some C has `H ≥ 1` |

`react` refuses a card whose `substrates` do not intersect the set: `noReaction(JUSTIFY.noSubstrate(card))`.

### 2.4 Legacy id mapping (mcmurry-orgo1 §7.1 → canonical ids; `LEGACY_REAGENT_IDS`, used only by the content validator to accept old challenge drafts)

hbr→HX_HBR, hcl→HX_HCL, hi→HX_HI, hbr_2equiv→HX_2EQ_HBR, hx_ether(hcl)→ROH_HX_HCL, hx_ether(hbr)→ROH_HX_HBR, br2_ch2cl2→X2_BR2, cl2_ch2cl2→X2_CL2, br2_h2o→HOX_BR2_H2O, nbs_h2o→HOX_BR2_H2O, hg_oac2_then_nabh4→OXYMERC, bh3_then_h2o2→HYDROBORATION, h2so4_h2o→H3O_HYDRATION (alkene reactant) / H2SO4_HEAT_ROH (alcohol reactant; the validator picks by substrate class), h2_pd→H2_PD, h2_pt→H2_PD, h2_lindlar→H2_LINDLAR, li_nh3→LI_NH3, mcpba→MCPBA, mcpba_then_h3o→ANTI_DIHYDROXYLATION, oso4_nmo→OSO4, o3_then_zn→O3_ZN, kmno4_h3o→KMNO4_HOT, koh_etoh→KOH_ETOH, naoet_etoh→SN2_NAOET, kotbu→TBUOK, naoh→SN2_NAOH, nacn_dmso→SN2_NACN, nai_acetone→SN2_NAI, h2o_heat→H2O_HEAT, etoh_heat→ETOH_HEAT, hgso4_h2so4_h2o→HGSO4_HYDRATION, sia2bh_then_h2o2→HYDROBORATION_ALKYNE, nanh2_nh3→NANH2_BASE, nanh2_then_*→NANH2_THEN_RX (the suffix becomes `rx`), nbs_hv→NBS_HV, cl2_hv→CL2_HV, br2_hv→BR2_HV, socl2_pyridine→ROH_SOCL2, pbr3→ROH_PBR3, hf_pyridine→ROH_HF_PYR. `mg_ether` and `li_then_cui` have no card (Grignard/organocuprate need an Mg block: out of v1).

## 3. Site helpers (`helpers.ts`)

```
findAlkenes(g): for k ascending over g.bonds: order === 2, both endpoints el 'C', neither aromatic, bond not aromatic → { bond: k, a, b, order: 2 }
findAlkynes(g): order === 3, both 'C'
findCX(g):      order === 1, one endpoint 'C' (any hybridisation), other ∈ {F,Cl,Br,I} with charge 0 → { c, x, bond, halogen }
findCOH(g):     order === 1, one endpoint 'C', other 'O' with charge 0 and deg 1 (so H(o) = 1)
alkylCount(g, c, partner) = deg(c) − 1
substrateClass(g, c, partner) = min(3, deg(c) − 1) as Cls        // for C–X: partner = x
isAllylic(g, c, partner): some neighbour n ≠ partner of c with a bond of order 2 (non-aromatic) to a third atom m ≠ c, n el 'C'
isBenzylic(g, c, partner): some neighbour n ≠ partner with n.aromatic
isNeopentyl(g, c, partner): substrateClass === 1 and the single heavy neighbour n ≠ partner has deg(n) === 4
substrateInfo(g, site): cls, allylic, benzylic, neopentyl (partner = site.x); sp2 = c.aromatic || some bond on c has order ≥ 2;
   betaH = count of neighbours n ≠ x of c with sp3(n) && H(n) ≥ 1; betaCarbonyl = some neighbour n ≠ x of c has a neighbour m ≠ c with carbonylC(m)
```

### 3.1 Markovnikov selector

```
markovnikov(g, pi):
  ka = alkylCount(g, a, b) + (isAllylic(g, a, b) || isBenzylic(g, a, b) ? 1 : 0)
  kb = alkylCount(g, b, a) + (isAllylic(g, b, a) || isBenzylic(g, b, a) ? 1 : 0)
  ka > kb → { more: a, less: b, tie: false }; ka < kb → { more: b, less: a, tie: false }; else { more: a, less: b, tie: true }
```
The nucleophile-derived group (X of HX, OH of H2O/HOX) goes to `more`, the electrophile-derived group (H, Br+ of Br2/H2O) to `less`; anti-Markovnikov cards (HYDROBORATION, RADICAL_HBR, ALKYNE_HYDROBORATION) swap. The +1 bonus encodes "primary allylic/benzylic ≈ secondary" (McMurry 7.9) and never affects v1 content (no conjugated substrates).

**Tie handling** (every regiochemical rule): build `p1` (nucleophile-derived group on `a`) and `p2` (on `b`). If `sameProduct(p1, p2)` the alkene is symmetric: `major = [p1]`, no warning (2-butene + HBr → 2-bromobutane). Otherwise `major = [p1, p2]`, `mixture: true`, `warnings += WARN.regioMixture` (2-pentene + HBr → 2- and 3-bromopentane). Stereo finalisation runs on each product separately and the result `stereo` is the "weakest" of the two (`none` < `racemic` < `relative` < `absolute`).

### 3.2 Multiple sites

`sites = [...findAlkenes(g), ...findAlkynes(g)]` filtered to the orders the rule accepts. Symmetric-reagent rules (X2_ADD on alkenes, H2, SYN_DIOL, ANTI_DIOL, EPOXIDATION, CYCLOPROPANATION, OZONOLYSIS, KMNO4_CLEAVAGE) react **every** site: additions in ascending bond index (atom ids and bond indices are stable because nothing is removed); cleavages in descending bond index. Regiochemical rules (HX_ADD, RADICAL_HBR, HOX_ADD, HYDRATION, OXYMERC, HYDROBORATION, the alkyne hydrations, LINDLAR, DISSOLVING_METAL) react `sites[0]` only and push `WARN.multipleSites(n, kind)` when `n > 1`. HX_ADD/X2_ADD with both an alkene and an alkyne present react the alkene first (it is `sites[0]`) and warn. v1 content uses single-site substrates; the warning exists for free play.

## 4. Graph operations

### 4.1 Fragments and atoms

- `stripExplicitH(g)` = every atom with `explicitH: null`, everything else unchanged. Applied once by `react` to every product.
- `attachFragment(g, atom, fragment, order = 1)`: `f = parseSmiles(fragment).graph`; `offset = g.atoms.length`; append every fragment atom (ids `+offset`, `tet`/`ez` remapped, `explicitH` kept until the final strip), append every fragment bond, then `withBond(atom, offset, order)`. Returns `attached = offset`. `'H'` as a `Group` means "attach nothing".
- `graftGraph(g, atom, frag, fragAtom)`: same with an already-parsed graph; returns `offset` so callers can remap `frag` ids (`id + offset`).
- `splitComponents(g)`: `components(g)` → for each, `buildGraph` over its atoms renumbered in ascending old id, bonds and tags remapped; `explicitH`, `charge`, `aromatic`, `tet`, `ez` preserved.

### 4.2 `addAcross(g, pi, toA, toB)`

1. `g1 = withBondOrder(g, pi.bond, (pi.order − 1) as BondOrder)`; if `pi.order === 2` and the bond had `ez`, `g1 = withEz(g1, pi.bond, undefined)`.
2. `newA = toA === 'H' ? 'H' : attachFragment(g1, pi.a, toA).attached` (graph updated); `newB` likewise on `pi.b`.
3. Return `{ graph, newA, newB }`. Any `tet` on `pi.a`/`pi.b` (impossible for sp2 carbons; defensive) is dropped.

### 4.3 `tautomerize(g, enolC, partnerC, o)`

Enol `partnerC=enolC–O–H` → carbonyl: `withBondOrder(bondBetween(enolC, partnerC), 1)`, `withBondOrder(bondBetween(enolC, o), 2)`. Implicit H does the rest (O loses its H, `partnerC` gains one). Keto form is always the product (McMurry 9.4 "with few exceptions").

### 4.4 Substitution and elimination primitives

```
substituteInvert(g, site, fragment):
  tet0 = g.atoms[site.c].tet                       // may be undefined
  g1 = withoutAtom(g, site.x); r = i => i > site.x ? i − 1 : i; c = r(site.c)
  { graph: g2, attached } = attachFragment(g1, c, fragment)
  if tet0: order = tet0.order.map(o => o === site.x ? attached : (o === 'H' ? 'H' : r(o)))
           g2 = withTet(g2, c, { order, sign: −tet0.sign })      // same slot, flipped sign = inversion
  return g2
```
Verified (reaction-bench §2.5, RDKit): `C[C@H](Br)CC` + OH → `C[C@@H](O)CC`; (S)-2-bromobutane → (R)-2-butanol. `substituteRacemize` is identical except the tag is not restored (`withTet(g2, c, undefined)` after `attachFragment`; `withoutAtom` already dropped it). Retention is never needed in v1.

```
eliminate(g, cX, beta, x):
  g1 = withoutAtom(g, x); r as above; a = min(r(cX), r(beta)); b = max(...)
  k = bondBetween(g1, a, b); g2 = withBondOrder(g1, k, 2); g2 = withTet(g2, a, undefined); g2 = withTet(g2, b, undefined)
  return { graph: g2, a, b, bond: k }
```
`x` may be any leaving-group atom (halogen, or the O of an alcohol for DEHYDRATION).

### 4.5 Syn/anti stereo template (`applyAdditionStereo`)

Inputs: product graph `g` (after `addAcross`), the reacted π bond `pi` (carbons `c1 = pi.a`, `c2 = pi.b`), the new groups `X = newA`, `Y = newB` (ids or `'H'`), `mode`, and the reactant graph (for the cis/trans relation and pre-existing tags).

1. **Other neighbours.** `others(c)` = the two entries among {heavy neighbours of `c` in `g` other than partner and the new group} ∪ {`'H'` × `H(c)` in `g`, minus one if the new group is `'H'`}, so that `[partner, a, b, new]` lists exactly four σ-partners. If `c` does not have four σ-partners (sp2 after an alkyne addition) it is skipped as a centre.
2. **Reference pair and relation.** Choose `a1 ∈ others(c1)`, `a2 ∈ others(c2)` and `cis`:
   - if `ringsThrough(reactant, c1, c2)` is non-empty: `a1`, `a2` = the ring-continuation neighbours of `c1`, `c2` in the smallest such ring; `cis = true`;
   - else if the reactant bond carried `ez`: `a1 = ez.refA`, `a2 = ez.refB`, `cis = ez.cis` (a ref `'H'` is allowed);
   - else `cis = undefined`.
   `b1`, `b2` = the remaining entries.
3. **Closed-form tags** (from the local frame of reaction-bench §2.1: `c1 = (0,0,0)`, `c2 = (1,0,0)`, `a1 = (−.5,.87,0)`, `b1 = (−.5,−.87,0)`, `a2 = (1.5, ±.87, 0)` by `cis`, `X = (0,0,1)`, `Y = (1,0,±1)` by mode; the signed volumes over `[partner, a, b, new]` reduce to constants — verified against RDKit `AssignStereochemistryFrom3D` on the eight cases of §9.3):
   ```
   tet(c1) = { order: [c2, a1, b1, X], sign: +1 }
   tet(c2) = { order: [c1, a2, b2, Y], sign: (cis ? +1 : −1) × (mode === 'anti' ? +1 : −1) }
   ```
   For `mode === 'none'` no tags are written. For `cis === undefined` (untagged acyclic alkene) the tags are written only if at most one of `c1`, `c2` will be a centre (step 4 then drops them anyway); if both would be centres: no tags, `warnings += WARN.geometryUnspecified`, `stereo = 'none'`.
4. **Finalise.** `hyd = hydrogensOf(g)`; `centers = [c1, c2].filter(c => isStereocenter(g, hyd, c))`; `retained` = the reactant had a `tet` on any atom other than `c1`, `c2` (those survive unchanged into the product).
   | mode | centers | action | `stereo` |
   |---|---|---|---|
   | none | 0 | — | `none` |
   | none | 1 | — (no tag was written) | `racemic` |
   | none | 2 | `WARN.diastereomerMixture` | `none` |
   | syn/anti | 0 | drop any tags on c1, c2 | `none` |
   | syn/anti | 1 | drop tags on c1, c2 | `racemic` |
   | syn/anti | 2, `!retained` | keep both tags | `relative` |
   | syn/anti | 2, `retained` | drop both tags, `WARN.facialSelectivity` | `absolute` |
   | any | ≥1 and `retained`, tags dropped | as above | `absolute` |
   When `retained` and no new centre forms, `stereo = 'absolute'` (e.g. H2 on an alkene elsewhere in a chiral molecule).
5. **`isStereocenter(g, hyd, c)`**: `el === 'C'`, `!aromatic`, `deg(c) + hyd[c] === 4`, `hyd[c] ≤ 1`, no bond of order ≥ 2, and `cipRank(g, hyd, c).tie === false` (a Rule-1a tie, including one flagged `tieNeedsAdvancedRules`, means "not a centre" in v1; this makes C1 of 1-bromo-1-methylcyclohexane a non-centre and both carbons of trans-1,2-dibromocyclohexane centres).

`ReactionStereo` meaning (contract): `racemic` = exactly one new centre, no tag; `relative` = syn/anti pair on an achiral reactant (either enantiomer accepted); `absolute` = the reactant's own centres are retained/inverted.

### 4.6 Alkyne E/Z tags

After a one-equivalent addition to an alkyne (`pi.order === 3`, bond now 2), `ezTag(g, pi, refA, refB, cis)` writes `ez = { refA, refB, cis }` only when each of `c1`, `c2` has two *different* σ-partners besides its partner, i.e. `deg(c) + H(c) === 3` and not (`H(c) === 2`); otherwise (terminal =CH2) no tag. Refs prefer heavy atoms: if the intended ref is `'H'` and the carbon has a heavy non-partner neighbour `n`, use `n` and negate `cis`.

| rule | refA (on c1) | refB (on c2) | cis | meaning |
|---|---|---|---|---|
| HX_ADD 1 equiv | the heavy substituent `a1` of c1 (H went to c1) | X (on c2) | true | H and X trans (McMurry 9.3) |
| X2_ADD 1 equiv | X1 | X2 | false | trans dihaloalkene |
| LINDLAR | `a1` | `a2` | true | cis alkene |
| DISSOLVING_METAL | `a1` | `a2` | false | trans alkene |

Checks (RDKit): 3-hexyne + HCl → `CC/C(Cl)=C/CC` (Z, Cl cis to the far ethyl); 1-butyne + Br2 → `Br/C=C(/Br)CC` (E); 4-octyne + Lindlar → `CCC/C=C\CCC` (Z); + Li/NH3 → `CCC/C=C/CCC` (E).

## 5. Transformation rules

Every rule is `apply<Rule>(substrate, card, opts): RuleResult` (`RuleFn`, §1). `opts.equiv` defaults to `card.equiv ?? 1`, `opts.rearrangement` to `'warn'`. "Site" means the entry selected by §3.2. Products pass through `stripExplicitH` and (unless the rule sets `fragments: true`) `dedupe` in `react` (§5.9).

### 5.1 `additions.ts`

| rule | groups → (less-substituted C / more-substituted C) | mode | rearrangement | notes |
|---|---|---|---|---|
| HX_ADD (alkene) | H / X | none | yes | `X = card.halogen` |
| RADICAL_HBR | Br / H | none | no | anti-Markovnikov; mechanism `radical` |
| X2_ADD (alkene) | X / X | anti | no | symmetric: no Markovnikov call |
| HOX_ADD | X / OH | anti | no | halohydrin |
| HYDRATION | H / OH | none | yes | |
| OXYMERC | H / OH | none | no | mercurinium ion: no shift |
| HYDROBORATION | OH / H | syn | no | anti-Markovnikov |
| H2 (alkene) | H / H | syn | no | all sites; alkynes twice |
| SYN_DIOL | OH / OH | syn | no | OSO4, KMNO4_COLD |
| ANTI_DIOL | OH / OH | anti | no | composite of MCPBA + EPOXIDE_H3O |
| EPOXIDATION | one O bonded to both | syn | no | 3-ring: `diagonal` on one C–O bond |
| CYCLOPROPANATION | one C (H2 or Cl2) bonded to both | syn | no | 3-ring |

**Generic addition** (`addWithRegio(g, pi, nucGroup, elGroup, mode, swap)`), used by every row except the last two:
1. `{more, less, tie} = markovnikov(g, pi)`; if `swap` (anti-Markovnikov) exchange `more`/`less`. For symmetric groups (X/X, H/H, OH/OH) skip the selector: `more = pi.b`, `less = pi.a`, `tie = false`.
2. `build(toLess, toMore)`: `{graph, newA, newB} = addAcross(g, pi, groupFor(pi.a), groupFor(pi.b))` then `applyAdditionStereo(graph, pi, newA, newB, mode, g)`.
3. If `tie`: `p1 = build(elGroup→a, nucGroup→b)`, `p2 = build(nucGroup→a, elGroup→b)`; §3.1 tie handling.
4. Rearrangement rows (`HX_ADD`, `HYDRATION`), no tie: `c = more` (the carbon that receives X/OH is the cation carbon); `shift = checkShift(g', c)` where `g' = withBondOrder(g, pi.bond, 1)` (the π bond lowered to single; the new H on `less` and the empty valence on `c` follow from the H arithmetic). Policy §5.6: `warn` → `major = [unrearranged, rearranged]`, `mixture: true`, `WARN.rearrangement`; `apply` → `major = [rearranged]`, `WARN.rearrangementApplied`; `ignore` → `[unrearranged]`. The rearranged product = `attachFragment(applyShift(g', shift), shift.to, X)`.
5. `mechanism: 'addition'` (`'radical'` for RADICAL_HBR); `justification = JUSTIFY[rule]`.

**HX_ADD on an alkyne** (`pi.order === 3`): `{more, less, tie}`; 1 equiv: `addAcross(g, pi, H→less, X→more)`, then `ezTag` per §4.6 (H and X trans); `stereo: 'none'`; tie (unsymmetrical internal alkyne, both carbons `alkylCount = 1`) → both vinyl halides, `WARN.regioMixture`. `equiv === 2`: apply the 1-equiv step, then on the product alkene (the same bond, now order 2) add H to the carbon **without** X and X to the carbon **already bearing X** (halogen-stabilised cation; the substitution count agrees), giving the geminal dihalide. Cards `HX_2EQ_*` set `equiv: 2`; `opts.equiv` overrides for `HX_HCL/HBR/HI` in free play. `HX_2EQ_*` on an alkene → `noReaction(JUSTIFY.twoEquivAlkene)`.

**X2_ADD on an alkyne**: 1 equiv: `addAcross(g, pi, X→a, X→b)`, `ezTag(refA = X1, refB = X2, cis = false)`, stereo `none`. 2 equiv: then `addAcross` X/X on the same bond (now order 2); both carbons bear two identical X → no centres, no tags, `stereo: 'none'`.

**H2 on an alkyne**: `addAcross` H/H twice on the same bond (3→2→1); `stereo` per §4.5 on the final alkane (`syn` only matters when both carbons are centres, e.g. ring alkynes: none in v1). **H2 on an alkene** with two new centres (1,2-dimethylcyclohexene) → cis product `C[C@H]1CCCC[C@H]1C` (meso), `stereo: 'relative'`.

**EPOXIDATION**: `g1 = withBondOrder(g, pi.bond, 1)`; `o = withAtom(O)`; `withBond(pi.a, o, 1)`; `withBond(pi.b, o, 1, { diagonal: true })`; tags via `applyAdditionStereo(g, pi, newA = o, newB = o, 'syn', g)` (both orders end in the same atom `o`; the closed form holds unchanged). Rings of size 3 are not buildable in v1 (`requiresDiagonalBonds`), so the card is off; the rule exists so the composite ANTI_DIOL and the v2 toggle share code.

**EPOXIDE_OPEN** (substrate class `epoxide`; acid, opens at the more substituted carbon; anti): ring `[c1, c2, o]` from `smallestRings(g, 3)`; `cOpen = argmax(alkylCount(c, other))` (tie → lower id); `cKeep` the other carbon. Read `cis` from the epoxide's own tags when both carbons carry `tet`: normalise `parityInOrder(g, hyd, cKeep, [cOpen, aKeep, bKeep, o]) = +1` by swapping `aKeep/bKeep`; then `cis = −parityInOrder(g, hyd, cOpen, [cKeep, aOpen, bOpen, o])` (inverse of the syn closed form); if either tag is missing, `cis = undefined` (→ `WARN.geometryUnspecified` when two centres). Remove bond `cOpen–o`; `attachFragment(cOpen, 'O')`; write tags `tet(cKeep) = {[cOpen, aKeep, bKeep, o], +1}`, `tet(cOpen) = {[cKeep, aOpen, bOpen, oNew], (cis ? +1 : −1) × (+1)}` (anti); finalise per §4.5 step 4. Cyclohexene oxide → `O[C@H]1CCCC[C@@H]1O` (trans, `relative`).

**ANTI_DIOL** is implemented directly: `addWithRegio(g, pi, 'O', 'O', 'anti', false)` (equivalent to EPOXIDATION + EPOXIDE_OPEN; symmetric substrates give the same trans diol whichever carbon opens; for unsymmetric alkenes both routes give the same constitution). Cyclohexene → `O[C@H]1CCCC[C@@H]1O`.

**CYCLOPROPANATION**: as EPOXIDATION with a new C (`CH2I2_ZNCU`) or a C bearing two Cl (`CHCL3_KOH`: `attachFragment` of `C(Cl)Cl` then the second ring bond with `diagonal: true`); syn; cis substituents of the alkene stay cis (the closed form with mode `syn`). Off in v1.

### 5.2 `alkynes.ts`

- **ALKYNE_HYDRATION_HG**: site = first alkyne; `{more, less, tie}`; enol = `addAcross(g, pi, H→less, O→more)` (order 3→2), `o = newMore`; `tautomerize(graph, enolC = more, partnerC = less, o)`. Terminal alkyne → methyl ketone (1-hexyne → `CCCCC(C)=O`). Symmetric internal → one ketone (dedupe). Tie on an unsymmetrical internal alkyne → both ketones, `mixture: true`, `WARN.hydrationMixture`. `mechanism: 'addition'`, `stereo: 'none'` (a new centre elsewhere is impossible: the carbonyl carbon is sp2).
- **ALKYNE_HYDROBORATION**: as above with the roles swapped (`O→less`, `H→more`); terminal alkyne → aldehyde (1-hexyne → `CCCCCC=O`); symmetric internal → ketone; unsymmetrical internal → mixture warning.
- **LINDLAR**: `addAcross(H, H)` once (3→2); `ezTag(a1, a2, cis = true)`; `mechanism: 'reduction'`, `stereo: 'none'` (the geometry lives in `ez`; graded by policy `ez`). Terminal alkyne → terminal alkene, no tag.
- **DISSOLVING_METAL**: same with `cis = false`.
- **ACETYLIDE_ALKYLATION** (`NANH2_THEN_RX`):
  1. `term` = alkynes with a carbon `t` having `H(t) === 1`; none → `noReaction(JUSTIFY.internalAlkyne)`. Use the first (`t` = the terminal carbon of `sites[0]`, lower id if both ends are terminal — acetylene).
  2. `opts.rx` missing → `noReaction(JUSTIFY.rxMissing)`. `rxSite = findCX(opts.rx)[0]`; missing → `noReaction(JUSTIFY.rxNotHalide)`. `info = substrateInfo(rx, rxSite)`; `info.sp2` → `noReaction(JUSTIFY.R1)`.
  3. `info.cls ≥ 2` (secondary/tertiary): `elim = applyE2(rx, rxSite, 'zaitsev')` (§5.8); `major = [elim.major[0], substrate]` (alkene + unchanged alkyne), `minor = elim.minor`, `mechanism: 'E2'`, `stereo: 'none'`, `mixture: false`, `WARN.acetylideElimination`, `justification = JUSTIFY.acetylideE2`. (`neopentyl` also takes this branch.)
  4. Else (methyl/primary): `halogen === 'Cl'` → `WARN.chlorideSlower`; `F` → `noReaction(JUSTIFY.R2)`. Product: `tet0 = rx.atoms[rxSite.c].tet`; `rx1 = withoutAtom(rx, rxSite.x)`; `{graph, attached, offset} = graftGraph(substrate, t, rx1, r(rxSite.c))`; if `tet0`: restore on `r(rxSite.c) + offset` with `t` in X's slot and `sign` flipped (SN2 inversion at the halide carbon; `stereo: 'absolute'`), else `stereo: 'none'`. `mechanism: 'SN2'`. 1-hexyne + 1-bromobutane → 5-decyne `CCCCC#CCCCC`.
- **DOUBLE_E2** (`NANH2_2EQ_DIHALIDE`): (a) two `CXSite`s on bonded sp3 carbons `c1–c2` with `H ≥ 1` each: capture nothing; `withoutAtom` both X (higher id first), set `bondBetween(c1', c2')` to 3; (b) one `CXSite` on an alkene carbon whose partner has `H ≥ 1`: remove X, bond 2→3. Product alkyne terminal (`H === 1` on an alkyne carbon) → `WARN.acetylideWorkup`. `mechanism: 'E2'`, `stereo: 'none'`. `CCC(Br)C(Br)CC` → 3-hexyne.

### 5.3 `oxidation.ts`

- **OZONOLYSIS**: for each alkene in descending bond index: `withoutBond(k)`; `attachFragment(a, 'O', 2)`; `attachFragment(b, 'O', 2)`. Then `major = splitComponents(g)`, `fragments: true`, `mixture: false` (fragments, the student builds all), `mechanism: 'oxidation'`, `stereo: 'none'`. A ring C=C gives one dicarbonyl. Isopropylidenecyclohexane → cyclohexanone + acetone; 2,3-dimethyl-2-butene `CC(C)=C(C)C` → two acetone entries (`major.length === 2`, kept by `fragments: true`). Formaldehyde (`C=O`) is a legitimate fragment and is built.
- **KMNO4_CLEAVAGE** (alkenes and alkynes): run OZONOLYSIS on alkenes; for alkynes: `withoutBond`, then each carbon gets `=O` and `–OH` (`attachFragment(c, 'O', 2)`, `attachFragment(c, 'O', 1)`). Then, over the fragment list, for every former π carbon `c`: `H(c) === 1` (aldehyde) → `attachFragment(c, 'O', 1)` (carboxylic acid); `H(c) === 2` (formaldehyde fragment) or an alkyne CH end (formic acid fragment) → delete that fragment and push `WARN.co2Lost`; `H(c) === 0` → ketone unchanged. `fragments: true`. 2-methyl-2-butene → acetone + acetic acid; 3-hexyne → 2 × propanoic acid (multiset); 1-hexyne → pentanoic acid (+ CO2 lost).
- **DIOL_CLEAVAGE** (HIO4): the two adjacent `COHSite`s `c1–c2`: `withoutBond(bondBetween(c1, c2))`; set both C–O bonds to order 2 (`withBondOrder`); `splitComponents`; `fragments: true`. Cyclohexane-1,2-diol → hexanedial `O=CCCCCC=O` (one fragment). Off in v1.

### 5.4 `radical.ts`

**5.4.1 ALLYLIC_BROMINATION** (NBS): candidates = sp3 carbons `c` with `H(c) ≥ 1` bonded to an alkene carbon `a` (partner `b`), ordered by `deg(c)` descending (3° > 2° > 1° C–H), then id. For the first candidate build `p1 = attachFragment(g, c, 'Br')` and the resonance-shifted product `p2`: `withBondOrder(bondBetween(a, b), 1)`, `withBondOrder(bondBetween(c, a), 2)`, `attachFragment(b, 'Br')`. `products = dedupe([p1, p2, …the same pair for every other candidate whose deg equals the first's])`. One product → `major = [it]`; several → all in `major`, `mixture: true`, `WARN.allylicMixture`. `mechanism: 'radical'`; `stereo` = `racemic` if the (single) product has a new centre (3-bromocyclohexene: C3 is a centre) else `none`; tags never written. Cyclohexene → `BrC1CCCC=C1` (single product: `p1 ≡ p2`). 1-butene → 3-bromo-1-butene + 1-bromo-2-butene (mixture).

**5.4.2 RADICAL_HALOGENATION** (CL2_HV, BR2_HV): `RADICAL_WEIGHTS = { Cl: {1: 1, 2: 3.5, 3: 5}, Br: {1: 1, 2: 82, 3: 1640} }` (McMurry 10.2 per-H reactivities; Br from mcmurry-orgo1 §7.2). For every carbon `c` with `H(c) ≥ 1`: `w(c) = H(c) × W[X][max(1, min(3, deg(c)))]` (methane counts as 1°). Products `attachFragment(g, c, X)` grouped by `sameProduct`, weights summed per group; sort by weight descending (tie → lowest carbon id). `major = [first]`, `minor = rest`, `mixture: false`, `mechanism: 'radical'`, `stereo: 'racemic' | 'none'` by new-centre test on `major[0]`. `warnings = [WARN.radicalRatio(X, rows)]` where `rows` = `[{ pct: round(100·w/Σw), cls: 'primary'|'secondary'|'tertiary' }…]` (the class is `deg` of the carbon of the group's first product). Butane + Cl2 → 2-chlorobutane 70 % (major), 1-chlorobutane 30 % (minor) — matches McMurry's 70:30; isobutane + Cl2 → 64:36 primary:tertiary (9 × 1 = 9 vs 1 × 5 = 5; `round(100·9/14) = 64`; McMurry prints the rounded 65:35, the engine reports the computed 64/36; major = 1-chloro-2-methylpropane); isobutane + Br2 → 2-bromo-2-methylpropane > 99 %.

### 5.5 `alcohols.ts` — ROH_TO_RX

`ROH_MECHANISM = { ROH_HX_HCL: 'SN1', ROH_HX_HBR: 'SN1', ROH_SOCL2: 'SN2', ROH_PBR3: 'SN2', ROH_HF_PYR: 'SN2' }`. Site = `findCOH(g)` with `sp3(c)` (first; more than one → `WARN.multipleSites`); none → `noReaction(JUSTIFY.noSubstrate)`; an O on an sp2 carbon (phenol/enol) only → `noReaction(JUSTIFY.rohSp2)`. `cls = substrateClass(g, c, o)`, `allylicOrBenzylic = isAllylic || isBenzylic`, `site = { c, x: o, bond, halogen: card.halogen }` (the leaving atom is the O).

- **SN1 cards** (`ROH_HX_*`): if `cls === 3 || allylicOrBenzylic`: `shift = checkShift(g, c)`; policy §5.6; `substituteRacemize(g, site, X)` (or on `applyShift` output at `shift.to`); `stereo = racemic` if `c` is a centre in the product else `none`; `mechanism: 'SN1'`; `justification = JUSTIFY.rohSn1`. Else (`cls` 1 or 2): same product, `WARN.rohSlow`, `justification = JUSTIFY.rohSlow`; `cls === 2` → racemize (tag dropped), `cls === 1` → no centre. 1-methylcyclohexanol + HCl → `CC1(Cl)CCCCC1`.
- **SN2 cards** (`ROH_SOCL2`, `ROH_PBR3`, `ROH_HF_PYR`): `cls === 3` → `noReaction(JUSTIFY.rohTertiary)`; else `substituteInvert(g, site, X)`; `stereo = absolute` if the reactant carried `tet` on `c`, else `none`; `mechanism: 'SN2'`; `justification = JUSTIFY.rohSn2`. (S)-2-butanol `C[C@H](O)CC` + PBr3 → (R)-2-bromobutane `C[C@@H](Br)CC` (inversion; McMurry 11.3 calls these SN2; the inversion itself is "likely", so 05 grades PBr3/SOCl2 products with `stereoCheck: 'none'` or `'relative'`, never `'absolute'`).

### 5.6 `rearrangement.ts` — 1,2-shifts (HX_ADD, HYDRATION, ROH_HX SN1, SN1, E1, DEHYDRATION only)

```
cationClass(g, c) = deg(c) + (isAllylic(g, c, −1) || isBenzylic(g, c, −1) ? 1 : 0)       // partner −1 = none excluded
checkShift(g, c):                                   // c = cation carbon; g has the C–X / C–OH bond removed or the π bond lowered
  best = null; cls = cationClass(g, c)
  for n in neighborsOf(g, c) ascending, with sp3(n) and el 'C':
    bonus = (isAllylic(g, n, c) || isBenzylic(g, n, c)) ? 1 : 0
    if H(n) ≥ 1 and deg(n) + bonus > cls:                       candidate { kind: 'hydride', from: c, to: n, newClass: deg(n) + bonus }
    if H(n) === 0:
      for m in neighborsOf(g, n) ascending, m ≠ c, el 'C', bond n–m order 1, not in a ring with n (ringsThrough(g, n, m) empty),
          preferring deg(m) === 1 (methyl) then lowest id:
        if deg(n) − 1 + bonus > cls:                            candidate { kind: 'methyl', from: c, to: n, migrating: m, newClass: deg(n) − 1 + bonus }; break
    keep the candidate with the highest newClass; ties → hydride over methyl, then lowest n
  return best
applyShift(g, s): hydride → g unchanged (only the cation position moves; H counts follow the bonding);
                  methyl → withoutBond(bondBetween(s.to, s.migrating)) then withBond(s.from, s.migrating, 1)
```
The caller finishes the reaction at `s.to` (attach the nucleophile there, or eliminate from there). Ring expansions/contractions are excluded by the ring test. Policy (`opts.rearrangement`, default `'warn'`, 00-contracts R7): `warn` → `major = [unrearranged, rearranged]`, `mixture: true`, `WARN.rearrangement`; `apply` → `[rearranged]` + `WARN.rearrangementApplied`; `ignore` → `[unrearranged]`. Test vectors: 3-methyl-1-butene + HCl → `CC(C)C(C)Cl` and `CCC(C)(C)Cl` (hydride, 2°→3°); 3,3-dimethyl-1-butene + HCl → `CC(Cl)C(C)(C)C` and `CC(C)C(C)(C)Cl` (methyl); 2-methylpropene + HBr → no shift (already tertiary); 1-methylcyclohexanol + HCl → no shift.

### 5.7 `decision.ts` — SN1 / SN2 / E1 / E2 (McMurry 11.3, 11.5, 11.12), rules evaluated in order

`decide(substrate, cX, card)`: `site = findCX(substrate).find(s => s.c === cX)` (absent → R0); `info = substrateInfo(substrate, site)`; `nuc = card.nuc`, `sol = card.solvent`. `orientation = nuc.bulky ? 'hofmann' : 'zaitsev'`. Mechanism lists are ordered major first.

| rule | condition (first match wins; R6 is a pre-check that only warns) | mechanisms | justification key |
|---|---|---|---|
| R0 | no `CXSite` at `cX` | none (noReaction) | `R0` |
| R1 | `info.sp2` (vinylic or aryl halide) | none | `R1` |
| R2 | `site.halogen === 'F'` | none | `R2` |
| R6 | `info.betaCarbonyl` → push `WARN.e1cb`, continue | — | — |
| R3 | `nuc.basicity === 'strong'`, `cls 3`, `info.betaH === 0`, `info.allylic || info.benzylic` | `[SN1]` (no β-H, so E2 is impossible; the stabilised cation forms) | `R3_tert_sn1` |
| R3 | `nuc.basicity === 'strong'`, `cls 3` | `[E2]` | `R3_tert` |
| R3 | strong base, `cls 2`, `baseOnly(nuc)` | `[E2]` | `R3_sec_baseOnly` |
| R3 | strong base, `cls 2` | `nuc.strength === 'strong' && !nuc.bulky ? [E2, SN2] : [E2]` | `R3_sec` / `R3_sec_bulky` |
| R3 | strong base, `cls 1`, `baseOnly(nuc) && nuc.atom === 'N'` (NANH2_BASE) | `[E2]` (no amine: NaNH2 is a base, not a nucleophile, in ch 1-11) | `R3_prim_baseOnly` |
| R3 | strong base, `cls 0`, `baseOnly(nuc) && nuc.atom === 'N'` (NANH2_BASE) | none (no β-H, no amination) | `R3_methyl_baseOnly` |
| R3 | strong base, `cls 1`, `nuc.bulky` | `[E2]` (Hofmann) | `R3_bulky` |
| R3 | strong base, `cls 1`, `info.neopentyl` | `info.betaH === 0 ? none : [E2]` (a neopentyl CH2–X never has a β-H, so in practice none, with the justification that names both the blocked backside attack and the missing β-H) | `R3_neopentyl_noBetaH` / `R3_neopentyl` |
| R3 | strong base, `cls 1`, `card.heat` (KOH_ETOH) | `[E2, SN2]` (reflux favors elimination, McMurry 8.1) | `R3_prim_heat` |
| R3 | strong base, `cls 1` | `[SN2, E2]` | `R3_prim` |
| R3 | strong base, `cls 0` | `[SN2]` | `R3_methyl` |
| R4 | weak base, strength strong/moderate, `cls 0 or 1` | `[SN2]` | `R4_prim` |
| R4 | weak base, `cls 2`, `sol === 'protic'` and (allylic or benzylic) | `[SN1, E1]` | `R4_sec_sn1` |
| R4 | weak base, `cls 2` | `[SN2]` (+ `WARN.proticSlow` if protic) | `R4_sec_sn2` |
| R4 | weak base, `cls 3`, `sol === 'protic'` | `[SN1, E1]` | `R4_tert_protic` |
| R4 | weak base, `cls 3`, aprotic | none | `R4_tert_aprotic` |
| R5 | strength weak (solvolysis), `cls 3` or (`cls 2` and allylic/benzylic) | `[SN1, E1]` | `R5_sn1` |
| R5 | weak, `cls 2` | `[SN1, E1]` + `WARN.slowSolvolysis` | `R5_sec_slow` |
| R5 | weak, `cls 1` and (allylic or benzylic) | `[SN1, E1]` | `R5_allylic` |
| R5 | weak, `cls 0 or 1` | none | `R5_primary` |

`baseOnly(nuc) = nuc.basicity === 'strong' && (nuc.atom === 'N' || nuc.atom === 'C')` — true for exactly `NANH2_BASE` (amide, N⁻) and `SN2_ACETYLIDE` (acetylide, C⁻) among the §2.2 cards (azide and cyanide have `basicity: 'weak'` and never reach R3). McMurry 9.9 and 11.12 say these anions give E2 with secondary halides *instead of* substitution, so no SN2 entry is listed (cls 3 is `[E2]` already). For cls 0/1 the two cards differ: amide ion (`nuc.atom === 'N'`) is only ever a base in McMurry ch 1-11 (9.2, 9.7, 11.12; amination with NaNH2 appears nowhere), so 1-bromobutane + NaNH2 gives but-1-ene only (`R3_prim_baseOnly`) and bromomethane + NaNH2 does not react (`R3_methyl_baseOnly`), never the amine; acetylide (`nuc.atom === 'C'`) keeps the generic `R3_prim` / `R3_methyl` SN2 rows (acetylide alkylation, 9.8). The `card.heat` row models KOH/ethanol at reflux (8.1) on primary halides: `[E2, SN2]`, so 1-bromobutane + KOH_ETOH gives but-1-ene major and butan-1-ol minor (no other strong-base card carries `heat`). (This resolves §10 item 1.)

Post-filter: remove `E1`/`E2` when `info.betaH === 0`; if the list becomes empty → noReaction with `JUSTIFY.noBetaH` (the `R3_tert_sn1` row fires before this filter, so a tertiary allylic/benzylic halide without β-H — trityl bromide — substitutes by SN1 instead of reporting no reaction). `Decision.rule` is the R-number of the row that fired. Cyclohexane trans-diaxial requirement: not modelled; when `cX` is in a 6-ring and the mechanism list starts with E2, push `WARN.ringConformation` (informational; menthyl-type substrates are excluded from content).

### 5.8 `substitution.ts` / `elimination.ts` — SUBST_ELIM and DEHYDRATION

**SUBST_ELIM** (`applySubstElim`): `sites = findCX(g)` filtered to sp3 carbons first, else any; none → R0; more than one → `WARN.multipleSites` and `sites[0]`. `d = decide(g, site.c, card)`; noReaction passes through with `d.justification` and `d.warnings`. Otherwise build each mechanism:

| mechanism | builder | product stereo |
|---|---|---|
| SN2 | `substituteInvert(g, site, nuc.fragment)` | `absolute` if the reactant had `tet` on `site.c`; else `racemic` if `site.c` is a centre in the product (cannot happen for SMILES-tagged content; defensive), else `none` |
| SN1 | `shift = checkShift(withoutAtom-free view: g with bond c–x ignored, c)`; policy §5.6; `substituteRacemize` at `c` (or at `shift.to` after `applyShift`) | `racemic` if a centre, else `none`; `WARN.sn1Racemic` when the reactant had `tet` on `c` |
| E2 | `applyE2(g, site, d.orientation)` §5.8.1–5.8.4 | `none` |
| E1 | rearrangement check as SN1, then `applyE1` (Zaitsev at the final cation) | `none` |

Assembly: `major = products of mechanisms[0]` (SN2/SN1 → one product; SN1 in `warn` mode with a shift → two, `mixture: true`; E2/E1 → the Zaitsev/Hofmann set, `mixture: true` only on a tie), `minor = products of mechanisms[1..]` (E2's own runner-up alkenes come first, then the secondary mechanism's product), `mechanism = mechanisms[0]`, `stereo` of the major, `justification = d.justification`, `warnings = d.warnings ++ builder warnings`.

**5.8.1 Beta candidates and substitution count.** `betas = neighborsOf(g, cX).filter(n => n !== x && sp3(n) && H(n) ≥ 1)` ascending. For each: `subst(n) = (deg(cX) − 2) + (deg(n) − 1)` = number of heavy substituents on the resulting C=C (2-bromo-2-methylbutane: β = C1 → 2 (2-methyl-1-butene), β = C3 → 3 (2-methyl-2-butene)).

**5.8.2 Selection.** Zaitsev: `best = max subst`; Hofmann: `best = min subst`, tie-break by the beta with the most H (least hindered), then lowest id. `chosen = betas with subst === best` (Zaitsev) or the single Hofmann beta. `products = dedupe(chosen.map(n => eliminate(g, cX, n, x)))`; several distinct → `mixture: true`, `WARN.zaitsevTie`. `minor = dedupe(other betas' alkenes)` sorted by subst descending (Zaitsev) or ascending (Hofmann), excluding `sameProduct` duplicates of `major`. Examples: 2-bromobutane + NaOEt → 2-butene major, 1-butene minor (McMurry 81:19); 2-bromo-2-methylbutane → 2-methyl-2-butene major, 2-methyl-1-butene minor (70:30); 1-chloro-1-methylcyclohexane + KOH/EtOH → 1-methylcyclohexene major, methylenecyclohexane minor; 3-bromopentane → 2-pentene only (both betas give the same molecule); 2-bromo-2-methylbutane + KOtBu → 2-methyl-1-butene (Hofmann; β = C1 has 3 H, subst 2).

**5.8.3 E/Z of the new alkene, general rule.** Let `{a, b, bond}` be the new C=C. If each end has exactly one heavy non-partner substituent (`deg === 2` after elimination) and neither end had a `tet` in the reactant: write `ez = { refA: heavyA, refB: heavyB, cis: false }` (E shown) and push `WARN.ezAssumedTrans`; the challenge grades with `stereoCheck: 'none'` (00-contracts R3). If an end has two heavy substituents (tri/tetrasubstituted alkene) or two H, write no tag (the geometry is unbuildable or undefined). E1 uses the same display rule (no geometric requirement, McMurry 11.10).

**5.8.4 E/Z from anti-periplanar E2 (both `cX` and `beta` carry `tet` in the reactant).** With `order(cX) = [beta, x, a, b]` (`a`, `b` the other two σ-partners of `cX`, ids or `'H'`) and `order(beta) = [cX, 'H', c, d]` (`beta` has exactly one H when it carries a tag):
```
s1 = parityInOrder(reactant, hyd, cX,   [beta, x, a, b])
s2 = parityInOrder(reactant, hyd, beta, [cX, 'H', c, d])
cis(a, c) = (s1 × s2 === +1)
```
(Derivation: in the Newman frame along cX→beta with X at azimuth 0 and the beta-H at 180°, `s1 = −1` ⇔ `a` sits at +120° and `s2 = −1` ⇔ `c` sits at +60°, i.e. both on the same side of the X–C–C–H plane, which becomes the alkene plane's normal side; checked against an explicit rotation construction and RDKit conformers.) Then `ez = { refA: a', refB: c', cis }` with heavy refs preferred (§4.6 substitution rule). Verified: meso-1,2-dibromo-1,2-diphenylethane `Br[C@H](c1ccccc1)[C@@H](Br)c1ccccc1` + KOH → the two phenyls cis → `Br/C(c1ccccc1)=C/c1ccccc1` = (E)-1-bromo-1,2-diphenylethene; the (1S,2S)/(1R,2R) isomer → phenyls trans → Z (McMurry 11.8). This branch is preview/free-play only in v1 (no content has two tagged centres with a C–X; the E product is a trisubstituted alkene and unbuildable).

**DEHYDRATION** (`H2SO4_HEAT_ROH`): site = `findCOH` with `sp3(c)`; `cls`: 3 → E1 at `c` (leaving atom `o`, rearrangement check, Zaitsev); 2 → same + `WARN.slowDehydration`; 1 → `noReaction(JUSTIFY.dehydrationPrimary)`. `mechanism: 'E1'`, `justification = JUSTIFY.dehydration`. 1-methylcyclohexanol → 1-methylcyclohexene (major, 91 %), methylenecyclohexane (minor).

### 5.9 `react.ts`

```ts
export function react(substrate: MoleculeGraph, card: ReagentCard, opts: ReactOptions = {}): ReactionResult {
  const o = { equiv: opts.equiv ?? card.equiv ?? 1, rearrangement: opts.rearrangement ?? 'warn', rx: opts.rx };
  const classes = substrateClasses(substrate);
  if (!card.substrates.some(s => classes.has(s))) return { ...noReaction(JUSTIFY.noSubstrate(card)), reagentId: card.id };
  const r = RULES[card.rule](substrate, card, o);
  const stripped = r.major.map(stripExplicitH);
  const major = r.fragments ? stripped : dedupe(stripped);            // cleavage fragments are a multiset (§6)
  const minor = r.minor ? dedupe(r.minor.map(stripExplicitH)).filter(m => !major.some(p => sameProduct(p, m))) : undefined;
  return { major, minor, mechanism: r.mechanism, stereo: r.stereo, warnings: r.warnings, noReaction: r.noReaction, justification: r.justification, mixture: r.mixture, reagentId: card.id };
}
```
`RULES` maps every `RuleId` to its `apply<Rule>` (27 entries; `HX_ADD` serves HX_HCL/HBR/HI/2EQ, `SUBST_ELIM` every ch-11 card, `SYN_DIOL` OSO4 + KMNO4_COLD, `X2_ADD` both halogens, `HOX_ADD` both, `ROH_TO_RX` five cards, `RADICAL_HALOGENATION` two, `CYCLOPROPANATION` two). A `noReaction` result is `{ major: [], mechanism: 'none', stereo: 'none', warnings, noReaction: true, justification, reagentId }`. Cleavage fragments are **not** deduped against each other because the challenge expects a multiset (§6, 05 §7.7): OZONOLYSIS/KMNO4_CLEAVAGE/DIOL_CLEAVAGE return `fragments: true` (`RuleResult`, §1) and `react` then keeps `major` as returned (3-hexyne + KMnO4 → two propanoic acids stay two entries; 2,3-dimethyl-2-butene + O3 → two acetones, row 99). `fragments` is not copied into `ReactionResult`. Every other rule's `major` is deduped.

**5.9.1 `ReactionResult` field semantics** (contract §1): `major` = what the student builds (all of them for fragments; any one when `mixture` and the challenge says `acceptAny`); `minor` = shown in the panel as "minor product", never required; `stereo` per §4.5; `warnings` are complete student sentences in the order produced; `justification` is one line in McMurry's words.

**5.9.2 `WARN` (every string, `helpers.ts`)**

| key | text |
|---|---|
| `multipleSites(n, kind)` | `This molecule has ${n} ${kind} sites; the bench reacts only the first one.` (`kind` ∈ `C=C`, `C≡C`, `C–X`, `C–OH`) |
| `regioMixture` | `Both alkene carbons carry the same number of alkyl groups, so Markovnikov's rule cannot choose: a mixture of regioisomers forms (McMurry 7.8). Both are shown.` |
| `geometryUnspecified` | `The reactant alkene has no defined geometry, so the product's stereochemistry is not defined.` |
| `diastereomerMixture` | `Two new chirality centers form with no syn/anti control: a mixture of diastereomers results, so no configuration is shown.` |
| `facialSelectivity` | `The reactant already has a chirality center; which face reacts is not modeled, so the new centers are shown without configuration.` |
| `rearrangement` | `A carbocation rearrangement (1,2-hydride or 1,2-methyl shift) is likely here: McMurry 7.11 reports about a 1:1 mixture of the unrearranged and rearranged products. Both are shown.` |
| `rearrangementApplied` | `The carbocation rearranged by a 1,2-shift to a more stable cation before the nucleophile attacked.` |
| `hydrationMixture` | `Unsymmetrical internal alkyne: both ketones form (McMurry 9.4). Both are shown.` |
| `acetylideElimination` | `An acetylide is a strong base: with a secondary or tertiary halide it causes E2 elimination instead of SN2 (McMurry 9.9). The alkyne is recovered unchanged.` |
| `acetylideWorkup` | `The terminal alkyne is deprotonated by the excess NaNH2; the H3O+ workup gives it back.` |
| `chlorideSlower` | `McMurry alkylates acetylides with alkyl bromides and iodides; a chloride reacts more slowly.` |
| `allylicMixture` | `The allylic radical is delocalized, so bromine can end up at either end of the allyl system (McMurry 10.3). All products are shown.` |
| `radicalRatio(X, rows)` | `${X}2/hν selectivity: ` + rows joined by `, ` as `${pct}% at a ${cls} C–H` + ` (McMurry 10.2).` |
| `rohSlow` | `Primary and secondary alcohols react slowly with HX; SOCl2 (for Cl) or PBr3 (for Br) are preferred (McMurry 10.5).` |
| `co2Lost` | `A =CH2 (or ≡CH) carbon is oxidized all the way to CO2, which escapes and is not built.` |
| `zaitsevTie` | `Two different alkenes have the same degree of substitution; Zaitsev's rule cannot choose between them. Both are shown.` |
| `ezAssumedTrans` | `The new double bond is drawn as E (trans); McMurry does not state a geometry preference here, so the geometry is not graded.` |
| `proticSlow` | `A protic solvent slows SN2 (McMurry 11.3); the reaction still goes.` |
| `slowSolvolysis` | `A simple secondary halide ionizes slowly, so this solvolysis is slow (McMurry 11.5).` |
| `slowDehydration` | `Secondary alcohols dehydrate more slowly than tertiary ones (McMurry 8.1).` |
| `e1cb` | `A carbonyl group lies two carbons from the leaving group: E1cB elimination is possible but not modeled (McMurry 11.10).` |
| `ringConformation` | `In a cyclohexane ring, E2 needs the H and the leaving group trans-diaxial (McMurry 11.9); this requirement is not modeled.` |
| `sn1Racemic` | `SN1 goes through a planar carbocation: the product is racemic (McMurry 11.5 notes a slight excess of inversion).` |

**5.9.3 `JUSTIFY` (every string; HUD "why" line)**

| key | text |
|---|---|
| `noSubstrate(card)` | `${card.label} needs ${list of card.substrates in words}; this molecule has none.` (words: alkene → `a C=C`, alkyne → `a C≡C`, terminal-alkyne → `a terminal C≡C–H`, alkyl-halide → `a C–X bond (X = Cl, Br, I)`, alcohol → `a C–OH`, epoxide → `an epoxide ring`, diol → `a 1,2-diol`, vicinal-dihalide → `a 1,2-dihalide`, alkane → `only C–C and C–H bonds`, allylic-alkene → `a C=C with an allylic C–H`) |
| `HX_ADD` | `Markovnikov: H adds to the alkene carbon with fewer alkyl groups, X to the one with more (McMurry 7.8).` |
| `HX_ADD_ALKYNE` | `HX adds to an alkyne with Markovnikov regiochemistry and H, X trans (McMurry 9.3).` |
| `HX_ADD_2EQ` | `A second HX adds to the vinylic halide with X going to the carbon that already bears X: a geminal dihalide (McMurry 9.3).` |
| `twoEquivAlkene` | `Two equivalents of HX only matter for alkynes; an alkene consumes one.` |
| `RADICAL_HBR` | `With peroxides HBr adds by a radical chain: Br ends on the less substituted carbon (not in McMurry 10e).` |
| `X2_ADD` | `Br2/Cl2 add anti through a cyclic halonium ion (McMurry 8.2).` |
| `X2_ADD_ALKYNE` | `X2 adds once to an alkyne with trans stereochemistry; a second equivalent gives the tetrahalide (McMurry 9.3).` |
| `HOX_ADD` | `Halohydrin formation: X+ adds first, water opens the halonium ion at the more substituted carbon, anti (McMurry 8.3).` |
| `HYDRATION` | `Acid-catalysed hydration is Markovnikov through a carbocation (McMurry 8.4).` |
| `OXYMERC` | `Oxymercuration–demercuration is Markovnikov without a carbocation, so no rearrangement (McMurry 8.4).` |
| `HYDROBORATION` | `Hydroboration–oxidation is non-Markovnikov and syn: H and OH add to the same face (McMurry 8.5).` |
| `H2` | `Catalytic hydrogenation adds both H to the same face (syn) (McMurry 8.6).` |
| `H2_ALKYNE` | `H2 over Pd/C reduces an alkyne all the way to the alkane (McMurry 9.5).` |
| `EPOXIDATION` | `A peroxyacid transfers one O to the alkene, syn (McMurry 8.7).` |
| `EPOXIDE_OPEN` | `Acid opens the epoxide at the more substituted carbon, anti: a trans-1,2-diol (McMurry 8.7).` |
| `ANTI_DIOL` | `Epoxidation then acidic hydrolysis gives the trans (anti) 1,2-diol (McMurry 8.7).` |
| `SYN_DIOL` | `OsO4 adds both OH to the same face: a cis (syn) 1,2-diol (McMurry 8.7).` |
| `CYCLOPROPANATION` | `The carbene adds to the alkene in one step, syn and stereospecific (McMurry 8.9).` |
| `OZONOLYSIS` | `Ozonolysis cleaves the C=C; each carbon becomes a C=O (McMurry 8.8).` |
| `KMNO4_CLEAVAGE` | `Hot acidic KMnO4 cleaves the C=C: R2C= gives a ketone, RCH= a carboxylic acid, H2C= CO2 (McMurry 8.8).` |
| `KMNO4_ALKYNE` | `Alkynes are cleaved by KMnO4 to carboxylic acids; a terminal ≡CH gives CO2 (McMurry 9.6).` |
| `DIOL_CLEAVAGE` | `HIO4 cleaves the C–C bond of a 1,2-diol to two carbonyls (McMurry 8.8).` |
| `ALKYNE_HYDRATION_HG` | `Hg(II)-catalysed hydration is Markovnikov; the enol tautomerizes to the ketone (McMurry 9.4).` |
| `ALKYNE_HYDROBORATION` | `Hydroboration–oxidation of an alkyne is non-Markovnikov; the enol tautomerizes to the aldehyde or ketone (McMurry 9.4).` |
| `LINDLAR` | `Lindlar's poisoned catalyst stops at the cis (Z) alkene by syn addition of H2 (McMurry 9.5).` |
| `DISSOLVING_METAL` | `Li in liquid NH3 reduces an alkyne to the trans (E) alkene (McMurry 9.5).` |
| `internalAlkyne` | `Only terminal alkynes are acidic enough (pKa ≈ 25) to be deprotonated by NaNH2 (pKa NH3 ≈ 35); an internal alkyne has no C≡C–H (McMurry 9.7).` |
| `rxMissing` | `Choose the alkyl halide for the second step.` |
| `rxNotHalide` | `The second reagent must be an alkyl halide (R–Br or R–I).` |
| `ACETYLIDE_ALKYLATION` | `The acetylide anion displaces X from a methyl or primary halide by SN2 (McMurry 9.8).` |
| `acetylideE2` | `Acetylide anions are strong bases: secondary and tertiary halides eliminate (E2) instead (McMurry 9.9).` |
| `DOUBLE_E2` | `Two successive E2 dehydrohalogenations of a 1,2-dihalide give the alkyne (McMurry 9.2).` |
| `ALLYLIC_BROMINATION` | `NBS with light substitutes Br at the allylic position through the resonance-stabilized allylic radical (McMurry 10.3).` |
| `RADICAL_HALOGENATION` | `Radical halogenation replaces a C–H by C–X; reactivity 3° > 2° > 1° C–H (McMurry 10.2).` |
| `rohSn1` | `Tertiary (and allylic/benzylic) alcohols react with HX by SN1 through a carbocation (McMurry 10.5).` |
| `rohSlow` | `Primary and secondary alcohols react slowly with HX (McMurry 10.5).` |
| `rohSn2` | `SOCl2 and PBr3 convert primary and secondary alcohols to halides by an SN2 process (McMurry 10.5, 11.3).` |
| `rohTertiary` | `SOCl2 and PBr3 are used for primary and secondary alcohols; tertiary alcohols use HX (McMurry 10.5).` |
| `rohSp2` | `An OH on a double-bond or ring carbon is not an alcohol for these reagents.` |
| `R0` | `There is no C–X bond: OH−, RO−, NH2− and F− are poor leaving groups (McMurry 11.3).` |
| `R1` | `Vinylic and aryl halides do not undergo SN2 or SN1 (McMurry 11.3).` |
| `R2` | `Fluoride is too poor a leaving group (McMurry 11.3).` |
| `R3_tert_sn1` | `No hydrogen on a neighbouring carbon, so E2 is impossible; this tertiary allylic/benzylic halide ionizes readily to a resonance-stabilized carbocation, so substitution goes by SN1 (McMurry 11.5).` |
| `R3_tert` | `Tertiary halide + strong base: E2 only; SN2 is impossible at a tertiary carbon (McMurry 11.12).` |
| `R3_sec_baseOnly` | `Amide and acetylide anions are strong bases: with a secondary halide they give E2 elimination instead of SN2 (McMurry 9.9, 11.12).` |
| `R3_sec` | `Secondary halide + strong base: E2 predominates, with some SN2 (McMurry 11.12).` |
| `R3_sec_bulky` | `Secondary halide + bulky base: E2, less substituted alkene (Hofmann) (McMurry 11.12; Hofmann orientation not in 10e).` |
| `R3_bulky` | `Primary halide + strong, sterically hindered base: E2 rather than SN2 (McMurry 11.12).` |
| `R3_neopentyl` | `Branching one carbon away blocks backside attack (neopentyl); E2 instead (McMurry 11.3).` |
| `R3_prim` | `Primary halide + good nucleophile: SN2 with inversion; a little E2 (McMurry 11.12).` |
| `R3_methyl` | `Methyl halide: SN2 only (no β-hydrogens) (McMurry 11.3).` |
| `R4_prim` | `Methyl/primary halide + good, weakly basic nucleophile: SN2 (McMurry 11.12).` |
| `R4_sec_sn1` | `Secondary allylic/benzylic halide in a protic solvent with a weakly basic nucleophile: SN1 (some E1) (McMurry 11.12).` |
| `R4_sec_sn2` | `Secondary halide + weakly basic nucleophile: SN2, best in a polar aprotic solvent (McMurry 11.12).` |
| `R4_tert_protic` | `Tertiary halide, weakly basic nucleophile, protic solvent: SN1 with E1 alongside (McMurry 11.12).` |
| `R4_tert_aprotic` | `Tertiary halides do not react by SN2, and without a protic solvent SN1 is not favored (McMurry 11.3, 11.5).` |
| `R5_sn1` | `Solvolysis: the solvent is the nucleophile; tertiary/allylic/benzylic halides ionize to a carbocation: SN1 major, E1 minor (McMurry 11.5, 11.10).` |
| `R5_sec_slow` | `A simple secondary halide ionizes slowly: SN1/E1 but slow (McMurry 11.5).` |
| `R5_allylic` | `A primary allylic/benzylic cation is as stable as a secondary alkyl cation: SN1 (McMurry 11.5).` |
| `R5_primary` | `Primary carbocations do not form, and water/alcohols are too weak for SN2: no reaction (McMurry 11.5).` |
| `noBetaH` | `Elimination needs a hydrogen on a carbon next to the C–X; there is none.` |
| `dehydration` | `Acid-catalysed dehydration is E1: the more substituted alkene forms (Zaitsev) (McMurry 8.1).` |
| `dehydrationPrimary` | `Primary alcohols need harsher conditions to dehydrate; not covered in McMurry 8.1.` |

## 6. Mixtures, fragments, minor products

| situation | `major` | `minor` | `mixture` | warning | challenge handling (05) |
|---|---|---|---|---|---|
| single product | `[p]` | rule's runner-ups | false | — | `expected: [p]` |
| cleavage fragments | all fragments (multiset) | — | false | `co2Lost` when applicable | `expected` lists every fragment; matched as a multiset |
| Markovnikov tie, distinct | `[p1, p2]` | — | true | `regioMixture` | not used in graded content (quiz only) |
| rearrangement (`warn`) | `[unrearranged, rearranged]` | — | true | `rearrangement` | `expected: [rearranged]`, `acceptAlso: [unrearranged]` (ch7-rearrangement-3-methylbut-1-ene) |
| Zaitsev tie | all tied alkenes | rest | true | `zaitsevTie` | not in content |
| unsymmetrical alkyne hydration | both ketones | — | true | `hydrationMixture` | `acceptAny: true` if ever used |
| allylic mixture | all | — | true | `allylicMixture` | content uses cyclohexene only |
| SN1 + E1 / SN2 + E2 / E2 + SN2 | first mechanism's product | second's | false | — | `expected: [major]`; `acceptAlso` optional |
| radical halogenation | top-weight product | rest | false | `radicalRatio` | `acceptAlso: [minor]` with `'minor 30%'` |
| acetylide + 2°/3° halide | `[alkene, alkyne]` | — | false | `acetylideElimination` | `expected: [alkene, alkyne]` (both built) or `acceptAny` |

The panel text for `mixture: true` is `Textbook mixture — ${major.length} products; ${acceptAny ? 'build either one' : 'this challenge names the one to build'}`; for fragments `Build all ${major.length} products`.

## 7. Product preview embedding

The algorithm is `embedOnLattice` (02 §13, port of `tools/reference/embed.py` + reaction-bench 4.2). This section fixes how the bench calls it and restates the two stereo constraints in the form the bench relies on.

### 7.1 What the embedder guarantees (restated)

1. **Order.** BFS from the max-degree node; H nodes exist only for atoms whose `tet.order` contains `'H'` (and `ez` refs of `'H'`), so a tagged centre with an implicit H gets an explicit H block in the preview and the student is told to place it (§8.5).
2. **Candidates.** Six face cells around the parent (straight continuation first), twelve edge-diagonals only with `allowDiagonal` and only for bonds flagged `diagonal`.
3. **Touching rule (09-amendment-no-bond.md §3.1).** Every bonded pair is face-adjacent; a face-adjacent *unbonded* heavy pair is avoided in the first (induced) pass and, when the stereo tags leave no induced embedding, allowed in the second pass and reported in `suppressedPairs` — the pairs the student sets to "no bond" with the wand. Cyclohexane still embeds as the cube's chair hexagon (pass A); a Z-1,2-disubstituted alkene embeds in pass B with its two cis substituents touching and one suppressed pair. H nodes touch only their parent in both passes.
4. **Seesaw rule (tetrahedral).** When the four tips of a tagged centre `c` are all placed, `V = ((p1−p0)×(p2−p0))·(p3−p0)` over `tet.order` must satisfy `sign(V) === tet.sign`; `V = 0` rejects. On the face lattice `V ≠ 0` ⇔ the two empty octahedral positions around `c` are orthogonal (a *seesaw* quad, 12 of 15) — never opposite (*square-planar*, 3 of 15). With three heavy tips and an H node the same test makes the trio an *octant* with the H in the correct one of the three free cells. The sign therefore fixes the enantiomer in the ghost; `predict-product` with `stereoCheck: 'relative'` then accepts the ghost and its mirror image.
5. **Coplanar rule (E/Z).** For a bond with `ez` whose ends and refs are placed: `va ⊥ u`, `vb ⊥ u`, `va ∥ vb` (both refs in one plane containing the C=C), and `(va·vb > 0) === cis`. Buildable for every `cis` value and substitution pattern: `cis: true` and every tri/tetrasubstituted case need one (two) suppressed pairs (09 §2.1).
6. **Budget.** `EMBED_NODE_BUDGET = 50 000`; measured need for every v1 product is < 300 nodes.
7. **Components.** Fragments (ozonolysis) are embedded separately and laid out 4 empty cells apart along +x.

### 7.2 Bench call

```
previewFor(graph): { pos, hPos, suppressedPairs, buildable }
  e = embedOnLattice(graph, { origin: [0, 0, 0], nodeBudget: EMBED_NODE_BUDGET })      // allowSuppressed defaults to true
  if e: translate so that min(pos ∪ hPos) = PRODUCT_MIN; if max(...) ≤ PRODUCT_MAX → { pos, hPos, suppressedPairs: e.suppressedPairs, buildable: true }
        else → fall through (too large for the zone; content validation prevents this)
  layout = relaxedLayout(graph) translated the same way → { pos: layout, hPos: empty, suppressedPairs: [], buildable: false }   // odd rings only
```
The ghost renderer draws a translucent break marker at every `suppressedPairs` midpoint (09 §5.3) and the panel prints `BENCH.breakHint(n)` under the preview text when `n = Σ suppressedPairs.length > 0`.
Constants (in `State.ts`): `REACTANT_MIN = [53, 10, 37]`, `REACTANT_MAX = [62, 30, 46]`, `PRODUCT_MIN = [65, 10, 37]`, `PRODUCT_MAX = [74, 30, 46]` (one empty cell inside every zone edge so a ghost never touches the other zone or the pad; `y = 10` leaves a free row above the bench tiles for rings, 00-contracts R15). The reactant uses `MoleculeEntry.layout` when present (translated to `REACTANT_MIN`), else `embedOnLattice`; `rx` is embedded separately and translated so its min `x` = reactant max `x` + 3 (two empty columns: no phantom bonds), same `y`, `z`.

### 7.3 `relaxedLayout(g)` (fallback when embedding fails: odd rings; Z-alkenes embed since 09-amendment-no-bond.md)

BFS from the max-degree atom; each atom is placed at the first unoccupied face cell of its BFS parent in the order [straight continuation, then `FACE_DIRS`]; no phantom-bond or stereo check; if no free face exists (cannot happen below degree 6) place at the first free cell in a 3×3×3 shell. Always succeeds, ≤ 6·n candidate tests. The renderer draws every bond of `g` as a stick between the two positions whatever their distance, so ring closures that did not land adjacent still show. The panel prints `STRINGS.previewOnly` (§8.7) for `buildable: false`.

### 7.4 Preview modes (`BenchState.preview`)

| mode | when | shown |
|---|---|---|
| `hidden` | `predict-product` before it is passed | nothing in the product zone; panel shows reactant, card, `equiv`, `rx` and the instruction |
| `ghost` | `choose-reagent` (the rule's `product`), free play, and a passed `predict-product` ("Show answer") | `GhostRenderer` translucent atom blocks + H studs at `pos`/`hPos`; bonds as translucent bars; translucent break markers at `suppressedPairs` (09 §5.3); charge badges |
| `sticks` | any `ghost` case whose `buildable` is false (odd rings only) | ball-and-stick over `relaxedLayout`, plus `STRINGS.previewOnly` |

Ghost blocks are not solid, not pickable for mining, and do not enter `MoleculeIndex`; placing a real block on a ghost cell is an ordinary placement.

### 7.5 Content validation hooks (`validateContent`, 05)

For every enabled `predict-product` challenge: every `expected` and `acceptAlso` graph must satisfy `embedOnLattice(...) !== null` (suppressed pairs allowed, 09 §4.4) when `stereoCheck !== 'none'` (a graded stereo target must be buildable), and every `expected` must fit `PRODUCT_MIN..MAX`; `buildReport` (05) lists the required suppressions. For every `choose-reagent`: `product` need not embed (preview may be `sticks` for an odd ring). For every bench challenge: the reactant (and `rx`) must embed and fit the reactant zone; `react(reactant, card, {equiv, rx}).major` must contain a graph `sameMolecule`-equal (policy = `stereoCheck`) to each `expected` entry (the roster agrees with the engine); `react` must not return `noReaction`.

## 8. Bench interaction protocol

### 8.1 Blocks and zones

- `Block.Bench` at `BENCH_BLOCKS = [(63,9,49), (64,9,49)]` (unbreakable). Interacting with either (interact key or click while the crosshair hits it within `PICK_DISTANCE`) opens/closes the bench panel; the challenge panel's "Open bench" button does the same when a bench challenge is current. Floors: `BenchReactantTile` under `x ∈ [52,64)`, `BenchProductTile` under `x ∈ [64,76)`, `z ∈ [36,48)`, `y = 8`.
- Zone membership is `zoneOf(x, y, z)`; a component belongs to a zone iff every atom does (`ExtractedComponent.zone`). "On the bench" = **reactant**: the components of `extractAll(index, 'reactant')`; **product**: the components of `extractAll(index, 'product')`. A component straddling zones has `zone: 'world'` and is neither.
- Locking: while `BenchState.mode ∈ {'predict', 'choose'}` the `PlacementContext.lockedZones` is `['reactant']` (placement, removal, bond wand and charge tool refuse with `REFUSAL_TEXT.lockedZone`). In `'free'` and `'idle'` nothing is locked.

### 8.2 State machine (`State.ts`)

```
idle ──challenge:changed(predict-product)──▶ predict
idle ──challenge:changed(choose-reagent)───▶ choose
idle ──bench opened with no bench challenge─▶ free
predict|choose ──challenge:changed(other)──▶ idle   (unlock; product-zone student blocks stay; reactant blocks removed)
free ──challenge:changed(bench challenge)──▶ predict|choose (product zone cleared to inventory first; see 8.3)
```
Entering `predict`/`choose`:
1. Clear both zones: student-placed blocks in the product zone go back to inventory (`bench:cleared` after); game-placed reactant blocks are removed without inventory change (they are tagged `benchOwned` in `State`, never counted).
2. `reactant = parseSmiles(rule.reactant).graph` (+ `rx`), placed per §7.2 through `World.setBlock` with the index's bond orders and charges set from the graph (double/triple bonds and charges must be written into `MoleculeIndex`, 00-contracts R9). Explicit H blocks are placed for every `hPos` the embedding returned (tagged centres) so the locked reactant shows its configuration.
3. `cardId = rule.reagentId` (predict) / `null` (choose); `equiv = rule.equiv ?? card.equiv ?? 1`; `preview = 'hidden'` (predict) / `'ghost'|'sticks'` of `parseSmiles(rule.product)` (choose); `result = null`.
4. Lock the reactant zone; emit `target:changed` to the reactant component so the molecule panel describes it.

### 8.3 Bench panel actions (`bench-panel.ts`, DOM)

| action | predict | choose | free |
|---|---|---|---|
| card list | the one card, selected, not changeable | `rule.options` in that order; clicking one = submission | every enabled card grouped by chapter |
| equiv toggle | shown iff `card.equiv` or the card rule is HX_ADD/X2_ADD and the reactant has a C≡C; fixed to `rule.equiv` when the rule sets it | hidden | shown for HX_ADD/X2_ADD on alkynes |
| rx | shown as text (`with ${name or formula}`) and as the second locked molecule | — | a picker over library alkyl halides |
| React | runs `react(reactant, card, {equiv, rx})`, stores `result`, emits `bench:reacted`; the panel shows `mechanism`, `justification`, `warnings`, mixture/fragment text and `minor` names; no product geometry is revealed (`preview` stays `hidden`) | not offered (choosing is the submission) | runs `react` with the selected card on `tagsFromPositions(reactantWorldGraph)`; `preview = 'ghost'|'sticks'` of every `major` graph (fragments laid out per §7.1.7) |
| Submit | evaluates `predict-product` over the product zone (§8.4) | — | disabled |
| Show answer | only after the challenge is passed: `preview = 'ghost'` of `expected[0]` | — | — |
| Clear product zone | returns student blocks in the product zone to inventory; emits `bench:cleared` | — | same (both zones) |

`bench:reacted` payload is `{ reagentId, result }`; the molecule panel does not change on it (it follows `target:changed`). The live region announces `STRINGS.reacted(mechanism)`.

### 8.4 Evaluating `predict-product` (algorithm for `evaluatePredictProduct(ch, ctx)` in `acceptance.ts`, 05)

`ctx.padMolecules` = product-zone component graphs (World graphs; `sameMolecule` normalises them). `E = rule.expected.map(parse)`, `A = (rule.acceptAlso ?? []).map(x => parse(x.smiles))`, `policy = rule.stereoCheck`.
1. Any product component with a warning of kind `over-valence` / `h-block-valence` → `{ kind: 'valence-error' }`.
2. `S = ctx.padMolecules`; `S.length === 0` → `'missing-molecule'` (message names `E[0]`'s formula).
3. **acceptAny**: `S.length > 1` → `'extra-molecule'` (names the formula of `S[1]`); else find `e ∈ E` with `sameMolecule(S[0], e, {stereo: policy}).same` → `'correct'`; otherwise feedback from the best verdict over `E` (step 6).
4. **multiset match** (default): if `S.length > E.length` → `'extra-molecule'` naming the unmatched component's formula (computed after the greedy match below); if `S.length < E.length` → `'missing-molecule'` naming the first unmatched expected formula. Else search a bijection `S ↔ E` by backtracking over `E` in order (≤ 3! permutations in v1): pair `(s, e)` is acceptable iff `sameMolecule(s, e, {stereo: policy}).same`. Found → `'correct'`.
5. **acceptAlso** (only when `S.length === 1`; 05 §7.7 owns this step and this text matches it): the first `a ∈ A` with `sameMolecule(S[0], a, {stereo: 'none'}).same` (constitution only, whatever `policy` is) → `'correct-reduced'` with `pointsEarned = pointsForAttempt(points, 2, false)` (half credit, outcome `SolvedReduced`; a later exact match upgrades to `SolvedFull`, 05 §1 rule (e)) and `message = rule.acceptAlso[i].note`.
6. **Failure kind** from the best verdict of `sameMolecule(S[0], e)` over `e ∈ E` (ranked SAME > ENANTIOMER > DIASTEREOMER > UNSPECIFIED > INVALID_GEOMETRY > DIFFERENT_CONSTITUTION > DIFFERENT_FORMULA): `DIFFERENT_FORMULA` → `'wrong-formula'` (message includes the student's and the expected formula); `DIFFERENT_CONSTITUTION` → `'constitutional-isomer'`; `ENANTIOMER` → `'enantiomer'` (message for SN2 challenges: the override `feedback.enantiomer` = `That is the enantiomer: SN2 inverts the configuration at the carbon that carried the leaving group.`); `DIASTEREOMER` → `'diastereomer'` (default text `Right connectivity, wrong relative configuration: check syn versus anti addition.`); `UNSPECIFIED` → `'unspecified-center'` (`Place an explicit H on the marked carbon so its configuration is defined.` with `offendingAtom`); `INVALID_GEOMETRY` → `'invalid-alkene-geometry'`.
Charges are always compared; a student product with a stray charge fails as `DIFFERENT_FORMULA` → `'wrong-charge'` when only the net charge differs (05 refines).

### 8.5 Evaluating `choose-reagent`

Clicking a card sets `ctx.chosenReagent` and submits: `correct.includes(chosenReagent)` → `'correct'` with `pointsForAttempt(points, attempt, false)`; else `'wrong-reagent'` with message = `rule.rejections?.[id]` if present, otherwise `STRINGS.wrongReagentGeneric(label, resultText)` where `resultText` = `react(parse(rule.reactant), card).major[0]`'s library name or formula (`analyze` is allowed in the UI layer), or `no reaction` when `noReaction`. After `maxAttempts` (default 2) failures → `'attempts-exhausted'` and the panel highlights a correct card. The reactant stays locked; the product ghost remains visible throughout.

### 8.6 Free play

No challenge active and the bench opened: both zones unlocked. Reactant = the single component in the reactant zone (two or more, or none → panel says `STRINGS.oneReactant`). Its graph is `tagsFromPositions(extract)` so grid-built stereo (E-alkenes, seesaw/octant centres with explicit H) reaches `react` as tags (R6 keeps `react` tag-only). Products are previewed, never graded; warnings and justification show exactly as in challenges. This is the only path on which `WARN.geometryUnspecified` and `WARN.multipleSites` normally appear.

### 8.7 Student strings (`src/ui/strings.ts`, written here so 07 copies them)

| key | text |
|---|---|
| `reactantLocked` | `Reactant (locked)` |
| `buildHere` | `Build the product here` |
| `react` | `React` |
| `showAnswer` | `Show answer` |
| `clearZone` | `Clear product zone` |
| `equiv(n)` | `${n} equivalent${n === 2 ? 's' : ''}` |
| `withRx(name)` | `then ${name}` |
| `previewOnly` | `This product cannot be built on the grid (it needs a 3-membered ring); preview only.` |
| `breakHint(n)` | `${n === 1 ? 'One pair of' : `${n} pairs of`} ghost atoms touch but are not bonded (red x marker): after placing the blocks, point the bond wand at the bar between them and press E until the marker appears.` (09 §3.2) |
| `mixture(n, any)` | `Textbook mixture — ${n} products; ${any ? 'build either one' : 'this challenge names the one to build'}.` |
| `fragments(n)` | `Build all ${n} products.` |
| `minor(name)` | `Minor product: ${name}` |
| `mechanism(m)` | `Mechanism: ${m}` (`addition`, `oxidation`, `reduction`, `radical`, `SN1`, `SN2`, `E1`, `E2`) |
| `reacted(m)` | `Reaction computed: ${m}. See the bench panel.` |
| `noReaction` | `No reaction.` |
| `oneReactant` | `Put exactly one molecule in the reactant zone.` |
| `wrongReagentGeneric(label, r)` | `${label} would give ${r} here. Try another reagent.` |
| `stereoRacemic` | `Racemic: either enantiomer is accepted.` |
| `stereoRelative` | `Either enantiomer of this diastereomer is accepted.` |
| `stereoAbsolute` | `Exactly this configuration is required.` |
| `placeH(atom)` | `Place an explicit H on carbon ${atom} so its configuration is defined.` |

## 9. Test matrix

Products are compared with `sameMolecule(product, parse(expected), { stereo: policy })` (`policy` column; `relative` for template stereo, `absolute` for retained/inverted centres, `ez` for alkyne-derived alkenes, `none` otherwise). `major`/`minor` are listed in order; `warn` names `WARN` keys; `mix` = `mixture`. Every SMILES below was re-parsed with RDKit 2026.03.6 (formulas balanced against the reactant plus the reagent's atoms; CIP labels where stated). Reactants are library molecules (05 must include each).

### 9.1 One row per card (`test/reactions/additions.test.ts`, `alkynes.test.ts`, `oxidation-radical.test.ts`, `substitution-elimination.test.ts`)

| # | card | reactant | opts | major | minor | mech | stereo | policy | mix / warn |
|---|---|---|---|---|---|---|---|---|---|
| 1 | HX_HCL | `C=C(C)C` | | `CC(C)(C)Cl` | | addition | none | none | |
| 2 | HX_HBR | `CC1=CCCCC1` | | `CC1(Br)CCCCC1` | | addition | none | none | |
| 3 | HX_HI | `C=CCCC` | | `CCCC(C)I` | | addition | racemic | none | |
| 4 | HX_HBR | `C#CCCCC` | | `C=C(Br)CCCC` | | addition | none | none | |
| 5 | HX_HCL | `CCC#CCC` | | `CC/C(Cl)=C/CC` (Z) | | addition | none | ez | embeds, `suppressedPairs [[3,5]]` (09 §2.1) |
| 6 | HX_2EQ_HBR | `C#CCCCC` | | `CCCCC(C)(Br)Br` | | addition | none | none | |
| 7 | HX_2EQ_HCL | `CCC#CCC` | | `CCCC(Cl)(Cl)CC` | | addition | none | none | |
| 8 | HX_2EQ_HBR | `C=C(C)C` | | — | | none | none | | noReaction `twoEquivAlkene` |
| 9 | HBR_ROOR | `C=C(C)C` | | `CC(C)CBr` | | radical | none | none | |
| 10 | X2_BR2 | `C1=CCCCC1` | | `Br[C@H]1CCCC[C@@H]1Br` (trans; C1 S, C6 S) | | addition | relative | relative | |
| 11 | X2_BR2 | `C/C=C/C` | | `C[C@H](Br)[C@H](Br)C` (meso) | | addition | relative | absolute | |
| 12 | X2_CL2 | `C=CC` | | `CC(Cl)CCl` | | addition | racemic | none | |
| 13 | X2_BR2 | `C#CCC` | | `Br/C=C(/Br)CC` (E) | | addition | none | ez | embeds, `suppressedPairs [[0,4]]`; graded by `ch9-predict-br2-1-equiv-but-1-yne` |
| 14 | X2_BR2 | `C#CCC` | equiv 2 | `BrC(Br)C(Br)(Br)CC` | | addition | none | none | |
| 15 | HOX_BR2_H2O | `C=C(C)C` | | `CC(C)(O)CBr` | | addition | none | none | |
| 16 | HOX_CL2_H2O | `C=CC` | | `CC(O)CCl` | | addition | racemic | none | |
| 17 | H3O_HYDRATION | `CC1=CCCCC1` | | `CC1(O)CCCCC1` | | addition | none | none | |
| 18 | OXYMERC | `CCC=C(C)C` | | `CCCC(C)(C)O` | | addition | none | none | |
| 19 | HYDROBORATION | `CCC=C(C)C` | | `CCC(O)C(C)C` | | addition | racemic | none | |
| 20 | HYDROBORATION | `CC1=CCCCC1` | | `C[C@@H]1CCCC[C@H]1O` (trans; 1R,2R or mirror) | | addition | relative | relative | |
| 21 | H2_PD | `CC1=C(C)CCCC1` | | `C[C@H]1CCCC[C@H]1C` (cis, meso) | | reduction | relative | relative | |
| 22 | H2_PD | `CCCC#CCCC` | | `CCCCCCCC` | | reduction | none | none | |
| 23 | MCPBA | `C1=CCCCC1` | | `C1CCC2OC2C1` | | addition | relative | none | card off; product needs diagonal |
| 24 | EPOXIDE_H3O | `C1CCC2OC2C1` (untagged) | | `O[C@H]1CCCC[C@@H]1O` | | addition | relative | relative | card off |
| 25 | ANTI_DIHYDROXYLATION | `C1=CCCCC1` | | `O[C@H]1CCCC[C@@H]1O` (trans) | | addition | relative | relative | |
| 26 | OSO4 | `C1=CCCCC1` | | `O[C@H]1CCCC[C@H]1O` (cis) | | addition | relative | relative | |
| 27 | KMNO4_COLD | `C1=CCCCC1` | | `O[C@H]1CCCC[C@H]1O` | | addition | relative | relative | card off |
| 28 | O3_ZN | `CC(C)=C1CCCCC1` | | `O=C1CCCCC1`, `CC(C)=O` | | oxidation | none | none | fragments |
| 29 | O3_ZN | `CC=C(C)C` | | `CC(C)=O`, `CC=O` | | oxidation | none | none | fragments |
| 30 | KMNO4_HOT | `CC=C(C)C` | | `CC(C)=O`, `CC(=O)O` | | oxidation | none | none | |
| 31 | KMNO4_HOT | `CCC#CCC` | | `CCC(=O)O`, `CCC(=O)O` | | oxidation | none | none | multiset of 2 |
| 32 | KMNO4_HOT | `C=CCCC` | | `CCCC(=O)O` | | oxidation | none | none | `co2Lost` |
| 33 | HIO4 | `OC1CCCCC1O` | | `O=CCCCCC=O` | | oxidation | none | none | card off |
| 34 | CH2I2_ZNCU | `C1=CCCCC1` | | `C1CCC2CC2C1` | | addition | relative | none | card off |
| 35 | CHCL3_KOH | `C1=CCCCC1` | | `ClC1(Cl)CC2CCCCC12` | | addition | relative | none | card off |
| 36 | HGSO4_HYDRATION | `C#CCCCC` | | `CCCCC(C)=O` | | addition | none | none | |
| 37 | HGSO4_HYDRATION | `CC#CCC` | | `CCC(=O)CC`, `CC(=O)CCC` | | addition | none | none | mix, `hydrationMixture` |
| 38 | HYDROBORATION_ALKYNE | `C#CCCCC` | | `CCCCCC=O` | | addition | none | none | |
| 39 | HYDROBORATION_ALKYNE | `CCC#CCC` | | `CCC(=O)CC` | | addition | none | none | |
| 40 | H2_LINDLAR | `CCCC#CCCC` | | `CCC/C=C\CCC` (Z) | | reduction | none | ez | embeds, `suppressedPairs [[2,5]]` (09 §2.1) |
| 41 | LI_NH3 | `CCCC#CCCC` | | `CCC/C=C/CCC` (E) | | reduction | none | ez | |
| 42 | NANH2_THEN_RX | `C#CCCCC` | rx `CCCCBr` | `CCCCC#CCCCC` | | SN2 | none | none | |
| 43 | NANH2_THEN_RX | `C#C` | rx `CCCBr` | `C#CCCC` | | SN2 | none | none | |
| 44 | NANH2_THEN_RX | `C#CCCCC` | rx `CC(C)Br` | `C=CC`, `C#CCCCC` | | E2 | none | none | `acetylideElimination` |
| 45 | NANH2_THEN_RX | `CCC#CCC` | rx `CCCCBr` | — | | none | none | | noReaction `internalAlkyne` |
| 46 | NANH2_THEN_RX | `C#CCCCC` | (no rx) | — | | none | none | | noReaction `rxMissing` |
| 47 | NANH2_2EQ_DIHALIDE | `CCC(Br)C(Br)CC` | | `CCC#CCC` | | E2 | none | none | |
| 48 | NANH2_2EQ_DIHALIDE | `CCCCC(Br)CBr` | | `CCCCC#C` | | E2 | none | none | `acetylideWorkup` |
| 49 | NBS_HV | `C1=CCCCC1` | | `BrC1CCCC=C1` | | radical | racemic | none | |
| 50 | NBS_HV | `C=CCC` | | `C=CC(C)Br`, `CC=CCBr` | | radical | none | none | mix, `allylicMixture` |
| 51 | CL2_HV | `CCCC` | | `CCC(C)Cl` | `CCCCCl` | radical | racemic | none | `radicalRatio` 70/30 |
| 52 | CL2_HV | `CC(C)C` | | `CC(C)CCl` | `CC(C)(C)Cl` | radical | none | none | `radicalRatio` 64/36 (9:5 per-H weights; McMurry rounds to 65:35) |
| 53 | BR2_HV | `CC(C)C` | | `CC(C)(C)Br` | `CC(C)CBr` | radical | none | none | 99/1 |
| 54 | ROH_HX_HCL | `CC1(O)CCCCC1` | | `CC1(Cl)CCCCC1` | | SN1 | none | none | |
| 55 | ROH_HX_HBR | `CC(C)(C)O` | | `CC(C)(C)Br` | | SN1 | none | none | |
| 56 | ROH_HX_HBR | `CCC(C)O` | | `CCC(C)Br` | | SN1 | racemic | none | `rohSlow` |
| 57 | ROH_SOCL2 | `CCCO` | | `CCCCl` | | SN2 | none | none | |
| 58 | ROH_PBR3 | `CCC(C)O` | | `CCC(C)Br` | | SN2 | none | none | |
| 59 | ROH_PBR3 | `C[C@H](O)CC` (S) | | `C[C@@H](Br)CC` (R) | | SN2 | absolute | absolute | |
| 60 | ROH_PBR3 | `CC(C)(C)O` | | — | | none | none | | noReaction `rohTertiary` |
| 61 | ROH_HF_PYR | `CCCO` | | `CCCF` | | SN2 | none | none | card off |
| 62 | SN2_NAOH | `C[C@H](Br)CC` (S) | | `C[C@@H](O)CC` (R) | `C=CCC`, `CC=CC` | SN2 (in `minor`; see note) | absolute | absolute | major is E2: see note below |
| 63 | SN2_NAOH | `CCCCBr` | | `CCCCO` | `C=CCC` | SN2 | none | none | |
| 64 | SN2_NAOCH3 | `CC(C)(C)Br` | | `C=C(C)C` | | E2 | none | none | |
| 65 | SN2_NAOCH3 | `CCCCBr` | | `CCCCOC` | `C=CCC` | SN2 | none | none | |
| 66 | SN2_NAOET | `CCC(C)Br` | | `CC=CC` (ez E, not graded) | `C=CCC`, `CCC(C)OCC` | E2 | none | none | `ezAssumedTrans` |
| 67 | SN2_NAOET | `CCC(C)(C)Br` | | `CC=C(C)C` | `C=C(C)CC` | E2 | none | none | |
| 68 | SN2_NAI | `CCCCBr` | | `CCCCI` | | SN2 | none | none | |
| 69 | SN2_NAI | `CC(C)(C)Br` | | — | | none | none | | noReaction `R4_tert_aprotic` |
| 70 | SN2_NACN | `CCCCBr` | | `CCCCC#N` | | SN2 | none | none | |
| 71 | SN2_NAN3 | `CCCCBr` | | `CCCCN=[N+]=[N-]` | | SN2 | none | none | card off |
| 72 | SN2_NASH | `CCCCBr` | | `CCCCS` | | SN2 | none | none | card off |
| 73 | SN2_NH3 | `CCCCBr` | | `CCCCN` | | SN2 | none | none | card off |
| 74 | SN2_NAOAC | `CCCCBr` | | `CCCCOC(C)=O` | | SN2 | none | none | card off |
| 75 | SN2_ACETYLIDE | `CCBr` | | `CC#CCC` | | SN2 | none | none | |
| 76 | SN2_ACETYLIDE | `BrC1CCCCC1` | | `C1=CCCCC1` | (none: `minor = []`) | E2 | none | none | `ringConformation`; R3_sec_baseOnly (no SN2 alkyne) |
| 77 | TBUOK | `CCC(C)(C)Br` | | `C=C(C)CC` (Hofmann) | `CC=C(C)C` | E2 | none | none | |
| 78 | NANH2_BASE | `CCC(C)Br` | | `CC=CC` | `C=CCC` | E2 | none | none | R3_sec_baseOnly (no amine in `minor`) |
| 79 | KOH_ETOH | `CC1(Cl)CCCCC1` | | `CC1=CCCCC1` | `C=C1CCCCC1` | E2 | none | none | |
| 80 | KOH_ETOH | `BrC1CCCCC1` | | `C1=CCCCC1` | `OC1CCCCC1` | E2 | none | none | |
| 81 | H2O_HEAT | `CC(C)(C)Br` | | `CC(C)(C)O` | `C=C(C)C` | SN1 | none | none | |
| 82 | H2O_HEAT | `CCCCBr` | | — | | none | none | | noReaction `R5_primary` |
| 83 | ETOH_HEAT | `CC(C)(C)Br` | | `CCOC(C)(C)C` | `C=C(C)C` | SN1 | none | none | |
| 84 | MEOH_HEAT | `CC(C)(C)Cl` | | `COC(C)(C)C` | `C=C(C)C` | SN1 | none | none | card off |
| 85 | HCOOH_H2O | `C[C@H](Br)c1ccccc1` | | `CC(OC=O)c1ccccc1` (racemic) | `C=Cc1ccccc1` | SN1 | racemic | none | `sn1Racemic`; card off |
| 86 | H2SO4_HEAT_ROH | `CC1(O)CCCCC1` | | `CC1=CCCCC1` | `C=C1CCCCC1` | E1 | none | none | |
| 87 | H2SO4_HEAT_ROH | `CCCO` | | — | | none | none | | noReaction `dehydrationPrimary` |
| 88 | HX_HCL | `C=CC(C)C` | (warn) | `CC(C)C(C)Cl`, `CCC(C)(C)Cl` | | addition | none (weakest of racemic, none) | none | mix, `rearrangement` |
| 89 | HX_HCL | `C=CC(C)C` | apply | `CCC(C)(C)Cl` | | addition | none | none | `rearrangementApplied` |
| 90 | HX_HCL | `C=CC(C)(C)C` | (warn) | `CC(Cl)C(C)(C)C`, `CC(C)C(C)(C)Cl` | | addition | none | none | mix (methyl shift) |
| 91 | HX_HBR | `CC=CCC` | | `CCCC(C)Br`, `CCC(Br)CC` | | addition | racemic | none | mix, `regioMixture` |
| 92 | HX_HBR | `CC=CC` | | `CCC(C)Br` | | addition | racemic | none | symmetric: no warning |
| 93 | HYDROBORATION | `CCC(C)C=CC` | | two alcohols | | addition | racemic | none | mix, `regioMixture` (McMurry: 4-methyl-2-hexene) |
| 94 | X2_BR2 | `c1ccccc1C=C` (styrene) | | `BrCC(Br)c1ccccc1` | | addition | racemic | none | ring untouched |
| 95 | H2_PD | `c1ccccc1` | | — | | none | none | | noReaction `noSubstrate` |
| 96 | SN2_NAOH | `C=CCl` | | — | | none | none | | noReaction `R1` |
| 97 | SN2_NAI | `CCCCF` | | — | | none | none | | noReaction `R2` |
| 98 | SN2_NAOH | `CCCCO` | | — | | none | none | | noReaction `noSubstrate` |
| 99 | O3_ZN | `CC(C)=C(C)C` | | `CC(C)=O`, `CC(C)=O` | | oxidation | none | none | fragments: `major.length === 2` (identical fragments kept) |
| 100 | SN2_NAOH | `C(Br)(c1ccccc1)(c1ccccc1)c1ccccc1` | | `OC(c1ccccc1)(c1ccccc1)c1ccccc1` | | SN1 | none | none | R3_tert_sn1; no shift (no sp3 neighbour) |

Row 62 note: (S)-2-bromobutane is secondary; with NaOH the decision is R3_sec → `[E2, SN2]`, so the engine's `major` is 2-butene and (R)-2-butanol is `minor`. McMurry 11.2 shows the SN2 inversion on exactly this pair, so the challenge (ch11-sn2-inversion, RB-28) is authored with `expected: [C[C@@H](O)CC]`, `stereoCheck: 'absolute'`, and the roster-agreement check of §7.5 accepts a match against `major ∪ minor` for SUBST_ELIM cards (unresolved question 2). Row 62's asserted result is therefore: `major = [CC=CC]`, `minor` contains `C[C@@H](O)CC` compared with policy `absolute` (inversion retained through `substituteInvert`).

### 9.2 Decision table (`test/reactions/decision.test.ts`; `decide` output `{mechanisms, rule}`)

| # | substrate (cX) | card | cls / flags | mechanisms | rule | McMurry |
|---|---|---|---|---|---|---|
| a | `CCCC(C)Cl` (2-chloropentane) | SN2_NAOCH3 | 2 | [E2, SN2] | R3 | 11.12: E2, 2-pentene major (minor 1-pentene, then the ether) |
| b | `C[C@H](Br)c1ccccc1` | HCOOH_H2O | 2, benzylic | [SN1, E1] | R5 | 11.12: SN1 formate + E1 styrene |
| c | `CCC(Cl)c1ccccc1` | SN2_NAOAC | 2, benzylic, protic | [SN1, E1] | R4 | 11.12: SN1 |
| d | `BrCCCc1ccccc1` | SN2_NAOCH3 | 1 | [SN2, E2] | R3 | 11.12: SN2 (NaOMe/DMF) |
| e | `BrC1CCCCC1` | SN2_ACETYLIDE | 2, baseOnly | [E2] | R3 | 9.9: cyclohexene, not the alkyne (E2 "instead") |
| e2 | `CCC(C)Br` | NANH2_BASE | 2, baseOnly | [E2] | R3 | 11.12: NaNH2 is listed as a base, not a nucleophile |
| f | `CC(C)(C)Br` | H2O_HEAT | 3 | [SN1, E1] | R5 | 11.10: 64:36 tBuOH : 2-methylpropene |
| g | `CC(C)(C)Br` | SN2_NAOH | 3 | [E2] | R3 | 11.12 |
| h | `CC(C)(C)Br` | SN2_NAOCH3 | 3 | [E2] | R3 | 11.12 |
| i | `CC(C)(C)Br` | SN2_NAI | 3, aprotic | none | R4 | 11.3 |
| j | `CCCCBr` | H2O_HEAT | 1 | none | R5 | 11.5 |
| k | `CCCCBr` | SN2_NACN | 1 | [SN2] | R4 | Table 11.1 |
| l | `CBr` | TBUOK | 0 | [SN2] | R3 | methyl has no β-H |
| m | `CCC(C)(C)Br` | TBUOK | 3, bulky | [E2] Hofmann | R3 | 11.12 (orientation not in 10e) |
| n | `CC(C)(C)CBr` (neopentyl) | SN2_NAOH | 1, neopentyl | [E2] | R3 | 11.3 |
| o | `C=CCl` | SN2_NAOH | vinylic | none | R1 | 11.3 |
| p | `Clc1ccccc1` | SN2_NAOH | aryl | none | R1 | 11.3 |
| q | `CCCCF` | SN2_NAI | F | none | R2 | 11.3 |
| r | `CCCCO` | SN2_NAOH | no C–X | none | R0 | 11.3 |
| s | `C=CCBr` (allyl bromide) | H2O_HEAT | 1, allylic | [SN1, E1] → post-filter: E1 dropped (β = C2 is sp2) → [SN1] | R5 | 11.5 |
| t | `CCC(C)Br` | SN2_NAI | 2, aprotic | [SN2] | R4 | 11.12 |
| u | `CCC(C)Br` | SN2_NASH | 2, protic, plain | [SN2] + `proticSlow` | R4 | 11.3 |
| v | `CCC(C)Br` | ETOH_HEAT | 2, plain | [SN1, E1] + `slowSolvolysis` | R5 | 11.5 |
| w | `O=CCCBr` | SN2_NAOH | 1, β-carbonyl | [SN2, E2] + `e1cb` | R3 (R6 warned) | 11.10 |
| x | `C(Br)(c1ccccc1)(c1ccccc1)c1ccccc1` (trityl bromide) | SN2_NAOH | 3, benzylic, no β-H | [SN1] | R3 | `R3_tert_sn1`: triphenylmethanol (11.5) |
| y | `BrC(c1ccccc1)c1ccccc1` (bromodiphenylmethane) | NANH2_BASE | 2, benzylic, baseOnly, no β-H | [E2] → post-filter → none | R3 | `JUSTIFY.noBetaH` (the SN1 fall-through of `R3_tert_sn1` is cls 3 only; not in content) |

### 9.3 Stereo template fixtures (`test/reactions/additions.test.ts`; tags asserted directly, then `sameMolecule` against the SMILES)

| case | cis(a1,a2) | mode | `tet(c1).sign` | `tet(c2).sign` | RDKit product |
|---|---|---|---|---|---|
| cyclohexene + Br2 | true (ring) | anti | +1 | +1 | `Br[C@H]1CCCC[C@@H]1Br` |
| cyclohexene + OsO4 | true | syn | +1 | −1 | `O[C@H]1CCCC[C@H]1O` |
| cyclohexene anti-diol | true | anti | +1 | +1 | `O[C@H]1CCCC[C@@H]1O` |
| 1-methylcyclohexene + BH3/H2O2 | true | syn | +1 | −1 | `C[C@@H]1CCCC[C@H]1O` |
| 1,2-dimethylcyclohexene + H2 | true | syn | +1 | −1 | `C[C@H]1CCCC[C@H]1C` |
| (E)-but-2-ene + Br2 | false (ez) | anti | +1 | −1 | `C[C@H](Br)[C@H](Br)C` (meso; verdict SAME under `absolute`) |
| (Z)-but-2-ene + Br2 | true (ez) | anti | +1 | +1 | `C[C@@H](Br)[C@H](Br)C` (chiral pair; `relative`) |
| (E)-but-2-ene + OsO4 | false | syn | +1 | +1 | `C[C@@H](O)[C@H](O)C` |

Orders are `[c2, a1, b1, X]` and `[c1, a2, b2, Y]` with `a` = ring-continuation / `ez` ref, `b` = the other (`'H'` when implicit). Also: propene + Br2 → one centre → no tag, `racemic`; (S)-3-bromocyclohexene… not needed; untagged `CC=CC` + Br2 → `geometryUnspecified`, no tags, `stereo: 'none'`.

### 9.4 Anti-periplanar E2 (`test/reactions/substitution-elimination.test.ts`, preview path)

| reactant | product `ez` | label |
|---|---|---|
| `Br[C@H](c1ccccc1)[C@@H](Br)c1ccccc1` (meso) + KOH_ETOH | phenyls `cis: true` | `Br/C(c1ccccc1)=C/c1ccccc1` = E |
| `Br[C@H](c1ccccc1)[C@H](Br)c1ccccc1` (S,S) + KOH_ETOH | `cis: false` | `Br/C(c1ccccc1)=C\c1ccccc1` = Z |

Parities from the tags: meso `s1 = −1, s2 = −1`; (S,S) `s1 = −1, s2 = +1` (RDKit conformers; the engine reads them through `parityInOrder` on the tags and must reproduce the same products).

### 9.5 Rearrangement (`test/reactions/rearrangement.test.ts`)

`checkShift` on the lowered graph: `C=CC(C)C` cation at C2 → `{hydride, to: C3, newClass: 3}`; `C=CC(C)(C)C` → `{methyl, to: C3, migrating: a CH3, newClass: 3}`; `C=C(C)C` cation at C2 → null; `CC1(O)CCCCC1` (cation at C1) → null; `C=CC1CCCCC1` cation at C2 → hydride to the ring CH (`newClass 3`); ring-bond migration never proposed: `C=CC1(C)CCCC1` → hydride impossible (no H), methyl shift only of the exocyclic CH3 (ring bonds excluded). Policies: `warn` two products + `mixture`; `apply` one; `ignore` one, no warning.

### 9.6 Preview and protocol (`test/chem/embed.test.ts` additions, `test/content/buildable.test.ts`, `test/app/state.test.ts`)

1. Every `expected` graph of every enabled `predict-product` challenge with `stereoCheck ≠ 'none'` embeds; every `expected`/`acceptAlso` fits `PRODUCT_MIN..MAX` after translation; every reactant fits the reactant zone.
2. `CCC/C=C\CCC` → `embedOnLattice` non-null with `suppressedPairs = [[2,5]]`, `previewFor` gives `buildable: true` and the ghost carries one break marker; `C1CC1` → `embedOnLattice` null → `relaxedLayout` returns 3 positions, all bonded pairs at distance ≥ 1, no duplicates; `buildable: false`.
3. `Br[C@H]1CCCC[C@@H]1Br` embedding: both centres have `V` of the tag's sign; translating to `PRODUCT_MIN` keeps every cell in the product zone; extracting the ghost as if built and running `sameMolecule(built, target, {stereo:'absolute'})` gives SAME; the mirror ghost gives ENANTIOMER.
4. State: entering a `predict-product` challenge locks `['reactant']`, places the reactant with the graph's bond orders in `MoleculeIndex` (`CCC#CCC` reactant → one bond of order 3 in the index), `preview === 'hidden'`; `react` output stored on `bench:reacted`; leaving the challenge removes bench-owned blocks without changing inventory and unlocks.
5. `evaluatePredictProduct`: RB-12 with two correct fragments → `correct`; one fragment → `missing-molecule`; three components → `extra-molecule`; RB-28 with the (S) alcohol → `enantiomer`; with a T-shaped C2 → `unspecified-center`; RB-31 with 2-methylpropene built → `constitutional-isomer` unless `acceptAlso` lists it.
6. `choose-reagent` RB-27: `ROH_PBR3` → correct; `ROH_HX_HBR` → `wrong-reagent` with `rejections.ROH_HX_HBR` text; second wrong pick → `attempts-exhausted`.

## 10. Unresolved questions

1. **`NANH2_BASE` on methyl/primary halides.** Secondary (and tertiary) halides with `NANH2_BASE` / `SN2_ACETYLIDE` are resolved: `R3_sec_baseOnly` gives `[E2]` only (§5.7; rows 76, 78, decision e/e2). For `cls 0/1` the generic rows still apply, so 1-bromobutane + NaNH2 reports `[SN2, E2]` with butan-1-amine as `major` — chemistry McMurry does not teach (the `nuc.fragment` `N` exists only so the row is well-formed). Options: restrict `NANH2_BASE.substrates` to secondary/tertiary halides in the content validator, or extend `baseOnly` to `cls 1` (`[E2]`, Hofmann-free). No graded challenge uses `NANH2_BASE` on a primary halide. Instructor call.
2. **Secondary halide + NaOH (row 62 / RB-28).** McMurry's canonical SN2 inversion example uses a secondary substrate that the 11.12 table sends to E2 major. Decision here: the engine reports E2 major with the SN2 product in `minor`, and the roster-agreement validator accepts `expected` matches in `major ∪ minor` for SUBST_ELIM cards. Alternative: give ch11-sn2-inversion the card `SN2_NAI` or `SN2_NACN` (no base), or add a dedicated `SN2_NAOH_DMSO` aprotic card with `basicity: 'weak'` for teaching purposes. Instructor call.
3. **Two propanoic acids from 3-hexyne (row 31)** require the student to build two identical molecules; 05 may prefer `expected: [CCC(=O)O]` with `acceptAny` semantics for identical fragments (needs a multiset-collapse flag in `PredictProductRule`, not in the contract).
4. **`Decision.orientation` and `warnings`** extend the contract's `decide` return shape (superset, assignable). Fold into 00-contracts §5 when it is next revised, together with `RuleResult`/`RuleFn`.
5. **`BenchState` and the zone constants** live in `State.ts` (WP-11); `relaxedLayout` in `helpers.ts` (WP-04) so that WP-08 needs no chemistry code. If WP-01 prefers, `relaxedLayout` can move into `embed.ts` as `embedRelaxed`.
6. **Free-play reactant stereo** depends on `tagsFromPositions` (03 §12); if WP-02 drops it, free play falls back to constitution-only reactants with `WARN.geometryUnspecified` on every syn/anti addition.
7. **`WARN.ezAssumedTrans` on every acyclic E2/E1 product** may be noisy in graded challenges (ch11-e2-zaitsev…); 05 can suppress it through `Challenge.feedback` only for submit results, not for the bench panel. Consider a `ReactionResult`-level `notes` split (informational vs cautionary) in a contract revision.
8. **Radical halogenation of cycloalkanes** treats every ring CH2 as secondary (correct) but `substrateClasses` requires "alkane" = C/H only; methylcyclohexane qualifies, chloroalkanes do not (no polychlorination in v1).
9. **`HX_ADD` on a substrate with both C=C and C≡C** reacts the alkene first with a warning; McMurry 9.3 does not rank them. Content avoids enynes.
