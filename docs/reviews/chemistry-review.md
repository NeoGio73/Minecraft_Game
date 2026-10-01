# Review: chemistry content and rules (v1.0.0)

Read-only review by an organic chemistry professor lens, with RDKit
2026.03.6 as the oracle and the real engine run from node (~200 `react()`
calls over 180 card/substrate pairs; every roster challenge fed through
`react`, `answerSet` and `validateContent`). **No blocker.** Every graded
challenge accepts the textbook-correct answer and rejects wrong ones.

## Major

1. **`src/reactions/decision.ts` (R3_prim / R3_methyl rows): the NaNH2 card
   turns primary and methyl halides into amines.** `NANH2_BASE` + `CCCCBr` →
   major `CCCCN` (SN2); `CCBr` → ethylamine; `CBr` → methylamine. McMurry
   uses NaNH2 only as a base (9.2, 9.7, 11.12); amide-ion amination appears
   nowhere in ch 1-11. `baseOnly(nuc)` is true for the card but only consulted
   for cls 2. Fix: in `decide()`, inside the `nuc.basicity === 'strong'`
   block, before the `cls === 1 && nuc.bulky` row add
   ```ts
   if (cls <= 1 && baseOnly(nuc) && nuc.atom === 'N') {
     return cls === 1 ? done('R3', 'R3_prim_baseOnly', ['E2']) : done('R3', 'R3_methyl_baseOnly', []);
   }
   ```
   and in `src/reactions/helpers.ts` JUSTIFY add
   `R3_prim_baseOnly: 'NaNH2 is a strong base, not a nucleophile: a primary halide gives E2 elimination (McMurry 9.2, 11.12); the amine is not formed.'`
   and `R3_methyl_baseOnly: 'A methyl halide has no β-hydrogen to eliminate, and NaNH2 is not used as a nucleophile in McMurry: no reaction.'`.
   Keep `nuc.atom === 'C'` (acetylide) on the SN2 path (9.8). Update the
   04 §5.7 table and `test/reactions/decision.test.ts` rows l/e2.

## Minor

2. **`KOH_ETOH` on primary halides returns the alcohol as major** (SN2 with
   the `'O'` fragment; `heat: true` ignored by `decide()`; in ethanol the
   nucleophile would be ethoxide). Fix (pick one): (a) for cards with
   `heat: true` and `basicity: 'strong'` on cls 1, order `['E2', 'SN2']`
   with justification "KOH/ethanol at reflux favors E2 (McMurry 8.1); some
   substitution"; or (b) change the card's `nuc.fragment` to `'OCC'` so the
   minor substitution product is the ethyl ether. No roster challenge affected.
3. **Neopentyl halide + strong base gives the wrong explanation**
   (`decision.ts` `finish()` / JUSTIFY): student only reads "no β-hydrogen".
   Fix: when `R3_neopentyl` fires and `betaH === 0`, justification
   `'Branching one carbon away blocks backside attack (neopentyl, McMurry 11.3), and there is no β-hydrogen for E2: no reaction.'`
   (new key `R3_neopentyl_noBetaH`).
4. **`src/reactions/alkynes.ts` `applyDoubleE2` produces cyclohexyne**
   (`NANH2_2EQ_DIHALIDE` + `BrC1CCCCC1Br` → `C#1CCCCC1`). Fix: before
   setting order 3, if any ring through the two carbons has length < 8,
   `noReaction('A ring smaller than eight carbons cannot hold a linear C≡C; vicinal dihalides on small rings do not give cycloalkynes.')`.
5. **`src/reactions/alcohols.ts` ROH_HX SN1 branch: no 1,2-shift check for
   secondary alcohols** (3-methylbutan-2-ol + HBr should rearrange to
   2-bromo-2-methylbutane). Fix: run `checkShift` for `cls === 2` too
   (`const shift = (fast || cls === 2) && opts.rearrangement !== 'ignore' ? checkShift(...) : null`),
   keeping the `rohSlow` warning. No challenge uses a rearranging alcohol.
