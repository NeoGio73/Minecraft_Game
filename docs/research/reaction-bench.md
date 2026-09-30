# Research: reaction-bench

_Source: workflow agent `research:reaction-bench`._

## Summary

IMPORTANT PROCESS FLAG: the relayed user message says "Wait, you didn't ask me what topics should be included." The topic list this task assumes ("instructor chose these topics for v1") has therefore NOT been confirmed by the user. This spec covers the reaction-bench topic as assigned, but the orchestrator must confirm the topic list with the user before engineering starts; treat the reaction bench as provisional scope.

Research result: a complete, implementation-level spec for a rule-based reaction bench covering OpenStax McMurry (10e) chapters 7-11. Sources: openstax.org and chem.libretexts.org are blocked by the egress proxy, so I read the book's official CNXML source from github.com/openstax/osbooks-organic-chemistry (modules m00069-m00073 for ch. 7, m00089-m00101 ch. 8, m00104-m00111 ch. 9, m00115/m00117/m00120 ch. 10, m00123-m00133 ch. 11), including the four end-of-chapter "Summary of Reactions". Every challenge SMILES was validated with RDKit 2026.03 (formula, CIP labels, and a traversal-based cis/trans face test for ring stereo). Key findings: (1) McMurry 10e does NOT cover HBr/ROOR radical anti-Markovnikov addition nor Hofmann orientation with t-BuOK on alkyl halides (only "strong, sterically hindered base favors E2" and Hofmann elimination of quaternary ammonium salts in ch. 24), so those cards are marked optional/instructor-toggle. (2) The cubic lattice with "face-adjacent = bonded" cannot represent Z-alkenes or the E/Z geometry of tri/tetrasubstituted alkenes, because two cis heavy substituents land in face-adjacent cells (phantom bond); a "no-bond override" (bond order 0) in the bond tool, or a cyclobutene-exception in the auto-bond rule, is required for cis products (Lindlar, 1-equiv HX/X2 on internal alkynes). Trans-1,2-disubstituted alkenes, trans/cis ring substituents (cyclohexane maps exactly onto the cube's chair hexagon) and all constitution-only products embed fine; a prototype BFS+backtracking embedder placed every test product (up to 18 atoms) in under 200 search nodes. (3) Rearrangements: McMurry shows ~50:50 mixtures for 3-methyl-1-butene + HCl and 3,3-dimethyl-1-butene + HCl, so v1 should detect and warn (showing both products) rather than silently apply shifts; the 1,2-shift itself is specified for an optional toggle.

## Design specification

# Reaction Bench Design Spec (McMurry / OpenStax Organic Chemistry ch. 7-11)

> PROCESS FLAG: the user has said the topic list was never confirmed with them. Everything below is scoped to the reaction-bench topic as assigned; confirm the topic list before implementing.
>
> Source note: openstax.org and libretexts are blocked by the egress proxy; all textbook facts were read from the OpenStax book's official CNXML source (github.com/openstax/osbooks-organic-chemistry, modules cited as mNNNNN). Section numbers below follow the OpenStax 10e chapter layout (7.7-7.11, 8.1-8.13, 9.2-9.9, 10.3-10.5, 11.1-11.12).

## 0. Core data model (shared with the chemistry core)

```ts
type Element = 'C'|'H'|'O'|'N'|'Cl'|'Br'|'I'|'F'|'S';
interface Atom { id: number; el: Element; charge: 0|1|-1; explicitH?: number; /* for stereo H */
                 // stereo: neighbor order (ids, or 'H' placeholder for the implicit H) + sign
                 tet?: { order: (number|'H')[]; sign: 1|-1 } }
interface Bond { a: number; b: number; order: 1|2|3;
                 ez?: { refA: number; refB: number; cis: boolean } }   // refA is a neighbor of a, refB of b
interface MolGraph { atoms: Atom[]; bonds: Bond[] }
```
* Implicit H count = valence(el) - sum(bond orders) - |charge adjustment|. Hydrogens are implicit except (a) at stereocenters, where the student must place the H explicitly for R/S to be defined, and (b) the 'H' placeholder in `tet.order`.
* `tet.sign` = sign of det[ p(order[1])-p(order[0]), p(order[2])-p(order[0]), p(order[3])-p(order[0]) ] for any right-handed 3D realization (this is exactly what the checker computes from voxel coordinates). Swapping any two entries of `order` flips `sign`.
* Helper `deg(c)` = number of heavy (non-H) neighbors of atom c. `alkylCount(c, partner)` = deg(c) - 1 (excludes the alkene/alkyne partner). Substrate class of a C-X carbon: `cls = deg(c) - 1` (0 methyl, 1 primary, 2 secondary, 3 tertiary).
* `isAllylic(c)`: some neighbor n of c (n != the reacting partner) has a C=C bond to a third atom. `isBenzylic(c)`: some neighbor is in an aromatic 6-ring. `isNeopentyl(c)`: cls==1 and the single heavy neighbor has deg 4.
* `canon(g)`: canonical string (Morgan-style invariant refinement + backtracking over ties, or simply a VF2 isomorphism test); used for "are these two regio-products the same molecule" (symmetry detection).

Engine API:
```ts
react(substrate: MolGraph, card: ReagentCard, opts?: {equiv?: 1|2; rx?: MolGraph /* for acetylide alkylation */; rearrangement?: 'warn'|'apply'|'ignore'})
  : { major: MolGraph[]; minor?: MolGraph[]; mechanism?: 'SN1'|'SN2'|'E1'|'E2'|'addition'|'oxidation'|'reduction'|'radical'|'none';
      stereo: 'none'|'racemic'|'relative'|'absolute'; warnings: string[]; noReaction?: boolean }
```
`major` is a list because cleavage reactions give two fragments and true mixtures are reported as several molecules with a warning.

## 1. Reagent card table

Columns: id | display name | textbook reagent string | chapter.section (OpenStax) | substrate class | transformation | regio | stereo | notes. Cards flagged `notInMcMurry10e` are instructor toggles (default OFF).

