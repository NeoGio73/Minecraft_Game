# 01 — Work packages

Twelve packages. File ownership is disjoint; a package edits only the files it owns plus its own tests. All packages code against `docs/design/00-contracts.md` and the five contract files (owned by nobody after this point; changes go through a contracts PR that updates `00-contracts.md`). Every package must leave `npm run typecheck` and `npm test` green.

Design docs referenced: `02-chemistry-core.md`, `03-stereo-acidity-hybridization.md`, `04-reaction-bench.md`, `05-content.md`, `06-engine.md`, `07-ui.md`, `08-deployment.md`.

| id | title | implements | depends on | pure |
|---|---|---|---|---|
| WP-01 | Chemistry core | 02 | — | yes |
| WP-02 | Stereochemistry engine and stereo-aware comparator | 03 | WP-01 | yes |
| WP-03 | Hybridization, formal charge, acidity | 03 | WP-01 | yes |
| WP-12 | Chemistry facade: analyze, naming | 02 | WP-01, WP-02, WP-03 | yes |
| WP-04 | Reaction bench engine | 04 | WP-01, WP-02 | yes |
| WP-05 | Content: library, roster, reagents, acceptance | 05 | WP-12, WP-04 | yes |
| WP-06 | Voxel world (pure) | 06 | — | yes |
| WP-07 | Player, camera, input | 06 | WP-06 | no |
| WP-08 | Rendering | 06 | WP-06 | no |
| WP-09 | UI / HUD | 07 | WP-05, WP-06 | no |
| WP-10 | LMS, persistence, packaging | 08 | — (uses only `src/lms/types.ts` and `RosterInfo`) | mixed |
| WP-11 | Integration, smoke test, CI | 06, 07, 08 | all | no |

## WP-01 Chemistry core (`02-chemistry-core.md`)
Files: `src/chem/valence.ts`, `src/chem/graph.ts`, `src/chem/smiles.ts`, `src/chem/kekulize.ts`, `src/chem/hydrogens.ts`, `src/chem/aromatic.ts`, `src/chem/formula.ts`, `src/chem/groups.ts`, `src/chem/wlhash.ts`, `src/chem/isomorphism.ts`, `src/chem/embed.ts`, `src/util/vec3.ts`.
Tests: `test/chem/smiles.test.ts`, `test/chem/hydrogens.test.ts`, `test/chem/formula.test.ts`, `test/chem/aromatic.test.ts`, `test/chem/groups.test.ts`, `test/chem/isomorphism.test.ts`, `test/chem/embed.test.ts`.
Notes: no file in this package imports from WP-02, WP-03 or WP-12. `isomorphism.ts` returns every mapping so WP-02's comparator can try each one for parity. `embed.ts` reads `tet`/`ez` tags directly (no CIP needed). Port `tools/reference/refimpl.py` (parser, H rule, WL, VF2) and `embed.py`.

## WP-02 Stereochemistry engine and comparator (`03-stereo-acidity-hybridization.md`, sections on CIP, R/S, E/Z, ring faces, comparison)
Files: `src/chem/cip.ts`, `src/chem/stereo.ts`, `src/chem/stereo-compare.ts`, `src/chem/compare.ts`.
Tests: `test/chem/cip.test.ts`, `test/chem/stereo.test.ts`, `test/chem/stereo-compare.test.ts`, `test/chem/compare.test.ts`.
Notes: port `tools/reference/cipref.py` line by line; fixtures are the tables in stereo-on-grid.md 1.6, 2.7, 3.2, 4.3, 6 and the 8/12 trio and 12/3 quad enumerations. `compare.ts` implements `sameMolecule` (quick reject → WL hash → `findIsomorphisms` → `compareStereo` per mapping → best verdict) and `normalize`; its constitution-only tests (isomer families, rewritten SMILES pairs, WL-collision fixture, state cap) live in `compare.test.ts`.

