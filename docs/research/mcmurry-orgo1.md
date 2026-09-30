# Research: mcmurry-orgo1

_Source: workflow agent `research:mcmurry-orgo1`._

## Summary

Chapter-by-chapter mapping of McMurry (OpenStax 10e) chapters 1-11 onto the voxel game, built from the OpenStax CNXML source (openstax.org itself is blocked by the egress proxy, so the official GitHub source repo openstax/osbooks-organic-chemistry was cloned and read directly; every section title, table and reaction summary below was read from that source). Deliverables: fit verdicts for every section, 50 challenges (all isomer sets required by the brief included; no odd rings without requiresDiagonalBonds), a 72-entry molecule library whose formulas, canonical SMILES and CIP R/S / E/Z labels were all verified mechanically with RDKit, the Table 3.1 functional-group detector as an ordered claimed-atom SMARTS list that was executed against 40 test molecules (acid/ester/amide exclusions proven), a reagent/reaction rule table for the bench, and lattice-specific stereo rules (which 4-of-6 octahedral arrangements are chiral, when an implicit H makes a center ambiguous, and a verified sign convention for R/S from coordinates). IMPORTANT: the relayed user message says the user was never asked which topics to include; the topic list in the computed task is therefore treated as unconfirmed and this mapping is organised as a per-chapter menu (with a fit verdict per section) so the user can choose.

## Design specification

# McMurry (OpenStax 10e) Ch 1–11 → Voxel Game: Implementation Spec

## 0. Scope note (read first)
The user said they were never asked which topics to include. Nothing here assumes the seven-topic list is final. Section 2 gives every section of ch 1–11 a fit verdict so the user can pick; the challenge list (§4) is tagged by chapter and topic so any subset can be enabled by a `topics` allow-list in the challenge loader. Recommended first question to the user: "Which of these chapters/sections do you want in v1?" with §2 as the menu.

Source: OpenStax McMurry CNXML from github.com/openstax/osbooks-organic-chemistry (openstax.org is blocked by the sandbox proxy; the repo is the same text). Module ids are given so an engineer can cite sections.

## 1. Engine features referenced by verdicts
- F1 Graph engine: atoms = blocks; bond = face adjacency; bond order tool 1/2/3; implicit H fill; formula; canonical graph hashing (use a Morgan/WL canonical form; ignore stereo).
- F2 Functional-group detector (§6).
- F3 Isomer set tracker (canonical forms, stereo ignored).
- F4 Hybridization/geometry: steric number = σ-bonds + lone pairs (C: 4→sp3, 3→sp2, 2→sp; N with 3 bonds+1 LP → sp3 (methylamine), amide/imine N sp2; O with 2 bonds+2 LP → sp3). Lattice geometry idealization: sp3 = "corner" or "see-saw" (§8.3), sp2 = T-shape, sp = straight line.
- F5 Stereo perception from lattice coordinates (§8.3): R/S per centre, E/Z per double bond, cis/trans on rings falls out of R/S.
- F6 Select-atom UI: click atoms; hydrogens must be shown (toggle) when H selection is required.
- F7 Reaction bench: reactant locked in a "reactant zone", student builds product in "product zone", picks reagent from a reagent bar (ids §7).
- F8 Optional diagonal (edge-adjacent) bonds → allows 3-,5-,7-rings. Any content needing it is marked requiresDiagonalBonds.
- F9 Multi-molecule zones (two or more locked molecules for comparison-type select challenges).
- Not planned (drives "no fit"): charges/ions, curved arrows, energy diagrams, Newman projections, chair conformers, spectra, kinetics.

## 2. Chapter-by-chapter mapping (section → verdict)
Verdict key: NAT = natural fit; FIT(Fx) = fits with listed feature; QUIZ = only as a text/multiple-choice quiz panel, not a build task; NO = no fit.

### Ch 1 Structure and Bonding (m00157–m00169). Objective: describe covalent bonding, sp3/sp2/sp hybrid orbitals and the geometry of methane, ethane, ethylene, acetylene; draw condensed/skeletal structures.
- 1.1–1.3 Atomic structure, orbitals, electron configurations: NO (no molecular build).
- 1.4 Development of bonding theory (tetravalent C, Lewis structures, valence): FIT(F1) valence limits are the block rules; lone pairs shown in HUD.
- 1.5 Valence bond theory (σ/π): QUIZ; HUD can label σ/π count per bond (order−1 = π bonds).
- 1.6 sp3 methane, 1.7 sp3 ethane: NAT (build CH4, C2H6; HUD shows sp3, 109.5° idealized as corner).
- 1.8 sp2 ethylene, 1.9 sp acetylene: NAT with F4 (build, set bond order, HUD shows sp2/sp, bond lengths table 1.7/1.8 in tooltip).
- 1.10 Hybridization of N, O, P, S: FIT(F4) methylamine/methanol builds; label N/O sp3.
- 1.11 MO theory: NO.
- 1.12 Drawing structures (condensed/skeletal): NAT — instruction shows condensed formula, student builds (challenge ch1-condensed-2-methylbutane).

### Ch 2 Polar Covalent Bonds; Acids and Bases (m00017–m00029). Objective: electronegativity and bond polarity, formal charge, resonance, Brønsted/Lewis acids and bases, pKa and predicting acid–base reactions, noncovalent interactions.
- 2.1 Polar bonds/electronegativity: FIT(F6) select the δ+ carbon (electrophilic C) in C–X/C–O bonds; HUD colours atoms by EN.
- 2.2 Dipole moments: QUIZ.
- 2.3 Formal charges: NO unless a charge tool is added (recommend v2: +/- tool with formal charge = valence e − (bonds + lone-pair e)).
- 2.4–2.6 Resonance: NO (needs charge/arrow tools; benzene build only shows one Kekulé form).
- 2.7 Brønsted–Lowry definition, 2.8 Acid/base strength (Table 2.3), 2.9 Predicting reactions from pKa: FIT(F6) "select the most acidic H" using the pKa lookup in §9; QUIZ for direction of equilibrium (lower pKa acid donates to conjugate base of higher-pKa acid).
- 2.10 Organic acids and bases: FIT(F6) select acidic H (O–H, α-C–H to C=O) and basic site (N or O lone pair).
- 2.11 Lewis definition: FIT(F6) select the Lewis-base atom (lone pair) in an ether/amine.
- 2.12 Noncovalent interactions: QUIZ.

### Ch 3 Alkanes (m00031–m00038). Objective: recognise functional groups (Table 3.1), define constitutional isomers, name/draw alkanes and alkyl groups (1°/2°/3°/4°), conformations.
- 3.1 Functional groups: NAT (F2) — build-to-spec by formula+group.
- 3.2 Alkanes and isomers: NAT (F3) — C4H10 (2), C5H12 (3), C6H14 (5).
- 3.3 Alkyl groups, 1°/2°/3°/4° carbons: NAT (F6) select the tertiary carbon / primary hydrogens.
- 3.4 Naming alkanes: NAT — name-to-structure; rules: longest chain (ties → more branches), number from end nearer first branch (ties → second branch), alphabetical substituents (di/tri ignored; iso counted; sec-/tert- ignored), complex substituents in parentheses.
- 3.5 Properties: QUIZ.
- 3.6–3.7 Conformations (Newman, staggered/eclipsed, gauche/anti): NO (single-bond rotation is not represented on the lattice).

### Ch 4 Cycloalkanes (m00039–m00048). Objective: name cycloalkanes, cis–trans isomerism in rings, ring strain, cyclohexane chair, axial/equatorial, ring-flip.
- 4.1 Naming cycloalkanes: NAT for even rings (cyclobutane, cyclohexane, cyclooctane); FIT(F8) for cyclopropane/cyclopentane. Rule: ring is parent if ring carbons ≥ substituent carbons; number to give lowest locants, ties by alphabetical order; halogens treated like alkyl.
- 4.2 Cis–trans isomerism in cycloalkanes: NAT (F5): substituents on the same face of the ring plane (same sign along the ring normal) = cis.
- 4.3 Ring strain (cyclopropane 115, cyclobutane 110.4 kJ/mol): QUIZ.
- 4.4–4.8 Conformations, chair, axial/equatorial, mono/disubstituted cyclohexanes, polycyclics: NO (cubic lattice gives a flat 2×3 rectangle for cyclohexane; no chair).

### Ch 5 Stereochemistry at Tetrahedral Centers (m00049–m00061). Objective: chirality and chirality centres, enantiomers, R/S via CIP rules, diastereomers, meso compounds, racemates, isomer taxonomy, prochirality.
- 5.1 Enantiomers/tetrahedral carbon, 5.2 Chirality and symmetry planes: NAT (F5,F6) — select the chirality centre; engine test: carbon with four topologically distinct branches.
- 5.3 Optical activity, 5.4 Pasteur: QUIZ.
- 5.5 Sequence rules (R/S): NAT (F5) stereo-exact builds.
- 5.6 Diastereomers, 5.7 Meso compounds: NAT (F5) — (2R,3R) vs meso-2,3-dibromobutane; cis-1,2-dimethylcyclobutane meso example is in the text.
- 5.8 Racemic mixtures/resolution: QUIZ (bench reports "racemic" when an achiral reactant makes a new centre, §7).
- 5.9 Review of isomerism: FIT(F3,F5) taxonomy shown in HUD when two builds are compared (constitutional / enantiomer / diastereomer / identical).
- 5.10 Chirality at N,P,S; 5.11 Prochirality; 5.12 Chirality in nature: NO/QUIZ.