| id | display | reagent string | ch. | substrate | transformation | regio | stereo | notes |
|---|---|---|---|---|---|---|---|---|
| HX_HCL | HCl | HCl, ether | 7.7-7.8 | alkene, alkyne | add H and Cl across pi bond | Markovnikov (Cl to more substituted C) | racemic; carbocation, no syn/anti control | rearrangement check |
| HX_HBR | HBr | HBr, ether | 7.7-7.8 | alkene, alkyne | add H, Br | Markovnikov | racemic | rearrangement check |
| HX_HI | HI | HI (KI, H3PO4) | 7.7 | alkene, alkyne | add H, I | Markovnikov | racemic | rearrangement check |
| HX_2EQ (HCl/HBr) | 2 equiv HX | 2 HBr (or 2 HCl), ether | 9.3 | alkyne | add 2 HX, both X on same carbon | Markovnikov both times | none | geminal dihalide |
| HBR_ROOR | HBr, peroxides | HBr, ROOR | not in 10e | alkene | add H, Br | anti-Markovnikov (Br to less substituted C) | racemic | `notInMcMurry10e: true`, default OFF |
| X2_BR2 | Br2 | Br2, CH2Cl2 (or CCl4) | 8.2 / 9.3 | alkene, alkyne | add Br, Br | n/a (symmetric) | ANTI (trans) | halonium ion; alkyne 1 equiv gives trans-dihaloalkene, 2 equiv tetrahalide |
| X2_CL2 | Cl2 | Cl2, CH2Cl2 | 8.2 | alkene, alkyne | add Cl, Cl | n/a | ANTI | |
| HOX_BR2_H2O | Br2, H2O (or NBS, H2O/DMSO) | Br2, H2O | 8.3 | alkene | add Br and OH | Markovnikov: OH to more substituted C, Br to less | ANTI | bromohydrin |
| HOX_CL2_H2O | Cl2, H2O | Cl2, H2O | 8.3 | alkene | add Cl and OH | OH to more substituted | ANTI | chlorohydrin |
| H3O_HYDRATION | H3O+ | H2O, H2SO4 (cat.) | 8.4 (7.7) | alkene | add H and OH | Markovnikov (OH to more substituted) | racemic (carbocation) | rearrangement check; industrial, harsh |
| OXYMERC | oxymercuration | 1) Hg(OAc)2, H2O/THF 2) NaBH4 | 8.4 | alkene | add H and OH | Markovnikov | racemic; no defined syn/anti (H from NaBH4 either face) | mercurinium ion: NO rearrangement |
| HYDROBORATION | hydroboration-oxidation | 1) BH3, THF 2) H2O2, NaOH | 8.5 | alkene | add H and OH | ANTI-Markovnikov (OH to less substituted C) | SYN | one step, no cation |
| H2_PD | catalytic hydrogenation | H2, Pd/C (or PtO2) | 8.6 / 9.5 | alkene, alkyne | add H, H (alkyne: twice, to alkane) | n/a | SYN | |
| MCPBA | epoxidation | RCO3H (m-CPBA), CH2Cl2 | 8.7 | alkene | form epoxide (3-ring O) | n/a | SYN | product has odd ring: requiresDiagonalBonds |
| EPOXIDE_H3O | epoxide hydrolysis | H3O+ | 8.7 | epoxide | open epoxide to 1,2-diol | n/a | ANTI (trans diol) | substrate has odd ring |
| ANTI_DIHYDROXYLATION | 1) RCO3H 2) H3O+ | 1) m-CPBA 2) H3O+ | 8.7 | alkene | add OH, OH | n/a | ANTI | composite card = MCPBA then EPOXIDE_H3O; avoids building the epoxide |
| OSO4 | syn dihydroxylation | 1) OsO4 2) NaHSO3, H2O (or cat. OsO4, NMO) | 8.7 | alkene | add OH, OH | n/a | SYN (cis diol) | |
| KMNO4_COLD | KMnO4, cold dilute, OH- | KMnO4, NaOH, 0 C | (not in 10e; classic syn diol alt) | alkene | add OH, OH | n/a | SYN | optional alias of OSO4, `notInMcMurry10e` |
| O3_ZN | ozonolysis | 1) O3 2) Zn, H3O+ (Zn/AcOH) | 8.8 | alkene | cleave C=C to two C=O | n/a | none | R2C= to ketone, RHC= to aldehyde, H2C= to formaldehyde |
| KMNO4_HOT | KMnO4, H3O+ (hot/acidic) | KMnO4, H3O+ | 8.8 | alkene, alkyne | cleave C=C; R2C= ketone, RHC= carboxylic acid, H2C= CO2; alkyne: internal gives 2 RCO2H, terminal gives RCO2H + CO2 | n/a | none | |
| HIO4 | periodic acid | HIO4, H2O | 8.8 | 1,2-diol | cleave C-C between the two C-OH to two C=O | n/a | none | optional |
| CH2I2_ZNCU | Simmons-Smith | CH2I2, Zn(Cu), ether | 8.9 | alkene | add CH2 across C=C forming cyclopropane | n/a | SYN, stereospecific (cis alkene gives cis cyclopropane) | requiresDiagonalBonds |
| CHCL3_KOH | dichlorocarbene | CHCl3, KOH | 8.9 | alkene | add CCl2 forming 1,1-dichlorocyclopropane | n/a | SYN, stereospecific | requiresDiagonalBonds |
| HGSO4_HYDRATION | Hg-catalyzed alkyne hydration | H2O, H2SO4, HgSO4 | 9.4 | alkyne | add H2O then tautomerize: ketone | Markovnikov (OH to more substituted alkyne C; terminal gives methyl ketone) | none | unsymmetrical internal gives mixture |
| HYDROBORATION_ALKYNE | alkyne hydroboration-oxidation | 1) BH3 (Sia2BH for terminal), THF 2) H2O2, NaOH | 9.4 | alkyne | add H2O then tautomerize: aldehyde (terminal) or ketone (internal) | ANTI-Markovnikov | none | unsymmetrical internal gives mixture |
| H2_LINDLAR | Lindlar hydrogenation | H2, Lindlar catalyst | 9.5 | alkyne | add H, H once: cis alkene | n/a | SYN, Z alkene | needs no-bond override to build (see section 4) |
| LI_NH3 | dissolving-metal reduction | Li (or Na), NH3(l) | 9.5 | alkyne | add H, H once: trans alkene | n/a | E alkene | |
| NANH2_THEN_RX | acetylide alkylation | 1) NaNH2, NH3 2) R-Br (R = CH3 or primary) | 9.8-9.9 | terminal alkyne | replace terminal H by R | n/a | none | card takes `rx` param; secondary/tertiary RX gives E2 alkene instead |
| NANH2_2EQ_DIHALIDE | alkyne from vicinal dihalide | 2 NaNH2 (or excess KOH), then H3O+ | 9.2 | 1,2-dihalide (or vinylic halide) | two E2 eliminations: alkyne | n/a | none | |
| NBS_HV | allylic bromination | NBS, hv, CCl4 | 10.3 | alkene with allylic C-H | substitute one allylic H by Br | radical; site = allylic sp3 C with H | racemic | resonance can move the C=C: v1 restricts to symmetric substrates |
| ROH_HX | alcohol + HX | HCl or HBr (or HI), ether, 0 C | 10.5 / 11.5 | alcohol (best tertiary, allylic, benzylic) | replace OH by X | n/a | racemic at that carbon (SN1) | primary/secondary: warn 'slow, use SOCl2/PBr3'; rearrangement check |
| ROH_SOCL2 | thionyl chloride | SOCl2, pyridine | 10.5 | 1 or 2 alcohol | replace OH by Cl | n/a | inversion (SN2) [likely] | tertiary: warn |
| ROH_PBR3 | phosphorus tribromide | PBr3, ether | 10.5 | 1 or 2 alcohol | replace OH by Br | n/a | inversion (SN2) [likely] | tertiary: warn |
| ROH_HF_PYR | HF-pyridine | HF, pyridine | 10.5 | 1 or 2 alcohol | replace OH by F | n/a | - | optional |
| SN2_NAOH | hydroxide | NaOH (or KOH), H2O/DMSO | 11.2-11.3 | alkyl halide/tosylate | Nu = OH | decision table | inversion | strong base too: E2 on 2/3 |
| SN2_NAOCH3 / SN2_NAOET | alkoxide | NaOCH3, CH3OH (NaOEt, EtOH) | 11.3 / 11.7 | alkyl halide | Nu = OR (ether) or E2 | decision table | inversion / Zaitsev | strong base: E2 for 2/3 substrates |
| SN2_NAI | iodide | NaI, acetone | 11.3 (Table 11.1) | methyl/1/2 halide | Nu = I | SN2 | inversion | weak base, no E2 |
| SN2_NACN | cyanide | NaCN, DMSO | 11.3 | methyl/1/2 halide | Nu = CN (nitrile) | SN2 | inversion | weakly basic |
| SN2_NAN3 | azide | NaN3, DMF | 11.3 | methyl/1/2 halide | Nu = N3 | SN2 | inversion | optional |
| SN2_NASH | hydrosulfide | NaSH, EtOH | 11.3 | methyl/1/2 halide | Nu = SH (thiol) | SN2 | inversion | optional |
| SN2_NH3 | ammonia | NH3 (excess) | 11.3 | methyl/1 halide | Nu = NH2 (amine) | SN2 | inversion | optional |
| SN2_NAOAC | acetate | NaOAc (CH3CO2Na) | 11.5 example | halide | Nu = OAc (ester) | weakly basic: SN2 (1/2), SN1 (3, benzylic, protic) | | optional |
| SN2_ACETYLIDE | acetylide | NaC(triple)CR | 9.9 / 11.3 | methyl/1 halide | Nu = C(triple)CR | SN2 | inversion | 2/3: E2 |
| TBUOK | tert-butoxide | KOtBu, tBuOH | 11.12 ('strong, sterically hindered base') | alkyl halide | E2, Hofmann (less substituted alkene) | Hofmann | anti-periplanar | Hofmann orientation `notInMcMurry10e` (only 'hindered base favors E2 over SN2' is stated) |
| NANH2_BASE | sodium amide | NaNH2, NH3 | 11.8 | alkyl halide | E2 (strong base) | Zaitsev | | |
| KOH_ETOH | KOH, ethanol | KOH, EtOH, heat | 8.1 / 11.7 | alkyl halide | E2 | Zaitsev | anti-periplanar | classic dehydrohalogenation |
| H2O_HEAT | water, heat (solvolysis) | H2O, heat | 11.4 / 11.10 | 3, allylic, benzylic (2 slow) halide | SN1 (ROH) major + E1 alkene minor | Zaitsev for E1 | racemization | e.g. 64:36 SN1:E1 for tBuCl in 80% aq EtOH, 65 C |
| ETOH_HEAT | ethanol, heat (solvolysis) | EtOH, heat | 11.5 / 11.10 | as above | SN1 (ethyl ether) major + E1 minor | | racemization | MEOH_HEAT analogous |
| HCOOH_H2O | formic acid / water | HCO2H, H2O | 11.12 example | 2 benzylic, 3 | SN1 formate ester + E1 | | racemization | optional |
| H2SO4_HEAT_ROH | dehydration | H2SO4, H2O/THF, 50 C | 8.1 | alcohol (tertiary) | E1: alkene | Zaitsev | | 1-methylcyclohexanol gives 1-methylcyclohexene (91%) |

Card attributes needed by the decision table (section 3):
```ts
interface ReagentCard { id; label; reagentText; chapter; section; substrates: SubstrateClass[]; rule: RuleId;
  nuc?: { atom: Element; group: MolGraph /* fragment to attach */; strength: 'strong'|'moderate'|'weak';
          basicity: 'strong'|'weak'; bulky: boolean; charged: boolean };
  solvent?: 'protic'|'aprotic'|'none'; heat?: boolean; equiv?: 1|2; notInMcMurry10e?: boolean }
```
Attribute values (from OpenStax Table 11.1 and text): strong nucleophiles: I-, CN-, HS-, CH3O-/RO-, HO-, N3-, RC(triple)C-, NH2-; moderate: NH3, Cl-, CH3CO2-, Br-; weak: H2O, ROH, RCO2H. Strong bases: HO-, RO-, tBuO- (bulky), NH2-, RC(triple)C-. Weak bases (nonbasic nucleophiles): H2O, ROH, RCO2H/RCO2-, I-, Br-, Cl-, CN-, N3-, HS-, NH3 (treat NH3 as weak base for this table).

