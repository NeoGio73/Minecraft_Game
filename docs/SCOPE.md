# OrgoCraft scope (v1)

Decisions recorded from the instructor on 2026-09-30. Everything downstream
(design, challenge content, engine features) follows this document.

## Audience and course

- College students in **Organic Chemistry I** (first semester).
- Textbook: **McMurry, Organic Chemistry** (chapter order of the OpenStax
  edition, which matches earlier McMurry editions for chapters 1-11).
- Delivered inside a **D2L Brightspace** course shell: uploaded into course
  content and/or as a SCORM 1.2 package that reports a score to the gradebook.

## Topics in v1 (instructor selected)

| McMurry chapter | Topic | Game feature |
| --- | --- | --- |
| 1 | Structure and bonding, hybridization and geometry | Analyzer reports sp/sp2/sp3, geometry and bond angles per atom; build challenges |
| 2 | Acids and bases, formal charge | pKa rule engine; "select the most acidic hydrogen"; charge tool; conjugate base challenges |
| 3 | Alkanes, functional groups, IUPAC naming | Functional group detection; name-to-structure challenges; molecular formula |
| 3, 4 | Constitutional isomers, cycloalkanes | Isomer-set challenges (C4H10, C5H12, C6H14, C4H8, C4H9Br); degrees of unsaturation |
| 5 | Stereochemistry at tetrahedral centers | R/S via CIP priorities computed from the 3D grid; enantiomer, diastereomer, meso challenges |
| 7 | Alkenes: structure, E/Z, Markovnikov | E/Z from grid geometry; alkene naming and stability challenges |
| 8 | Alkene addition reactions | Reaction bench with McMurry's reagent set (HX, X2, halohydrin, hydration, oxymercuration, hydroboration, hydrogenation, hydroxylation, cleavage, radical HBr) |
| 9 | Alkynes | Reaction bench: HX, X2, hydration, hydroboration, Lindlar, Li/NH3, acetylide alkylation |
| 10 | Organohalides | Naming and preparation challenges |
| 11 | SN1, SN2, E1, E2 | Reaction bench decision table; predict-product and choose-reagent challenges |

## Explicitly out of v1

- Aromaticity and resonance structures (chapter 15 and beyond).
- Newman projections, chair conformations, spectroscopy, arrow-pushing
  mechanisms (do not map to a block builder).
- Multiplayer, accounts, any server component.

## Engine consequences of the scope

- Stereochemistry requires real 3D placement: a carbon with four
  substituents on four of its six octahedral neighbor positions has a
  definite handedness unless the four are coplanar. The analyzer must detect
  planar centers and prompt the student to fix them.
- Odd-membered rings (3, 5, 7) are impossible with face adjacency on a cubic
  lattice. Cyclopropanation and epoxidation products are therefore either
  excluded or supported through an optional diagonal-bond mode. Decision:
  exclude from v1 challenges; keep the data model open to diagonal bonds.
- The reaction bench computes products as molecule graphs and checks the
  student's built molecule by graph isomorphism, with stereo labels compared
  after matching.
- Some chapter 1-2 objectives need a small quiz panel (multiple choice,
  yes/no) in addition to build challenges.