### Ch 6 Overview of Organic Reactions (m00076–m00087). Objective: classify reactions (addition, elimination, substitution, rearrangement), polar vs radical mechanisms, nucleophile/electrophile, curved arrows, thermodynamics, energy diagrams, intermediates.
- 6.1 Kinds of reactions: FIT(F7) bench tags each reaction rule with its class; QUIZ to classify.
- 6.2 Mechanisms, 6.3 Radical reactions, 6.4 Polar reactions: FIT(F6) select nucleophilic site (C=C π bond, lone-pair atom) and electrophilic site (H of HBr, δ+ carbon).
- 6.5 HBr + ethylene example: NAT (F7) predict-product.
- 6.6 Curved arrows: NO.
- 6.7–6.10 Equilibria, bond dissociation energies, energy diagrams, intermediates: NO (QUIZ only).
- 6.11 Biological vs lab reactions: NO.

### Ch 7 Alkenes: Structure and Reactivity (m00062–m00073). Objective: degree of unsaturation, alkene nomenclature, cis–trans and E/Z, alkene stability order, electrophilic addition, Markovnikov's rule, carbocation stability, Hammond postulate, rearrangements.
- 7.1 Industrial preparation: NO. 7.2 Degree of unsaturation: NAT (F1) — formula-and-groups with ring/π-bond counts; DoU = (2C+2+N−H−X)/2.
- 7.3 Naming alkenes: NAT — chain must contain C=C; number from end nearer C=C; accept "2-butene" and "but-2-ene".
- 7.4 Cis–trans, 7.5 E,Z designation: NAT (F5).
- 7.6 Stability (tetra > tri > di > mono; trans > cis): FIT(F9) select the more stable alkene among locked molecules; engine computes substituent count on C=C carbons.
- 7.7 Electrophilic addition, 7.8 Markovnikov: NAT (F7).
- 7.9 Carbocation stability: FIT(F6) select the carbon that becomes the more stable cation.
- 7.10 Hammond postulate: NO. 7.11 Rearrangements: FIT(F7) as an "advanced" predict-product (hydride/methyl shift rule in §7).

### Ch 8 Alkenes: Reactions and Synthesis (m00088–m00101). Objective: prepare alkenes by elimination; add HX, X2, HOX, H2O (two regiochemistries), H2, O (epoxide), 2 OH (syn and anti diol); cleave C=C; carbenes; polymers; reaction stereochemistry.
- 8.1 Preparing alkenes (dehydrohalogenation KOH/EtOH; dehydration H2SO4/heat): NAT (F7).
- 8.2 Halogenation X2 (anti): NAT (F7,F5). 8.3 Halohydrins (Markovnikov OH, anti): NAT. 8.4 Oxymercuration (Markovnikov OH): NAT. 8.5 Hydroboration (non-Markovnikov, syn): NAT. 8.6 Hydrogenation (syn): NAT. 8.7 Epoxidation (product is a 3-ring: requiresDiagonalBonds) and hydroxylation OsO4 (syn diol): NAT for OsO4; epoxide only via F8 or as a two-step reagent that skips building the epoxide. 8.8 Oxidative cleavage O3/Zn, KMnO4: NAT (multi-product acceptance).
- 8.9 Carbenes → cyclopropanes: FIT(F8) only. 8.10 Radical polymerisation, 8.11 Biological radical additions: NO.
- 8.12–8.13 Reaction stereochemistry (achiral reactants give racemic product): FIT(F5,F7) bench rule "racemic" (§7.4).

### Ch 9 Alkynes (m00102–m00111). Objective: name alkynes; prepare by double elimination and acetylide alkylation; HX, X2 addition; hydration to ketone vs aldehyde; reductions to cis/trans alkene or alkane; acidity of terminal alkynes; retrosynthetic thinking.
- 9.1 Naming: NAT. 9.2 Preparation from dihalides: NAT (F7). 9.3 HX and X2 addition: NAT (1 vs 2 equiv flag). 9.4 Hydration (HgSO4 → methyl ketone; Sia2BH → aldehyde): NAT. 9.5 Reduction (Pd-C, Lindlar cis, Li/NH3 trans): NAT (F5). 9.6 Oxidative cleavage: FIT (rarely used; optional). 9.7 Acidity/acetylide: NAT (F6 select acidic H; pKa 25 vs 44 vs 60). 9.8 Alkylation of acetylide: NAT (primary halides only; secondary/tertiary → elimination). 9.9 Organic synthesis: FIT as multi-step choose-reagent chains (v2).

### Ch 10 Organohalides (m00112–m00120). Objective: name alkyl halides; prepare by radical halogenation, allylic bromination (NBS), from alcohols (HX, SOCl2, PBr3); Grignard reagents; organometallic coupling; oxidation/reduction definitions.
- 10.1 Names/structures: NAT (name-to-structure; number from end nearer first substituent, alkyl or halo; ties → alphabetical). 10.2 Radical halogenation: NAT (major product by selectivity 1:3.5:5 per H). 10.3 Allylic bromination NBS: NAT. 10.4 Allyl radical resonance: NO. 10.5 From alcohols: NAT (+ choose-reagent). 10.6 Grignard: FIT (needs Mg block; product RMgX). 10.7 Coupling (Gilman, Suzuki): FIT optional. 10.8 Oxidation/reduction definitions: QUIZ.

### Ch 11 Nucleophilic Substitutions and Eliminations (m00121–m00133). Objective: SN2 (inversion, 2nd order, steric order), SN1 (carbocation, racemisation, 3°/allylic/benzylic), Zaitsev, E2 (anti-periplanar, trans-diaxial), E1/E1cB, choosing the mechanism.
- 11.1 Discovery (Walden): QUIZ. 11.2 SN2, 11.3 Characteristics (substrate, nucleophile Table 11.1, leaving group, solvent): NAT (F7,F5 inversion) + choose-reagent. 11.4 SN1, 11.5 Characteristics: NAT (racemic flag). 11.6 Biological substitutions: NO. 11.7 Zaitsev: NAT (major product = more substituted alkene). 11.8 E2 and isotope effect: NAT for products; isotope effect QUIZ. 11.9 E2 in cyclohexanes (trans-diaxial): NO for geometry (no chair); QUIZ. 11.10 E1/E1cB: FIT (E1 as SN1 companion; E1cB QUIZ). 11.11 Biological eliminations: NO. 11.12 Summary of reactivity: NAT as choose-reagent / select-substrate challenges.

## 3. Challenge record schema
```
{ id, chapter, section, topic, title, instruction, rule:{type,...}, objective, hint, requiresDiagonalBonds?:bool }
```
Rule types: exact-molecule{target}, formula-and-groups{formula, required[], forbidden[], ringCount?, piBonds?}, isomer-set{formula, count, isomers[]}, name-to-structure{name, target}, stereo-exact{target, accept[]}, select-atom{molecules[], selector, answerDescription}, predict-product{reactant, reagent, product|products[], stereoChecked, acceptAlso?[]}, choose-reagent{reactant, product, options[], correct}. SMILES are targets for graph comparison (stereo ignored unless stereo-exact or stereoChecked).

