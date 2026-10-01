# OrgoCraft

OrgoCraft is a browser game in the style of Minecraft for a first-semester college organic chemistry course (McMurry, *Organic Chemistry*, chapters 1-11). Students build molecules out of atom blocks on a lab pad, the game analyzes what they built (formula, functional groups, hybridization, R/S and E/Z, acidity) and grades it against a roster of challenges; a reaction bench applies the McMurry reagent set to a reactant and asks the student to build or predict the product. It runs entirely in the browser (Vite, TypeScript, Three.js) with no server and is delivered inside a D2L Brightspace course, either as a plain course file or as a SCORM 1.2 package that reports a score to the gradebook.

Audience: students in Organic Chemistry I and the instructor who uploads it. The instructor-facing steps are in [`docs/INSTRUCTOR.md`](docs/INSTRUCTOR.md); the scope decisions are in [`docs/SCOPE.md`](docs/SCOPE.md).

## Chapter coverage (McMurry 1-11)

| Chapter | Topic | In the game |
| --- | --- | --- |
| 1 | Structure and bonding, hybridization, geometry | Per-atom sp/sp2/sp3, geometry and bond angles in the molecule panel; build challenges; quiz questions |
| 2 | Acids and bases, formal charge | pKa rules, "select the most acidic hydrogen" challenges, the charge tool, conjugate-base challenges |
| 3 | Alkanes, functional groups, IUPAC names | Functional-group detection, name-to-structure challenges, molecular formula |
| 3, 4 | Constitutional isomers, cycloalkanes | Isomer-set challenges (C4H10, C5H12, C6H14, C4H8, C4H9Br), degrees of unsaturation |
| 5 | Stereochemistry at tetrahedral centers | R/S from CIP priorities computed on the 3D grid; enantiomer, diastereomer and meso challenges |
| 7 | Alkenes, E/Z, Markovnikov | E/Z from grid geometry, alkene naming and stability challenges |
| 8 | Alkene addition reactions | Reaction bench: HX, X2, halohydrin, hydration, oxymercuration, hydroboration, hydrogenation, hydroxylation, cleavage, radical HBr |
| 9 | Alkynes | Reaction bench: HX, X2, hydration, hydroboration, Lindlar, Li/NH3, acetylide alkylation |
| 10 | Organohalides | Naming and preparation challenges |
| 11 | SN1, SN2, E1, E2 | Reaction bench decision table; predict-product and choose-reagent challenges |

Aromaticity, resonance, conformations, spectroscopy and arrow-pushing mechanisms are out of scope for v1. Odd-membered rings cannot be built on a cubic lattice, so cyclopropanation and epoxidation products are excluded from the roster.

Two touching atom blocks bond automatically. The bond wand cycles a bond through single, double, triple and *no bond* (a red x break marker between the blocks), which is how substituents on the same side of a Z-alkene stay apart. See `docs/design/09-amendment-no-bond.md`.

## Controls

The single-letter keys work only while the 3D view (the canvas) has focus; Tab leaves it. All keys except Escape, Tab and F3 can be remapped in Settings.

| Action | Keys |
| --- | --- |
| Move, jump, sprint | W A S D, Space, Shift |
| Look | Mouse (captured, or drag when capture is unavailable), arrow keys |
| Mine / remove a block | Q or left button |
| Place an atom, use the current tool, open the bench | E or right button |
| Element slots (C N O S F Cl Br I, H) | 1-9 |
| Bond wand, charge tool, select tool | B, C, V |
| Cycle hotbar slots (or select-mode candidates) | Mouse wheel, `[` `]` |
| Analyze the targeted molecule (spoken summary) | F |
| Submit the current challenge | Enter |
| Next / previous challenge | `.` / `,` |
| Hint, challenge list, help, reaction bench | I, L, H, R |
| Show or hide hydrogens | T |
| Clear the selection (select mode) | Backspace |
| Pause menu, release the mouse | Escape |
| Debug overlay | F3 |

The HUD panels, dialogs and the pause menu are keyboard-operable; two live regions announce results and tool changes to screen readers, and a scene description mirrors the targeted molecule as text.

## Running locally

Requirements: Node 22 and npm.

```sh
npm install
npm run dev        # Vite dev server, open the printed URL
```

Append `?debug=1` to the URL to expose `window.__orgocraft` (teleport, place, wand, goToChallenge, state) for scripting.

## Testing

```sh
npm run typecheck  # tsc --noEmit, strict
npm test           # vitest: chemistry, reactions, content, world, LMS adapter, packaging
```