## 2. Transformation rules (graph level)

### 2.0 Common helpers
* `findAlkenes(g)`: bonds with order 2 between two C atoms, neither aromatic. `findAlkynes(g)`: order-3 C-C bonds. `findCX(g)`: single bonds C-{Cl,Br,I} (and C-OTs if tosylates are modeled). `findCOH(g)`: C-O single with O bearing one H and no other heavy neighbor. If the site count is 0: `noReaction` with warning "no <site> found". If >1 site: v1 reacts ALL sites with the same card only for symmetric reagents (H2, X2, O3, KMnO4); for regiochemical cards react the first site and warn "multiple reactive sites: v1 reacts one" (challenge content uses single-site substrates).
* Markovnikov selector for pi bond (c1,c2): `k1 = alkylCount(c1,c2)`, `k2 = alkylCount(c2,c1)`, optionally `+1` if the resulting cation would be allylic/benzylic. Electrophile-derived group (H, Br+ of Br2/H2O, Hg) goes to the LESS substituted carbon; the nucleophile-derived group (X, OH) goes to the MORE substituted carbon. Anti-Markovnikov cards (hydroboration, HBr/ROOR) swap. If k1 == k2: compute both products; if `canon(p1) == canon(p2)` the alkene is symmetric and there is one product (e.g. 2-butene + HBr gives 2-bromobutane); else return both in `major` with warning "equally substituted alkene: mixture of regioisomers (McMurry 7.8)". Challenge content must avoid ties.
* `addAcross(g, c1, c2, groupTo1, groupTo2, stereo: 'syn'|'anti'|'none')`: lower bond order by 1 (2 to 1, 3 to 2); attach group fragments (H = increment implicit H; OH = new O atom bonded to c; Br = new Br atom; CH3 etc. as fragments); then assign stereo by the template in 2.1.
* Cation-class helpers for rearrangement in 2.9.

### 2.1 Syn/anti stereo assignment (template method)
Used by every addition. Given pi bond c1=c2 with substituents a1,b1 on c1 and a2,b2 on c2 (each may be 'H'), and the cis/trans relation between a1 and a2:
* Source of the relation: (i) `bond.ez` of the reactant (student-built alkene with coplanar substituents), (ii) ring membership: if c1 and c2 are in the same ring, the ring-continuation neighbors are cis, (iii) if the alkene is 1,1-disubstituted or monosubstituted the relation is irrelevant, (iv) otherwise (twisted acyclic build) the relation is undefined: assign no stereo and warn "reactant alkene geometry undefined".
* Local frame: c1=(0,0,0), c2=(1,0,0), a1=(-0.5,0.87,0), b1=(-0.5,-0.87,0), a2=(1.5,0.87,0) if cis(a1,a2) else (1.5,-0.87,0), b2 the remaining slot. New groups: X on c1 at (0,0,1); Y on c2 at (1,0,1) for syn, (1,0,-1) for anti. Then for each carbon that becomes a stereocenter (four distinct neighbors incl. at most one H) set `tet = { order: [partner, a, b, newGroup], sign: sign(det(a-partner, b-partner, new-partner)) }`. Alkyne additions (1 equiv HX, X2): same frame; trans addition places H/X (or X/X) on opposite sides in the plane, giving `bond.ez` with `cis = false` between the two added groups (equivalently, the added X is cis to the substituent on the other carbon).
* Because the face choice is arbitrary, the result is one enantiomer; set result `stereo: 'relative'` when the reactant had no stereocenters (checker accepts either enantiomer = racemic) and `'absolute'` only when the reactant already carried defined stereocenters that are retained. For additions with `'none'` stereo (HX, H3O+, oxymercuration) that create exactly one new stereocenter: leave `tet` undefined and set `stereo: 'racemic'`; if they create two new stereocenters (e.g. HBr on 1,2-disubstituted ring alkene) v1 returns no stereo and warns "mixture of diastereomers".

### 2.2 Alkene additions
| card | groups (to less-subst C / to more-subst C) | stereo | notes |
|---|---|---|---|
| HX_* | H / X | none (racemic) | rearrangement check (2.9) |
| HBR_ROOR | Br / H | none | anti-Markovnikov; optional |
| X2_* | X / X | anti | |
| HOX_* | X / OH | anti | Markovnikov: OH on more substituted |
| H3O_HYDRATION | H / OH | none | rearrangement check |
| OXYMERC | H / OH | none | no rearrangement |
| HYDROBORATION | OH / H | syn | H and OH syn; e.g. 1-methylcyclohexene gives trans-2-methylcyclohexanol (OH and CH3 trans) |
| H2_PD | H / H | syn | matters only if both carbons become stereocenters (1,2-dimethylcyclohexene gives cis) |
| OSO4 (KMNO4_COLD) | OH / OH | syn | cis diol |
| MCPBA | one O bonded to both carbons | syn | creates 3-ring; `requiresDiagonalBonds` |
| EPOXIDE_H3O | break one C-O of the epoxide, add OH to that carbon, the other keeps O-H | anti | opening at either carbon gives the same trans diol for symmetric epoxides; for unsymmetric v1 opens at the more substituted carbon (acid conditions) |
| ANTI_DIHYDROXYLATION | OH / OH | anti | trans diol directly |
| CH2I2_ZNCU / CHCL3_KOH | new C (H2 or Cl2) bonded to both alkene carbons | syn, stereospecific | 3-ring; cis substituents stay cis |
| O3_ZN | delete C=C; each carbon gets =O | none | fragments: g may split into 2 molecules (or 1 dicarbonyl if the C=C was in a ring); run connected-components |
| KMNO4_HOT | as O3_ZN, then: carbon with one H becomes C(=O)OH; carbon with two H (H2C=) becomes CO2 (drop it, add note); R2C= stays ketone | none | alkynes: each alkyne carbon becomes CO2H; terminal CH gives CO2 |
| NBS_HV | pick allylic sp3 carbon with >=1 H (prefer secondary over primary); replace H by Br | racemic | if two non-equivalent allylic sites or resonance would relocate the C=C, warn "mixture of allylic isomers"; v1 content uses cyclohexene |

### 2.3 Alkyne additions
* HX 1 equiv (`HX_*` on alkyne): H to less substituted alkyne carbon, X to more substituted; bond 3 to 2; `ez`: H and X trans (McMurry: "trans stereochemistry of H and X normally"). Terminal alkyne product is a 1,1-disubstituted alkene (no E/Z). For symmetric internal (3-hexyne + HCl) the product is (Z)-3-chloro-3-hexene (verified: CC/C(Cl)=C/CC). For unsymmetrical internal alkynes both carbons have one substituent: tie, mixture warning.
* HX 2 equiv (`HX_2EQ`): apply 1 equiv, then apply HX again to the vinyl halide with X directed to the carbon ALREADY bearing X (halogen-stabilized cation; Markovnikov by substitution count also agrees because that carbon has more heavy neighbors), giving the geminal dihalide (1-hexyne gives 2,2-dibromohexane; 3-hexyne gives 3,3-dichlorohexane).
* X2 1 equiv: X to each carbon, bond 3 to 2, `ez` with the two X trans (1-butyne + Br2 gives (E)-1,2-dibromo-1-butene = Br/C=C(/Br)CC). X2 2 equiv: then add X2 anti across the resulting alkene (no stereo since the carbons carry two identical X).
* HGSO4_HYDRATION: OH to more substituted alkyne carbon, H to the other, bond 3 to 2 (enol), then `tautomerize`. Terminal alkyne gives methyl ketone. Symmetric internal gives one ketone. Unsymmetrical internal: two enols, return both ketones with warning "mixture (McMurry 9.4)".
* HYDROBORATION_ALKYNE: OH to LESS substituted carbon (terminal carbon for terminal alkynes), H to the other; enol; `tautomerize` gives aldehyde (terminal) or ketone (internal, symmetric). Unsymmetrical internal: mixture warning.
* `tautomerize(g, enolC, partnerC)`: bond enolC-partnerC 2 to 1; bond enolC-O 1 to 2; O loses its H; partnerC gains one implicit H. (Ketone/aldehyde is favored "with few exceptions", McMurry 9.4.)
* H2_PD on alkyne: apply syn H2 addition twice (alkane). H2_LINDLAR: once, `ez.cis = true` between the two carbon substituents (cis alkene). LI_NH3: once, `ez.cis = false` (trans). For terminal alkynes the product is a terminal alkene either way (no E/Z; no warning).
* NANH2_THEN_RX: requires a terminal alkyne C(triple)C-H (else noReaction "internal alkynes have no acidic H, pKa ~25 vs NH3 35"). Requires `opts.rx` with a C-X where cls <= 1 and X in {Br, I}: replace the terminal H by the alkyl fragment (SN2 at RX carbon; if RX carbon is a stereocenter, invert). If rx cls >= 2: product = E2 alkene of RX (section 3) + the unchanged alkyne, warning "acetylide is a strong base: elimination (McMurry 9.9)".
* NANH2_2EQ_DIHALIDE: substrate with X on two adjacent sp3 carbons each bearing >=1 H, or a vinylic halide with an H on the adjacent alkene carbon: remove both HX (bond becomes 3). Product alkyne; if the resulting alkyne is terminal, note the acetylide forms until H3O+ workup.

