# Review: engine, state and UI correctness (v1.0.0)

Read-only review by a senior TypeScript/Three.js engineer lens; every finding
marked "reproduced" was reproduced in headless Chromium through the DebugApi
or with node scripts against the pure modules.

## Blocker

1. **`analyze()` on a ring-dense build freezes the tab for seconds to minutes.**
   `src/app/Game.ts` `runOne()` / `runAnalyses()` call `analyze()` synchronously and
   unbounded per component (the 4 ms budget only stops between components). Root
   cause: `analyzeStereo()` (`src/chem/stereo.ts`, calls `assignRS` for every sp3
   carbon) → `cipRank()` (`src/chem/cip.ts`): `CIP_SPHERE_CAP = 500` caps one sphere
   list inside `compareLigands`, not the digraph size per centre, so on the lattice
   (every square is a 4-ring, every cube holds 5 rings) the hierarchical digraph
   with duplicate nodes explodes. Reproduced: 3×3 carbon sheet 26 ms; 4×4 89 ms;
   4×5 342 ms; 5×5 (25 atoms) 16–17 s all in analyzeStereo; 2×2×2 cube 106 ms;
   3×2×2 block 1.35 s; 3×2×3 block (18 atoms) > 90 s (killed). In the running
   game the 25th carbon of a 5×5 patch stalled the frame loop 10.2 s; a 12×4 patch
   crashed the renderer.
   Fix: (a) `cip.ts`: add a total node budget per `cipRank` call: `nodes: number` on
   `CipCtx`, incremented where DNodes are created; when `ctx.nodes > CIP_NODE_BUDGET`
   (≈4000) set `ctx.capHit = true` and stop expanding; `assignRS` already turns
   `capHit` into `CANNOT_ASSIGN` ("digraph size cap", `STEREO_TEXT.cannotAssign`).
   (b) `Game.ts`: time each `analyze` in `runOne`; if a component exceeded ~50 ms,
   do not re-run it synchronously on later edits (mark it "heavy" and re-analyse
   it only on an explicit Analyze or submit, telling the student in the panel), or
   run `analyze` in a Web Worker (src/chem is pure and worker-safe) and apply
   results asynchronously in `runAnalyses`.

## Major

2. **Locked challenge molecules are stamped over student atoms and auto-bond to
   them.** `Game.ts` `placeLocked()` writes `world.setBlock(p, atomBlockOf(el))`
   unconditionally; `onChallengeChanged()` never clears the slot boxes
   (`LOCKED_ORIGINS ± LOCKED_EXTENT`, `REACTANT_MIN..MAX`). Reproduced with the
   ethanol lock cells of ch2-select-most-acidic-h-ethanol: a student carbon at a
   lock cell was silently replaced (no inventory credit, no block:removed), and a
   student carbon on the floor next to it bonded into the locked component, which
   then read "propan-2-ol". Same path for quiz `display` molecules and the bench
   reactant. Fix: in `onChallengeChanged()` before each `place(...)`, clear student
   atoms in the reserved box expanded by one cell, crediting inventory
   (`clearReservedBox(min, extent)` iterating the box ±1, `removeAtomCell` on
   non-locked atom cells) for `(LOCKED_ORIGINS[i], LOCKED_EXTENT)` and
   `(REACTANT_MIN, REACTANT_MAX−REACTANT_MIN+1)`, with a polite announcement;
   and refuse student placement inside those boxes (+1 margin) in `placeAtom`
   with `ENGINE_TEXT.lockedMolecule`.
3. **In a select-atom challenge, Place on the student's own atom becomes a
   selection in the locked molecule and consumes an attempt.** `Game.ts`
   `doPlace()` / `doMine()` `case 'select': this.selectHovered()` runs when
   `hud.select.place()` returns false; `selectHovered()` builds
   `{ molecule: 0, atom }` from the target's cellToAtom, and State
   `emitSelection()` / acceptance `evaluateSelectAtom` → `normalizeSelection`
   read `molecule 0` as the locked molecule. Reproduced. Fix: in both switch
   arms `case 'select': if (hud?.select.active) return; this.selectHovered(); return;`.
   Also outside select mode `emitSelection()` resolves `molecule 0` through
   `lockedValue.find(...)` first, so with a bench challenge the select tool on a
   product-zone atom highlights the reactant's atom: give non-locked items a
   sentinel (`molecule: -1`) or resolve via the target when the rule is not select-atom.