6. **`ch7-quiz-alkene-stability` quotes heats of hydrogenation not in
   Table 7.2** (no 1-butene row). Fix: hint "propene (monosubstituted) −125,
   cis-but-2-ene −119, trans-but-2-ene −115 kJ/mol (Table 7.2)" and the
   matching explanation; do not attribute a 1-butene value to Table 7.2.
7. **`ch7-predict-rearrangement-3-methylbut-1-ene-hcl` gives half credit for
   a product McMurry reports as ~50 %.** Fix:
   `"expected": ["CCC(C)(C)Cl", "CC(C)C(C)Cl"], "acceptAny": true`, drop
   `acceptAlso`, reword: "Build either of the two chlorides McMurry reports
   (about 1:1); the rearranged one shows you understand the hydride shift."
   (If the rule type lacks `acceptAny`, add it to the predict-product rule in
   src/content/types.ts and acceptance.ts.)
8. **`ch11-predict-sn1-tert-butyl-bromide-water` acceptAlso note** misstates
   McMurry's datum. Fix the note to: "2-methylpropene, the E1 product. McMurry
   11.10 reports 36 % elimination for 2-chloro-2-methylpropane in 80 % aqueous
   ethanol at 65 °C; the same competition applies here."
9. **`ch10-choose-propan-1-ol-to-1-chloropropane` and
   `ch10-choose-butan-2-ol-to-2-bromobutane`: the bench returns the halide
   as major for the HX cards (slow warning only) but the grader marks those
   cards wrong.** Fix: add to both instructions "Pick the reagent McMurry 10.5
   recommends" and surface `WARN.rohSlow` in the bench justification as
   "slow, low-yield; McMurry uses SOCl2/PBr3".
10. **Static `wrong-formula` feedback overrides assume one wrong build**
    (`ch2-build-acetate-ion` "yours is C2H4O2…", `ch2-build-tert-butyl-cation`
    "yours is C4H10…"). Fix: remove the hard-coded "yours is …" clause and let
    `FEEDBACK['wrong-formula']` supply the actual formula; keep only the hint
    sentence, e.g. acetate: "Right skeleton but the O-H hydrogen is still
    there? Target the single-bonded oxygen and press C once to make it O-."
11. **`src/chem/acidity.ts` nits**: (a) `[OH-]`'s hydrogen is classed
    `OH.water` 15.74 (should not be an acid site) → in `classifyO`, charge −1
    with no heavy neighbour → `XH.other`; (b) `PKA_MOD.allylic` source cites
    "propargyl 15.5" → "allyl 15.5, benzyl 15.4", keep `verified: true`;
    (c) `NH.amine.secondary` 40 vs Table 22.1's 36: add that note to the
    source string.
12. **`src/content/molecules.json` `dmso` chapters `[2]`** → `[2, 11]`.

## Verified correct (summary)

- molecules.json 192/192: SMILES parse, Hill formulas (with charges) match
  RDKit, all 43 stereo labels match rdCIPLabeler, 4 meso flags exact, ring
  cis/trans confirmed by 3D embedding, names and alternates reviewed.
- challenges.json 91/91: validator clean; 29 predict-product expected
  products in the engine's major set under the stated stereoCheck; 5
  choose-reagent (except finding 9); 15 select-atom answer sets exact; 6
  quizzes correct; 5 isomer sets complete by RDKit enumeration; 5
  name-to-structure and 12 stereo-exact targets verified; 8
  formula-and-groups rules checked against enumerated isomers; section
  numbers match OpenStax 10e.
- Reaction engine (56 cards, ~200 runs): regiochemistry, equivalents,
  mixtures, rearrangement policy, cleavage, alkyne chemistry, acetylide
  alkylation, NBS, radical halogenation ratios, SN/E decisions and the
  syn/anti/inversion stereo templates all agree with McMurry and RDKit.
- acidity.ts (56 molecules), groups.ts (68/68), hybridization.ts (40 atoms):
  all correct.