## 4. Challenge list (50, ordered by chapter)
1. ch1-build-methane | ch1 §1.6 | hybridization | "Place one carbon block. Turn hydrogen display on. You should see four hydrogens around it. Check the HUD reads CH4 and sp3." | exact-molecule target C | obj: sp3 carbon is tetravalent | hint: carbon always fills to four bonds.
2. ch1-condensed-2-methylbutane | ch1 §1.12 | structures | "Build the molecule written as the condensed structure CH3CH(CH3)CH2CH3." | exact-molecule target CCC(C)C | obj: read condensed structures | hint: the CH3 in parentheses hangs off the second carbon.
3. ch1-select-sp2-propene | ch1 §1.8 | hybridization | "Propene is placed for you. Select every sp2-hybridized carbon." | select-atom molecules [C=CC], selector hybridization==sp2 → answer = both C=C carbons | obj: sp2 = three σ partners | hint: count the atoms each carbon is bonded to.
4. ch1-build-ethyne-sp | ch1 §1.9 | hybridization | "Build ethyne (acetylene). Use the bond tool until the bond order reads 3, then confirm both carbons show sp in the HUD." | exact-molecule C#C | obj: sp carbon, linear | hint: each carbon has only two neighbours.
5. ch2-electrophilic-carbon | ch2 §2.1/§10.1 | polarity | "Chloromethane is placed. Select the atom that carries the partial positive charge (δ+)." | select-atom [CCl], selector carbon bonded to F/Cl/Br/I/O/N → C | obj: C–X bond polarity makes carbon electrophilic | hint: chlorine pulls electron density toward itself.
6. ch2-most-acidic-h-ethanol | ch2 §2.8 | acids-bases | "Ethanol is placed with hydrogens shown. Select its most acidic hydrogen." | select-atom [CCO], selector lowest-pKa H (§9 table: O–H 16 vs C–H ~50) → the O–H hydrogen | obj: O–H hydrogens are far more acidic than C–H | hint: which conjugate base puts the negative charge on oxygen?
7. ch2-stronger-acid-acetic-vs-ethanol | ch2 §2.9 | acids-bases | "Acetic acid and ethanol are placed. Select the single hydrogen that is the most acidic in the whole scene." | select-atom [CC(=O)O, CCO], selector lowest pKa H → acetic acid O–H (4.76 < 16.00) | obj: resonance-stabilised carboxylate makes RCO2H stronger | hint: compare Table 2.3 values 4.76 and 16.00.
8. ch2-lewis-base-site | ch2 §2.11 | acids-bases | "Dimethyl ether is placed. Select the atom that would donate an electron pair to BF3." | select-atom [COC], selector atom with lone pair → O | obj: Lewis base = lone-pair donor | hint: which atom has non-bonding electrons?
9. ch3-fg-alcohol-c3h8o | ch3 §3.1 | functional-groups | "Build a molecule with formula C3H8O that contains an alcohol group and no ether." | formula-and-groups C3H8O required [alcohol] forbidden [ether] (accepts propan-1-ol CCCO or propan-2-ol CC(C)O) | obj: alcohol = C–O–H | hint: three carbons in a row, put O–H on any of them.
10. ch3-fg-ether-c2h6o | ch3 §3.1 | functional-groups | "Build C2H6O with an ether group (no alcohol)." | formula-and-groups C2H6O required [ether] forbidden [alcohol] → COC | obj: ether = C–O–C; constitutional isomer of ethanol | hint: put the oxygen between the carbons.
11. ch3-fg-carboxylic-acid | ch3 §3.1 | functional-groups | "Build C2H4O2 containing a carboxylic acid." | formula-and-groups C2H4O2 required [carboxylic_acid] forbidden [ester, aldehyde, ketone, alcohol, ether] → CC(=O)O | obj: –CO2H is one group, not ketone+alcohol | hint: one carbon carries both a C=O and an O–H.
12. ch3-fg-ester | ch3 §3.1 | functional-groups | "Build C3H6O2 containing an ester and no carboxylic acid." | formula-and-groups C3H6O2 required [ester] forbidden [carboxylic_acid, ketone, ether, alcohol] (accepts CC(=O)OC methyl ethanoate, O=COCC ethyl methanoate) | obj: ester = C(=O)–O–C | hint: acid whose O–H hydrogen is replaced by carbon.
13. ch3-fg-amide | ch3 §3.1 | functional-groups | "Build C2H5NO containing an amide." | formula-and-groups C2H5NO required [amide] forbidden [amine, ketone, aldehyde] (accepts CC(N)=O, CNC=O) | obj: amide = C(=O)–N | hint: nitrogen attached directly to the carbonyl carbon.
14. ch3-isomers-c4h10 | ch3 §3.2 | isomers | "Build both constitutional isomers of C4H10, one after the other. The tracker counts distinct skeletons." | isomer-set C4H10 count 2 isomers [CCCC, CC(C)C] | obj: same formula, different connectivity | hint: straight chain, then move one carbon to a branch.
15. ch3-isomers-c5h12 | ch3 §3.2 | isomers | "Build all three constitutional isomers of C5H12." | isomer-set C5H12 count 3 [CCCCC, CCC(C)C, CC(C)(C)C] | obj: branching multiplies isomers | hint: pentane, 2-methylbutane, 2,2-dimethylpropane.
16. ch3-isomers-c6h14 | ch3 §3.2 | isomers | "Build all five constitutional isomers of C6H14 (McMurry Table 3.2)." | isomer-set C6H14 count 5 [CCCCCC, CCCC(C)C, CCC(C)CC, CCC(C)(C)C, CC(C)C(C)C] | obj: systematic enumeration | hint: hexane; two methylpentanes; two dimethylbutanes.
17. ch3-name-3-ethyl-2-methylpentane | ch3 §3.4 | nomenclature | "Build 3-ethyl-2-methylpentane." | name-to-structure target CCC(CC)C(C)C | obj: locants and alphabetical order | hint: five-carbon chain; ethyl on C3, methyl on C2.
18. ch3-name-2-2-4-trimethylpentane | ch3 §3.4 | nomenclature | "Build 2,2,4-trimethylpentane (isooctane)." | name-to-structure CC(C)CC(C)(C)C | obj: multiple identical substituents | hint: two methyls on the same carbon get the same number twice.
19. ch3-select-tertiary-carbon | ch3 §3.3 | alkyl-groups | "2-Methylbutane is placed. Select the tertiary carbon." | select-atom [CCC(C)C], selector carbon with exactly 3 carbon neighbours → C2 | obj: 1°/2°/3°/4° classification | hint: count carbon neighbours only.
20. ch4-isomers-c4h8 | ch4 §4.1/§7.2 | isomers | "Build every constitutional isomer of C4H8 you can with face-adjacent bonds (there are 4; a fifth, methylcyclopropane, needs a three-membered ring)." | isomer-set C4H8 count 4 isomers [C=CCC, CC=CC, C=C(C)C, C1CCC1] plus optional CC1CC1 (requiresDiagonalBonds; count becomes 5 when diagonals are on) | obj: one degree of unsaturation = one C=C or one ring | hint: three alkenes and one ring.
21. ch4-cycloalkane-c5h10-lattice | ch4 §4.1 | cycloalkanes | "Build a cycloalkane (a ring, no double bonds) with formula C5H10 using only face-adjacent bonds." | formula-and-groups C5H10 required [] forbidden [alkene, alkyne] ringCount 1 → methylcyclobutane CC1CCC1 (cyclopentane, ethylcyclopropane, dimethylcyclopropanes need diagonals) | obj: CnH2n for cycloalkanes; ring parent naming | hint: a four-membered ring plus one carbon.
22. ch4-name-methylcyclohexane | ch4 §4.1 | nomenclature | "Build methylcyclohexane. Tip: a six-membered ring on this grid is a 2×3 rectangle." | name-to-structure CC1CCCCC1 | obj: ring as parent | hint: six ring carbons, one methyl.
23. ch4-cis-1-2-dimethylcyclohexane | ch4 §4.2 | cis-trans | "Build cis-1,2-dimethylcyclohexane: both methyl blocks on the same face of the ring (both above the ring plane)." | stereo-exact target C[C@H]1CCCC[C@H]1C (meso, 1R,2S) accept [that only] | obj: cis = same face | hint: lay the ring flat, put both methyls on +y.
24. ch4-trans-1-2-dimethylcyclohexane | ch4 §4.2 | cis-trans | "Build trans-1,2-dimethylcyclohexane (one methyl above, one below the ring)." | stereo-exact target C[C@H]1CCCC[C@@H]1C accept [C[C@H]1CCCC[C@@H]1C (1S,2S), C[C@@H]1CCCC[C@H]1C (1R,2R)] | obj: trans = opposite faces; it is chiral (either enantiomer accepted) | hint: one methyl on +y, the other on −y.
25. ch5-select-chirality-center | ch5 §5.2 | chirality | "Butan-2-ol is placed. Select its chirality centre." | select-atom [CCC(C)O], selector carbon with four distinct branches → C2 | obj: four different groups (H, OH, CH3, CH2CH3) | hint: CH2 and CH3 carbons can never be chirality centres.
26. ch5-build-r-2-bromobutane | ch5 §5.5 | R/S | "Build (R)-2-bromobutane. Place the hydrogen on C2 explicitly so the configuration is unambiguous." | stereo-exact target CC[C@@H](C)Br accept [CC[C@@H](C)Br] | obj: CIP ranking Br > C2H5 > CH3 > H, clockwise = R | hint: with H pointing away, Br → ethyl → methyl must run clockwise.
27. ch5-build-s-alanine | ch5 §5.5 | R/S | "Build (S)-alanine, (S)-2-aminopropanoic acid, the natural enantiomer." | stereo-exact C[C@H](N)C(=O)O | obj: N > CO2H > CH3 > H; S = counter-clockwise | hint: the CO2H carbon outranks CH3 because it carries oxygens.
28. ch5-build-r-lactic-acid | ch5 §5.5 | R/S | "Build (R)-lactic acid, (R)-2-hydroxypropanoic acid." | stereo-exact C[C@@H](O)C(=O)O | obj: OH > CO2H > CH3 > H | hint: McMurry Fig 5.6 — (−)-lactic acid is R.
29. ch5-build-meso-2-3-dibromobutane | ch5 §5.7 | meso | "Build meso-2,3-dibromobutane: the (2R,3S) stereoisomer, which has an internal mirror plane." | stereo-exact target C[C@@H](Br)[C@@H](Br)C accept [C[C@@H](Br)[C@@H](Br)C] (engine must also report 'achiral/meso') | obj: two centres, opposite labels, superimposable on mirror image | hint: if you mirror your build, it should be the same molecule.
30. ch5-build-r-3-methylhexane | ch5 §5.5 | R/S | "Build (R)-3-methylhexane — every group on C3 is carbon, so rank by the first point of difference." | stereo-exact CCC[C@H](C)CC | obj: CIP rule 2 (propyl > ethyl > methyl > H) | hint: propyl beats ethyl at the third atom out.
31. ch6-predict-ethene-hbr | ch6 §6.5 | addition | "Bench: ethene + HBr. Build the product." | predict-product reactant C=C reagent hbr product CCBr stereoChecked false | obj: electrophilic addition, C=C is the nucleophile | hint: H adds to one carbon, Br to the other.
32. ch7-unsaturation-c6h10 | ch7 §7.2 | unsaturation | "Build any molecule with formula C6H10 that has exactly one ring and one double bond." | formula-and-groups C6H10 ringCount 1 piBonds 1 forbidden [alkyne] (accepts cyclohexene, ethylcyclobutene, etc.) | obj: degree of unsaturation 2 = ring + C=C | hint: (2·6+2−10)/2 = 2.
33. ch7-build-e-but-2-ene | ch7 §7.4 | E/Z | "Build (E)-but-2-ene (trans): the two methyls on opposite sides of the C=C." | stereo-exact C/C=C/C | obj: E = higher groups opposite | hint: put one CH3 on +y and the other on −y, both in the same plane as the C=C.
34. ch7-build-z-2-chlorobut-2-ene | ch7 §7.5 | E/Z | "Build (Z)-2-chlorobut-2-ene." | stereo-exact C/C=C(/C)Cl (Z: Cl and the C3-methyl on the same side) | obj: CIP on alkenes (Cl > CH3; CH3 > H) | hint: McMurry's own example; 'ze zame zide'.
35. ch7-build-e-3-methylpent-2-ene | ch7 §7.5 | E/Z | "Build (E)-3-methylpent-2-ene." | stereo-exact C/C=C(\C)CC (E: ethyl on C3 and methyl on C2 opposite) | obj: ethyl outranks methyl (rule 2) | hint: on C3 compare CH2CH3 with CH3.
36. ch7-markovnikov-2-methylpropene-hcl | ch7 §7.8 | addition | "Bench: 2-methylpropene + HCl. Build the sole product." | predict-product C=C(C)C reagent hcl product CC(C)(C)Cl stereoChecked false | obj: Markovnikov: H to less substituted carbon | hint: the tertiary carbocation forms.
37. ch7-select-carbocation-carbon | ch7 §7.9 | carbocations | "2-Methylpropene is placed. Select the carbon that becomes positively charged when H+ adds (the more stable carbocation)." | select-atom [C=C(C)C], selector alkene carbon with more carbon substituents → C2 | obj: 3° > 2° > 1° > methyl | hint: which alkene carbon has more alkyl groups?
38. ch7-rearrangement-3-methylbut-1-ene | ch7 §7.11 | rearrangement | "Bench: 3-methylbut-1-ene + HCl. Build the REARRANGED product (hydride shift to the tertiary cation)." | predict-product C=CC(C)C reagent hcl product CCC(C)(C)Cl stereoChecked false acceptAlso [CC(C)C(C)Cl labelled 'unrearranged (also formed, ~50%)'] | obj: 2° cation → 3° by hydride shift | hint: move an H from C3 to C2 before Cl attacks.
39. ch8-dehydrohalogenation-bromocyclohexane | ch8 §8.1 | elimination | "Bench: bromocyclohexane + KOH in ethanol. Build the alkene." | predict-product BrC1CCCCC1 reagent koh_etoh product C1CCC=CC1 | obj: elimination of HX gives C=C | hint: remove Br and an H from the neighbouring carbon.
40. ch8-br2-e-but-2-ene-meso | ch8 §8.2 | anti-addition | "Bench: (E)-but-2-ene + Br2 in CH2Cl2. Build the product with correct stereochemistry." | predict-product C/C=C/C reagent br2_ch2cl2 product C[C@@H](Br)[C@@H](Br)C stereoChecked true (meso only) | obj: anti addition via bromonium ion; trans alkene → meso | hint: the two Br's must end on opposite faces.
41. ch8-hydroboration-2-methylbut-2-ene | ch8 §8.5 | hydration | "Bench: 2-methylbut-2-ene, then BH3·THF followed by H2O2/NaOH. Build the alcohol." | predict-product CC=C(C)C reagent bh3_then_h2o2 product CC(C)C(C)O stereoChecked false | obj: non-Markovnikov OH | hint: OH goes to the less substituted alkene carbon.
42. ch8-choose-reagent-anti-markovnikov | ch8 §8.4–8.5 | hydration | "Which reagent converts 2-methylpropene into 2-methylpropan-1-ol?" | choose-reagent reactant C=C(C)C product CC(C)CO options [hg_oac2_then_nabh4, bh3_then_h2o2, h2so4_h2o, h2_pd] correct bh3_then_h2o2 | obj: complementary hydration methods | hint: oxymercuration would give tert-butanol.
43. ch8-oso4-cyclohexene-cis-diol | ch8 §8.7 | hydroxylation | "Bench: cyclohexene + cat. OsO4 / NMO. Build the diol with correct stereochemistry." | predict-product C1CCC=CC1 reagent oso4_nmo product O[C@H]1CCCC[C@H]1O stereoChecked true (cis/meso) | obj: syn dihydroxylation | hint: both OH on the same face.
44. ch8-hydrogenation-1-2-dimethylcyclohexene | ch8 §8.6 | reduction | "Bench: 1,2-dimethylcyclohexene + H2 / PtO2. Build the alkane with correct stereochemistry." | predict-product CC1=C(C)CCCC1 reagent h2_pt product C[C@H]1CCCC[C@H]1C stereoChecked true (cis/meso) | obj: syn addition of H2 | hint: both new H's from the same face ⇒ methyls cis.
45. ch8-ozonolysis-2-methylbut-2-ene | ch8 §8.8 | cleavage | "Bench: 2-methylbut-2-ene + O3, then Zn/H3O+. Build BOTH carbonyl products." | predict-product CC=C(C)C reagent o3_then_zn products [CC(C)=O, CC=O] stereoChecked false | obj: C=C → two C=O | hint: cut the double bond, put =O on each end.
46. ch9-hbr-2equiv-hex-1-yne | ch9 §9.3 | alkyne-addition | "Bench: hex-1-yne + 2 HBr. Build the product." | predict-product C#CCCCC reagent hbr_2equiv product CCCCC(C)(Br)Br | obj: Markovnikov twice → geminal dihalide | hint: both Br on C2.
47. ch9-hydration-hex-1-yne | ch9 §9.4 | alkyne-hydration | "Bench: hex-1-yne + H2O, H2SO4, HgSO4. Build the isolated product (not the enol)." | predict-product C#CCCCC reagent hgso4_h2so4_h2o product CCCCC(C)=O | obj: Markovnikov hydration + keto–enol tautomerism → methyl ketone | hint: OH on C2, then the enol becomes a C=O.
48. ch9-lindlar-vs-li-nh3-hex-3-yne | ch9 §9.5 | reduction | "Bench: hex-3-yne + H2 / Lindlar catalyst. Build the alkene with correct geometry." | predict-product CCC#CCC reagent h2_lindlar product CC/C=C\CC stereoChecked true (Z); companion choose-reagent: to get (E)-hex-3-ene CC/C=C/CC pick li_nh3 from [h2_lindlar, li_nh3, h2_pd, nanh2] | obj: syn (Lindlar → cis) vs dissolving-metal (→ trans) | hint: Lindlar is a poisoned catalyst that stops at the cis alkene.
49. ch9-acidic-h-and-alkylation | ch9 §9.7–9.8 | acetylide | Part A select-atom [C#CC] "Select propyne's most acidic hydrogen" → terminal ≡C–H (pKa 25). Part B predict-product reactant C#C reagent nanh2_then_1-bromopropane product C#CCCC | obj: sp C–H acidity; acetylide is an SN2 nucleophile on 1° halides | hint: the acetylide carbon bonds to the CH2 that carried Br.
50. ch10-ch11-halide-block | ch10 §10.1–10.5, ch11 §11.2–11.8 | organohalides + substitution/elimination — sub-challenges (each is a separate record in code, ids given):
 - ch10-isomers-c4h9br: isomer-set C4H9Br count 4 [CCCCBr, CCC(C)Br, CC(C)CBr, CC(C)(C)Br]; obj positional + skeletal isomers; hint 1-, 2-bromobutane and two bromo-2-methylpropanes.
 - ch10-nbs-cyclohexene: predict-product C1CCC=CC1 reagent nbs_hv product BrC1CCCC=C1; obj allylic bromination; hint Br replaces an H next to the C=C, C=C stays.
 - ch10-radical-chlorination-butane: predict-product CCCC reagent cl2_hv product CCC(C)Cl (major, 70%) acceptAlso [CCCCCl 'minor 30%']; obj 2° H 3.5× more reactive; hint count the hydrogens and weight them.
 - ch10-tert-alcohol-hcl: predict-product CC(C)(C)O reagent hx_ether(hcl) product CC(C)(C)Cl; obj SN1 on 3° alcohol; hint tertiary alcohols react fastest with HX.
 - ch10-choose-reagent-primary-alcohol-to-chloride: choose-reagent CCCO → CCCCl options [hx_ether(hcl), socl2_pyridine, pbr3, mg_ether] correct socl2_pyridine; obj 1°/2° alcohols use SOCl2/PBr3; hint HCl is slow for primary alcohols.
 - ch11-sn2-inversion: predict-product CC[C@H](C)Br ((S)-2-bromobutane) reagent naoh product CC[C@@H](C)O ((R)-butan-2-ol) stereoChecked true; obj backside attack inverts configuration (McMurry Fig 11.2); hint the OH ends up where the Br was NOT.
 - ch11-sn2-cyanide: predict-product CCCCBr reagent nacn_dmso product CCCCC#N; obj SN2 on 1° halide with a strong nucleophile; hint carbon of CN bonds to C1.
 - ch11-sn1-tert-bromide-water: predict-product CC(C)(C)Br reagent h2o_heat product CC(C)(C)O; obj SN1 via tert-butyl cation; hint neutral nucleophile, tertiary substrate.
 - ch11-e2-zaitsev-2-bromo-2-methylbutane: predict-product CCC(C)(C)Br reagent naoet_etoh product CC=C(C)C (Zaitsev, 70%) acceptAlso [C=C(C)CC 'minor 30%'] stereoChecked false; obj more substituted alkene predominates; hint remove H from the carbon that gives the trisubstituted alkene.
 - ch11-e2-1-chloro-1-methylcyclohexane: predict-product CC1(Cl)CCCCC1 reagent koh_etoh product CC1=CCCCC1 acceptAlso [C=C1CCCCC1 'minor'] ; obj Zaitsev in rings (McMurry worked example 11.4); hint endocyclic trisubstituted alkene is major.
 - ch11-choose-reagent-sn2-vs-e2: choose-reagent CCC(C)Br → CC=CC options [nacn_dmso, naoet_etoh, h2o_heat, mg_ether] correct naoet_etoh; obj 2° halide + strong base = E2; hint a strong, basic alkoxide favours elimination.
 - ch11-select-fastest-sn2-substrate: select-atom molecules [CBr, CC(C)Br, CC(C)(C)Br] selector "molecule whose C–Br carbon has the fewest carbon substituents" → bromomethane (select any atom of it); obj steric hindrance order methyl > 1° > 2° > 3°; hint backside attack needs an open carbon.
(50 top-level ids; the block in #50 expands to 12 records → 61 records total; enable per topic.)

Reserve ideas (not specified): ch9-br2-but-1-yne → CC/C(Br)=C\Br (E, stereoChecked); ch9-hydroboration-but-1-yne (sia2bh_then_h2o2) → CCCC=O; ch8-halohydrin-propene (br2_h2o) → CC(O)CBr; ch8-epoxide-then-h3o (mcpba_then_h3o) cyclohexene → trans diol O[C@H]1CCCC[C@@H]1O accept either enantiomer; ch10-grignard bromoethane + mg_ether → CC[Mg]Br (needs Mg block); ch10-name-2-bromo-5-methylhexane CC(C)CCC(C)Br; ch4-name-1,1-dimethylcyclohexane CC1(C)CCCCC1.

## 5. Molecule library (72 entries; formula and canonical SMILES verified with RDKit; stereo labels verified with rdCIPLabeler)
Format: IUPAC name (common) | formula | SMILES | ch | flags
1 methane | CH4 | C | 1
2 ethane | C2H6 | CC | 1
3 propane | C3H8 | CCC | 3
4 butane | C4H10 | CCCC | 3
5 2-methylpropane (isobutane) | C4H10 | CC(C)C | 3
6 pentane | C5H12 | CCCCC | 3
7 2-methylbutane (isopentane) | C5H12 | CCC(C)C | 3
8 2,2-dimethylpropane (neopentane) | C5H12 | CC(C)(C)C | 3
9 hexane | C6H14 | CCCCCC | 3
10 2-methylpentane | C6H14 | CCCC(C)C | 3
11 3-methylpentane | C6H14 | CCC(C)CC | 3
12 2,2-dimethylbutane | C6H14 | CCC(C)(C)C | 3
13 2,3-dimethylbutane | C6H14 | CC(C)C(C)C | 3
14 3-ethyl-2-methylpentane | C8H18 | CCC(CC)C(C)C | 3
15 2,2,4-trimethylpentane (isooctane) | C8H18 | CC(C)CC(C)(C)C | 3
16 (R)-3-methylhexane | C7H16 | CCC[C@H](C)CC | 5
17 cyclopropane | C3H6 | C1CC1 | 4 | requiresDiagonalBonds
18 methylcyclopropane | C4H8 | CC1CC1 | 4 | requiresDiagonalBonds
19 cyclobutane | C4H8 | C1CCC1 | 4
20 methylcyclobutane | C5H10 | CC1CCC1 | 4
21 cyclopentane | C5H10 | C1CCCC1 | 4 | requiresDiagonalBonds
22 cyclohexane | C6H12 | C1CCCCC1 | 4
23 methylcyclohexane | C7H14 | CC1CCCCC1 | 4
24 cis-1,2-dimethylcyclohexane (meso, 1R,2S) | C8H16 | C[C@H]1CCCC[C@H]1C | 4
25 trans-1,2-dimethylcyclohexane ((1S,2S) shown; enantiomer C[C@@H]1CCCC[C@H]1C) | C8H16 | C[C@H]1CCCC[C@@H]1C | 4
26 ethene (ethylene) | C2H4 | C=C | 1,7
27 propene (propylene) | C3H6 | C=CC | 7
28 but-1-ene | C4H8 | C=CCC | 7
29 (E)-but-2-ene (trans-2-butene) | C4H8 | C/C=C/C | 7
30 (Z)-but-2-ene (cis-2-butene) | C4H8 | C/C=C\C | 7
31 2-methylpropene (isobutylene) | C4H8 | C=C(C)C | 7
32 2-methylbut-2-ene | C5H10 | CC=C(C)C | 7
33 2-methylbut-1-ene | C5H10 | C=C(C)CC | 11
34 3-methylbut-1-ene | C5H10 | C=CC(C)C | 7
35 2,3-dimethylbut-2-ene | C6H12 | CC(C)=C(C)C | 7
36 (E)-3-methylpent-2-ene | C6H12 | C/C=C(\C)CC | 7
37 (Z)-2-chlorobut-2-ene (E isomer: C/C=C(\C)Cl) | C4H7Cl | C/C=C(/C)Cl | 7
38 (Z)-hex-3-ene (cis) | C6H12 | CC/C=C\CC | 9
39 (E)-hex-3-ene (trans) | C6H12 | CC/C=C/CC | 9
40 cyclohexene | C6H10 | C1CCC=CC1 | 8
41 1-methylcyclohexene | C7H12 | CC1=CCCCC1 | 11
42 methylenecyclohexane | C7H12 | C=C1CCCCC1 | 11
43 1,2-dimethylcyclohexene | C8H14 | CC1=C(C)CCCC1 | 8
44 ethyne (acetylene) | C2H2 | C#C | 1,9
45 propyne | C3H4 | C#CC | 9
46 but-1-yne | C4H6 | C#CCC | 9
47 but-2-yne | C4H6 | CC#CC | 9
48 pent-1-yne | C5H8 | C#CCCC | 9
49 hex-1-yne | C6H10 | C#CCCCC | 9
50 hex-3-yne | C6H10 | CCC#CCC | 9
51 chloromethane (methyl chloride) | CH3Cl | CCl | 2,10
52 bromomethane | CH3Br | CBr | 11
53 bromoethane | C2H5Br | CCBr | 6
54 2-bromopropane (isopropyl bromide) | C3H7Br | CC(C)Br | 11
55 1-bromobutane | C4H9Br | CCCCBr | 11
56 (S)-2-bromobutane (R: CC[C@@H](C)Br) | C4H9Br | CC[C@H](C)Br | 5,11
57 1-bromo-2-methylpropane | C4H9Br | CC(C)CBr | 10
58 2-bromo-2-methylpropane (tert-butyl bromide) | C4H9Br | CC(C)(C)Br | 11
59 2-chloro-2-methylpropane (tert-butyl chloride) | C4H9Cl | CC(C)(C)Cl | 7,10
60 2-chlorobutane | C4H9Cl | CCC(C)Cl | 10
61 2-chloro-2-methylbutane | C5H11Cl | CCC(C)(C)Cl | 7
62 2-bromo-2-methylbutane | C5H11Br | CCC(C)(C)Br | 11
63 bromocyclohexane (cyclohexyl bromide) | C6H11Br | BrC1CCCCC1 | 8,10
64 1-chloro-1-methylcyclohexane | C7H13Cl | CC1(Cl)CCCCC1 | 11
65 3-bromocyclohexene | C6H9Br | BrC1CCCC=C1 | 10
66 meso-2,3-dibromobutane (2R,3S) ((2R,3R): C[C@@H](Br)[C@H](Br)C) | C4H8Br2 | C[C@@H](Br)[C@@H](Br)C | 5,8
67 trans-1,2-dibromocyclohexane ((1S,2S); cis/meso: Br[C@H]1CCCC[C@H]1Br) | C6H10Br2 | Br[C@H]1CCCC[C@@H]1Br | 8
68 2,2-dibromohexane | C6H12Br2 | CCCCC(C)(Br)Br | 9
69 (E)-1,2-dibromobut-1-ene | C4H6Br2 | CC/C(Br)=C\Br | 9
70 methanol (methyl alcohol) | CH4O | CO | 1,2,3
71 ethanol (ethyl alcohol) | C2H6O | CCO | 2,3
72 propan-2-ol (isopropyl alcohol) | C3H8O | CC(C)O | 3
73 propan-1-ol | C3H8O | CCCO | 3
74 butan-1-ol | C4H10O | CCCCO | 3
75 (R)-butan-2-ol ((S): CC[C@H](C)O) | C4H10O | CC[C@@H](C)O | 5,11
76 2-methylpropan-2-ol (tert-butanol) | C4H10O | CC(C)(C)O | 8,10,11
77 2-methylpropan-1-ol (isobutyl alcohol) | C4H10O | CC(C)CO | 8
78 3-methylbutan-2-ol | C5H12O | CC(C)C(C)O | 8
79 2-methylbutan-2-ol | C5H12O | CCC(C)(C)O | 8
80 cyclohexanol | C6H12O | OC1CCCCC1 | 8
81 1-methylcyclohexanol | C7H14O | CC1(O)CCCCC1 | 8
82 cis-cyclohexane-1,2-diol (meso) (trans: O[C@H]1CCCC[C@@H]1O and enantiomer) | C6H12O2 | O[C@H]1CCCC[C@H]1O | 8
83 (R)-lactic acid, (R)-2-hydroxypropanoic acid ((S): C[C@H](O)C(=O)O) | C3H6O3 | C[C@@H](O)C(=O)O | 5
84 dimethyl ether | C2H6O | COC | 2,3
85 diethyl ether | C4H10O | CCOCC | 3
86 methanal (formaldehyde) | CH2O | C=O | 3
87 ethanal (acetaldehyde) | C2H4O | CC=O | 3,8
88 propanal | C3H6O | CCC=O | 3
89 butanal | C4H8O | CCCC=O | 9
90 propanone (acetone) | C3H6O | CC(C)=O | 2,3,8
91 butanone (methyl ethyl ketone) | C4H8O | CCC(C)=O | 3
92 hexan-2-one | C6H12O | CCCCC(C)=O | 9
93 cyclohexanone | C6H10O | O=C1CCCCC1 | 3
94 methanoic acid (formic acid) | CH2O2 | OC=O | 2
95 ethanoic acid (acetic acid) | C2H4O2 | CC(=O)O | 2,3
96 propanoic acid | C3H6O2 | CCC(=O)O | 5
97 methyl ethanoate (methyl acetate) | C3H6O2 | CC(=O)OC | 3
98 ethyl ethanoate (ethyl acetate) | C4H8O2 | CC(=O)OCC | 3
99 methylamine | CH5N | CN | 1,3
100 ethylamine | C2H7N | CCN | 3
101 dimethylamine | C2H7N | CNC | 3
102 propan-2-amine (isopropylamine) / propan-1-amine | C3H9N | CC(C)N / CCCN | 3
103 ethanamide (acetamide) | C2H5NO | CC(N)=O | 3
104 N-methylethanamide | C3H7NO | CC(=O)NC | 3
105 ethanenitrile (acetonitrile) | C2H3N | CC#N | 3
106 pentanenitrile | C5H9N | CCCCC#N | 11
107 (S)-alanine, (S)-2-aminopropanoic acid | C3H7NO2 | C[C@H](N)C(=O)O | 5
108 methanethiol | CH4S | CS | 3
109 dimethyl sulfide | C2H6S | CSC | 3
110 benzene (ch 15; needed for 'arene' in Table 3.1; a 6-ring fits the lattice as a 2×3 rectangle) | C6H6 | c1ccccc1 (Kekulé C1=CC=CC=C1) | 3/15
111 ethylmagnesium bromide (needs Mg block) | C2H5BrMg | CC[Mg]Br | 10
(111 numbered lines because pairs share lines; distinct compounds ≈ 100. If the engineer wants exactly 60–80, drop 14–16, 20, 33–35, 42–43, 48, 57, 60, 69, 73, 85–89, 91, 93, 96, 100–102, 104, 106, 108–109.)

## 6. Functional-group detector (Table 3.1) — ordered rules with claimed atoms
Algorithm: run rules in this order; each match claims the listed atoms; a later match that touches an already-claimed atom is discarded. Report the multiset of surviving matches. If none: "alkane" when only C/H, else "unclassified". Tested (RDKit) on 40 molecules — see facts.
| # | group | plain-words rule | SMARTS | claimed atoms |
| 1 | carboxylic acid | C with =O and –OH | [CX3](=[OX1])[OX2H1] | C, both O |
| 2 | acid anhydride | C(=O)–O–C(=O) | [CX3](=[OX1])[OX2][CX3](=[OX1]) | all 5 |
| 3 | ester | C(=O)–O–C | [CX3](=[OX1])[OX2][#6] | C=O carbon, both O |
| 4 | thioester | C(=O)–S–C | [CX3](=[OX1])[SX2][#6] | C, O, S |
| 5 | acid chloride | C(=O)–X | [CX3](=[OX1])[F,Cl,Br,I] | C, O, X |
| 6 | amide | C(=O)–N | [CX3](=[OX1])[NX3] | C, O, N |
| 7 | nitrile | C≡N | [CX2]#[NX1] | C, N |
| 8 | aldehyde | C(=O) with ≥1 H on that C | [CX3;H1,H2](=[OX1]) | C, O |
| 9 | ketone | C(=O) between two carbons | [#6][CX3](=[OX1])[#6] | C, O |
| 10 | imine | C=N | [CX3]=[NX2] | C, N |
| 11 | sulfoxide | C–S(=O)–C | [#6][SX3](=[OX1])[#6] | S, O |
| 12 | alcohol | C–O–H | [#6][OX2H1] | O |
| 13 | thiol | C–S–H | [#6][SX2H1] | S |
| 14 | disulfide | C–S–S–C | [#6][SX2][SX2][#6] | both S |
| 15 | ether | C–O–C | [#6][OX2][#6] | O |
| 16 | sulfide | C–S–C | [#6][SX2][#6] | S |
| 17 | amine | N (single bonds only) bonded to ≥1 C | [NX3;!$([N]=*);!$([N]#*)]([#6]) | N |
| 18 | halide | C–X (report alkyl/vinyl/aryl subtype by carbon type) | [#6][F,Cl,Br,I] | X |
| 19 | arene | six-membered ring with alternating double bonds | [c]1[c][c][c][c][c]1 (or Kekulé ring pattern if no aromaticity model) | 6 ring C |
| 20 | alkyne | C≡C | [CX2]#[CX2] | both C |
| 21 | alkene | C=C | [CX3]=[CX3] | both C |
| 22 | phosphate/diphosphate | C–O–PO3 | [#6][OX2]P(=O)(O)O | O, P | (out of v1 scope; listed for completeness)
Why the order works: the carbonyl carbon and its oxygens are claimed by rules 1–6 before rules 8/9/12/15/17 can see them, so RCO2H is never ketone+alcohol, RCO2R' never ketone+ether, RCONH2 never ketone+amine; nitrile is checked before alkyne by element; arene before alkene so benzene is not three alkenes. Implementation without a SMARTS engine: encode each rule as a small subgraph matcher on the block graph (atom symbol, bond order, H count, degree), which is all these patterns use.

## 7. Reaction bench
### 7.1 Reagent ids (display label → id)
hbr, hcl, hi (HX in ether), hbr_2equiv, hx_ether(hcl|hbr) (for alcohols), br2_ch2cl2, cl2_ch2cl2, br2_h2o (or nbs_h2o), hg_oac2_then_nabh4, bh3_then_h2o2, h2so4_h2o (acid-cat. hydration / dehydration when reactant is an alcohol), h2_pd, h2_pt, h2_lindlar, li_nh3, mcpba, mcpba_then_h3o, oso4_nmo, o3_then_zn, kmno4_h3o, koh_etoh, naoet_etoh, kotbu, naoh, nacn_dmso, nai_acetone, h2o_heat, etoh_heat, hgso4_h2so4_h2o, sia2bh_then_h2o2, nanh2_nh3, nanh2_then_<halide id>, nbs_hv, cl2_hv, br2_hv, socl2_pyridine, pbr3, hf_pyridine, mg_ether, li_then_cui.
### 7.2 Rule table (reactant class + reagent → transform; regio; stereo tag). Substituent count of an alkene carbon = number of non-H neighbours other than its C=C partner.
- alkene + hbr/hcl/hi → add H to the alkene carbon with FEWER substituents, X to the other (Markovnikov). Tie → both products, accept either. Stereo: none (racemic if a new centre forms). Advanced flag `allowRearrangement`: if the carbocation carbon (the one getting X) is 2° and an adjacent carbon is 3° (or would become 3° after a 1,2-shift of H or CH3), also accept the product with X on that adjacent carbon.
- alkene + br2_ch2cl2/cl2 → X on both carbons, ANTI (new substituents on opposite faces: in lattice terms, on a ring or fixed frame, opposite signs along the normal). Stereo checked when requested: trans alkene + X2 → meso (for symmetric R groups); cis alkene → racemic pair; cycloalkene → trans-1,2-dihalide (either enantiomer).
- alkene + br2_h2o → OH on the MORE substituted carbon, Br on the other, anti.
- alkene + hg_oac2_then_nabh4 or h2so4_h2o → OH on the MORE substituted carbon, H on the other; stereo none (racemic).
- alkene + bh3_then_h2o2 → OH on the LESS substituted carbon, H on the other; SYN (OH and new H same face) — matters only when both carbons become stereocentres (e.g. 1-methylcyclohexene → trans-2-methylcyclohexanol: C[C@H]1CCCC[C@@H]1O or enantiomer).
- alkene + h2_pd/h2_pt → alkane, SYN (cis product on rings).
- alkene + mcpba → epoxide (3-ring; requiresDiagonalBonds to build) syn; mcpba_then_h3o → 1,2-diol ANTI (trans on rings); oso4_nmo → 1,2-diol SYN (cis on rings, meso for symmetric).
- alkene + o3_then_zn → cut C=C, each carbon becomes C=O (aldehyde if it had an H, ketone otherwise); kmno4_h3o → same but aldehyde → carboxylic acid and CH2= → CO2 (CO2 not built; accept the other fragment).
- alkyl halide + koh_etoh/naoet_etoh/kotbu → E2: remove X and a β-H; major product = most substituted alkene (Zaitsev); kotbu → least substituted (Hofmann) may be added in v2; requires ≥1 β-H; product set = all distinct alkenes, major flagged. Tertiary alcohol + h2so4_h2o (heat) → same dehydration logic.
- alkyl halide + nucleophile ids (naoh, nacn_dmso, nai_acetone, nanh2 acetylide, RO−) on methyl/1°/unhindered 2° → SN2: replace X by Nu with INVERSION at that carbon (stereoChecked ⇒ compare R/S of product to inverted input); 3° or neopentyl → refuse ("no SN2: too hindered"), offer E2 instead. Acetylide + 2°/3° halide → elimination (cyclohexene from bromocyclohexane per McMurry 9.8).
- alkyl halide (3°, allylic, benzylic) + h2o_heat/etoh_heat/weak Nu → SN1: replace X by Nu (H2O → OH, ROH → OR), stereo RACEMIC (accept either enantiomer; HUD says "racemic"); also report E1 alkene as a side product (2-chloro-2-methylpropane in aq. EtOH: 64% SN1 : 36% E1). 1° substrate → "no reaction (SN1 needs a stable cation)".
- alkyne + hbr (1 equiv) → vinylic halide: X on the more substituted (internal) carbon, H on terminal carbon; hbr_2equiv → geminal dihalide on that carbon. alkyne + br2 (1 equiv) → trans-dihaloalkene (E when R ≠ H on one end); 2 equiv → tetrahalide.
- terminal alkyne + hgso4_h2so4_h2o → methyl ketone (OH on internal C, then tautomerise: C(OH)=CH2 → C(=O)CH3); internal symmetric alkyne → single ketone; unsymmetric internal → two ketones. terminal alkyne + sia2bh_then_h2o2 → aldehyde RCH2CHO; internal + bh3_then_h2o2 → ketone.
- alkyne + h2_pd → alkane; h2_lindlar → (Z)-alkene (syn); li_nh3 → (E)-alkene (anti).
- terminal alkyne + nanh2_nh3 → acetylide (engine: mark C− site); nanh2_then_<1° RX> → new C–C bond at terminal carbon.
- vicinal dihalide + 2 nanh2 (or excess koh) → alkyne.
- alkane + cl2_hv → monochlorination at each distinct H type; major = argmax(count_H × weight), weights 1° 1.0, 2° 3.5, 3° 5.0; br2_hv → same with weights 1 : 82 : 1640 (McMurry gives bromination as far more selective; use 3° ≫ 2° ≫ 1°).
- alkene + nbs_hv → Br on an allylic C–H (C adjacent to C=C, not on the C=C); C=C unchanged (allylic rearrangement ignored in v1).
- alcohol + hx_ether → alkyl halide (fast only for 3°; 1°/2° flagged "slow/needs heat", still accepted); socl2_pyridine → chloride (1°/2° only); pbr3 → bromide (1°/2° only); hf_pyridine → fluoride. Stereo: SOCl2/PBr3 with inversion (only if stereoChecked).
- alkyl halide + mg_ether → R–Mg–X (needs Mg block; Mg valence 2); li_then_cui → R2CuLi (v2).
### 7.3 Product acceptance
Canonical-graph compare (stereo ignored) unless stereoChecked; for multi-product rules compare multisets; "acceptAlso" entries are shown as "correct minor product" feedback. Reactant zone is locked; extra stray atoms in the product zone fail with "unused atoms".
### 7.4 Racemic rule
If the reactant molecule and reagent are achiral and the product has a new chirality centre, the bench labels the product "racemic" and accepts either enantiomer; if the reactant is chiral and the rule is SN2, exactly the inverted product is required; SN1 accepts both.

## 8. Acceptance-rule semantics and lattice stereo
### 8.1 Canonical graph
Node label = element + formal charge (0 in v1); edge label = bond order; implicit H count derived from valence (C4, N3, O2, S2, halogen 1, Mg 2) minus bond-order sum; explicit H blocks are folded into the count. Canonicalise with iterative WL refinement + lexicographically minimal DFS string (or port a small SMILES canonicaliser). Two molecules match if canonical strings are equal.
### 8.2 Formula/DoU
Formula from element counts including implicit H (Hill order: C, H, then alphabetical). DoU = (2C + 2 + N − H − X)/2 (O and S ignored) — McMurry 7.2.
### 8.3 Stereo from lattice coordinates
Chirality centre candidates: sp3 carbon (4 σ-neighbours counting implicit H) whose four branches are topologically distinct (compare canonical strings of the four rooted subtrees with the centre removed; N with 3 groups is not a centre in v1).
Position sets: neighbours occupy 4 of the 6 directions {±x,±y,±z}. Valid ("see-saw") iff the set contains exactly one opposite pair; the 3 coplanar sets are INVALID → message "the four groups around this carbon are flat; a real tetrahedral carbon is not — move one group up or down" and the challenge cannot pass.
Implicit H: if a centre has 3 explicit neighbours: (a) on three mutually perpendicular directions → handedness is independent of the H position (proved by direct computation), use any free direction; (b) containing an opposite pair → handedness DEPENDS on where H goes → message "place the hydrogen block explicitly on this carbon". Stereo-exact challenges state this in the instruction.
R/S: rank the four neighbours by CIP (§9.2); with positions p1 ≥ p2 ≥ p3 ≥ p4 by priority, compute T = (p1−p4)·((p2−p4)×(p3−p4)). T < 0 ⇒ R; T > 0 ⇒ S; T = 0 ⇒ invalid geometry. (Verified against RDKit on five known centres.)
E/Z: for double bond a=b along axis u, each of a and b has two other neighbours which must lie on the SAME perpendicular axis as each other (T-shape: e.g. +y and −y, implicit H taking the empty slot); both a and b must use the same perpendicular axis, else message "twisted double bond — put all four groups in one plane". Let ha, hb be the higher-priority neighbour on each carbon; Z iff (ha−a)·(hb−b) > 0 else E. Double bond is stereogenic only if each carbon's two groups differ (7.4).
Meso/achiral report: molecule is achiral if its canonical string with all labels inverted equals the original.
Ring cis/trans: no special code; R/S labels of the target already encode it (e.g. cis-1,2-dimethylcyclohexane = (1R,2S)).
### 8.4 select-atom selectors
hybridization(sp|sp2|sp3); electrophilicCarbon (C bonded to O/N/X and not carbonyl O itself; for carbonyls the C=O carbon); lonePairAtom; mostAcidicH (§9.1 lookup by environment); chiralityCenter; tertiaryCarbon; moreSubstitutedAlkeneCarbon; betaHydrogenZaitsev; molecule-level selectors resolve to "any atom of that molecule". Success = selected set equals answer set.
### 8.5 isomer-set
Maintain Set<canonical>; on "submit", if formula ≠ target → "wrong formula (yours: …)"; if canonical ∉ isomers[] → "not a valid isomer"; duplicates → "already built"; success at size == count (or ≥ when diagonals enabled and optional isomers exist).

## 9. Reference data
### 9.1 pKa lookup for mostAcidicH (from Tables 2.3, 8.1 in §9.7, Appendix B)
carboxylic acid O–H 4.8 (formic 3.7); HCN 9.3; thiol S–H 10.3; phenol O–H 9.9; water 15.7; methanol 15.5; ethanol 16.0; 2-propanol 17.1; tert-butanol 18.0; aldehyde α-C–H 17; ketone α-C–H 19.3; ester α-C–H 25; nitrile α-C–H 25; terminal alkyne ≡C–H 25; ammonia/amine N–H 36–40; alkene =C–H 44; alkane C–H ~60. Rule: pick the H with the lowest pKa; tie → reject challenge design.
### 9.2 CIP ranking (5.5, 7.5)
Rank by atomic number of the attached atom (Br > Cl > S > P > O > N > C > H); ties: compare the sets of atoms one bond further out, highest first, repeat outward to the first difference (breadth-first, sets sorted descending); double/triple bonds: duplicate the partner atom (C=O counts as C bonded to O,O; C≡C as C,C,C). Isotopes ignored in v1.
### 9.3 Nomenclature accepted spellings
Accept both locant styles ("2-butene" / "but-2-ene", "2-methyl-2-butanol" / "2-methylbutan-2-ol"), common names in Table 7.1 (ethylene, propylene, isobutylene, isoprene) and alkyl-halide style names (isopropyl bromide) as instruction text only; the target is always the SMILES.
### 9.4 Alkene stability (Table 7.2 heats of hydrogenation)
ethylene −136, propene −125, cis-2-butene −119, trans-2-butene −115, isobutylene −118, 2-methyl-2-butene −112, 2,3-dimethyl-2-butene −110 kJ/mol; order tetra > tri > di (trans > cis) > mono.
### 9.5 Selectivity numbers
Cl2/hv per-H reactivity 1° : 2° : 3° = 1 : 3.5 : 5 (butane → 30:70 1-/2-chlorobutane; isobutane → 65:35 1-/2-chloro). Zaitsev examples: 2-bromobutane → 81% 2-butene; 2-bromo-2-methylbutane → 70% 2-methyl-2-butene. SN2 relative nucleophile rates on CH3Br (Table 11.1): H2O 1, CH3CO2− 500, NH3 700, Cl− 1000, HO− 10 000, CH3O− 25 000, I− 100 000, CN− 125 000, HS− 125 000.

## Facts

- [verified] OpenStax 'Organic Chemistry: A Tenth Edition' chapter 3 is 'Organic Compounds: Alkanes and Their Stereochemistry' with sections 3.1 Functional Groups, 3.2 Alkanes and Alkane Isomers, 3.3 Alkyl Groups, 3.4 Naming Alkanes, 3.5 Properties of Alkanes, 3.6 Conformations of Ethane, 3.7 Conformations of Other Alkanes (module ids m00032-m00038). _(source: collections/organic-chemistry.collection.xml and modules/m000xx/index.cnxml in github.com/openstax/osbooks-organic-chemistry (cloned))_
- [verified] Table 3.1 'Structures of Some Common Functional Groups' lists exactly: alkene (-ene), alkyne (-yne), arene (none), halide (none), alcohol (-ol), ether (ether), monophosphate (phosphate), diphosphate (diphosphate), amine (-amine), imine/Schiff base (none), nitrile (-nitrile), thiol (-thiol), sulfide (sulfide), disulfide (disulfide), sulfoxide (sulfoxide), aldehyde (-al), ketone (-one), carboxylic acid (-oic acid), ester (-oate), thioester (-thioate), amide (-amide), acid chloride (-oyl chloride), carboxylic acid anhydride (-oic anhydride). _(source: modules/m00032/index.cnxml (section 3.1))_
- [verified] Table 2.3 pKa values: ethanol 16.00, water 15.74, HCN 9.31, H2PO4- 7.21, acetic acid 4.76, H3PO4 2.16, HNO3 -1.3, HCl -7.0. Section 2.10 adds methanol 15.54 and acetone 19.3. Appendix B adds (CH3)2CHOH 17.1, (CH3)3COH 18.0, CH3CHO 17, HC≡CH 25, CH3CN 25, NH3 36, H2C=CH2 44, CH4 ~60, HCO2H 3.7, CH3SH 10.3. _(source: modules/m00025, m00027, m00030)_
- [verified] McMurry Table 3.2: number of alkane constitutional isomers C6H14 = 5, C7H16 = 9, C8H18 = 18; text states two C4H10 and three C5H12 isomers. _(source: modules/m00033 (section 3.2))_
- [verified] Chapter 8 Summary of Reactions: HX addition (Markovnikov); Cl2/Br2 addition (anti, halonium ion); halohydrin formation (Markovnikov, anti); oxymercuration-demercuration Hg(OAc)2/H2O then NaBH4 (Markovnikov); hydroboration-oxidation BH3/THF then H2O2/OH- (non-Markovnikov, syn); catalytic hydrogenation H2/Pd-C or PtO2 (syn); epoxidation with peroxyacid (syn); hydroxylation with OsO4 then NaHSO3 or cat. OsO4/NMO (syn); dichlorocarbene and Simmons-Smith cyclopropanation; acid-catalysed epoxide hydrolysis to trans-1,2-diol (anti); oxidative cleavage with O3 then Zn/H3O+, and with KMnO4/H3O+; 1,2-diol cleavage with HIO4. _(source: modules/m00101 summary-reactions section)_
- [verified] Chapter 9 Summary of Reactions: alkyne preparation by dehydrohalogenation of vicinal dihalides (2 KOH or NaNH2) and by acetylide alkylation (NaNH2 then RCH2Br, primary halides only); HX addition (1 equiv gives vinylic halide Markovnikov, 2 equiv gives geminal dihalide); X2 addition (trans dihaloalkene, then tetrahalide); HgSO4/H2SO4/H2O hydration gives methyl ketone from terminal alkyne; hydroboration-oxidation (disiamylborane) of terminal alkyne gives aldehyde; H2/Pd-C gives alkane; H2/Lindlar gives cis alkene; Li/NH3 gives trans alkene; NaNH2 gives acetylide anion. Alkyne pKa 25, alkene 44, alkane 60. _(source: modules/m00111 summary-reactions, m00105-m00110)_
- [verified] Chapter 10 Summary of Reactions: allylic bromination with NBS/hv; alcohol + HX (3° > 2° > 1°); 1°/2° alcohol + SOCl2 (pyridine) or PBr3 (ether); alcohol + HF-pyridine; RX + Mg/ether -> RMgX; RX + 2 Li -> RLi, 2 RLi + CuI -> R2CuLi; Gilman coupling; Suzuki-Miyaura. Radical chlorination selectivity: 2° H 3.5x and 3° H 5x a 1° H; butane + Cl2/hv gives 1-chlorobutane:2-chlorobutane 30:70. _(source: modules/m00120 summary-reactions, m00114, m00117)_
- [verified] Chapter 11 reactivity summary: primary halides SN2 with good nucleophile, E2 with strong hindered base; secondary halides SN2 with weakly basic nucleophile in polar aprotic solvent, E2 with strong base; tertiary halides E2 with base, SN1+E1 under neutral protic conditions. SN2 inverts configuration ((S)-2-bromobutane + HO- gives (R)-2-butanol); SN1 gives racemisation; E2 requires anti-periplanar H and X (trans-diaxial in cyclohexanes); Zaitsev: 2-bromobutane + NaOEt gives 81% 2-butene, 19% 1-butene; 2-bromo-2-methylbutane gives 70% 2-methyl-2-butene; 1-chloro-1-methylcyclohexane + KOH/EtOH gives 1-methylcyclohexene (major). _(source: modules/m00123, m00125, m00128, m00129, m00130, m00133)_
- [verified] Markovnikov's rule (7.8): in HX addition H attaches to the carbon with fewer alkyl substituents, X to the carbon with more; carbocation stability 3° > 2° > 1° > methyl; 3-methyl-1-butene + HCl gives ~50% rearranged 2-chloro-2-methylbutane (hydride shift) plus 2-chloro-3-methylbutane. Degree of unsaturation: add halogens to H, ignore O, subtract N from H. _(source: modules/m00070, m00071, m00073, m00064)_
- [verified] CIP sequence rules (5.5 and 7.5): rank by atomic number of the attached atom, then first point of difference outward, multiple bonds duplicated; with lowest group away, 1->2->3 clockwise = R; E/Z: higher-ranked groups same side = Z, opposite = E. (-)-Lactic acid is R; natural (+)-alanine is S. _(source: modules/m00054, m00067)_
- [verified] McMurry keeps the older locant style (2-butene, not but-2-ene) but notes IUPAC's 1993 recommendation; the game should accept both spellings. _(source: modules/m00065 (section 7.3))_
- [verified] All 72 library SMILES produce the stated molecular formulas and have distinct canonical SMILES (no accidental duplicates); the stereo SMILES for every stereo-exact/predict-product target carry the stated R/S or E/Z labels; meso-2,3-dibromobutane, cis-cyclohexane-1,2-diol, cis-1,2-dimethylcyclohexane are identical to their mirror images (meso). _(source: RDKit 2026.03.6 run in scratchpad (verify.py, verify2.py) using rdCIPLabeler)_
- [verified] The functional-group SMARTS list with claimed-atom exclusion returns exactly ['carboxylic_acid'] for acetic acid, ['ester'] for methyl/ethyl acetate, ['amide'] for acetamide and N-methylacetamide, ['nitrile'] for acetonitrile, ['arene'] for benzene, and multi-group results for lactic acid (acid+alcohol), alanine (acid+amine), 1-bromopropan-2-ol (alcohol+halide). _(source: RDKit run fg.py in scratchpad, 40 test molecules)_
- [verified] Coordinate-based chirality: with neighbour positions p1..p4 in decreasing CIP priority, R iff (p1-p4)·((p2-p4)×(p3-p4)) < 0; checked on 3D embeddings of (R)/(S)-2-bromobutane, (R)/(S)-lactic acid, (S)-alanine, (R)-3-methylhexane. _(source: RDKit embedding + rdCIPLabeler comparison in scratchpad)_
- [verified] On a cubic lattice a carbon with 4 of 6 octahedral positions occupied is chiral-capable in 12 of the 15 possible position sets (one trans pair plus one position on each other axis) and undefined (square planar) in the 3 sets {±x,±y},{±x,±z},{±y,±z}; with three explicit substituents on mutually perpendicular axes the implicit-H position does not change the handedness, but with a trans pair plus one more explicit substituent the handedness depends on where the implicit H is placed. _(source: Analytical triple-product computation on lattice coordinates (worked in this session))_
- [verified] The OpenStax McMurry text contains no explicit per-section 'learning objectives' blocks; objectives below are derived from each chapter's 'Why This Chapter?' and end-of-chapter Summary. _(source: grep over all 342 modules of the cloned repo)_
- [verified] The user was not asked which topics to include; the seven-topic list in the computed task is unconfirmed. _(source: Relayed user message in this workflow run)_

## Recommendations

- Before building content, ask the user which chapters/sections to include; present §2 verdicts as the menu (the user explicitly said they were never asked). Treat the seven-topic list in the computed task as a proposal only.
- Implement stereo perception exactly as §8.3: reject the 3 coplanar 4-of-6 arrangements, require an explicit H block when three explicit substituents include a trans pair, and use the verified triple-product sign (T<0 ⇒ R). Unit-test against library entries 16, 24, 25, 56, 66, 75, 83, 107 whose labels were RDKit-verified.
- Ship the functional-group detector as the ordered claimed-atom rule list in §6 (a small subgraph matcher is enough; no SMARTS engine needed) and copy the 40-molecule test set from this session as unit tests.
- Enable diagonal (edge-adjacent) bonds behind a per-challenge flag; only 8 library molecules / 2 challenges need it (cyclopropane/cyclopentane/epoxides), so v1 can ship without it.
- Add a formal-charge (+/−) tool in v2 to unlock ch 2.3–2.6 (formal charge, resonance) and acetylide/carbocation intermediates; without it those sections stay quiz-only.
- Use OpenStax section numbers and module ids in challenge metadata so instructors can map challenges to their syllabus; the book is CC BY-NC-SA, so quoting rule text in hints is permitted with attribution.
- Accept both McMurry locant style (2-butene) and current IUPAC style (but-2-ene) in all name fields.
- Keep RDKit in the content pipeline (not the browser): regenerate formulas, canonical SMILES and CIP labels for every library edit with the verify.py pattern used here.

## Risks

- The user has not confirmed the topic list; content authored against the seven-topic assumption may be discarded.
- openstax.org was unreachable from the sandbox; the text was taken from the official OpenStax GitHub CNXML source, which should match the live site but section numbering was inferred from module order (cross-checked against the appendix's section references) rather than read from rendered pages.
- Cubic-lattice geometry is chemically idealised (90°/180° angles, flat cyclohexane, T-shaped sp2 carbons); students may internalise wrong geometry unless the HUD shows the real angles.
- A carbon with four substituents can be placed square-planar on the lattice; if the engine does not reject this, R/S will be undefined or wrong. Likewise implicit-H centres with a trans pair are ambiguous.
- Zaitsev/E2 in cyclohexanes (trans-diaxial requirement, 11.9) and all conformational content (3.6–3.7, 4.4–4.8) cannot be represented; any challenge claiming to teach them would be misleading.
- Radical halogenation, rearrangements and SN1/E1 give product mixtures; the bench must present them as major/minor rather than single answers or students will learn false regiospecificity.
- Grignard products need an Mg block and metal valence rules not covered by the current atom set.
- Aromaticity: benzene builds as a single Kekulé structure; the detector's arene rule must match the Kekulé ring pattern if the engine has no aromaticity model, and resonance cannot be shown.