## WP-03 Hybridization, formal charge, acidity (`03-stereo-acidity-hybridization.md`, sections on AtomInfo, charge tool, pKa engine)
Files: `src/chem/hybridization.ts`, `src/chem/charge.ts`, `src/chem/acidity.ts`.
Tests: `test/chem/hybridization.test.ts`, `test/chem/charge.test.ts`, `test/chem/acidity.test.ts`.
Notes: the 24-row hybridization table, lonePairs/targetValence table, charge-tool examples, every C2-05/C2-06/C2-07 molecule, and butanone's single equivalence class are the fixtures.

## WP-12 Chemistry facade (`02-chemistry-core.md`, section "analyze pipeline")
Files: `src/chem/analyze.ts`, `src/chem/naming.ts`.
Tests: `test/chem/analyze.test.ts`, `test/chem/naming.test.ts`.
Notes: `analyze` runs normalize → counts/formula/DoU/rings → groups → hash → atomInfo → stereo (only when `hasPositions`) → acidity → name → warnings and returns the `Analysis` record; `naming.ts` builds the hash index over the library entries it is given (it does not import `molecules.json`; WP-05's `library.ts` passes the parsed entries in).

## WP-04 Reaction bench engine (`04-reaction-bench.md`)
Files: `src/reactions/react.ts`, `src/reactions/decision.ts`, `src/reactions/helpers.ts`, `src/reactions/additions.ts`, `src/reactions/alkynes.ts`, `src/reactions/oxidation.ts`, `src/reactions/substitution.ts`, `src/reactions/elimination.ts`, `src/reactions/radical.ts`, `src/reactions/alcohols.ts`, `src/reactions/rearrangement.ts`.
Tests: `test/reactions/additions.test.ts`, `test/reactions/alkynes.test.ts`, `test/reactions/decision.test.ts`, `test/reactions/substitution-elimination.test.ts`, `test/reactions/oxidation-radical.test.ts`, `test/reactions/rearrangement.test.ts`.
Notes: fixtures are RB-01..RB-38 and the extra vectors in reaction-bench.md section 5; tests compare products with `sameMolecule` (WP-02) at the challenge's policy. `react` never imports `analyze`.

## WP-05 Content (`05-content.md`)
Files: `src/content/molecules.json`, `src/content/challenges.json`, `src/content/reagents.json`, `src/content/library.ts`, `src/content/reagents.ts`, `src/content/challenges.ts`, `src/content/acceptance.ts`, `src/content/selectors.ts`, `src/content/feedback.ts`, `src/content/validate.ts`, `orgocraft.config.json`.
Tests: `test/content/library.test.ts`, `test/content/reagents.test.ts`, `test/content/challenges.test.ts`, `test/content/acceptance.test.ts`, `test/content/buildable.test.ts`, `test/content/selectors.test.ts`.
Notes: every challenge gets ≥1 positive and ≥2 negative builds (as SMILES or lattice layouts) with the expected `FeedbackKind`; `buildable.test.ts` runs `embedOnLattice` on every library entry and every build target; pKa margins validated; `totalPoints` asserted from the JSON.

## WP-06 Voxel world, pure (`06-engine.md`)
Files: `src/world/blocks.ts`, `src/world/chunk.ts`, `src/world/world.ts`, `src/world/worldgen.ts`, `src/world/mesher.ts`, `src/world/raycast.ts`, `src/world/molecule-index.ts`, `src/world/extract.ts`, `src/util/prng.ts`, `src/util/noise.ts`.
Tests: `test/world/mesher.test.ts`, `test/world/raycast.test.ts`, `test/world/molecule-index.test.ts`, `test/world/extract.test.ts`, `test/world/worldgen.test.ts`.
Notes: `extract.ts` produces `WorldGraph` with H blocks collapsed into `hPos`; placement/bond/charge validation lives in `molecule-index.ts`; cube-chair hexagon has no chord, planar 2×3 hexagon has one, inner-vertex carbon placement is allowed and flagged `cage`.

## WP-07 Player, camera, input (`06-engine.md`)
Files: `src/player/physics.ts`, `src/player/camera.ts`, `src/input/InputManager.ts`, `src/input/pointerlock.ts`, `src/input/look-modes.ts`, `src/input/keymap.ts`.
Tests: `test/player/physics.test.ts`, `test/input/keymap.test.ts`.

## WP-08 Rendering (`06-engine.md`)
Files: `src/render/Renderer.ts`, `src/render/ChunkRenderer.ts`, `src/render/AtomRenderer.ts`, `src/render/BondRenderer.ts`, `src/render/StereoOverlay.ts`, `src/render/GhostRenderer.ts`, `src/render/Highlight.ts`, `src/render/element-texture.ts`, `src/render/palette.ts`, `src/render/lights.ts`.
Tests: none in vitest (WebGL); covered by the smoke test. `test/render/palette.test.ts` may test the pure sRGB→linear conversion if `palette.ts` isolates it.

## WP-09 UI / HUD (`07-ui.md`)
Files: `src/ui/hud.ts`, `src/ui/strings.ts`, `src/ui/toolbar.ts`, `src/ui/hotbar.ts`, `src/ui/molecule-panel.ts`, `src/ui/challenge-panel.ts`, `src/ui/quiz-panel.ts`, `src/ui/bench-panel.ts`, `src/ui/select-atom.ts`, `src/ui/settings-panel.ts`, `src/ui/pause-menu.ts`, `src/ui/help.ts`, `src/ui/live-region.ts`, `src/ui/styles.css`, `src/app/Settings.ts`.
Tests: `test/ui/strings.test.ts` (every `WarningKind`, `FeedbackKind`, `CenterLabel`, `BondLabel` has a string).

## WP-10 LMS, persistence, packaging (`08-deployment.md`)
Files: `src/lms/Progress.ts`, `src/lms/scorm-api.ts`, `src/lms/ScormAdapter.ts`, `src/lms/storage.ts`, `scorm/imsmanifest.template.xml`, `scorm/xsd/*.xsd`, `scripts/check-relative-paths.mjs`, `scripts/package-d2l.mjs`, `scripts/package-scorm.mjs`, `docs/INSTRUCTOR.md`.
Tests: `test/lms/progress.test.ts`, `test/lms/adapter.test.ts` (fake `window.API` in a jsdom-free harness: the adapter takes the API object and a `WindowLike` as constructor parameters).
Notes: different `student_id` ⇒ mirror ignored; local restore ⇒ no auto-commit; `exit` never `logout`; encoded all-solved length < `SUSPEND_DATA_BUDGET`.

## WP-11 Integration, smoke test, CI (`06-engine.md`, `07-ui.md`, `08-deployment.md`)
Files: `src/main.ts`, `src/app/Game.ts`, `src/app/State.ts`, `index.html`, `scripts/smoke.mjs`, `.github/workflows/build.yml`, `src/util/throttle.ts`.
Tests: `test/app/state.test.ts`, `test/pure-imports.test.ts`.
Notes: `State.ts` is pure and owns the emitter; `Game.ts` wires World → MoleculeIndex → extract → analyze → panels, the bench flow (card → `react` → `embedOnLattice` → ghost preview → `evaluate`), the select-atom flow and the adapter milestones. The smoke test scripts the methane challenge and a select-H challenge through the fake API.

## Merge order and parallelism
WP-01, WP-06, WP-07 (physics part), WP-10 (Progress part) can start immediately. WP-02 and WP-03 start when WP-01's `graph.ts`, `valence.ts`, `hydrogens.ts` and `isomorphism.ts` have merged. WP-12 and WP-04 follow WP-02/WP-03. WP-05 follows WP-12 and WP-04. WP-08 follows WP-06; WP-09 follows WP-05 and WP-06; WP-11 is last. No placeholder files are created: a package adds an import of another package's module only after that module has merged, and the dependency column above is the only allowed import direction between packages.