4. **Submitting a select-atom challenge with nothing selected consumes an
   attempt; the last attempt is mis-reported.** `State.ts` `evaluateCurrent()` →
   `finish()` treats kind `wrong-atom` as consuming; `acceptance.ts`
   `evaluateSelectAtom` returns `fail('wrong-atom')` for an empty selection
   before its `ctx.attempt >= rule.maxAttempts` check; `challenge-panel.ts` keeps
   Submit enabled with an empty selection. Reproduced: three Enter presses with
   no selection consumed all three attempts, the third reported `wrong-atom`
   (not `attempts-exhausted`, no answer revealed, exhausted bit unset). Fix: in
   `finish()` extend `consuming` with
   `&& !(c.rule.type === 'select-atom' && this.selectionValue.length === 0)`;
   in `acceptance.ts` move the exhaustion check ahead of the empty-selection
   return (or return a dedicated non-consuming kind such as `nothing-selected`
   with a clear message); in `challenge-panel.ts` `refreshSelection()` set
   `submit.disabled = state.finished || (rule.type === 'select-atom' && state.selection.length === 0)`.
5. **The T key (toggleHydrogens) never changes the view and desynchronises the
   HUD's settings copy.** `hud.ts` `on('settings:changed')` → `case 'showHydrogens'`
   reads the HUD's private `current`; `Game.ts` `handlePressed` case
   `toggleHydrogens` calls `saveSettings(next)` and emits behind the HUD's back
   (only `ctx.updateSettings` updates `current`). Reproduced. Fix: `Game.ts`
   `case 'toggleHydrogens': hud.handleAction('toggleHydrogens'); break;` and
   `hud.ts` `handleAction`: `case 'toggleHydrogens': if (!select.forcesHydrogens()) ctx.updateSettings({ showHydrogens: !current.showHydrogens }); return true;`.

## Minor (reproduced unless noted)

6. **Bond wand picks the bond hidden behind an atom when aiming at the atom's
   outer face along the bond axis.** `Game.ts` `resolveHover()`
   (`BOND_PICK_MARGIN = 0.6`) with BondRenderer's pick box spanning both atom
   cubes. Fix: make the pick box only the visible segment
   (`BAR_LEN − ATOM_SCALE` long) and lower the margin to ≈0.45, or discard a pick
   hit whose point lies inside the voxel-hit atom's cube.
7. **Input accumulated while the WebGL context is lost is applied in one frame
   after restore** (yaw jump, queued place actions fire). Fix in `Game.frame()`:
   `if (document.hidden || this.renderer.contextLost) { this.input.consumeFrame(); this.last = tNow; return; }`.
8. **`?debug=1` inventory (99 of each) is persisted and leaks into normal
   sessions.** Fix: skip `saveInventory` in debug mode (pass `debug` through State
   or RenderHooks), or seed debug counts in memory only.
9. **Analyze (F) / any `molecule:analyzed` drops the keyboard-cycled select
   candidate** (`select-atom.ts` `rebuild()` nulls `keyboardHover`; `hud.ts`
   rebuilds on every analysis). Fix: keep `keyboardHover`/`cycledIndex` when the
   rebuilt candidate keys equal the previous ones.
10. **Every atom placement/removal remeshes 1–3 chunks although atoms are not
    part of the chunk mesh** (`world.ts` `setBlock()`). Fix: when both old and
    new ids are Air or atom blocks, write the cell and bump `version` without
    setting `dirty` or marking neighbours.
11. **Wheel over the canvas changes the hotbar while the canvas is not the
    active element; `InputManager.modal` is never set.** Fix: in `onWheel`
    `if (!this.active() || this.isModal) return;` after preventDefault; wire
    `modal` from the dialog stack or delete it.
12. **Escape under pointer lock** (not verifiable headless): Chromium consumes
    the Esc that exits the lock, so `LookModes.onLockChange` (unlock branch)
    should inject 'pause' when no dialog is open and the canvas is active.
13. **No IntersectionObserver pause** (06 §11.4 deviation, by reading): an
    iframe scrolled out of view keeps rendering at full rate. Fix: observe
    `#stage`; when not intersecting, skip rendering (keep input/physics paused
    like `document.hidden`).
14. **Every hover change sets `sceneDirty`** (by reading), so looking around
    rebuilds all instanced atoms/bonds/studs; only `highlight.update` is needed
    for a hover change. Fix: separate the hover/highlight path from the
    scene-rebuild path.
15. **bench-panel.ts open()/close() force the molecule panel collapsed/expanded**,
    discarding the student's own Collapse choice. Fix: remember the prior state
    on open and restore it on close.

## Verified correct (summary)

Frame order and deferral; challenge progression (quiz exhaustion, hints, solved
resubmits); inventory accounting; the whole no-bond flow; bench flow; raycast
DDA edge cases; physics (no tunnelling, wall stop, push-up, world clamp);
world/mesher border marking and cross-chunk culling; rendering pools, resize,
pixel-ratio cap, slow-frame downgrade, context loss and restore; input (blur
clearing, synchronous pointer-lock request with fallback, reserved keys,
form/dialog focus); UI/a11y (pause menu focus and inert HUD, Tab order, polite
region latest-wins, reduced motion). Not exercised: touch, real pointer-lock UX,
long-session memory growth.