### 2.4 Alcohol to halide (ch. 10)
* ROH_HX: site C-OH. If cls(C)==3 or allylic/benzylic: SN1: replace OH by X, drop `tet` (racemize), run rearrangement check; else (cls 1 or 2): still replace OH by X but warn "primary/secondary alcohols react slowly with HX; SOCl2/PBr3 are preferred (McMurry 10.5)"; for cls 2 racemize.
* ROH_SOCL2 / ROH_PBR3: cls 1 or 2 only (cls 3: warn "not typical for tertiary alcohols", still allow product for the bench? no: return noReaction with hint); replace OH by Cl/Br with SN2 inversion at that carbon (section 2.6). Mark stereo 'absolute' if the reactant had a defined center.

### 2.5 Substitution / elimination product construction (ch. 11)
The DECISION TABLE (section 3) yields a mechanism list; each mechanism builds its product:
* SN2: `substituteInvert(g, cX, X, nucFragment)`: remove X, attach the nucleophile atom in X's slot of `tet.order`, flip `tet.sign` (verified with RDKit: (S)-2-bromobutane C[C@H](Br)CC gives (R)-2-butanol C[C@@H](O)CC). If cX has no stereo, none results (racemic if a new center is created, which cannot happen here).
* SN1: replace X by the nucleophile atom; delete `tet` at cX (racemization; McMurry: "few SN1 displacements occur with complete racemization; most give 0-20% excess inversion" - v1 reports "racemic (slight excess inversion)"). Nucleophile for solvolysis cards = solvent: H2O gives OH, EtOH gives OCH2CH3, MeOH gives OCH3, HCO2H gives OC(=O)H. Run rearrangement check on the cation carbon before attaching.
* E2 / E1 (shared): `betaCandidates = neighbors(cX) that are sp3 carbons with >=1 H`. For each beta compute `subst = (deg(cX)-1) + (deg(beta)-1)` (heavy substituents on the resulting C=C). Zaitsev: choose max subst; Hofmann (bulky base): choose min subst, tie-break by the beta with the most H (least hindered). Ties (equal subst, non-equivalent products by canon): return both, warning "mixture; Zaitsev cannot distinguish". Build: remove X from cX, remove one H from beta, set bond cX-beta order 2. Minor product: the next-best alkene (report as `minor`).
* E/Z of the new alkene: (a) if each alkene carbon ends with two different substituents: for E2 on substrates where BOTH cX and beta had defined `tet`, derive geometry by anti-periplanar rule: realize tetrahedral coordinates for both carbons from `tet`, rotate about the C-C bond until dihedral(H, beta, cX, X) = 180 deg, then substituents with positive component along the common perpendicular (normal to the H-C-C-X plane) are cis to each other (meso-1,2-dibromo-1,2-diphenylethane gives E, the (1S,2S) isomer gives Z; McMurry 11.8). (b) otherwise (free rotation, no stereocenters) set E (larger groups trans) as the displayed answer but mark `ezChecked: false` in challenges, since McMurry does not state a trans preference. (c) E1: Zaitsev, no geometric requirement; same E display rule.
* Cyclohexane E2 (optional v1.1): the beta H must be trans (diaxial) to X. If cX and beta both carry defined `tet` and the beta carbon's non-H substituent is TRANS to X (i.e. its H is cis to X), exclude that beta (menthyl chloride gives the non-Zaitsev 2-menthene, McMurry 11.9). v1 default: ignore (warn "ring conformational requirement not modeled").
* E1cB: out of scope for v1 (needs carbonyl beta to X); return warning if a C=O is two carbons from X.

### 2.6 Multi-step and equivalents
`equiv` applies to HX_* and X2_* on alkynes (1 default, 2 = geminal/tetra). H2_PD on alkynes is always full reduction; Lindlar/Li-NH3 always one equivalent. The composite cards (ANTI_DIHYDROXYLATION, NANH2_THEN_RX, NANH2_2EQ_DIHALIDE) are sequences of the primitive rules.

### 2.7 Products that are mixtures
`major` holds more than one molecule only for cleavage fragments or genuine textbook mixtures (tie regiochemistry, unsymmetrical alkyne hydration, rearrangement mixtures). The challenge checker requires the student to build every molecule in `major` (fragments) and the UI labels mixtures as "either is accepted" when the challenge JSON says `acceptAny: true`.