The smoke test drives the *built* game in headless Chromium through `window.__orgocraft`, in standalone mode and inside a fake SCORM 1.2 wrapper, and fails on any console error, uncaught exception, failed step, or serious/critical axe-core violation. It serves `dist/` under a deep D2L-style path so the relative-base build is exercised.

```sh
npm run build
npm run smoke
```

Chromium is located through `CHROMIUM_PATH` (or `CHROME_PATH`), then `$PLAYWRIGHT_BROWSERS_PATH/chromium-*`, then `/opt/pw-browsers/chromium-*` and `~/.cache/ms-playwright`. To install one with the pinned Playwright version: `npx playwright install chromium`. The run writes `test-results/smoke.png` and `docs/screenshots/smoke.png`.

## Building and packaging for D2L

```sh
npm run build          # dist/ with relative asset paths
npm run check:paths    # fails if anything in dist/ is referenced by an absolute path
npm run package:d2l    # release/orgocraft-v<version>-d2l.zip    (Path A: course file, no grade)
npm run package:scorm  # release/orgocraft-v<version>-scorm12.zip (Path B: SCORM 1.2, grade item)
npm run release        # the four steps above
```

The version, pass mark and the list of disabled challenges come from `orgocraft.config.json`. Uploading the zips into Brightspace, creating the grade item and what the score means are described step by step in [`docs/INSTRUCTOR.md`](docs/INSTRUCTOR.md). CI (`.github/workflows/build.yml`) runs typecheck, tests, build, path check, both packages and the smoke test on every push and attaches the zips to a GitHub release on a `vX.Y.Z` tag that matches the config version.

## Folder layout

```
index.html                 static page skeleton (canvas, HUD containers, live regions)
orgocraft.config.json      version, pass mark, disabled challenges
src/
  main.ts                  entry point: WebGL check, Game start
  app/                     Game (composition root and frame loop), State (UI-facing state), Settings, events
  chem/                    pure chemistry: SMILES, graph, analysis, naming, stereo (CIP, R/S, E/Z), acidity, embedding
  reactions/               pure reaction bench: additions, alkynes, substitution/elimination, oxidation, radicals
  content/                 molecule library, challenge roster, reagent cards, acceptance and feedback (JSON + TS)
  world/                   voxel world, chunks, mesher, raycast, molecule index (bonds, charges, suppressed pairs)
  player/                  physics and first-person camera
  input/                   key map, input manager, pointer lock and look modes
  render/                  Three.js renderers: chunks, atoms, bonds and break markers, ghosts, highlights, overlays
  ui/                      HUD: panels, hotbar, quiz, bench, pause menu, help, settings, live regions, strings, CSS
  lms/                     SCORM 1.2 adapter, progress model, local storage
  util/                    noise, PRNG, throttle, vec3
test/                      vitest suites, mirroring src/
scripts/                   smoke.mjs, package-d2l.mjs, package-scorm.mjs, check-relative-paths.mjs
scorm/                     imsmanifest template and the SCORM 1.2 XSDs
public/                    static assets copied into dist/
tools/reference/           Python reference implementations used to derive the chemistry fixtures
docs/                      SCOPE.md, INSTRUCTOR.md, design/, research/, screenshots/
```

## Design documents

The design set in `docs/design/` is the specification the code follows; `09` overrides the others where they conflict.

| File | Covers |
| --- | --- |
| `00-contracts.md` | Shared types and the frozen module contracts |
| `01-work-packages.md` | Work package split and file ownership |
| `02-chemistry-core.md` | SMILES, graphs, hydrogens, functional groups, hashing, isomorphism, embedding |
| `03-stereo-acidity-hybridization.md` | CIP, R/S and E/Z on the grid, hybridization, formal charge, pKa engine |
| `04-reaction-bench.md` | Reagent set, reaction rules, bench flow |
| `05-content.md` | Molecule library, challenge roster, acceptance rules, feedback text |
| `06-engine.md` | World, player, input, rendering, game loop, debug API, smoke test steps |
| `07-ui.md` | HUD, panels, dialogs, focus and live-region policy, strings |
| `08-deployment.md` | SCORM adapter, persistence, packaging, instructor guide, CI |
| `09-amendment-no-bond.md` | "No bond" between touching blocks: index, wand cycle, break marker, content |
| `10-integration-notes.md` | Integration notes and deviations recorded during assembly |

Research notes behind those decisions are in `docs/research/`.