### 2.8 Aromatic rings
Benzene rings are inert to every card here (McMurry 8.3, 8.6: styrene's ring does not react with Br2 or H2/Pd). `findAlkenes` must exclude aromatic bonds (Kekule double bonds inside a 6-ring with alternating orders and all-sp2 atoms).

### 2.9 Carbocation rearrangements (HX, H3O+, ROH_HX, SN1, E1 only; NOT oxymercuration, halonium, hydroboration)
Recommendation for v1: **detect and warn**, do not silently apply. McMurry's own examples are ~50:50 mixtures, so there is no single "major product" to grade; challenge content avoids rearranging substrates; the bench shows both products with the note "carbocation rearrangement (1,2-hydride/methyl shift) likely; McMurry 7.11 reports about a 1:1 mixture". Provide `opts.rearrangement: 'apply'` for an instructor demo mode.
Algorithm `checkShift(g, c)` where c is the cation carbon (the Markovnikov carbon for additions; cX for SN1/E1):
```
cls(c) = deg(c)   // heavy neighbors of the cation carbon (after H added for additions)
for n in heavyNeighbors(c) that are sp3 carbons:
   hydride: if implicitH(n) >= 1 and deg(n) > cls(c)               -> shift: n loses H, c gains H, cation moves to n
   methyl : if implicitH(n) == 0 and n has a CH3 (or alkyl) neighbor m != c and (deg(n) - 1) > cls(c)
                                                                   -> shift: bond n-m deleted, bond c-m created, cation moves to n
   treat allylic/benzylic n as deg(n)+1
pick the shift giving the highest class (tertiary/benzylic); if none: no rearrangement
```
Then finish the reaction at the new cation (attach nucleophile / eliminate). Test vectors: 3-methyl-1-butene + HCl gives CC(C)C(C)Cl (unrearranged) and CCC(C)(C)Cl (rearranged); 3,3-dimethyl-1-butene + HCl gives CC(Cl)C(C)(C)C and CC(C)C(C)(C)Cl. Ring expansions are out of scope.

## 3. SN1 / SN2 / E1 / E2 decision table (McMurry 11.3, 11.5, 11.12), evaluated in order

Inputs: `cls` (0 methyl, 1 primary, 2 secondary, 3 tertiary), flags `allylic`, `benzylic`, `neopentyl`, `vinylicOrAryl`; card `nuc.strength`, `nuc.basicity`, `nuc.bulky`, `solvent`, `heat`; leaving group `X`.
```
R0  no C-X (Cl, Br, I, OTs)            -> noReaction ("alcohols, ethers, amines, fluorides are not substrates: OH-, RO-, NH2-, F- are poor leaving groups")
R1  X on sp2 carbon (vinylic/aryl)      -> noReaction ("vinylic and aryl halides do not undergo SN2 or SN1", 11.3)
R2  leaving-group rank I > Br > Cl >> F: F -> noReaction; OTs behaves like I
R3  base strong (HO-, RO-, tBuO-, NH2-, acetylide):
      cls 3                             -> E2 (Zaitsev; Hofmann if bulky). NEVER SN2. ("tertiary + strong base is E2", 11.12)
      cls 2                             -> E2 major (Zaitsev / Hofmann if bulky); SN2 minor only if nuc.strength strong and not bulky
      cls 1 or 0:
         bulky (tBuO-)                  -> E2 Hofmann (cls 0: SN2 - methyl has no beta H)
         neopentyl                      -> E2 (SN2 blocked by branching one carbon away)
         else                           -> SN2 major (inversion), E2 minor
R4  base weak, nucleophile strong/moderate (I-, CN-, N3-, HS-, RS-, RCO2-, NH3, Cl-, Br-):
      cls 0, 1                          -> SN2
      cls 2                             -> SN2 if solvent aprotic (or no better option); if solvent protic AND (allylic or benzylic) -> SN1 (+E1 minor)
      cls 3                             -> solvent protic: SN1 (+E1 minor); aprotic: noReaction ("tertiary halides do not react by SN2")
R5  nucleophile weak = solvent (H2O, ROH, HCO2H), protic, usually heat (solvolysis):
      cls 3, or cls 2 with allylic/benzylic -> SN1 major + E1 minor (heat raises E1 share; still report SN1 major per 64:36 example)
      cls 2 (plain)                     -> SN1/E1 slowly (warn "slow")
      cls 0, 1 (not allylic/benzylic)   -> noReaction ("primary carbocations do not form"); primary allylic/benzylic -> SN1
R6  E1cB flag (C=O beta to X, base present)  -> warn, out of scope
```
Products: SN2 via `substituteInvert`; SN1 via racemizing substitution (+rearrangement check); E2/E1 via Zaitsev/Hofmann builder. Report `mechanism` and a one-line justification string quoting the rule (for the HUD).
Textbook checks the engine must reproduce: 2-chloropentane + NaOMe/MeOH -> E2 (2-pentene major); 1-bromo-1-phenylethane + HCO2H/H2O -> SN1 formate + E1 styrene; 1-chloro-1-phenylpropane + NaOAc/AcOH-H2O -> SN1; 3-bromopropylbenzene + NaOMe/DMF -> SN2; bromocyclohexane + NaC(triple)CCH3 -> E2 cyclohexene; tBuBr + H2O -> SN1 tBuOH (E1 minor 2-methylpropene); tBuBr + NaOH/NaOMe -> E2 2-methylpropene.

## 4. Product generation on the cubic grid

### 4.1 Lattice facts that constrain the design (verified with a prototype)
* Bipartite lattice: odd rings (3, 5, 7) need edge-diagonal bonds. Epoxides, cyclopropanes, cyclopentane products are flagged `requiresDiagonalBonds`.
* Because face-adjacent blocks are bonded automatically, an embedding must satisfy `faceAdjacent(p,q) <=> bonded(p,q)` for every atom pair (no phantom bonds). Consequences:
  - Cyclohexane embeds only as the cube's chair hexagon (0,0,0)-(1,0,0)-(1,1,0)-(1,1,1)-(0,1,1)-(0,0,1) (the 2x3 rectangle has chords). Each ring carbon then has exactly 3 legal substituent cells, so cis/trans 1,2-substituents are representable.
  - A Z-alkene (two cis heavy substituents) is NOT representable: the substituent cells are face-adjacent. Likewise the E/Z geometry of any tri/tetrasubstituted alkene: such alkenes can be built only "twisted" (substituent planes perpendicular), which is fine for constitution-only checks but carries no E/Z. Only E-1,2-disubstituted alkenes have buildable geometry.
  - REQUIRED MECHANIC (recommend to the world/bond engine): a "no-bond override" - the bond tool cycles 0/1/2/3 where 0 explicitly unbonds two face-adjacent blocks (render a visible gap/notch). Fallback: the auto-bond rule skips a pair whose bond would close a 4-membered ring containing a double bond. Without one of these, challenges that build Z products (Lindlar, 1-equiv HX/X2 on internal alkynes) must be choose-reagent challenges or stereo-unchecked.
  - Stereocenters bearing an H need the H placed explicitly: with 3 heavy neighbors and the H implicit, the 2 free octahedral cells give opposite chiralities, so configuration is undefined. With 4 heavy neighbors, if the two free cells are opposite each other the arrangement is square-planar (undefined); if adjacent it is a seesaw and the parity is defined (det != 0).

### 4.2 Embedding algorithm (BFS layout with backtracking; prototype placed every test product in 7-175 nodes, <10 ms)
```
order = BFS from the max-degree atom (neighbors sorted by degree desc); include explicit H atoms at stereocenters
place(k):
  if k == n: success
  i = order[k]; parent = first already-placed bonded neighbor
  cands = parent.pos + FACE(6)  [+ EDGE_DIAGONAL(12) if allowDiagonal]; sort: straight continuation (parent - grandparent direction) first
  for p in cands:
     reject if occupied
     for each placed atom q: reject if faceAdjacent(p,q) != bonded(i,q); reject if bonded(i,q) and not adjacent(p,q,allowDiagonal)
     if every neighbor of a stereocenter c (c == i or c bonded to i) is now placed: reject unless sign(det from lattice coords, same neighbor order as c.tet.order) == c.tet.sign (det == 0 => reject)
     if both ends and both reference substituents of an ez bond are placed: reject unless (perp components parallel) == cis; perpendicular (dot == 0) => reject
     commit p; if place(k+1): success; undo
  fail
node budget 50,000; on failure fall back to the preview (4.3)
```
Diagonal adjacency counts as a bond only where the game says so (explicit diagonal bonds), so it is not part of the phantom-bond test. Multi-fragment products are embedded separately with an offset of 4 cells.

### 4.3 Presentation modes
1. **Ghost build**: render the embedding as translucent "ghost blocks"; the student fills them (easy mode). 2. **Ball-and-stick preview**: Three.js spheres/cylinders using the embedding coordinates (already 3D) or, if embedding failed, a force-directed 3D layout; student builds freely (normal mode). 3. **Name/formula only** (hard mode). For choose-reagent challenges the product is only previewed, never built, so Z-alkene products are allowed there.

### 4.4 Checking the student's product
1. Extract `S` from the voxel world: atoms = blocks; bonds = face adjacency (+ explicit diagonal) with the bond tool's order; explicit H blocks are collapsed into implicit H counts except that their positions are kept for parity.
2. Split `S` and expected `E` into connected components; multisets must match (one component per expected molecule; extra/missing -> "you have N molecules, expected M").
3. Constitution: VF2-style backtracking isomorphism (atom invariant = element, charge, degree, sorted bond orders, implicit H count; bond invariant = order). Molecules are <= 40 heavy atoms, so no canonicalization is needed; the mapping phi is required for stereo anyway.
4. Stereo (only if the challenge's `stereoCheck != 'none'`): for each `tet` center c in E: student's center phi(c): compute sign from lattice positions with neighbor order phi(c.tet.order) (H must be explicit; if missing -> "place the H on C to define its configuration"; det == 0 -> "square-planar arrangement: configuration undefined"). For each `ez` bond: compare parallel/antiparallel of the perpendicular substituent components (perpendicular -> "alkene substituents must be coplanar"). Policy: `'absolute'` requires all signs equal; `'relative'` (racemic products) accepts all-equal OR all-flipped tetrahedral signs (E/Z unchanged); `'ez'` checks double bonds only.
5. Feedback tiers: wrong formula -> hint from `warnings`; right formula wrong connectivity -> "constitutional isomer"; enantiomer when absolute required -> "that is the enantiomer: SN2 inverts"; wrong diastereomer -> "syn vs anti".

## 5. Challenge list (all SMILES RDKit-verified; formulas checked; ring cis/trans verified by face test)

Schema: `{ id, chapter, type, reactant, reagentId, expected[], acceptReagentIds?, stereoCheck: 'none'|'relative'|'absolute'|'ez', requiresDiagonalBonds, requiresNoBondOverride, source }`

| id | ch | type | reactant SMILES (name) | reagent | expected product SMILES | stereoCheck | flags | source |
|---|---|---|---|---|---|---|---|---|
| RB-01 | 7 | predict | C=C(C)C (2-methylpropene) | HX_HBR | CC(C)(C)Br | none | | 7.7 |
| RB-02 | 7 | predict | CC1=CCCCC1 (1-methylcyclohexene) | HX_HBR | CC1(Br)CCCCC1 | none | | 7.8 |
| RB-03 | 7 | predict | C=CCCC (1-pentene) | HX_HI | CCCC(C)I (racemic) | none | | 7.7 |
| RB-04 | 8 | predict | C1=CCCCC1 (cyclohexene) | X2_BR2 | Br[C@H]1CCCC[C@@H]1Br (trans, rac) | relative | | 8.2, 8.7 |
| RB-05 | 8 | choose | CCC=C(C)C (2-methyl-2-pentene) -> CCCC(C)(C)O | answer OXYMERC (accept H3O_HYDRATION) | | none | | 8.5 |
| RB-06 | 8 | predict | CCC=C(C)C | HYDROBORATION | CCC(O)C(C)C (2-methyl-3-pentanol, rac) | none | | 8.5 |
| RB-07 | 8 | predict | CC1=CCCCC1 | HYDROBORATION | C[C@@H]1CCCC[C@H]1O (trans-2-methylcyclohexanol, rac) | relative | | 8.5 (cyclopentene analog in text) |
| RB-08 | 8 | predict | CC1=C(C)CCCC1 (1,2-dimethylcyclohexene) | H2_PD (PtO2) | C[C@H]1CCCC[C@H]1C (cis, meso) | relative | | 8.6 |
| RB-09 | 8 | choose | C1=CCCCC1 -> O[C@H]1CCCC[C@H]1O (cis diol) | answer OSO4 (accept KMNO4_COLD if enabled) | | relative (preview only) | | 8.7 |
| RB-10 | 8 | predict | C1=CCCCC1 | ANTI_DIHYDROXYLATION | O[C@H]1CCCC[C@@H]1O (trans diol, rac) | relative | | 8.7 |
| RB-11 | 8 | predict | C1=CCCCC1 | MCPBA | C1CCC2OC2C1 (cyclohexene oxide) | none | requiresDiagonalBonds | 8.7 |
| RB-12 | 8 | predict | CC(C)=C1CCCCC1 (isopropylidenecyclohexane) | O3_ZN | O=C1CCCCC1 + CC(C)=O (two molecules) | none | | 8.8 |
| RB-13 | 8 | predict | CC=C(C)C (2-methyl-2-butene) | KMNO4_HOT | CC(C)=O + CC(=O)O | none | | 8.8 rule |
| RB-14 | 8 | predict | C1=CCCCC1 | CH2I2_ZNCU | C1CCC2CC2C1 (bicyclo[4.1.0]heptane) | none | requiresDiagonalBonds | 8.9 |
| RB-15 | 8 | predict | C=C(C)C | HOX_BR2_H2O | CC(C)(O)CBr | none | | 8.3 |
| RB-16 | 9 | predict | C#CCCCC (1-hexyne) | HX_HBR (1 equiv) | C=C(Br)CCCC (2-bromo-1-hexene) | none | | 9.3 |
| RB-17 | 9 | predict | C#CCCCC | HX_2EQ (HBr) | CCCCC(C)(Br)Br (2,2-dibromohexane) | none | | 9.3 |
| RB-18 | 9 | predict | C#CCC (1-butyne) | X2_BR2 (1 equiv) | Br/C=C(/Br)CC ((E)-1,2-dibromo-1-butene) | ez if override available else none | requiresNoBondOverride for E/Z (Br cis to ethyl) | 9.3 |
| RB-19 | 9 | predict | C#CCCCC | HGSO4_HYDRATION | CCCCC(C)=O (2-hexanone) | none | | 9.4 |
| RB-20 | 9 | choose | C#CCCCC -> CCCCCC=O (hexanal) | answer HYDROBORATION_ALKYNE | | none | | 9.4 |
| RB-21 | 9 | choose | CCCC#CCCC (4-octyne) -> CCC/C=C\\CCC (cis-4-octene) | answer H2_LINDLAR | | ez (preview only) | Z product: choose-reagent by design | 9.5 |
| RB-22 | 9 | predict | CCCC#CCCC | LI_NH3 | CCC/C=C/CCC (trans-4-octene) | ez | | 9.5 (5-decyne in text) |
| RB-23 | 9 | predict | C#CCCCC | NANH2_THEN_RX (rx = CCCCBr) | CCCCC#CCCCC (5-decyne) | none | | 9.8 |
| RB-24 | 9 | predict (pitfall) | BrC1CCCCC1 (bromocyclohexane) | SN2_ACETYLIDE (NaC#CCH3) | C1=CCCCC1 (cyclohexene; E2, not SN2) | none | | 9.9 |
| RB-25 | 10 | predict | C1=CCCCC1 | NBS_HV | BrC1CCCC=C1 (3-bromocyclohexene) | none | | 10.3 |
| RB-26 | 10 | predict | CC1(O)CCCCC1 (1-methylcyclohexanol) | ROH_HX (HCl) | CC1(Cl)CCCCC1 | none | | 10.5 |
| RB-27 | 10 | choose | CCC(C)O (2-butanol) -> CCC(C)Br | answer ROH_PBR3 (reject ROH_HX: 'slow for secondary') | | none | | 10.5 |
| RB-28 | 11 | predict | C[C@H](Br)CC ((S)-2-bromobutane) | SN2_NAOH | C[C@@H](O)CC ((R)-2-butanol) | absolute | explicit H required at C2 | 11.2 |
| RB-29 | 11 | predict | CCCCBr (1-bromobutane) | SN2_NACN | CCCCC#N | none | | 11.3 Table 11.1 |
| RB-30 | 11 | predict | CCCCBr | SN2_NAI | CCCCI | none | | 11.3 |
| RB-31 | 11 | predict | CC(C)(C)Br (tBuBr) | H2O_HEAT | CC(C)(C)O (SN1 major; minor C=C(C)C) | none | | 11.4, 11.10 |
| RB-32 | 11 | predict | CC(C)(C)Br | SN2_NAOCH3 (strong base) | C=C(C)C (E2, not SN2) | none | | 11.12 |
| RB-33 | 11 | predict | CCC(C)Br (2-bromobutane) | SN2_NAOET (NaOEt/EtOH) | C/C=C/C (2-butene, Zaitsev; minor C=CCC) | none (E/Z not checked) | | 11.7 (81:19) |
| RB-34 | 11 | predict | CCC(C)(C)Br (2-bromo-2-methylbutane) | SN2_NAOET | CC=C(C)C (2-methyl-2-butene; minor C=C(C)CC) | none | | 11.7 (70:30) |
| RB-35 | 11 | predict | CC1(Cl)CCCCC1 | KOH_ETOH | CC1=CCCCC1 (1-methylcyclohexene; minor C=C1CCCCC1) | none | | 11.7 worked example |
| RB-36 | 11 | predict | BrC1CCCCC1 | KOH_ETOH | C1=CCCCC1 | none | | 8.1 |
| RB-37 (opt) | 11 | predict | CCC(C)(C)Br | TBUOK | C=C(C)CC (Hofmann) | none | notInMcMurry10e | general |
| RB-38 (opt) | 9 | predict | CCC#CCC (3-hexyne) | HX_HCL (1 equiv) | CC/C(Cl)=C/CC ((Z)-3-chloro-3-hexene) | ez only with override | requiresNoBondOverride | 9.3 |

Atom-count checks (RDKit): RB-04 C6H10Br2; RB-07 C7H14O; RB-08 C8H16; RB-10 C6H12O2; RB-12 C9H16O2 total; RB-13 C5H10O3 total; RB-17 C6H12Br2; RB-18 C4H6Br2; RB-19/20 C6H12O; RB-21/22 C8H16; RB-23 C10H18; RB-28 C4H10O; RB-38 C6H11Cl. Odd rings only in RB-11 and RB-14 (and RB-11's substrate for EPOXIDE_H3O if used separately).

Unit-test vectors beyond the challenges: 2-pentene + HBr -> tie -> {CCC(Br)CC? no: CCCC(C)Br and CCC(Br)CC} mixture warning; 2-butene + HBr -> single product CCC(C)Br (symmetric); 3-methyl-1-butene + HCl -> rearrangement warning with both chlorides; unsymmetrical internal alkyne CC#CCC + HgSO4 -> two ketones warning; 4-methyl-2-hexene + hydroboration -> mixture warning; internal alkyne + NaNH2 -> noReaction; 1-bromobutane + H2O heat -> noReaction; tBuBr + NaI/acetone -> noReaction (aprotic, tertiary).

## 6. Pitfalls to encode as engine warnings / content rules
1. Symmetric alkenes: compute both regio-products and compare canonically; identical -> one product, no "Markovnikov" message.
2. Equally substituted but non-symmetric alkenes (2-pentene): mixture; never used in graded predict challenges; usable as a "what is wrong with this substrate" quiz.
3. Alkynes + 2 HX give geminal (same carbon) dihalides, not vicinal; students commonly build 1,2-dibromides.
4. Alkyne hydration products are carbonyls, never enols: always run `tautomerize`; grade the ketone/aldehyde only.
5. Terminal alkyne: HgSO4 route gives methyl ketone (OH on C2), hydroboration gives aldehyde (OH on C1).
6. Oxymercuration vs H3O+: same Markovnikov product but only H3O+ (and HX, SN1/E1) triggers the rearrangement check.
7. Hydroboration is syn AND anti-Markovnikov: on 1-methylcyclohexene the OH ends trans to CH3 (H and OH syn).
8. Br2 gives trans; OsO4 gives cis; epoxide hydrolysis gives trans diols; H2 gives cis (only visible when two stereocenters form).
9. Tertiary + strong base is E2, never SN2; tertiary + weak nucleophile in aprotic solvent: no reaction; tertiary in protic solvent: SN1 + E1.
10. Acetylide/alkoxide/amide with secondary or tertiary halides: elimination.
11. Odd-ring products (epoxide, cyclopropane) and odd-ring substrates need diagonal bonds; flag in content.
12. Z-alkenes and E/Z-defined trisubstituted alkenes cannot be built without the no-bond override; use choose-reagent challenges or `stereoCheck: 'none'` for them.
13. Stereocenters with an H: require explicit H; square-planar substituent layouts are undefined - tell the student to move a substituent.
14. Vinylic/aryl halides: no SN1/SN2; benzene rings inert to all cards.
15. NBS allylic bromination on unsymmetrical alkenes gives allylic-isomer mixtures via the resonance-delocalized radical; content uses cyclohexene only.
16. Alcohol + HX for primary/secondary: slow; the bench allows it with a warning but the graded answer for 2-butanol -> 2-bromobutane is PBr3.

## Facts

- [verified] Markovnikov's rule (OpenStax 7.8): in the addition of HX to an alkene, H attaches to the carbon with fewer alkyl substituents and X to the carbon with more alkyl substituents; when both alkene carbons have the same degree of substitution a mixture results (2-pentene + HBr gives 2-bromopentane and 3-bromopentane). _(source: OpenStax Organic Chemistry (McMurry 10e) source module m00070 'Orientation of Electrophilic Additions: Markovnikov's Rule', github.com/openstax/osbooks-organic-chemistry)_
- [verified] Carbocation stability order tertiary > secondary > primary > methyl; gas-phase R-Cl dissociation enthalpies 940 (CH3Cl), 810 (EtCl), 710 (iPrCl), 680 (tBuCl) kJ/mol. Allylic/benzylic: a primary allylic or benzylic cation is about as stable as a secondary alkyl cation, and a secondary allylic/benzylic about as stable as a tertiary alkyl cation. _(source: OpenStax modules m00071 'Carbocation Structure and Stability' and m00126 'Characteristics of the SN1 Reaction')_
- [verified] Carbocation rearrangements: 3-methyl-1-butene + HCl gives ~50% 2-chloro-3-methylbutane and ~50% 2-chloro-2-methylbutane (hydride shift); 3,3-dimethyl-1-butene + HCl gives an equal mixture of 3-chloro-2,2-dimethylbutane and 2-chloro-2,3-dimethylbutane (methyl shift). _(source: OpenStax module m00073 'Evidence for the Mechanism of Electrophilic Additions: Carbocation Rearrangements')_
- [verified] Chapter 8 Summary of Reactions: HCl/HBr/HI add with Markovnikov regiochemistry; Cl2/Br2 add anti via halonium ion; halohydrin formation (X2, H2O) is Markovnikov and anti; oxymercuration-demercuration (1. Hg(OAc)2, H2O/THF 2. NaBH4) is Markovnikov; hydroboration-oxidation (1. BH3, THF 2. H2O2, OH-) is non-Markovnikov syn; catalytic hydrogenation (H2, Pd/C or PtO2) syn; peroxyacid epoxidation syn; OsO4 (then NaHSO3, or catalytic OsO4/NMO) syn diol; acid-catalyzed epoxide hydrolysis gives trans-1,2-diol (anti); ozonolysis (1. O3 2. Zn, H3O+) and KMnO4/H3O+ cleave C=C; CHCl3/KOH gives dichlorocyclopropane; CH2I2, Zn(Cu) (Simmons-Smith) gives cyclopropane; HIO4 cleaves 1,2-diols. _(source: OpenStax module m00101, section 'Summary of Reactions' for chapter 8)_
- [verified] Specific ch. 8 textbook examples: cyclopentene + Br2 gives only trans-1,2-dibromocyclopentane; cyclohexene + Br2 gives trans-1,2-dibromocyclohexane; 1-methylcyclopentene hydroboration-oxidation gives trans-2-methylcyclopentanol (85%); 2-methyl-2-pentene gives 2-methyl-3-pentanol (hydroboration) and 2-methyl-2-pentanol (oxymercuration); 1,2-dimethylcyclohexene + H2/PtO2 gives cis-1,2-dimethylcyclohexane (82%); 1,2-epoxycyclohexane + H3O+ gives trans-1,2-cyclohexanediol (86%); 1,2-dimethylcyclopentene + OsO4 then NaHSO3 gives cis-1,2-dimethyl-1,2-cyclopentanediol (87%); isopropylidenecyclohexane ozonolysis gives cyclohexanone + acetone; KMnO4/H3O+ converts RCH= to a carboxylic acid and H2C= to CO2; cyclohexene + CH2I2/Zn(Cu) gives bicyclo[4.1.0]heptane (92%); acid-catalyzed hydration of 1-butene gives racemic 2-butanol; 'Markovnikov's rule does not apply to symmetrically substituted alkenes' (4-methyl-2-hexene gives a mixture with either hydration method). _(source: OpenStax modules m00090, m00092, m00093, m00094, m00095, m00096, m00097, m00100)_
- [verified] Acid-catalyzed hydration (H2O, H2SO4 or H3PO4) proceeds by protonation to a carbocation (Markovnikov), e.g. 1-methylcyclohexene gives 1-methylcyclohexanol; HI is usually generated from KI + H3PO4 (1-pentene gives 2-iodopentane); oxymercuration proceeds via a mercurinium ion (no carbocation) and the H from NaBH4 can attach from either face. _(source: OpenStax modules m00069 'Electrophilic Addition Reactions of Alkenes' and m00092 'Hydration of Alkenes: Addition of H2O by Oxymercuration')_
- [verified] McMurry 10e chapters 7-8 do not cover radical (peroxide, HBr/ROOR) anti-Markovnikov addition of HBr; the only non-Markovnikov additions in ch. 7-9 are hydroboration-oxidation. The radical section 8.10 covers only chain-growth polymerization. _(source: grep of all ch. 7-11 modules for 'anti-Markovnikov', 'non-Markovnikov', 'ROOR', 'peroxide' in github.com/openstax/osbooks-organic-chemistry; hits only in m00093 (hydroboration), m00101, m00106, m00111, and 'benzoyl peroxide' in m00098)_
- [verified] Alkynes + HX: reaction can be stopped at 1 equiv (vinylic halide) or go to a geminal dihalide with 2 equiv; Markovnikov regiochemistry (halogen on the more substituted side); trans stereochemistry of H and X normally, though not always. 1-hexyne + HBr gives 2-bromo-1-hexene then 2,2-dibromohexane; 3-hexyne + HCl gives (Z)-3-chloro-3-hexene then 3,3-dichlorohexane. Br2/Cl2 add with trans stereochemistry: 1-butyne + Br2 gives (E)-1,2-dibromo-1-butene then 1,1,2,2-tetrabromobutane. _(source: OpenStax module m00105 'Reactions of Alkynes: Addition of HX and X2' and m00111 Summary of Reactions)_
- [verified] Alkyne hydration: H2O/H2SO4/HgSO4 gives Markovnikov enol that tautomerizes to a ketone (1-hexyne gives 2-hexanone, 78%); terminal alkynes give methyl ketones; unsymmetrical internal alkynes give a mixture of both ketones; no NaBH4 step is needed. Hydroboration-oxidation of a terminal alkyne (using bulky disiamylborane to prevent double addition) gives an aldehyde; an internal alkyne such as 3-hexyne gives a ketone. _(source: OpenStax module m00106 'Hydration of Alkynes')_
- [verified] Alkyne reduction: H2/Pd-C gives the alkane; H2 with Lindlar catalyst gives the cis alkene by syn addition (4-octyne gives cis-4-octene); Li or Na in liquid NH3 gives the trans alkene (5-decyne gives trans-5-decene, 78%). _(source: OpenStax module m00107 'Reduction of Alkynes')_
- [verified] Terminal alkynes (pKa 25) are deprotonated by NaNH2 (NH3 pKa 35); acetylide anions alkylate methyl and primary alkyl bromides/iodides by SN2 (acetylene + NaNH2 then CH3Br gives propyne; 1-hexyne + NaNH2 then 1-bromobutane gives 5-decyne, 76%); with secondary and tertiary halides elimination occurs instead (bromocyclohexane + propynide gives cyclohexene, not 1-cyclohexylpropyne). Vicinal dihalides give alkynes with excess KOH or NaNH2 (twofold dehydrohalogenation). _(source: OpenStax modules m00104, m00109, m00110)_
- [verified] Chapter 10: NBS/hv/CCl4 brominates the allylic position (cyclohexene gives 3-bromocyclohexene, 85%); alcohols + HX give alkyl halides, working best for tertiary alcohols (SN1 via carbocation; 1-methylcyclohexanol + HCl gives 1-chloro-1-methylcyclohexane, 90%); primary and secondary alcohols are best converted with SOCl2 (chloride) or PBr3 (bromide; 2-butanol + PBr3 gives 2-bromobutane, 86%); HF-pyridine gives fluorides; OpenStax 11.3 describes the SOCl2/PBr3 conversions as SN2 processes. _(source: OpenStax modules m00115, m00117, m00120 Summary of Reactions, m00124)_
- [verified] SN2 (OpenStax 11.2-11.3): single-step backside attack with inversion ((S)-2-bromobutane + HO- gives (R)-2-butanol); substrate reactivity methyl > primary > secondary >> neopentyl, tertiary (no SN2); vinylic and aryl halides unreactive; nucleophile relative rates vs CH3Br: H2O 1, CH3CO2- 500, NH3 700, Cl- 1000, HO- 10000, CH3O- 25000, I- 100000, CN- 125000, HS- 125000; leaving groups TosO- > I- > Br- > Cl- > F- with HO-, RO-, H2N- not displaced; polar aprotic solvents (DMSO, DMF, CH3CN, HMPA) accelerate SN2, protic solvents slow it. _(source: OpenStax modules m00123 'The SN2 Reaction' and m00124 'Characteristics of the SN2 Reaction')_
- [verified] SN1 (OpenStax 11.4-11.5): rate-limiting ionization; best for tertiary, allylic, benzylic substrates; nucleophile strength irrelevant but it must be nonbasic to avoid E; polar protic solvents accelerate; products are largely racemized (typically 0-20% excess inversion from ion pairs); leaving group order HO- << Cl- < Br- < I- ~ TosO- < H2O (protonated alcohol). _(source: OpenStax modules m00125 and m00126)_
- [verified] Zaitsev's rule (OpenStax 11.7): elimination gives the more highly substituted alkene; 2-bromobutane + NaOEt/EtOH gives 81% 2-butene and 19% 1-butene; 2-bromo-2-methylbutane gives 70% 2-methyl-2-butene and 30% 2-methyl-1-butene; 1-chloro-1-methylcyclohexane + KOH/EtOH gives 1-methylcyclohexene (major) and methylenecyclohexane (minor). _(source: OpenStax module m00128 'Elimination Reactions: Zaitsev's Rule')_
- [verified] E2 (OpenStax 11.8-11.9): one step, strong base (HO-, RO-), anti-periplanar geometry required; meso-1,2-dibromo-1,2-diphenylethane + KOH gives only (E)-1-bromo-1,2-diphenylethylene and the (1S,2S) isomer gives the Z alkene; in cyclohexanes the H and leaving group must be trans-diaxial (menthyl chloride gives the non-Zaitsev 2-menthene, neomenthyl chloride gives 1-menthene 200x faster). _(source: OpenStax modules m00129 and m00130)_
- [verified] E1 (OpenStax 11.10): carbocation intermediate, Zaitsev product, no geometric requirement; SN1 and E1 occur together with nonbasic nucleophiles in protic solvent: 2-chloro-2-methylpropane in 80% aqueous EtOH at 65 C gives 64% 2-methyl-2-propanol (SN1) and 36% 2-methylpropene (E1). E1cB occurs when the leaving group is two carbons from a carbonyl. _(source: OpenStax module m00131 'The E1 and E1cB Reactions')_
- [verified] Summary of reactivity (OpenStax 11.12): primary halides: SN2 with a good nucleophile, E2 with a strong sterically hindered base, E1cB if beta to carbonyl. Secondary: SN2 with a weakly basic nucleophile in polar aprotic solvent, E2 predominates with a strong base; secondary allylic/benzylic also SN1/E1 with weakly basic nucleophile in protic solvent. Tertiary: E2 when a base is used; SN1 + E1 together under neutral conditions (pure EtOH or water). Worked examples: 2-chloropentane + NaOMe/MeOH is E2; 1-bromo-1-phenylethane in HCO2H/H2O is SN1 (+E1); 1-chloro-1-phenylpropane + NaOAc/AcOH-H2O is SN1; 3-bromopropylbenzene + NaOMe/DMF is SN2. _(source: OpenStax modules m00133 'A Summary of Reactivity' and m00126 worked example)_
- [likely] OpenStax McMurry 10e does not state a Hofmann (less-substituted) rule for potassium tert-butoxide with alkyl halides; the only Hofmann-orientation statement is for Hofmann elimination of quaternary ammonium salts (ch. 24, 'the major product is the less highly substituted alkene ... probably steric'). 3-bromocyclohexene + KOtBu/tBuOH giving 1,3-cyclohexadiene appears in ch. 14. The 'bulky base gives Hofmann product' rule for t-BuOK is standard textbook chemistry but is unverified in this source. _(source: grep of all modules for 'Hofmann', 'butoxide'; modules m00295 (Reactions of Amines), m00171 (Conjugated Dienes), m00133)_
- [likely] E2/E1 on acyclic substrates with free rotation give predominantly the E (trans) disubstituted alkene when both are possible; PBr3/SOCl2 conversions of chiral secondary alcohols proceed with inversion. Neither statement is made explicitly in the OpenStax ch. 7-11 text I read. _(source: General organic chemistry knowledge; not located in OpenStax modules read)_
- [verified] RDKit verification: trans-1,2-dibromocyclohexane = Br[C@H]1CCCC[C@@H]1Br (S,S; substituents on opposite ring faces); cis-1,2-dimethylcyclohexane = C[C@H]1CCCC[C@H]1C (meso, same face); cis-1,2-cyclohexanediol = O[C@H]1CCCC[C@H]1O; trans-1,2-cyclohexanediol = O[C@H]1CCCC[C@@H]1O; trans-2-methylcyclohexanol = C[C@@H]1CCCC[C@H]1O (1R,2R rel); (S)-2-bromobutane = C[C@H](Br)CC and (R)-2-butanol = C[C@@H](O)CC; (Z)-3-chloro-3-hexene = CC/C(Cl)=C/CC; (E)-1,2-dibromo-1-butene = Br/C=C(/Br)CC; cis-4-octene = CCC/C=C\CCC; trans-4-octene = CCC/C=C/CCC. Replacing a leaving group in the same SMILES slot and flipping @/@@ produces the SN2 inversion product. _(source: RDKit 2026.03.6 run in /tmp/claude-0/.../scratchpad/ox/verify.py and verify2.py (CIP labels via rdCIPLabeler; ring faces via local ring-traversal normals on MMFF-optimized conformers))_
- [verified] On the cubic lattice with 'face-adjacent = bonded', an induced 6-cycle exists (the cube's chair hexagon: (0,0,0),(1,0,0),(1,1,0),(1,1,1),(0,1,1),(0,0,1)), so cyclohexane rings embed as chairs; cis-disubstituted alkenes cannot be embedded because the two cis substituents occupy face-adjacent cells (phantom bond); a prototype BFS+backtracking embedder found placements for all constitution-only and trans/ring-stereo test products in 7-175 search nodes and correctly failed for cis-4-octene and (Z)-3-chloro-3-hexene, and needs edge-diagonal bonds for epoxides, cyclopropanes and cyclopentene. _(source: Prototype /tmp/claude-0/-home-user-Minecraft-Game/8f0480a6-ca12-5fe0-96b2-f372903d1e22/scratchpad/ox/embed.py run in this session)_

## Recommendations

- Before any engineering: confirm the v1 topic list with the user (their message says it was never asked). Treat this reaction-bench spec as provisional until then.
- Add a 'no-bond override' to the bond tool (order 0 between face-adjacent blocks, rendered as a gap) or exempt cyclobutene-closing pairs from auto-bonding; without it Z-alkenes and E/Z-defined trisubstituted alkenes cannot be built, which also affects the E/Z stereochemistry topic, not just the reaction bench.
- Ship rearrangements as detect-and-warn (both products shown, quoting McMurry 7.11's ~1:1 mixtures) and keep rearranging substrates out of graded challenges; expose the 1,2-shift as an instructor demo toggle.
- Keep HBr/ROOR (anti-Markovnikov radical HBr) and t-BuOK Hofmann orientation as instructor-enabled cards flagged 'not in McMurry 10e'; the OpenStax text only says a hindered base favors E2 over SN2 on primary halides.
- Use the stereo policy 'relative' (accept either enantiomer) for products formed from achiral reactants and 'absolute' only for SN2 inversion of a prebuilt chiral substrate ((S)-2-bromobutane to (R)-2-butanol).
- Reuse the embedding prototype logic (BFS + backtracking + phantom-bond and stereo constraints) for a 'ghost build' mode; it is trivially fast for course-sized molecules, and cyclohexane rings come out as chairs on the cube automatically.
- Encode the SN1/SN2/E1/E2 logic as the ordered rule list in section 3 with a human-readable justification string per rule so the HUD can explain the mechanism choice in McMurry's words.
- Require explicit H blocks at stereocenters whenever a challenge checks R/S, and validate that the four substituents are not square-planar before computing parity.
- For Z-alkene products (Lindlar; 1-equiv HX/X2 on internal alkynes) use choose-reagent challenges (preview only) unless the no-bond override ships.
- Write engine unit tests from the textbook examples listed at the end of section 3 and section 5 (all SMILES already RDKit-verified in this session).

## Risks

- Scope risk: the user flagged that the topic list was never confirmed; the reaction bench (and the other six topics) may not be what they want.
- Lattice representation: cis (Z) alkenes and the E/Z of tri/tetrasubstituted alkenes are unbuildable under 'face-adjacent = bonded'; if the world engine does not add a no-bond override, several textbook products (cis-4-octene, (Z)-3-chloro-3-hexene, (E)-1,2-dibromo-1-butene geometry) can only be previewed, and the E/Z topic itself is constrained.
- Odd rings (epoxides, cyclopropanes, cyclopentene substrates) depend on the optional diagonal-bond feature; if it is cut, drop MCPBA/Simmons-Smith/CHCl3 cards to choose-reagent-only.
- Two example cards from the task prompt (HBr/ROOR; t-BuOK Hofmann) are not in OpenStax McMurry 10e; including them by default may conflict with the instructor's course.
- Rearrangements and equally substituted alkenes produce mixtures in McMurry's own examples; any 'single major product' grading for those would be chemically wrong, so the engine must warn rather than grade.
- E/Z outcome of E2/E1 on simple acyclic substrates (trans preference) and PBr3/SOCl2 inversion are standard but not stated in the OpenStax text read; they are marked 'likely' and should not be graded.
- Source access: openstax.org and libretexts were blocked; facts were taken from the OpenStax GitHub CNXML source, which is the same content, but page/section numbers were inferred from module order rather than the rendered site.
- Student-built reactants may have undefined alkene geometry or stereocenters (twisted or square-planar layouts); the engine must degrade gracefully (no stereo, warning) instead of guessing.
- Ring E2 conformational requirements (trans-diaxial) and E1cB are not modeled in v1; challenges must avoid menthyl-type substrates and beta-carbonyl leaving groups.
