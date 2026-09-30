# OrgoCraft — Design Document (v1, revision 2)

A Minecraft-style voxel world that teaches college organic chemistry. Vite + TypeScript + Three.js, no backend, delivered inside a D2L Brightspace course shell either as uploaded course content (Manage Files) or as a SCORM 1.2 package that reports a score to the gradebook.

This document is the single source of truth for the engineering team. It was re-aligned with `docs/SCOPE.md` (the instructor's decisions, dated 2026-09-30): the course is **Organic Chemistry I (McMurry ch. 1–11)** and aromaticity is out. Where this document still departs from SCOPE.md (stereochemistry, the reaction bench and the charge tool are deferred to v2), section 1 says so plainly and open question 1 asks the instructor to sign off.

Numbers that engineering copies into code (point totals, pad bounds, block ids) appear once here and are asserted by tests that read the JSON, never by literals.

---

## 1. Goals, audience, non-goals

### Goals
1. Students build molecules by placing element blocks in a 3D world; the game continuously reports formula, implicit hydrogens, hybridization per atom, degrees of unsaturation, functional groups, the most acidic hydrogen and (when known) the name, so every build is a formative check (McMurry ch. 1–3).
2. A fixed, ordered roster of 25 challenges (section 5): 22 Organic I challenges enabled by default (Lewis structures/valence, hybridization, acids and bases, functional groups, constitutional-isomer sets C4H10/C5H12/C6H14/C4H8/C4H9Br, IUPAC decoding, unsaturation, cycloalkanes, alkene additions, alkynes, organohalides, SN2/E2 products) plus a 3-challenge **Organic II extension pack** (benzene, p-xylene, aspirin) that is **disabled by default**.
3. The score (0–100) reaches the D2L gradebook through SCORM 1.2 when launched as a SCORM object, and is saved locally otherwise.
4. Runs on the machines students actually have (Chromebooks, integrated GPUs) inside an LMS iframe, and is fully keyboard-operable (WCAG 2.1 AA target; public colleges are under 28 CFR 35.200).

### Audience
College Organic Chemistry I students. Textbook per `docs/SCOPE.md`: McMurry (OpenStax chapter order). Each challenge cites its McMurry chapter; Klein/Wade equivalents are noted once in section 5.

### Relationship to `docs/SCOPE.md` (read this before estimating)
| SCOPE.md item | v1 status | Why |
|---|---|---|
| Ch. 1 hybridization, geometry, bond angles | **In**: per-atom sp/sp2/sp3 + geometry label in the molecule panel; quiz challenge C05 | pure graph rule (4.9) |
| Ch. 2 "select the most acidic hydrogen", pKa rule engine | **In**: `acidity.ts` + `acidicH` challenge type (C14, C15) | pKa lookup by H-site class, no charges needed |
| Ch. 2 formal charge, charge tool, conjugate-base challenges | **Deferred to v2** | all v1 atoms are neutral; a charge tool changes valence rules and rendering. Open question 3 |
| Ch. 3–4 functional groups, naming, isomer sets, DoU | **In** (C06–C13, C16, C20) | |
| Ch. 5 R/S, enantiomers, meso | **Deferred to v2** | needs seesaw/planar detection and CIP; the grid keeps positions so it is additive. Open question 1 |
| Ch. 7 E/Z from geometry | **Deferred to v2**; alkene naming and C4H8 isomers are in | stereo comparison is stripped in v1 |
| Ch. 8, 9, 11 reaction bench | **Deferred to v2**; v1 grades "build the product" challenges (C17, C18, C21, C22) as structure builds | no product-generation engine in v1. Open question 1 |
| Ch. 10 organohalides | **In** (C20 C4H9Br set, C21) | |
| Aromaticity (ch. 15+) | **Out of the Organic I track** — the extension pack X01–X03 is Organic II content and is disabled unless the instructor enables it | SCOPE.md excludes it; kept because the chemistry core must perceive aromatic rings anyway to name the library's aromatic entries |
| Small quiz panel (MC, yes/no) | **In**: `quiz` challenge type | |

### Non-goals for v1 (explicit)
- No reaction simulation or mechanisms; "build the product" challenges are graded as structure builds against a stored target.
- No stereochemistry: R/S, E/Z, cis/trans are ignored; targets are compared after stereo stripping.
- No formal charges (all atoms neutral). Nitro compounds, carboxylates, ammonium, carbocations are out.
- No odd-membered rings (3, 5, 7): face-adjacency bonding on a cubic lattice is bipartite (4.5). No diagonal-bond tool in v1.
- No explicit hydrogen blocks: hydrogens are implicit and auto-filled.
- No IUPAC name generator: naming is library lookup only.
- No multiplayer, accounts, server, analytics or external network calls of any kind.
- No world persistence: terrain edits and inventory are not graded state (inventory is mirrored to localStorage as a convenience only).

---

## 2. Deployment

### 2.1 Build configuration (Vite)
`vite.config.ts` (already in the repo) keeps:
- `base: './'` — mandatory. D2L serves uploaded files from `/content/enforced/<orgUnitId>-<orgUnitCode>/<folder>/index.html`, and the SCORM Content Service serves from `https://content.<region>.content-service.brightspace.com/vault/.../scormcontent/index.html`. A root-absolute `/assets/...` URL 404s in both.
- `build.assetsDir: 'assets'`, `build.sourcemap: false`, `build.target: 'es2020'`.
- Add `build.chunkSizeWarningLimit: 1500`; no dynamic `import()` / `manualChunks`: output is exactly `index.html`, `assets/index-<hash>.js`, `assets/index-<hash>.css`.
- Nothing in `public/` is referenced by absolute path. All runtime assets are generated at runtime (canvas textures); there are no image/model/wasm files to fetch.
- `scripts/check-relative-paths.mjs` runs after `vite build` and fails if `dist/` contains `"/assets/`, `src="/` or `href="/`.
- Output must never contain restricted extensions (`.sh .bat .exe .dll .config .cmd .ps1 .jar`), which D2L's uploader rejects. The packaging scripts assert this.

### 2.2 Path A — Manage Files upload (course content, no grade)
Script: `npm run package:d2l` → `release/orgocraft-v<version>-d2l.zip` containing a **single versioned folder** `orgocraft-v<version>/` with the contents of `dist/`.

Instructor steps (documented in `docs/INSTRUCTOR.md`):
1. Course Admin → Manage Files → Upload → choose the zip (default limit 2 GB; ours is < 1 MB).
2. Open the zip's action menu → Unzip. Wait for the background-job notification.
3. Tick `orgocraft-v<version>/index.html` → "Add Content Topics" → choose the module and a topic title.
4. Never click "Edit HTML" on the topic: the Brightspace Editor strips `<script>` tags.
5. For an update, upload a new versioned folder and use "Change File" on the topic (avoids the stale-`index.html` cache problem; hashed asset names handle the rest).

In this path the game runs in **standalone mode** (2.6): no gradebook, progress in localStorage. The HUD badge reads "Progress saved on this device — not connected to the gradebook".

### 2.3 Path B — SCORM 1.2 package (gradebook)
Script: `npm run package:scorm` → `release/orgocraft-v<version>-scorm12.zip` with, **at the zip root** (no wrapping folder):
- `imsmanifest.xml` generated from `scorm/imsmanifest.template.xml` by globbing `dist/**` into `<file href="..."/>` entries (index.html first, forward slashes, no leading `./`).
- `imscp_rootv1p1p2.xsd`, `adlcp_rootv1p2.xsd`, `imsmd_rootv1p2p1.xsd`, `ims_xml.xsd` (copied from `scorm/xsd/`; 1EdTech requires referenced XSDs at the package root).
- `index.html` and `assets/`.

Manifest (single SCO):
```xml
<manifest identifier="orgocraft" version="1"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG">
    <organization identifier="ORG"><title>OrgoCraft: Organic Chemistry I</title>
      <item identifier="item_1" identifierref="res_1"><title>OrgoCraft</title>
        <adlcp:masteryscore>70</adlcp:masteryscore></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res_1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/> <!-- + one <file> per dist asset -->
    </resource>
  </resources>
</manifest>
```
`masteryscore` is read from `orgocraft.config.json` (`passMark`, default 70) so the instructor's pass mark is in one place.

Instructor steps: Content → module → Upload/Create → **New SCORM/xAPI Object** → upload the zip → answer **Yes** to "create a grade item", Grade Calculation Method = **Highest Attempt**, Course Package Player Options = **Open player in new window** → Save. Then Grades → Manage Grades → set the item to 100 points. Do **not** import through Course Admin → Import/Export/Copy Components (legacy player: latest-attempt grading only, complete-on-visit, no Data Hub). Test with a real test-student account, not "View as Learner" (resume is not exercised for instructors).

### 2.4 Iframe constraints and layout
- Framing detection: `const framed = window.self !== window.top`. Same-origin parent detection: `let sameOriginParent = false; try { sameOriginParent = !!window.parent.document; } catch {}`. Auto-sized D2L viewer detection: `sameOriginParent && window.frameElement?.classList.contains('d2l-iframe-fit-user-content')`.
- **Stage sizing** (`#stage`):
  - Framed → `height: 100vh` (inside a frame, `100vh` is the iframe's own height, which is the only safe choice for a fixed-height cross-origin frame such as SCORM embedded mode served from the Content Service). Add `min-height: 480px` **only** when the frame is the same-origin auto-sized D2L viewer (it grows the iframe to the document height; the default is 580 px, `overflow-y: hidden`).
  - Top-level (SCORM new window, "Open in new tab", standalone) → `height: 100dvh`.
  - Fullscreen (`document.fullscreenElement`) → stage fills the fullscreen element.
  - `html, body { margin:0; overflow:hidden }`. The renderer resizes from a `ResizeObserver` on `#stage`, debounced to one resize per animation frame, never from `window.innerHeight`. `aspect-ratio` is never used for the stage.
  - HUD panels collapse to icons below 640 px stage height so the hotbar and challenge panel stay visible at 480 px.
- **Toolbar** (DOM, top of stage): "Fullscreen" (calls `stage.requestFullscreen()` inside the click handler; hidden if `!document.fullscreenEnabled`), "Open in new tab" (`<a href=location.href target=_blank rel=noopener>`; **standalone mode only** — in LMS mode a new tab cannot reach the SCORM API, so it is hidden and Fullscreen is offered instead), "Help", "Settings", mode badge, "Save & Exit" (LMS mode).
- **Pointer lock**: attempted only on canvas click (transient activation), see 3.3. Failure (promise rejection, `pointerlockerror`, or `document.pointerLockElement !== canvas` 150 ms later) switches to drag-look silently and shows the hint "Drag to look". After Esc, never auto-relock; wait for the next click.
- **Keyboard focus**: `<canvas tabindex="0" aria-label="OrgoCraft 3D world. Press H for controls, Escape to open the menu, Tab to leave the world.">`. `pointerdown` → `canvas.focus()`. Key handlers are on `window` but act **only when `document.activeElement === canvas` or pointer lock is held**; in that state `preventDefault()` for Space, Arrow keys, PageUp/Down, Home/End and bound letter/digit keys. Never for Tab, Escape, F-keys, or when a DOM input/dialog has focus. The key set is cleared on canvas `blur`, window `blur` and `visibilitychange` (no stuck movement after clicking the D2L chrome).
- `<title>OrgoCraft</title>` is set (D2L reads it). No `http://` subresources exist.

### 2.5 Score model (`src/lms/Progress.ts`, pure)
- Each challenge has `points` (easy 1, medium 2, hard 4) and a `track` (`orgo1` | `orgo2`). A challenge is **enabled** iff its track is enabled in `orgocraft.config.json` (`tracks: { orgo1: true, orgo2: false }`) and its id is not in `disabledChallenges`.
- `totalPoints = Σ points over enabled challenges`. With the defaults (Organic I track only) **totalPoints = 41**; with the extension pack enabled it is 49. These numbers are never written as literals in code or tests: `challenges.test.ts` computes them from `challenges.json` + config and this document is checked against that test.
- `raw = Math.round(100 * earnedPoints / totalPoints)`, integer 0–100.
- Monotonic within an attempt: `reportedRaw = max(reportedRaw, raw)`; a challenge earns points once; re-submitting a solved challenge is allowed (feedback) but never changes the score.
- `lesson_status`: `incomplete` until `raw >= passMark`, then `passed`. We write these ourselves and do not rely on the LMS applying `masteryscore`. **`failed` is never written** (there is no natural "final" moment in a free-navigation game, and Highest Attempt grading makes it meaningless); only `incomplete`/`passed` ever appear.
- `score.raw` is **never written while it is 0** (a student who merely opens the game must not get a 0 recorded under First/Last Attempt calculation).
- `attempted` (a challenge has been submitted at least once) is tracked for the progress UI and stored in `suspend_data`; it does not affect the score.

### 2.6 `ScormAdapter` (`src/lms/`)
Discovery (`scorm-api.ts`):
```ts
function findApi(start: Window): ScormApi12 | null {
  let win: Window | null = start;
  for (let i = 0; i < 10 && win; i++) {
    try { if ((win as any).API) return (win as any).API; } catch { break; } // cross-origin: stop
    let parent: Window | null = null;
    try { parent = win.parent; } catch { break; }
    if (!parent || parent === win) break;
    win = parent;
  }
  return null;
}
export function discover(): ScormApi12 | null {
  let api = findApi(window);
  try { if (!api && window.opener) api = findApi(window.opener); } catch {}
  try { if (!api && window.top && window.top.opener) api = findApi(window.top.opener); } catch {}
  return api;
}
```
Every cross-window access is in try/catch (the Content Service serves content from a different origin than the LMS host; a `SecurityError` ends the walk instead of crashing). `document.domain` is never touched. Discovery is retried every 250 ms for 2 s; if nothing is found the adapter enters **standalone mode**.

LMS-mode call sequence:
1. **Load**: `LMSInitialize("")`; read `cmi.core.student_id`, `cmi.core.lesson_mode`, `cmi.core.lesson_status`, `cmi.core.entry`, `cmi.suspend_data`, `cmi.core.lesson_location`; write `cmi.core.score.min="0"`, `cmi.core.score.max="100"`; if status is `not attempted` write `lesson_status="incomplete"`; `LMSCommit("")`. If `lesson_mode` is `review` or `browse`, the badge reads "Review mode — score not recorded" and score writes are skipped.
2. **Resume**: if `suspend_data` is non-empty, decode it into state. If it is empty, consult the **learner-keyed** localStorage mirror (below); if a mirror exists for the same `student_id`, show a confirmation dialog "Progress from an earlier session on this device was found (N solved). Restore it?" — Yes restores the bitmask into UI state only. **No score is committed on restore**; `score.raw` is next written when the student earns a milestone (computed from the union of solved challenges).
3. **Milestone** (every challenge acceptance): write `cmi.core.score.raw` (only if > 0), `cmi.core.lesson_location` (current challenge id), `cmi.suspend_data`, `lesson_status` per 2.5; `LMSCommit("")`. Non-milestone commits (current-challenge change) are throttled to one per 30 s.
4. `visibilitychange` → hidden: `LMSCommit("")`.
5. **Exit** (`pagehide` and the "Save & Exit" button): write `cmi.core.exit` = `"suspend"` unless every enabled challenge is solved, in which case `""` (normal exit). **Never `logout`** (it ends the attempt and some players log the learner out). `lesson_status="passed"` with `exit="suspend"` is a valid 1.2 combination and D2L resumes it. Then `LMSCommit("")`, `LMSFinish("")` exactly once (guarded by a `finished` flag). `beforeunload` is not used. After Save & Exit the game shows a full-stage overlay "Progress saved — use the player's Exit (or close) button to leave". `window.close()` is **not** called (inside the D2L new-window player the SCO is an iframe of the popup and `window.opener` is null; `top.close()` would close the player before its own finish). The only exception: `top.close()` when `window.top` is same-origin and `window.top.opener` exists (script-opened, same origin), which never happens on D2L today.
6. Any call returning `"false"` logs `LMSGetLastError()` + `LMSGetErrorString()` to the console; play is never blocked.

`suspend_data` codec (`Progress.ts`): `v1|<solved hex>|<attempted hex>|<reportedRaw>|<currentChallengeId>` where both bitmasks index the roster order (bit 0 = C01 … bit 21 = C22, bits 22–24 = X01–X03), e.g. `v1|1f|3f|17|C06`. All-solved encodes in < 40 chars (unit-tested; hard limit 4096 in SCORM 1.2).

**localStorage mirror (learner-keyed)**: in LMS mode the same string is mirrored to `localStorage['orgocraft.v1.progress.' + sanitize(student_id)]` (sanitize = `[^A-Za-z0-9_-]` → `_`, max 64 chars); if `student_id` is empty the mirror is disabled. In standalone mode the key is `orgocraft.v1.progress.local`. A mirror is only ever read when its key matches the current learner, so a shared lab computer never restores student A's progress for student B. All localStorage access is wrapped in try/catch (private windows, blocked storage); the game runs with in-memory state if it throws.

Standalone mode: identical game logic; `Progress` persists to the local key only; badge "Progress saved on this device — not connected to the gradebook".

---

## 3. Core loop and controls

### 3.1 Loop
1. **Explore** a small world (128×32×128) with a flat "lab pad" at the centre and ore outcrops around it.
2. **Mine** element ore blocks (C, N, O, S, F, Cl, Br, I) — each yields 3 atoms into the inventory. Breaking a placed atom block returns it to inventory. Stone/dirt/grass are breakable (to reach ore) but not placeable. **Scaffold** (glass, hotbar slot 0, unlimited) is placeable and breakable, never bonds, and lets students build above the floor (needed for chord-free rings, 4.5).
3. **Place** atoms from the hotbar onto any block face. A placed atom automatically forms a **single bond to every face-adjacent atom block**. If that would exceed the valence of the new atom or any neighbour, the placement is **refused** with a flash and the message "Carbon can only make 4 bonds here (would make 5)". If the new atom bonds to ≥ 3 atoms of one existing molecule, placement is allowed but the panel warns "Carbon bonded to three ring atoms — this closes a cage, not a substituent".
4. **Bond wand** (hotbar slot 9): point at a bond and press Place to cycle order 1→2→3→1. Raising order is refused (flash + message) if either atom would exceed valence; wrapping from 3 to 1 is always allowed.
5. **Implicit hydrogens** auto-fill every atom to its valence and are rendered as small white studs on the atom cube (6.6) and as counts in the molecule panel.
6. **Analyze** (F): the molecule under the crosshair is named (library lookup), its groups listed, hybridization per atom shown, the most acidic hydrogen marked, warnings shown, and the summary announced in the ARIA live region.
7. **Challenges**: the challenge panel shows the current challenge; **Submit** (Enter or the panel button) evaluates the targeted molecule (or, for set challenges, every molecule on the pad; for `acidicH`, the targeted atom; for `quiz`, the chosen option) and accepts/rejects with specific feedback (e.g. "Formula matches C4H10O but this is 2-butanol, not a tertiary alcohol: the carbon bearing OH has 1 H"). Accepted challenges add points and commit the score.

**Targeted molecule rule**: the connected component containing the atom block under the crosshair (DDA hit, ≤ 6 blocks); if none, the component nearest the player within 8 blocks; if none, "No molecule targeted".

**Lab pad membership** (set challenges): a component is *on the pad* iff **every** atom has `x ∈ [52,76)`, `z ∈ [52,76)` and `y ≥ 9` (above the LabTile floor at y = 8). Components partly outside are ignored with a warning "Part of a molecule is off the pad".

### 3.2 Keys and mouse (defaults; remappable in Settings)
| Action | Primary | Keyboard-only alternative |
|---|---|---|
| Move | W A S D | same |
| Jump | Space | same |
| Sprint | Shift (hold) | same |
| Look | Mouse (pointer lock) or drag | Arrow keys: ←/→ yaw 2.5 rad/s, ↑/↓ pitch 1.5 rad/s (rate in Settings) |
| Mine / remove block | Left mouse button | Q |
| Place atom / scaffold / cycle bond (wand) | Right mouse button | E |
| Hotbar slot | 1–9, 0 (scaffold) | same; `[` `]` also cycle |
| Hotbar cycle | Mouse wheel | `[` `]` |
| Analyze targeted molecule | F | F |
| Submit for current challenge | Enter | Enter |
| Next / previous challenge | . and , | same |
| Toggle help overlay | H | H |
| Pause menu / release pointer | Esc | Esc |
| Debug overlay | F3 | F3 |
| Leave the game canvas | Tab | Tab (documented on-screen; WCAG 2.1.2) |

All single-letter shortcuts are active only while the canvas has focus (WCAG 2.1.4). `KeyboardEvent.code` is used (layout independent). `contextmenu` is prevented on the canvas; the wheel listener is `{ passive: false }` with `preventDefault`.

### 3.3 Look modes (`src/input/look-modes.ts`)
One `FirstPersonCamera` (yaw/pitch, `camera.rotation.order = 'YXZ'`, pitch clamped ±89°) is fed by three sources; three's `PointerLockControls` is **not** used (it swallows the `requestPointerLock` rejection).
- **locked**: on canvas click, `await canvas.requestPointerLock({ unadjustedMovement: true })`, on rejection retry without options, on rejection → drag mode. `mousemove.movementX/Y × sensitivity (default 0.002 rad/px)`. `pointerlockchange`/`pointerlockerror` are ground truth. Esc releases (browser default) and opens the pause menu.
- **drag**: `pointerdown` (button 0) → `setPointerCapture`; `pointermove` deltas rotate; `pointerup` within 250 ms and < 5 px movement counts as **Mine**; button 2 = Place. Touch: one-finger drag = look, tap = mine, long-press (500 ms) = place, plus on-screen buttons (move D-pad, Jump, Mine, Place) shown when `pointer: coarse`.
- **keys**: arrow keys (always active as an additional source, so the game is playable with the keyboard alone even when pointer lock is refused in a sandboxed iframe).

Settings: sensitivity slider (0.0005–0.006), invert Y, keyboard turn rate, reduced motion (also read from `prefers-reduced-motion`).

---

## 4. Chemistry model (`src/chem/`, pure TypeScript, no DOM/three imports)

### 4.1 Data structures
```ts
export type Element = 'C' | 'H' | 'N' | 'O' | 'F' | 'Cl' | 'Br' | 'I' | 'S' | 'P';
export type BondOrder = 1 | 2 | 3;

export interface Atom {
  id: number;                 // index in MoleculeGraph.atoms
  el: Element;
  charge: 0;                  // v1: always 0; typed for v2
  explicitH: number | null;   // from bracket atoms in SMILES ([nH]); null = compute
  aromatic: boolean;          // set by aromaticity perception (4.6)
  pos?: readonly [number, number, number]; // grid cell for world-derived graphs (v2 stereo)
}
export interface Bond {
  a: number; b: number;       // atom ids, a < b
  order: BondOrder;           // Kekulé order; kept even when aromatic
  aromatic: boolean;
}
export interface MoleculeGraph { atoms: Atom[]; bonds: Bond[]; adj: number[][]; /* adj[atomId] = bond indices */ }

export type Hybrid = 'sp' | 'sp2' | 'sp3';
export interface Analysis {
  formula: string;            // Hill order, e.g. C4H9Br
  counts: Record<Element, number>;
  hydrogens: number[];        // implicit H per atom
  hybrid: Hybrid[];           // per atom (4.9)
  geometry: string[];         // 'tetrahedral 109.5°' | 'trigonal planar 120°' | 'linear 180°' | 'bent' | 'trigonal pyramidal'
  dou: number;                // degrees of unsaturation
  ringCount: number;          // bonds - atoms + components
  groups: GroupHit[];         // functional groups (4.8)
  acidity: AcidSite[];        // H-bearing atoms with pKa class (4.10), sorted ascending
  warnings: Warning[];        // over-valence, cage, off-pad
  name: string | null;        // library lookup (4.11)
  hash: string;               // WL hash (4.7)
}
```

### 4.2 Valence table (`valence.ts`)
| Element | Allowed valence (v1) | Notes |
|---|---|---|
| C | 4 | |
| H | 1 | parser only; not a block |
| N | 3 | |
| O | 2 | |
| S | 2 | `advancedSulfur` flag adds {4,6} — off in v1 |
| P | 3 | parser only; {5} behind the flag |
| F, Cl, Br, I | 1 | |
`maxValence(el)` = largest allowed; `nextValence(el, n)` = smallest allowed ≥ n, or `null` if n exceeds all.

### 4.3 Implicit hydrogen computation (`hydrogens.ts`)
For each atom: `s = sum of Kekulé bond orders on the atom`. If `explicitH !== null` → H = explicitH. Else `v = nextValence(el, s)`; if `v === null` → H = 0 and emit `Warning{ kind:'over-valence', atom, have:s, max:maxValence }`; else H = v − s. This is the OpenSMILES rule and RDKit's neutral-atom behaviour. Always computed on Kekulé orders, before aromaticity perception.

### 4.4 Molecule extraction from the voxel grid (`extract.ts`, `world/molecule-index.ts`)
- **Two authoritative stores, one owner.** The Uint8 block grid owns *which cells are atoms and of which element*; `MoleculeIndex.bonds` owns *bond orders*. Bond existence is derived (a bond exists iff two atom cells are face-adjacent, |dx|+|dy|+|dz| = 1) but bond **order** exists only in the index. Any "rebuild index from grid" path (WebGL context restore, tests, world load) must call `index.rebuildFromWorld(world, previousOrders)` which re-derives adjacency and then re-applies every surviving pair's order from `previousOrders`; orders of pairs that no longer exist are dropped. `molecule-index.test.ts` asserts a double bond survives a rebuild.
- `MoleculeIndex`: `atoms: Map<CellKey, {key, el, x, y, z}>`; `bonds: Map<PairKey, BondOrder>`. `CellKey = x | (z << 7) | (y << 14)`; `PairKey = min * 2^21 + max` (numbers stay < 2^42, exact in doubles).
- `setBlock` maintains the index incrementally: placing an atom adds bonds (order 1) to all face-adjacent atoms; removing an atom deletes its bonds; the bond wand rewrites `bonds.set(pair, order)`.
- `canPlaceAtom(cell, el)` returns `{ ok, reason, cageWarning }`: refuses if the new atom or any neighbour would exceed `maxValence`; sets `cageWarning` when the new atom is adjacent to ≥ 3 atoms of one component (ring count would jump by ≥ 2).
- `extractMolecules(index): MoleculeGraph[]` = connected components by BFS over the bond map; atom ids are assigned in BFS order from the lowest CellKey so extraction is deterministic; `pos` is filled. `componentOf(cellKey)` returns the graph containing that cell. `componentsOnPad()` applies the pad rule of 3.1.

### 4.5 Grid geometry facts the content depends on
- Face adjacency on a cubic lattice is bipartite (parity of x+y+z flips each step), so **all rings have even length**: 4-rings (unit square) and 6-rings are buildable; 3-, 5-, 7-rings are not.
- A target is buildable under auto-bonding iff it is an **induced subgraph of the cubic lattice**: an embedding where every bonded pair is face-adjacent and **no non-bonded pair is face-adjacent**. Even rings are necessary, not sufficient. `test/content/buildable.test.ts` (9.1) proves this for every library entry and every exact/set target, so future content cannot silently become unbuildable.
- The only chord-free 6-ring is the cube-vertex hexagon `(0,0,0)-(1,0,0)-(1,1,0)-(1,1,1)-(0,1,1)-(0,0,1)` (geometrically the chair). A planar 2×3 hexagon auto-bonds a chord; the sixth placement is refused only if valence is exceeded, otherwise it silently makes a bicyclic — the panel's ring count and the cage warning make this visible.
- The two remaining cube vertices `(0,1,0)` and `(1,0,1)` each touch **three** ring atoms. Placing a carbon (or nitrogen) there is **legal**: in cyclohexane each ring carbon goes from 2 to 3 bonds and the new carbon has 3 (all ≤ 4), producing a tri-bridged cage (ring count 3). Only O and halogens are refused there by valence. The placement therefore triggers the cage warning ("Carbon bonded to three ring atoms — this closes a cage, not a substituent") rather than a refusal.
- Free faces: in mid-air each ring atom has exactly three free faces. **On the lab pad floor** the three y = 9 ring atoms have their −y face blocked by unbreakable LabTile, leaving two, so the Help overlay tells students to build rings **one block above the floor** on scaffold (place scaffold, build the ring from y = 10, remove the scaffold). The ring diagram in Help shows this.
- Substituents on a ring occupy a free face; ortho-disubstituted rings (extension pack, aspirin) need both substituents' branches to avoid touching — the embedder test proves aspirin fits and the Help "Rings" page shows the layout.

### 4.6 SMILES subset parser and aromaticity (`smiles.ts`, `kekulize.ts`, `aromatic.ts`)
Parser (OpenSMILES subset), left-to-right scan:
- Atoms: organic subset `B C N O P S F Cl Br I`, aromatic `b c n o s p`, bracket atoms `[isotope? symbol chiral? Hn? charge? :class?]` — explicit H count is honoured; isotope, chirality (`@`, `@@`) and class are ignored; a non-zero charge is a parse error in v1.
- Bonds `- = # :` (`/` and `\` treated as single); no bond symbol between aromatic atoms = aromatic bond, otherwise single.
- Branches: push previous atom on `(`, pop on `)`. Ring closures: digit or `%dd` after an atom opens if unseen, closes if open (bond = explicit symbol from either end; if both given they must agree; else aromatic if both atoms aromatic, else single); numbers are reusable; unmatched closure at end = error. `.` resets the previous atom (multiple components allowed for set challenges).
- Kekulization (`kekulize.ts`): atoms that need one double bond = aromatic C with (explicit-order sum + aromatic-bond count + explicitH) < 4, and aromatic N with degree 2 and no explicit H; aromatic O/S and `[nH]` need none. Perfect matching over needy atoms using only aromatic bonds by backtracking DFS (molecules ≤ 60 atoms). Matched bonds get order 2, other aromatic bonds order 1; atoms/bonds keep `aromatic = true`. Failure = parse error ("cannot kekulize").
- Aromaticity perception (`aromatic.ts`), applied identically to library targets and student graphs, on the Kekulé graph:
  1. Enumerate simple 6-cycles (DFS from each atom, depth ≤ 6).
  2. A 6-cycle is a *candidate* if every atom is C or N and has exactly one double bond (to any partner) and no triple bond.
  3. A candidate is *aromatic* if each atom's double-bond partner lies in this cycle or in another candidate that shares a bond with it (handles both Kekulé forms of naphthalene; rejects quinones and exocyclic methylenes).
  4. For each aromatic cycle set `aromatic = true` on its atoms and on all bonds between its atoms. Kekulé orders are retained for H counting and DoU.
  This makes the two Kekulé forms of o-xylene and aspirin hash identically while distinguishing benzene from 1,3-cyclohexadiene and 1,3,5-hexatriene. It is on the graded path only for the extension pack; it is always used for library naming.

### 4.7 Canonicalization / isomorphism (`wlhash.ts`, `isomorphism.ts`, `compare.ts`)
Chosen algorithm: **Weisfeiler–Lehman hash as a fast filter, VF2-style backtracking as the arbiter**. No canonical SMILES generator.
- Atom label `L0(v) = el + '/' + H + '/' + charge + '/' + (aromatic ? 'a' : 'k')`; bond label = `'ar'` if aromatic else order.
- WL: `L_i(v) = hash(L_{i-1}(v) + '|' + sorted list of (bondLabel + ':' + L_{i-1}(u)))`; iterate until the number of distinct labels stops growing or 2·|V| rounds; final `hash = hash(sorted multiset of labels)`. `hash` = FNV-1a 64-bit over the string, rendered as hex. The stable partition is exposed as `symmetryClasses` (HUD "unique carbon environments").
- Quick reject before WL: element histogram, formula, bond-label multiset.
- VF2 confirm (`isIsomorphic(g1, g2)`): order g2's atoms by BFS from its highest-degree atom; map depth-first; candidate images of atom u = intersection over already-mapped neighbours w of u of {unmapped neighbours of map(w)} (all unmapped atoms if u has no mapped neighbour); feasibility = equal L0 label, equal degree, and for every mapped neighbour w of u, bondLabel(u,w) = bondLabel(map(u),map(w)) and no extra bonds among mapped images; backtrack; success when all atoms are mapped. Capped at 200 000 states (returns `false` with a warning).
- `sameMolecule(a, b)` = quickReject ∧ hashEqual ∧ isIsomorphic. Both sides go through: Kekulé graph → implicit H → aromaticity perception → labels.

### 4.8 Functional-group detection (`groups.ts`)
TypeScript graph predicates over the perceived graph (no SMARTS engine; the SMARTS document intent and are the RDKit test oracle). Notation: `X` = total degree incl. H, `H` = implicit H, `deg` = heavy-atom degree, `sp3C` = non-aromatic C with no double/triple bonds, `carbonylC` = C with a double bond to O. Rules run in the order listed; atoms "claimed" by an earlier rule are excluded where noted:

| # | Group | Rule (plain words) | SMARTS oracle | Excludes / notes |
|---|---|---|---|---|
| 1 | carboxylic acid | carbonylC bonded to O with H=1 | `[CX3](=O)[OX2H1]` | claims its OH oxygen |
| 2 | acid anhydride | carbonylC–O–carbonylC | `[CX3](=O)[OX2][CX3](=O)` | claims the bridging O |
| 3 | acyl halide | carbonylC bonded to F/Cl/Br/I | `[CX3](=O)[F,Cl,Br,I]` | claims the halogen |
| 4 | urea / carbamate | carbonylC whose two other neighbours are both N, or one N and one O(–C) | `[NX3][CX3](=O)[NX3]`, `[NX3][CX3](=O)[OX2][#6]` | claims the N atoms (and the O); runs before ester/amide |
| 5 | ester | carbonylC (other substituent C or H) bonded to O whose other neighbour is a non-carbonyl C | `[CX3;$(C[#6]),$([CH1])](=O)[OX2][#6;!$(C=O)]` | claims the ester O; anhydrides/carbonates/carbamates excluded |
| 6 | amide | carbonylC (other substituent C or H) bonded to non-aromatic N with 3 bonds | `[CX3;$(C[#6]),$([CH1])](=O)[NX3]` | claims the N; ureas excluded by 4 |
| 7 | aldehyde | carbonylC with H=1 and one C neighbour; formaldehyde: carbonylC with H=2 | `[CX3H1](=O)[#6]`, `[CX3H2]=O` | acids/formates/DMF excluded (carbonylC has an O or N neighbour) |
| 8 | ketone | carbonylC bonded to two carbons | `[#6][CX3](=O)[#6]` | |
| 9 | phenol | O with H=1 bonded to aromatic C | `[OX2H]c` | extension pack only |
| 10 | enol | O with H=1 bonded to a non-aromatic C that has a C=C double bond | `[OX2H][CX3]=[CX3]` | reported with a hint "enols tautomerize to carbonyls" |
| 11 | alcohol (methanol/1°/2°/3°) | O with H=1 bonded to sp3C; class by that carbon's carbon-neighbour count 0/1/2/3 | `[OX2H][CX4;H3]`, `[CX4;H2]`, `[CX4;H1]`, `[CX4;H0]` | acids (1), phenols (9), enols (10) never match |
| 12 | ether | O with deg 2, both neighbours carbon, neither a carbonylC | `[OD2]([#6;!$(C=O)])[#6;!$(C=O)]` | O claimed by 2/4/5 excluded; cyclic ethers included |
| 13 | aryl amine (1°/2°/3°) | non-aromatic N, X=3, bonded to ≥ 1 aromatic C and not to carbonylC; class by H 2/1/0 | `[NX3;!$(N-C=O)]c` | extension pack only; claims the N |
| 14 | amine (1°/2°/3°) | non-aromatic N, X=3, not bonded to carbonylC or aromatic C; class by H count 2/1/0 | `[NX3;!$(N-C=O);!$(N-[a])]` | amide N (6), urea N (4), aryl amine (13) excluded; aromatic `n` never matches |
| 15 | nitrile | C with a triple bond to N (N degree 1) | `[CX2]#[NX1]` | |
| 16 | halomethane | sp3 C with no carbon neighbours and ≥ 2 halogens | `[CX4;!$(C[#6])]([F,Cl,Br,I])[F,Cl,Br,I]` | CH2Cl2, CHCl3, CCl4; claims its halogens |
| 17 | alkyl halide (methyl/1°/2°/3°) | halogen bonded to sp3C; class by that carbon's carbon-neighbour count 0/1/2/3 | `[CX4][F,Cl,Br,I]` | halogens claimed by 3/16 excluded |
| 18 | aryl halide | halogen bonded to aromatic C | `c[F,Cl,Br,I]` | extension pack only |
| 19 | thiol | S with H=1 bonded to C | `[SX2H1][#6]` | |
| 20 | sulfide | S with deg 2, both neighbours carbon | `[SX2]([#6])[#6]` | |
| 21 | alkene | double bond between two non-aromatic carbons, any degree; a carbon carrying two double bonds marks the hit "alkene (cumulated)" | `[#6;X3,X2;!a]=[#6;X3,X2;!a]` | covers allenes (1,2-butadiene reports two alkene hits, one cumulated pair); aromatic Kekulé C=C excluded by perception |
| 22 | alkyne | triple bond between two carbons | `[CX2]#[CX2]` | |
| 23 | arene | each perceived aromatic 6-ring | `a1aaaaa1` | extension pack only |
| 24 | alkane / cycloalkane | no other group and no multiple bonds; `cycloalkane` if ringCount > 0 | — | only when 1–23 are empty |
Groups are a **set**: aspirin reports acid + ester + arene. `groups.test.ts` runs the 40-molecule probe set plus 1,2-butadiene, urea, methyl carbamate, N-methylaniline, vinyl alcohol, CH2Cl2 and CHCl3 against the SMARTS oracle output recorded at authoring time.

### 4.9 Formula, degrees of unsaturation, hybridization (`formula.ts`, `hybrid.ts`)
- Counts include implicit H. Hill order: `C`, then `H`, then remaining elements alphabetically (`Br, Cl, F, I, N, O, P, S`); if no carbon, all alphabetical. Subscripts as plain digits in data (`C4H9Br`), rendered with `<sub>` in the panel.
- `DoU = (2C + 2 + N − H − X) / 2` with X = F+Cl+Br+I; O, S ignored. Equals rings + π bonds counted on the Kekulé graph (double = 1, triple = 2); the panel shows both the number and the decomposition ("2 = 1 ring + 1 π bond"). `ringCount = bonds − atoms + components`. Verified for the whole library at authoring time (RDKit).
- **Hybridization** (McMurry ch. 1): `σ = heavy-atom degree + H + lonePairs(el)` with lone pairs C 0, N 1, O 2, S 2, halogen 3; `sp3` if σ = 4, `sp2` if σ = 3, `sp` if σ = 2. Conjugation override: N or O bonded to a carbonylC or an aromatic C is `sp2` (amide N, ester O, aniline N). Geometry label from σ and H-less partner count: C sp3 tetrahedral 109.5°, sp2 trigonal planar 120°, sp linear 180°; N sp3 trigonal pyramidal ~107°; O sp3 bent ~105°. Matches RDKit hybridization for every library entry except the documented conjugation cases (propyne: sp3, sp, sp — used by C05).

### 4.10 Acidity rule engine (`acidity.ts`, McMurry ch. 2)
Every atom with H ≥ 1 is an *H site* classified by the first matching rule; pKa values are McMurry Table 2.3 approximations stored in `src/content/acidity.json` so the instructor can edit them:

| order | site class | rule | pKa |
|---|---|---|---|
| 1 | carboxylic acid O–H | O(H) bonded to carbonylC | 5 |
| 2 | phenol O–H | O(H) bonded to aromatic C | 10 |
| 3 | thiol S–H | S(H) | 10.5 |
| 4 | alcohol O–H | O(H) bonded to sp3C | 16 |
| 5 | amide N–H | N(H) bonded to carbonylC | 17 |
| 6 | α C–H of aldehyde/ketone | sp3 C(H) bonded to a carbonylC that is an aldehyde or ketone | 20 |
| 7 | terminal alkyne C–H | C(H) with a triple bond to C | 25 |
| 8 | α C–H of ester/nitrile | sp3 C(H) bonded to ester carbonylC or nitrile C | 25 |
| 9 | amine N–H | N(H) not covered above | 36 |
| 10 | alkene C–H | non-aromatic sp2 C(H) | 44 |
| 11 | aromatic C–H | aromatic C(H) | 43 |
| 12 | alkane C–H | any other C(H) | 50 |
`mostAcidic(analysis)` = all sites in the lowest-pKa class (ties accepted). The molecule panel marks them with "most acidic H"; challenge type `acidicH` (5.1) grades the student's targeted atom against this set with feedback such as "The O–H of a carboxylic acid (pKa ≈ 5) is far more acidic than the C–H you picked (pKa ≈ 50)".

### 4.11 Naming strategy (`naming.ts`, `content/library.ts`)
Library lookup only: at load, every library entry is parsed → perceived → hashed into `Map<hash, Entry[]>`. `nameOf(graph)` = entries with equal hash filtered by `isIsomorphic`; return `entry.name` or `null`. The panel shows "Unnamed — C5H12O (not in library)" for unknowns, still with formula/groups. No IUPAC generator in v1.

---

## 5. Content

### 5.1 Challenge roster (`src/content/challenges.json`)
Acceptance types (`src/content/challenges.ts`):
- `exact { smiles }` — `sameMolecule(target, targeted)` after H fill, aromaticity perception, stereo stripped.
- `predicate { formula?, carbons?, ringCount?, ringSizes?: number[], groups?: GroupName[], notIsomorphicTo?: smiles[] }` — all clauses must hold on the targeted molecule. Every predicate in the roster is **closed**: its accepted set is enumerated in `challenges.test.ts` and listed below.
- `set { smiles: string[] }` — the components on the lab pad (3.1 rule) must be exactly the target multiset: every target present once, nothing else. Feedback names the offender: "Missing: 2,2-dimethylbutane", "Extra molecule on the pad: ethanol — remove it (Esc → Clear pad returns its atoms)", "Stray atom on the pad: O". Duplicate isomers: "You built 2-methylpentane twice".
- `acidicH { smiles }` — the targeted molecule must be isomorphic to `smiles` **and** the atom under the crosshair (H ≥ 1) must be in `mostAcidic(...)`. Submitting without an atom under the crosshair says "Point at the atom that carries the most acidic hydrogen, then press Enter".
- `quiz { requires?: smiles, question, options: string[], answer: number }` — the challenge panel shows radio buttons; if `requires` is set, a molecule isomorphic to it must be targeted or on the pad when Submit is pressed.

Points: easy 1, medium 2, hard 4. **Organic I track (default): 22 challenges, totalPoints = 41. With the extension pack: 25 challenges, 49.** `challenges.test.ts` asserts these from the JSON and config; the progress bar text uses the computed value. McMurry (OpenStax) chapters cited; Klein/Wade: bonding & hybridization Klein 1/Wade 1, acids Klein 3/Wade 2, alkanes & isomers Klein 4/Wade 3, functional groups Klein 2/Wade 2, alkenes Klein 8/Wade 7–8, alkynes Klein 9/Wade 9, halides & substitution Klein 7/Wade 6, aromatics Klein 17/Wade 16. Chapter 2 challenges (C14–C15) come after chapter 3 in play order because they need the bond wand and O ore.

| id | track | title | instruction (shown to student) | acceptance | pts | learning objective |
|---|---|---|---|---|---|---|
| C01 | orgo1 | One block, four hydrogens | Mine a carbon ore block (dark, labeled C) near the pad and place a single carbon block on the pad. Watch the panel fill in the hydrogens. Submit it. | exact `C` | 1 | Carbon makes 4 bonds; implicit hydrogens; CH4 (McMurry 1) |
| C02 | orgo1 | Ethane | Place two carbon blocks side by side so they bond. | exact `CC` | 1 | σ bond, sp3 carbons, C2H6 (McMurry 1) |
| C03 | orgo1 | Double bond | Build ethene: two carbons joined by a double bond (select the bond wand, point at the bond, press Place). | exact `C=C` | 1 | π bond, sp2, C2H4 (McMurry 1, 7) |
| C04 | orgo1 | Triple bond | Build ethyne (or cycle ethene's bond to order 3). | exact `C#C` | 1 | Triple bond, sp, linear geometry (McMurry 1, 9) |
| C05 | orgo1 | Hybridization check | Build propyne (CH3–C≡CH). Then answer: how many of its carbons are sp-hybridized? | quiz `{requires:"CC#C", options:["0","1","2","3"], answer:2}` | 1 | sp/sp2/sp3 from σ-partner count (McMurry 1) |
| C06 | orgo1 | Ethanol | Build ethanol: an –OH on a two-carbon chain (C2H6O). | exact `CCO` | 1 | Oxygen valence 2; alcohol group (McMurry 3) |
| C07 | orgo1 | Same formula, different molecule | Build a molecule with formula C2H6O that is NOT ethanol. | predicate `{formula:"C2H6O", notIsomorphicTo:["CCO"]}` → {dimethyl ether} | 1 | Constitutional isomers; ether vs alcohol (McMurry 3) |
| C08 | orgo1 | Both butanes | Build every isomer of C4H10 (there are two) as separate molecules on the pad. | set `["CCCC","CC(C)C"]` | 2 | Chain branching; isomer enumeration (McMurry 3) |
| C09 | orgo1 | Three pentanes | Build all three isomers of C5H12 on the pad. | set `["CCCCC","CCC(C)C","CC(C)(C)C"]` | 2 | Isomer enumeration; neopentane (McMurry 3) |
| C10 | orgo1 | Five hexanes | Build all five isomers of C6H14 on the pad. | set `["CCCCCC","CCCC(C)C","CCC(C)CC","CCC(C)(C)C","CC(C)C(C)C"]` | 4 | Systematic isomer enumeration (McMurry 3) |
| C11 | orgo1 | Decode the name | Build 3-ethyl-2-methylhexane. | exact `CCCC(CC)C(C)C` | 2 | IUPAC parent chain and substituent decoding (McMurry 3) |
| C12 | orgo1 | Five-carbon ketone | Build a ketone with formula C5H10O. | predicate `{formula:"C5H10O", groups:["ketone"]}` → {2-pentanone, 3-pentanone, 3-methyl-2-butanone} | 2 | Ketone definition (C=O between two carbons); the four C5H10O aldehydes are rejected with "that carbonyl carbon has an H: aldehyde" (McMurry 3) |
| C13 | orgo1 | A ring instead | Build cyclohexane (C6H12). Hint: a flat hexagon will not work on this grid; build the ring on the corners of a cube one block above the floor (Help → Rings). | exact `C1CCCCC1` | 2 | DoU = 1 realized as a ring; cycloalkanes (McMurry 4) |
| C14 | orgo1 | Most acidic hydrogen I | Build propanoic acid (CH3CH2COOH). Point at the atom whose hydrogen is most acidic and press Enter. | acidicH `CCC(=O)O` → the OH oxygen | 2 | Carboxylic acid O–H (pKa ≈ 5) vs C–H (McMurry 2) |
| C15 | orgo1 | Most acidic hydrogen II | Build 1-butyne. Point at the atom whose hydrogen is most acidic and press Enter. | acidicH `CCC#C` → the terminal alkyne carbon | 2 | Terminal alkyne C–H (pKa ≈ 25) vs sp3 C–H (≈ 50); s-character (McMurry 2, 9) |
| C16 | orgo1 | Acyclic C4H8 | Build every acyclic C4H8 isomer (three; cis/trans count as one here) on the pad. | set `["CCC=C","CC=CC","CC(C)=C"]` | 2 | Alkene isomers and locants; introduces cis/trans (McMurry 7) |
| C17 | orgo1 | Markovnikov addition | Propene + HBr. Build the major product. | exact `CC(C)Br` | 2 | Markovnikov regiochemistry (McMurry 8) |
| C18 | orgo1 | Anti-Markovnikov | 1-Butene + BH3·THF, then H2O2/NaOH (hydroboration–oxidation). Build the product. | exact `CCCCO` | 2 | Anti-Markovnikov hydration; 1-butanol not 2-butanol (McMurry 8) |
| C19 | orgo1 | Unsaturation, no rings | Build any molecule with formula C4H6 and no rings. | predicate `{formula:"C4H6", ringCount:0}` → {1,3-butadiene, 1,2-butadiene, 1-butyne, 2-butyne} | 2 | DoU = 2 realized as π bonds (McMurry 7, 9) |
| C20 | orgo1 | Four bromobutanes | Build all four constitutional isomers of C4H9Br on the pad. | set `["CCCCBr","CCC(C)Br","CC(C)CBr","CC(C)(C)Br"]` | 4 | Alkyl halide isomers and 1°/2°/3° classification (McMurry 10) |
| C21 | orgo1 | SN2 product | 1-Bromopropane + NaCN in DMSO. Build the substitution product. | exact `CCCC#N` | 2 | SN2: nucleophile replaces the leaving group at the same carbon (McMurry 11) |
| C22 | orgo1 | E2 product (Zaitsev) | 2-Bromo-2-methylbutane + NaOEt, heat. Build the major alkene. | exact `CC=C(C)C` | 2 | E2, Zaitsev's rule: the more substituted alkene (2-methyl-1-butene rejected) (McMurry 11) |
| X01 | orgo2 | Benzene | Build benzene: a six-carbon cube-corner ring with alternating double bonds. | exact `c1ccccc1` | 2 | Aromatic ring, Kekulé forms (McMurry 15) — extension pack, disabled by default |
| X02 | orgo2 | Para-xylene | Build 1,4-dimethylbenzene. | exact `Cc1ccc(C)cc1` | 2 | ortho/meta/para nomenclature (McMurry 15) — extension |
| X03 | orgo2 | Aspirin | Build aspirin: a benzene ring bearing a carboxylic acid and, ortho to it, an acetate ester. | exact `CC(=O)Oc1ccccc1C(=O)O` | 4 | Multi-group recognition (acid + ester + arene) (McMurry 15, 21) — extension |

Changes relative to the research list: aligned with SCOPE.md (Organic I); aromatic challenges reduced to the disabled extension pack; C4H9Br and C6H14 sets, acidity challenges, hybridization quiz and "build the product" challenges for ch. 8/11 added; the research's C13 predicate, secondary amine, tertiary alcohol and 2-butene exact challenges dropped (subsumed by C16/C20 or Organic II); the research's stereo (R/S, E/Z) and caffeine challenges are v2; nitrobenzene is excluded everywhere (charges).

### 5.2 Molecule library (`src/content/molecules.json`)
All 60 SMILES/formula pairs below were verified with RDKit 2026.03.6 during this revision (parse, formula, pairwise non-isomorphic after stereo stripping, DoU = rings + π) and every entry was proven **induced-embeddable in the cubic lattice** by the backtracking embedder of 9.1. Odd-ring molecules (cyclopropane, oxirane, THF, caffeine, nicotine) and charged species are excluded from v1 because they cannot be built.

| name | formula | SMILES |
|---|---|---|
| methane | CH4 | `C` |
| ethane | C2H6 | `CC` |
| propane | C3H8 | `CCC` |
| butane | C4H10 | `CCCC` |
| 2-methylpropane (isobutane) | C4H10 | `CC(C)C` |
| pentane | C5H12 | `CCCCC` |
| 2-methylbutane | C5H12 | `CCC(C)C` |
| 2,2-dimethylpropane (neopentane) | C5H12 | `CC(C)(C)C` |
| hexane | C6H14 | `CCCCCC` |
| 2-methylpentane | C6H14 | `CCCC(C)C` |
| 3-methylpentane | C6H14 | `CCC(C)CC` |
| 2,2-dimethylbutane | C6H14 | `CCC(C)(C)C` |
| 2,3-dimethylbutane | C6H14 | `CC(C)C(C)C` |
| 3-ethyl-2-methylhexane | C9H20 | `CCCC(CC)C(C)C` |
| cyclobutane | C4H8 | `C1CCC1` |
| cyclohexane | C6H12 | `C1CCCCC1` |
| ethene | C2H4 | `C=C` |
| propene | C3H6 | `CC=C` |
| 1-butene | C4H8 | `CCC=C` |
| 2-butene | C4H8 | `CC=CC` |
| 2-methylpropene | C4H8 | `CC(C)=C` |
| 2-methyl-2-butene | C5H10 | `CC=C(C)C` |
| 1,3-butadiene | C4H6 | `C=CC=C` |
| 1,2-butadiene | C4H6 | `CC=C=C` |
| cyclohexene | C6H10 | `C1CCC=CC1` |
| ethyne | C2H2 | `C#C` |
| propyne | C3H4 | `CC#C` |
| 1-butyne | C4H6 | `CCC#C` |
| 2-butyne | C4H6 | `CC#CC` |
| methanol | CH4O | `CO` |
| ethanol | C2H6O | `CCO` |
| 1-propanol | C3H8O | `CCCO` |
| 2-propanol | C3H8O | `CC(C)O` |
| 1-butanol | C4H10O | `CCCCO` |
| 2-butanol | C4H10O | `CCC(C)O` |
| 2-methyl-2-propanol (tert-butanol) | C4H10O | `CC(C)(C)O` |
| dimethyl ether | C2H6O | `COC` |
| diethyl ether | C4H10O | `CCOCC` |
| formaldehyde | CH2O | `C=O` |
| acetaldehyde | C2H4O | `CC=O` |
| propanal | C3H6O | `CCC=O` |
| acetone | C3H6O | `CC(C)=O` |
| 2-pentanone | C5H10O | `CCCC(C)=O` |
| 3-pentanone | C5H10O | `CCC(=O)CC` |
| 3-methyl-2-butanone | C5H10O | `CC(C)C(C)=O` |
| formic acid | CH2O2 | `OC=O` |
| acetic acid | C2H4O2 | `CC(=O)O` |
| propanoic acid | C3H6O2 | `CCC(=O)O` |
| ethyl acetate | C4H8O2 | `CCOC(C)=O` |
| acetamide | C2H5NO | `CC(N)=O` |
| methylamine | CH5N | `CN` |
| dimethylamine | C2H7N | `CNC` |
| acetonitrile | C2H3N | `CC#N` |
| butanenitrile | C4H7N | `CCCC#N` |
| chloromethane | CH3Cl | `CCl` |
| 2-chloropropane | C3H7Cl | `CC(C)Cl` |
| bromoethane | C2H5Br | `CCBr` |
| 1-bromopropane | C3H7Br | `CCCBr` |
| 2-bromopropane | C3H7Br | `CC(C)Br` |
| 1-bromobutane | C4H9Br | `CCCCBr` |
| 2-bromobutane | C4H9Br | `CCC(C)Br` |
| 1-bromo-2-methylpropane | C4H9Br | `CC(C)CBr` |
| 2-bromo-2-methylpropane (tert-butyl bromide) | C4H9Br | `CC(C)(C)Br` |
| 2-bromo-2-methylbutane | C5H11Br | `CCC(C)(C)Br` |
| dichloromethane | CH2Cl2 | `ClCCl` |
| chloroform | CHCl3 | `ClC(Cl)Cl` |
| ethanethiol | C2H6S | `CCS` |
| benzene | C6H6 | `c1ccccc1` |
| toluene | C7H8 | `Cc1ccccc1` |
| o-xylene | C8H10 | `Cc1ccccc1C` |
| p-xylene | C8H10 | `Cc1ccc(C)cc1` |
| phenol | C6H6O | `Oc1ccccc1` |
| aspirin | C9H8O4 | `CC(=O)Oc1ccccc1C(=O)O` |

(The table has 66 rows: the ~40 core entries the brief asked for plus every member of the C5H12, C6H14, C4H8, C4H9Br and C5H10O sets so that each set challenge names what the student built.) A unit test parses every entry, asserts the formula, asserts no two differently-named entries are isomorphic, and asserts lattice embeddability.

---

## 6. Engine (`src/world/`, `src/render/`, `src/player/`)

### 6.1 World and chunks
```ts
export const CHUNK_W = 16, CHUNK_H = 32, CHUNK_D = 16;   // x, y, z
export const WORLD_CX = 8, WORLD_CZ = 8;                  // 128 x 32 x 128 cells
export const cidx = (x, y, z) => x + CHUNK_W * (z + CHUNK_D * y);   // x fastest
export class Chunk { data = new Uint8Array(16*32*16); dirty = true; mesh: Mesh | null = null; constructor(readonly cx: number, readonly cz: number) {} }
export class World {
  getBlock(x, y, z): BlockId;   // Air outside x/z bounds and y >= 32; Bedrock for y < 0
  setBlock(x, y, z, id): void;  // marks chunk dirty (+ neighbour chunk when x%16 in {0,15} or z%16 in {0,15}); updates MoleculeIndex
}
```
Lab pad: cells x ∈ [52, 76), z ∈ [52, 76), surface y = 8 (`LabTile`, edge ring `LabTileEdge`); the pad rule for challenges is 3.1. Spawn at (64, 9, 64) facing −z. Terrain generator (`worldgen.ts`, seeded value noise, seed 1337, identical for every student): bedrock y=0, stone y=1..h−3, dirt to h−1, grass at h with h ∈ [6, 13] outside the pad (pad area flattened to 7 with LabTile at 8). Ore veins: for each element, 3×3×3 blobs placed in stone within 3 cells of the surface at a density that yields ≥ 400 blocks per element world-wide; one small exposed outcrop of each element within 12 blocks of the pad so C01 needs no digging.

### 6.2 Block ids (`blocks.ts`, Uint8)
| id | name | opaque | breakable | placeable | notes |
|---|---|---|---|---|---|
| 0 | Air | no | – | – | |
| 1 | Bedrock | yes | no | no | y = 0 |
| 2 | Stone | yes | yes | no | |
| 3 | Dirt | yes | yes | no | |
| 4 | Grass | yes | yes | no | top face greener |
| 5 | Sand | yes | yes | no | |
| 6 | Scaffold (glass) | no | yes | **yes, unlimited (slot 0)** | never bonds; pad boundary posts also use it |
| 7 | LabTile | yes | no | no | pad floor |
| 8 | LabTileEdge | yes | no | no | pad border marker |
| 32–39 | Ore: C, N, O, S, F, Cl, Br, I | yes | yes → 3 atoms | no | stone colour mixed 50 % with CPK colour; HUD names it |
| 64–71 | Atom: C, N, O, S, F, Cl, Br, I | **no** (drawn separately) | yes → returns to inventory | yes (from inventory) | solid for collision |
Helpers: `isOre(id) = id >= 32 && id < 40`, `isAtom(id) = id >= 64 && id < 72`, `elementOf(id) = ELEMENTS[id & 7]` with `ELEMENTS = ['C','N','O','S','F','Cl','Br','I']`, `isOpaque(id) = id !== 0 && id !== 6 && !isAtom(id)`, `isSolid(id) = id !== 0`.

### 6.3 Meshing (`mesher.ts`, pure)
Culled ("naive") face meshing; greedy meshing is rejected (per-quad colour limits, no measurable gain at ~16k terrain blocks).
```ts
export interface MeshBuffers { pos: Float32Array; nor: Float32Array; col: Float32Array; idx: Uint32Array }
export const FACES: ReadonlyArray<{ dir: [number,number,number]; corners: [number,number,number][]; shade: number }>; // +y 1.0, -y 0.5, ±x 0.8, ±z 0.7; CCW from outside; indices [0,1,2, 0,2,3]
export function buildChunkMesh(get: (x,y,z) => BlockId, ox: number, oz: number, paletteLinear: Float32Array, out: MeshBuffers): number; // face count
```
For each non-air, non-atom cell and each of 6 directions, emit the face iff `!isOpaque(get(neighbour))` (neighbour lookups go through `World.getBlock` across chunk borders). Scaffold is meshed as a translucent face set in a second, shared `MeshLambertMaterial({ transparent:true, opacity:0.35 })` group of the same geometry. Vertex colour = `palette[id] × FACES[f].shade` (grass top uses a second palette slot). Buffers are pooled once at worst case (8192 cells × 6 faces); Uint32 indices. `applyChunkMesh` (render module): dispose old geometry, `setAttribute` position/normal/color from `.slice()` copies, `setIndex`, **`computeBoundingSphere()`**, mesh at chunk origin with `matrixAutoUpdate = false`. Scheduler rebuilds ≤ 2 dirty chunks per frame. Palette values are **linear** (`new Color(hex)` converts sRGB → linear; copy `.r .g .b`).

### 6.4 Picking (`raycast.ts`, pure)
Amanatides–Woo DDA: `raycastVoxels(ox,oy,oz, dx,dy,dz, maxDist = 6, get) → { x,y,z, nx,ny,nz, t, id } | null`. Direction unit length; `step = sign(d)`, `tDelta = |1/d|` (Infinity for 0), `tMax` = distance to first plane per axis; advance the smallest `tMax`, record the crossed axis as the normal (−step). Starting inside a solid returns normal (0,0,0) and placement is skipped. Placement cell = hit + normal; rejected if out of bounds, not air, overlapping the player AABB, or (atoms) failing `canPlaceAtom`. A `BlockHighlight` (EdgesGeometry of a 1.002 box, 3:1-contrast outline) marks the targeted cell; for the bond wand a highlight marks the targeted bond.

Bond picking: `Raycaster.setFromCamera(new Vector2(0,0), camera).intersectObject(bondPickMesh)` where `bondPickMesh` is an InstancedMesh of fatter (0.3) boxes sharing the bond instance matrices with **`mesh.visible = false`** (Raycaster does not check `visible`, so the mesh costs no draw call and no transparent sorting). `instanceId → PairKey` lookup table maintained by `BondRenderer`.

### 6.5 Player physics (`player/physics.ts`, pure)
```ts
export const PLAYER = { halfW: 0.3, height: 1.8, eye: 1.62, speed: 4.3, sprint: 6.5, jumpVel: 8.5, gravity: -28, maxFall: -40 };
export function stepPlayer(p: PlayerState, input: FrameInput, dt: number, isSolid: (x,y,z) => boolean): void;
```
Fixed 1/60 s timestep with accumulator (real dt clamped to 0.1 s). Move per axis (x, z, then y); after each axis, test every cell overlapping the AABB; on collision snap to the cell face (±1e-4), zero that velocity component, set `onGround` on a −y collision; sub-step any axis delta > 0.5 blocks. Jump only when `onGround`. Atom and scaffold cells are solid. Player cannot leave the world (x/z clamped to [0.3, 127.7]).

### 6.6 Rendering atoms, bonds and labels (`render/AtomRenderer.ts`, `BondRenderer.ts`, `element-texture.ts`)
- **Atoms**: one `InstancedMesh` per element (`BoxGeometry(0.62)`, max 1024 instances) with a runtime `CanvasTexture` per element that bakes the CPK background colour, a contrasting element symbol (~70 % of the face, bold sans) and a 6 px darker border; `texture.colorSpace = SRGBColorSpace`, mipmaps on, material colour white. Colours (`CPK_HEX`): C 0x3b3b3b (white text), N 0x2b5fe3 (white), O 0xe3242b (white), S 0xf2e21f (black), F 0x90e050 (black), Cl 0x1fd11f (black), Br 0x9e1b1b (white), I 0x940094 (white). Symbol labels satisfy WCAG 1.4.1; a legend is in Help.
- **Implicit hydrogens**: a second InstancedMesh of small white studs (`BoxGeometry(0.16)`) on free faces of the atom cube (up to 4, faces chosen deterministically by free-direction order ±x, ±z, ±y), count = implicit H. Toggle in Settings ("Show hydrogens"), default on.
- **Bonds**: one `InstancedMesh` of `BoxGeometry(0.11, 0.11, 1.0)` grey 0x9a9a9a, one instance per bar: midpoint of the two cell centres, quaternion `setFromUnitVectors(+Z, axis)`; order 2 = two bars offset ±0.13 on a perpendicular (+Y for x/z bonds, +X for y bonds), order 3 = 0, ±0.17; bar width 0.08 for orders 2–3; aromatic-perceived bonds are drawn as order 1 plus a thin dashed inner bar (visual only; Kekulé orders remain editable). Max 4096 bars.
- **Rebuild policy**: `AtomRenderer.rebuild()` / `BondRenderer.update()` run on the frame after any atom/bond change (batched), iterating `MoleculeIndex` (atoms from the grid, orders from `index.bonds`); `instanceMatrix.needsUpdate = true`, `mesh.count = n`.
- **Highlight of the targeted molecule / acid site / group atoms**: per-instance **diffuse multiplier** via `setColorAt` (`instanceColor`; it multiplies the texture colour, it is not emissive). Default (1,1,1); targeted molecule (1.35,1.35,1.0) (a warm brightening that keeps the symbol legible on every CPK colour); group-highlight and most-acidic-H atoms (1.5,1.5,0.5). After any change set **`mesh.instanceColor.needsUpdate = true`**. Because a multiplier cannot lighten pure black text, the targeted molecule additionally gets the `BlockHighlight` outline on each atom (EdgesGeometry, one LineSegments with merged edges, rebuilt with the atom mesh).

### 6.7 Lighting, camera, fog
`HemisphereLight(0xdfe9ff, 0x6b6b6b, 1.0)` + `DirectionalLight(0xffffff, 1.2)` at (0.5, 1, 0.3), no shadows. `PerspectiveCamera(70°, aspect, 0.05, 120)`; `scene.fog = new Fog(0x9fc5e8, 40, 110)`, `scene.background` = same colour. Renderer: `new WebGLRenderer({ canvas, antialias: !lowGfx, powerPreference: 'high-performance' })`, `setPixelRatio(Math.min(devicePixelRatio, lowGfx ? 1 : 1.5))`, output colour space left at SRGB default.

### 6.8 Performance knobs
- `lowGfx` decided at start: `prefers-reduced-motion`, `hardwareConcurrency <= 4`, `/CrOS/.test(userAgent)`, or unmasked renderer string containing `SwiftShader`/`llvmpipe`; after 120 frames, mean frame time > 22 ms drops pixel ratio to 1 and disables H studs. User toggle "Low graphics" persisted in `localStorage['orgocraft.v1.settings']`.
- Draw calls: ≤ 64 terrain chunks (frustum culled) + ≤ 64 scaffold groups (only chunks containing scaffold) + 8 atom meshes + 1 H mesh + 1 bond mesh + 1 outline ≈ 80 typical (pick mesh is invisible and costs nothing).
- Skip rendering when `document.hidden` or an `IntersectionObserver` reports the canvas off-screen in the LMS page.
- `webglcontextlost` → `preventDefault`, pause, show overlay; `webglcontextrestored` → mark all chunks dirty, `index.rebuildFromWorld(world, index.bonds)` (orders preserved), rebuild atom/bond meshes.
- Reduced motion: no head-bob, no FOV kick on sprint, instant HUD transitions, fades instead of flashes (nothing above 3 Hz; the "refused placement" flash is a single 300 ms fade of the highlight outline).
- `window.__orgocraft = { frames, triangles, calls, version }` updated each frame (smoke test + F3 overlay).

---

## 7. UI / HUD (`src/ui/`, DOM elements overlaid on the canvas; nothing is painted in WebGL)

Layout inside `#stage` (position: relative): canvas fills the stage; overlays are absolutely positioned with 16 px gutters and a translucent dark backing (`rgba(10,12,16,0.78)`), text `#f4f6f8` (≥ 4.5:1), UI borders `#c9d1d9` (≥ 3:1). Theme tokens on `:root`; dark and light both provided.

- **Toolbar** (top): mode badge ("Connected to course gradebook" / "Review mode — score not recorded" / "Progress saved on this device"), Fullscreen, Open in new tab (standalone only), Help (H), Settings, Save & Exit (LMS mode).
- **Crosshair** (centre): 2-colour (white with dark outline, 3:1 against any background); changes shape when the bond wand or scaffold is active. `aria-hidden`.
- **Target-block info** (below crosshair): "Carbon ore — mine for 3 C", "Oxygen atom (2 bonds, 0 H, sp3, most acidic H)", "Bond C–O, order 1 (E: cycle)", "Scaffold". Mirrored to the live region only on Analyze.
- **Hotbar** (bottom centre, `role="toolbar"`, `aria-label="Hotbar"`): 10 slots as buttons; slots 1–8 element (symbol, name in `aria-label`, count badge), slot 9 bond wand, slot 0 scaffold (∞). Selected slot has a visible ring and `aria-pressed`. Wheel/number keys select. Inventory is the hotbar.
- **Molecule panel** (right, `aria-labelledby`): name (or "Unnamed"), formula with `<sub>`, DoU with decomposition, atom count, ring count, functional groups list (each with a "highlight atoms" button), "most acidic H: O–H of carboxylic acid (pKa ≈ 5)" with a highlight button, per-atom table on expand (element, bonds, implicit H, hybridization, geometry label), warnings (`role="alert"` container: "Carbon has 5 bonds — remove one", "Carbon bonded to three ring atoms — cage", "Part of a molecule is off the pad"). Auto-updates for the targeted molecule at ≤ 4 Hz.
- **Challenge panel** (left): "Challenge 7 of 22 — Same formula, different molecule", instruction text, points, status (not started / attempted / solved ✓), quiz radio group when the challenge is a `quiz`, Submit button, Previous/Next buttons, progress bar ("Score 24 / 100 — 6 of 22 solved", denominators computed from enabled challenges), feedback text after Submit. All buttons reachable by Tab.
- **Pause menu** (Esc; `role="dialog"`, `aria-modal`, focus trapped, Esc/Resume returns focus to the canvas): Resume, Help, Settings, Remap keys, **Clear pad** (returns every atom on the pad to inventory and removes pad scaffold; confirmation "Remove 14 atoms from the pad?"), Save & Exit.
- **Restore dialog** (2.6 step 2): "Progress from an earlier session on this device was found (N solved). Restore it?" Restore / Start fresh.
- **Help overlay**: controls table (3.2), look-mode hint, "How rings work on this grid" diagram (cube-corner hexagon built on scaffold one block above the floor; the "inside corner makes a cage" note), element colour legend with symbols, pKa table, exit instructions ("Press Tab to leave the game area; Esc opens this menu and releases the mouse").
- **Settings** (persisted to localStorage): Low graphics, Show hydrogens, Reduced motion, Invert look Y, Mouse sensitivity, Keyboard turn rate, Key remapping (each action → one key; conflicts rejected), Theme (auto/dark/light).
- **Accessibility**: `<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">` receives at most one message per second: hotbar selection, Analyze summary ("Propanoic acid, C3H6O2, carboxylic acid, most acidic hydrogen on the O–H, 1 degree of unsaturation, no warnings"), challenge results, mode changes. A second hidden `<section aria-label="Scene description">` holds a structured text mirror of the molecule panel plus the list of molecules on the pad (name/formula each), updated on change. Errors (refused placement) go to a `role="alert"` region. All interactive elements have visible focus rings (2 px `#ffd166` outline); the canvas shows a focus ring when focused. No timers anywhere. Colour is never the sole cue.

---

## 8. Project structure

Pure = no DOM/WebGL imports, unit-tested in node. DOM/WebGL modules are exercised by the Playwright smoke test.

```
index.html                       stage div, canvas (tabindex=0), HUD roots, live regions, <title>OrgoCraft</title>
vite.config.ts                   base './', es2020, chunkSizeWarningLimit 1500, alias @ → src
vitest.config.ts                 node environment, test/**/*.test.ts
tsconfig.json                    strict, Bundler resolution
orgocraft.config.json            passMark (70), tracks {orgo1:true, orgo2:false}, disabledChallenges [], version tag
package.json                     scripts: dev/build/typecheck/test/package:d2l/package:scorm/smoke
scorm/imsmanifest.template.xml   manifest skeleton with {{FILES}} and {{MASTERY}} placeholders
scorm/xsd/*.xsd                  imscp_rootv1p1p2, adlcp_rootv1p2, imsmd_rootv1p2p1, ims_xml
scripts/check-relative-paths.mjs fails the build if dist/ has root-absolute URLs
scripts/package-d2l.mjs          dist/ → release/orgocraft-v<ver>-d2l.zip (versioned folder inside)
scripts/package-scorm.mjs        dist/ + manifest + XSDs → release/orgocraft-v<ver>-scorm12.zip (root-level)
scripts/smoke.mjs                Playwright smoke test (9.2)
src/main.ts                      entry: creates Game, handles fatal errors (no-WebGL message)
src/app/Game.ts                  DOM/WebGL — composition root: world, renderer, input, ui, lms; RAF loop with fixed-step physics
src/app/State.ts                 pure — current challenge, inventory, targeted molecule/atom, quiz choice; tiny event emitter
src/app/Settings.ts              DOM (localStorage) — settings schema, defaults, load/save with try/catch
src/chem/types.ts                pure — Element, Atom, Bond, MoleculeGraph, Analysis, Warning, AcidSite
src/chem/valence.ts              pure — valence table, nextValence, maxValence
src/chem/graph.ts                pure — MoleculeGraph builders, adjacency, degree, cycle enumeration (≤ 6)
src/chem/smiles.ts               pure — SMILES subset parser → MoleculeGraph (Kekulé)
src/chem/kekulize.ts             pure — perfect-matching Kekulization for lowercase aromatic input
src/chem/hydrogens.ts            pure — implicit H + over-valence warnings
src/chem/aromatic.ts             pure — 6-ring aromaticity perception (4.6)
src/chem/formula.ts              pure — Hill formula, element counts, DoU, ring count
src/chem/hybrid.ts               pure — hybridization + geometry labels (4.9)
src/chem/groups.ts               pure — functional-group predicates (4.8), ordered, with atom sets
src/chem/acidity.ts              pure — H-site classes, pKa lookup, mostAcidic (4.10)
src/chem/wlhash.ts               pure — WL refinement, FNV-1a hash, symmetry classes
src/chem/isomorphism.ts          pure — VF2-style matcher with state cap
src/chem/compare.ts              pure — sameMolecule pipeline (H → perceive → labels → hash → VF2)
src/chem/analyze.ts              pure — analyze(graph) → Analysis
src/chem/naming.ts               pure — library index by hash, nameOf(graph)
src/content/molecules.json       library (5.2)
src/content/challenges.json      roster (5.1) with track and points
src/content/acidity.json         pKa table (4.10)
src/content/challenges.ts        pure — Challenge types, enabled-set + totalPoints from config, acceptance evaluation (exact/predicate/set/acidicH/quiz), feedback strings
src/content/library.ts           pure — load + validate molecules.json at startup
src/world/blocks.ts              pure — block ids, isOre/isAtom/isOpaque/isSolid/isPlaceable, elementOf, palette hex table
src/world/chunk.ts               pure — Chunk class, cidx
src/world/world.ts               pure — World get/set, dirty marking, MoleculeIndex hookup, pad membership
src/world/worldgen.ts            pure — seeded terrain + ore placement + lab pad
src/world/mesher.ts              pure — buildChunkMesh into pooled MeshBuffers (opaque + scaffold groups)
src/world/raycast.ts             pure — Amanatides–Woo voxel DDA
src/world/molecule-index.ts      pure — atoms/bonds maps, incremental updates, rebuildFromWorld(world, orders), components, canPlaceAtom (valence + cage), pad components
src/world/extract.ts             pure — MoleculeIndex component → MoleculeGraph (with pos)
src/player/physics.ts            pure — PLAYER constants, stepPlayer AABB sweep
src/player/camera.ts             three — FirstPersonCamera (yaw/pitch → camera)
src/input/InputManager.ts        DOM — key set, focus handling, preventDefault policy, wheel, contextmenu, blur clearing
src/input/pointerlock.ts         DOM — tryPointerLock with fallbacks and 150 ms verification
src/input/look-modes.ts          DOM — locked / drag / keys sources feeding the camera; touch
src/input/keymap.ts              pure — default bindings, remap validation, serialization
src/render/Renderer.ts           three — WebGLRenderer setup, lowGfx detection, resize (ResizeObserver), context loss, __orgocraft counters
src/render/ChunkRenderer.ts      three — applyChunkMesh, rebuild scheduler (≤ 2/frame), shared materials
src/render/AtomRenderer.ts       three — per-element InstancedMesh + H studs + instanceColor tints + outline
src/render/BondRenderer.ts       three — bond bars, invisible pick mesh, instanceId → PairKey
src/render/Highlight.ts          three — block and bond outline
src/render/element-texture.ts    DOM canvas — makeElementTexture(symbol, bg, fg)
src/render/palette.ts            three — linear palette Float32Array from blocks.ts hex table
src/render/lights.ts             three — hemisphere + directional + fog
src/ui/hud.ts                    DOM — mounts all panels, throttled updates from State
src/ui/toolbar.ts                DOM — badge, fullscreen, open-in-new-tab, help, settings, save & exit
src/ui/hotbar.ts                 DOM — 10 slots, counts, selection, ARIA toolbar
src/ui/molecule-panel.ts         DOM — Analysis rendering, group/acid highlight buttons, warnings alert
src/ui/challenge-panel.ts        DOM — roster navigation, quiz radios, submit, feedback, progress
src/ui/settings-panel.ts         DOM — settings form + key remap
src/ui/pause-menu.ts             DOM — dialog with focus trap, Clear pad
src/ui/dialogs.ts                DOM — restore-progress and clear-pad confirmations, saved-overlay
src/ui/help.ts                   DOM — controls table, ring diagram (inline SVG), legend, pKa table
src/ui/live-region.ts            DOM — status/alert queues with 1 s throttling; scene description mirror
src/ui/styles.css                tokens, layout (framed 100vh / top-level 100dvh), focus rings, sr-only, dark/light
src/lms/scorm-api.ts             DOM (window walk) — ScormApi12 interface, discover()
src/lms/ScormAdapter.ts          DOM — init/resume/commit/exit sequence, throttling, visibility/pagehide hooks, lesson_mode
src/lms/Progress.ts              pure — score model, suspend_data encode/decode (solved+attempted), learner-keyed merge rule
src/lms/storage.ts               DOM — guarded localStorage get/set
src/util/prng.ts                 pure — mulberry32
src/util/noise.ts                pure — 2-D value noise
src/util/throttle.ts             pure — throttle/debounce helpers
test/chem/*.test.ts              parser, hydrogens, formula/DoU, hybrid, aromatic, groups, acidity, compare, naming, library validation
test/content/challenges.test.ts  every challenge's acceptance against positive and negative builds; totals from JSON
test/content/buildable.test.ts   lattice embedder over library + all targets; end-to-end grid builds
test/world/*.test.ts             mesher, raycast, molecule-index (incl. cage + order-preserving rebuild), worldgen invariants
test/player/physics.test.ts      collision sweep
test/lms/progress.test.ts        score model, codec, learner-keyed mirror, exit values, fake API sequence
docs/DESIGN.md                   this document
docs/SCOPE.md                    instructor decisions (v1 departures listed in section 1)
docs/INSTRUCTOR.md               D2L upload/SCORM steps, gradebook settings, enabling the extension pack, troubleshooting
.github/workflows/build.yml      typecheck, test, build, package, smoke, upload release/*.zip
```

---

## 9. Test plan

### 9.1 Vitest unit tests (node, pure modules)
Chemistry (`test/chem/`):
- `smiles.test.ts`: branches, nested branches, ring closures incl. `%10` and number reuse (`C%10CCCCC%10` ≡ `C1CCCCC1` ≡ `C2CCCCC2`), bond symbols on either/both closure ends, bracket atoms with H count, `.` components, error cases (unmatched closure `C1CCC`, charge, unknown symbol; `c1ccc1` may fail to kekulize).
- `hydrogens.test.ts`: OpenSMILES rule for every element; over-valence warning for a C with 5 bonds; N with 4 bonds.
- `formula.test.ts`: Hill order (`C4H9Br`, `CH4N2O`, `CHCl3`, `ClCCl` → `CH2Cl2`), DoU for all library entries equals rings + π bonds; ring count for cyclohexane (1), butane (0), cubane-like cage built on the grid (5).
- `hybrid.test.ts`: propyne → sp3, sp, sp; ethene sp2; acetamide N sp2; ethanol O sp3; geometry labels.
- `aromatic.test.ts`: both Kekulé forms of o-xylene and aspirin hash equal; benzene ≠ 1,3-cyclohexadiene ≠ 1,3,5-hexatriene; quinone not aromatic; styrene's vinyl C=C remains an alkene.
- `groups.test.ts`: the 40-molecule probe set from the research with expected hit sets, plus 1,2-butadiene (two alkene hits, one cumulated), urea (urea, not amide), methyl carbamate (carbamate, not ester/amide), N-methylaniline (aryl amine 2°), vinyl alcohol (enol, not alcohol), CH2Cl2/CHCl3 (halomethane, not methyl halide), acetyl chloride (acyl halide only), DMF (amide not aldehyde).
- `acidity.test.ts`: propanoic acid → O–H (5); 1-butyne → terminal C (25); ethanol → O–H; acetone → α C–H; propane → all C–H tie; each pKa class fires on its canonical example.
- `compare.test.ts`: isomer families C4H10 (2), C5H12 (3), C6H14 (5), C3H8O (3), C4H10O (7), acyclic C4H8 (3), C4H9Br (4), C5H10O carbonyl (7) are pairwise distinct; rewritten pairs equal (`CCCCC(C)`=`CCCCCC`, `OCCCC`=`CCCCO`); WL hash equality implies VF2 success for every library pair; a regular-graph WL collision fixture is caught by VF2; state cap returns false.
- `naming.test.ts` / `library.test.ts`: every library entry parses, formula matches, no two different names are isomorphic, `nameOf(parse(smiles)) === name`.

Content (`test/content/`):
- `challenges.test.ts`: `totalPoints(enabled(config))` equals `Σ points` read from the JSON for both the default config and the all-tracks config (no literal 41/49 in the test; the test additionally greps `docs/DESIGN.md` for "totalPoints = 41" and "it is 49" so this document cannot drift). For each challenge: at least one positive build (as SMILES) is accepted and two negatives are rejected with the expected feedback kind (C07 rejects ethanol; C12 accepts the three ketones and rejects all four C5H10O aldehydes; C13 rejects methylcyclopentane-free alternatives such as 1-hexene; C14 rejects the α-carbon pick; C15 rejects the CH3 pick; C16 rejects a pad that includes cyclobutane; C17 rejects 1-bromopropane; C18 rejects 2-butanol; C19 rejects cyclobutene; C20 rejects a pad with a duplicate; C22 rejects 2-methyl-1-butene; set challenges reject a stray atom, a missing isomer and an extra molecule with the naming feedback; quiz C05 rejects a wrong option and a missing propyne). `suspend_data` for all-solved < 40 chars.
- `buildable.test.ts`: a backtracking embedder (BFS order from the highest-degree atom, 6 candidate cells around the first placed neighbour, reject a cell if any placed non-bonded atom is face-adjacent or any placed bonded atom is not) must succeed for every library entry and every `exact`/`set`/`acidicH`/`quiz.requires` target. For every challenge the found embedding is then written through `World.setBlock` (translated onto the pad at y ≥ 10) with bond orders applied via `index.bonds`, extracted with `extractMolecules`, and run through `evaluate(challenge)` — so the grid path, not only the SMILES path, is exercised per challenge.

World (`test/world/`):
- `mesher.test.ts`: one block in an empty 3×3×3 → 6 faces / 24 vertices / 36 indices; two adjacent → 10 faces; block next to an atom cell → face still emitted; block next to scaffold → face emitted; full 16×32×16 solid chunk → only boundary faces; vertex colours are palette × shade.
- `raycast.test.ts`: known hit cell and normal on each axis; miss beyond maxDist; ray starting inside a block returns zero normal; diagonal ray crosses the expected cells.
- `molecule-index.test.ts`: placing adjacent atoms creates bonds; removal deletes bonds; valence refusal (5th neighbour on C; 3rd on O); bond-order raise refused at valence; extraction yields correct components and deterministic atom order; cube-corner hexagon has no chord; planar 2×3 hexagon has one; **placing C at an inner cube vertex of cyclohexane is allowed, yields ringCount 3 and the cage warning; placing O there is refused**; `rebuildFromWorld(world, orders)` preserves a double bond; pad membership excludes a component with one atom at x = 51 or y = 8.
- `worldgen.test.ts`: pad is flat and LabTile; ≥ 400 ore per element; an outcrop of each element within 12 blocks of spawn; determinism for seed 1337.

Player: `physics.test.ts`: falls and lands on ground, cannot walk through a wall or scaffold, no tunnelling at maxFall, jump only when grounded.

LMS: `progress.test.ts`: raw computation with disabled challenges and tracks, monotonic raw, passed/incomplete rule (never failed), encode/decode roundtrip incl. attempted bits; **mirror keyed by student_id: a mirror stored under student A is ignored when student B initializes; a matching mirror is offered, and restoring it changes state but produces no `score.raw` write until the next milestone**; `ScormAdapter` against a 20-line fake `window.API` recording calls (init → read student_id/lesson_mode → set min/max → status incomplete → commit; milestone writes raw only when > 0; **exit = `suspend` when passed but not all solved, `""` when all enabled solved, never `logout`**; finish exactly once; no `window.close` call).

### 9.2 Playwright smoke test (`scripts/smoke.mjs`, `npm run smoke`)
- Launch `playwright-core` chromium with `executablePath = process.env.CHROME_PATH ?? glob($PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux*/chrome)` (the installed chromium-1194 does not match playwright-core 1.63's expected 1243). Headless WebGL2 on SwiftShader is verified to work.
- Serve `dist/` with a tiny node http server under the nested path `/content/enforced/12345-ORGO/orgocraft-v1/` (proves relative base) and, in a second run, inside a same-origin wrapper page that iframes it at a fixed 580 px height with a fake `window.API` (proves SCORM discovery through `parent` and that the hotbar and challenge panel are inside the 580 px frame — asserted via `getBoundingClientRect`).
- Fail on any `pageerror` or console error; `waitForFunction(() => window.__orgocraft?.frames > 10 && window.__orgocraft.triangles > 0, null, { timeout: 20000 })`.
- Scripted play: focus canvas, press `1`, `E` to place a carbon (after positioning via a debug hook `window.__orgocraft.teleport(...)` exposed only when `?debug=1`), expect the molecule panel to read "Methane"; press Enter, expect challenge C01 to be marked solved and the fake API to have received `cmi.core.score.raw`.
- Keyboard-only pass: Tab from the toolbar to the canvas and back (no trap); Esc opens the pause menu and focus lands on "Resume".
- Screenshot to `test-results/smoke.png`; non-zero exit on failure. CI installs the full `playwright@1.63.0` and runs `npx playwright install --with-deps chromium`.

### 9.3 Manual D2L checklist (in `docs/INSTRUCTOR.md`, run on the real course shell before release)
1. Manage Files path: zip uploads, unzips, topic opens; DevTools shows no MIME/404 errors for `assets/index-*.js` under `/content/enforced/`.
2. In the classic viewer the stage fills the frame (≥ 480 px), the hotbar and challenge panel are fully visible, there is no vertical scroll trap in the D2L page, and Fullscreen works from inside the viewer.
3. Click locks the pointer; Esc releases it and opens the menu; if lock fails, drag-look works and the hint appears; arrow-key look works.
4. Space and arrows do not scroll the D2L page while the canvas is focused; they do scroll normally once focus leaves the canvas (Tab).
5. Keys never stick after clicking the D2L chrome mid-press.
6. Whole game completable keyboard-only (Q/E/F/Enter/arrows), including an `acidicH` and a `quiz` challenge.
7. NVDA or VoiceOver announces hotbar changes, Analyze results and challenge results; the scene description is readable.
8. SCORM path (new player, new window): badge says "Connected to course gradebook"; solve C01–C03, Save & Exit (overlay says progress saved; use the player's Exit); Grades shows the raw score; open again as the same test student — progress resumes from `suspend_data`; a second attempt with a lower score does not lower the Highest Attempt grade.
9. SCORM embedded mode: the stage fills the fixed-height frame without clipping the hotbar or challenge panel; Fullscreen available.
10. Shared-computer check: log in as test student B on the same browser profile after A; B sees no restore prompt and no score is written for B.
11. Chrome with third-party cookies blocked and Safari: content loads; note any popup blocking in new-window mode.
12. Re-release to a new versioned folder shows the new build without clearing cache.
13. If the campus enables D2L's HTML sandbox option: scripts still run, pointer lock is refused gracefully, keyboard play works.

---

## 10. Risks, mitigations, v2

### Risks and mitigations
| Risk | Mitigation |
|---|---|
| Scope disagreement with `docs/SCOPE.md` (stereo, reaction bench, charge tool in v1) | Section 1 table states every departure; open question 1 asks for sign-off; the grid keeps positions and bond orders so v2 stereo/reactions are additive. Ch. 8/9/11 are covered in v1 as build-the-product challenges. |
| Pointer lock unavailable or flaky in D2L (sandboxed iframe, SCORM frame, post-Esc relock rejection) | Drag-look and arrow-key look are first-class; on-screen mode hint; never auto-relock; Fullscreen / "Open in new tab" (standalone). |
| D2L specifics (MIME types, iframe height, sandbox option, Lessons viewer) verifiable only from secondary sources | Early real-shell test (9.3) in the first sprint; framed stage sized to 100vh; single JS bundle. |
| SCORM API not reachable from the Content Service frame layout, or D2L not applying `masteryscore` | Adapter degrades to standalone with a visible badge; we write `passed`/`incomplete` and always emit numeric `score.raw`; SCORM Cloud test before hand-off. |
| New SCORM player resume bugs / progress reset | Learner-keyed localStorage mirror offered (never auto-committed); Highest Attempt grading recommended; `exit=suspend` always unless fully solved. |
| Grade integrity on shared computers | Mirror keyed by `cmi.core.student_id`; restore requires confirmation; restored state never writes a score by itself. |
| `suspend_data` 4096-char cap | Bitmask codec < 40 chars; unit-tested. |
| Kekulé ambiguity breaks aromatic targets (extension pack) | Aromaticity perception on both sides; unit tests on both Kekulé forms. |
| WL hash collisions / VF2 blow-up | VF2 always confirms; degree/label pre-filters; 200k-state cap. |
| Bipartite lattice and cages: flat hexagons, odd rings, inner-vertex placements | Help diagram (build rings on scaffold above the floor), C13 hint, cage warning, ring count visible; odd-ring molecules excluded; buildability test for all content. |
| Auto-bonding creates unintended bonds when building compactly | Placement refused when valence is exceeded (never silently dropped); ring count and per-atom bond table visible; H studs make bonding visible; scaffold lets students space things out. |
| Predicate/set challenges accept unintended molecules | Every predicate is closed (formula clause) and its accepted set is enumerated in `challenges.test.ts` (C07, C12, C19); set challenges require the exact multiset. |
| Future content becomes unbuildable | `buildable.test.ts` embeds every target on every CI run. |
| Stale `index.html` after same-name re-upload | Versioned folders; hashed assets; instructor doc. |
| Low-end GPUs / context loss / SwiftShader | lowGfx heuristics, pixel-ratio cap, context-loss handling with order-preserving index rebuild, ≈ 80 draw calls. |
| pKa table disagreements between textbooks | Values in `acidity.json`; only class order matters for grading and v1 challenges never pit adjacent classes (5 vs 50, 25 vs 50). |
| Accessibility conformance of a 3D game is inherently partial | Keyboard-only path, live region and text mirror, no timers, contrast-checked DOM HUD; instructor notified that an accommodation plan (DOM-only builder, v2) may still be needed. |

### v2 ideas (short list)
1. **Reaction bench** (SCOPE.md ch. 8, 9, 11): rule engine producing product graphs for McMurry's reagent set and the SN1/SN2/E1/E2 decision table, graded by the same comparator; the v1 build-the-product challenges become its first fixtures.
2. **Stereochemistry** (SCOPE.md ch. 5, 7): R/S from grid geometry (seesaw placements, CIP priorities, planar-centre warnings), E/Z from coplanar substituents; stereo-aware comparison.
3. **Charge tool** (SCOPE.md ch. 2): isoelectronic-valence rule, formal charge display, conjugate-base and carbocation challenges.
4. **IUPAC naming** generator for acyclic alkanes/alkenes/alkynes/alcohols/ketones/acids/halides; library lookup remains the fallback.
5. Diagonal-bond wand (odd rings: cyclopropane, epoxides, five-membered rings), 13C signal count from WL symmetry classes, DOM-only accessible builder mode, Organic II pack growth (EAS products, carbonyl derivatives).


## Key decisions

- **Scope**: v1 content is re-aligned to docs/SCOPE.md (Organic I, McMurry ch. 1-11): 22 Organic I challenges enabled by default; aromatic content is a 3-challenge Organic II extension pack (X01-X03) disabled by default via orgocraft.config.json tracks. _(SCOPE.md excludes aromaticity and lists ch. 2/3/4/7/8/9/10/11 objectives; the previous draft put 41% of the grade on Organic II content with zero coverage of the instructor's chosen topics.)_
- **Scope**: Stereochemistry (ch. 5, E/Z), the reaction bench and the charge tool remain deferred to v2; ch. 8/9/11 are covered as build-the-product challenges and ch. 2 by an acidity rule engine plus quiz panel, and the departure from SCOPE.md is stated in section 1 as a sign-off item. _(Those features need a product-generation engine, CIP/seesaw geometry and charged valences; the grid data model keeps positions and bond orders so they are additive.)_
- **Score model**: totalPoints is computed from challenges.json plus config (41 for Organic I, 49 with the extension pack) and asserted by tests that read the JSON and grep this document; no literal totals in code. _(The previous draft's literal 45 was wrong (49) and would have been copied into tests and UI.)_
- **SCORM resume**: The localStorage mirror is keyed by cmi.core.student_id, only read when the id matches, restored only after an explicit confirmation, and never auto-commits a score; score.raw is next written at a real milestone. _(localStorage is per browser profile, not per D2L account; the old merge rule would have written student A's score to student B's gradebook on a shared computer.)_
- **SCORM exit**: cmi.core.exit is always 'suspend' unless every enabled challenge is solved (then ''); 'logout' is never written and 'failed' is never written. _('logout' ends the attempt so a passed student could not continue toward 100 and some players log the learner out; 'failed' cannot be evaluated sensibly in a free-navigation game and is irrelevant under Highest Attempt grading.)_
- **Save & Exit**: No window.close(); after LMSFinish an overlay tells the student to use the player's Exit button; top.close() only when top is same-origin and script-opened. _(Inside D2L's new-window player the SCO is an iframe of the popup with a null opener; closing the top window would pre-empt the player's own finish.)_
- **Layout**: Framed stage uses height:100vh (min-height 480px only inside the same-origin auto-sized D2L viewer); top-level uses 100dvh; aspect-ratio sizing is dropped. _(Width-driven aspect-ratio sizing overflowed fixed-height cross-origin SCORM frames and clipped the hotbar and challenge panel.)_
- **Grid geometry**: Inner-cube-vertex placements next to a ring are legal for C/N and produce a cage; the game warns ('bonded to three ring atoms — cage') instead of refusing, rings are built on a new unlimited scaffold block one level above the pad floor, and the molecule-index test expects ringCount 3 for the cage. _(The previous claim that valence refuses those placements was false (cyclohexane ring carbons go 2->3 bonds); pad-floor atoms also lose their -y face.)_
- **Data ownership**: The Uint8 grid owns atom cells/elements; MoleculeIndex.bonds owns bond orders; every index rebuild takes the previous order map and re-applies it. _(Bond orders do not exist in the grid, so a naive rebuild (context restore, tests) would silently reset double/triple bonds.)_
- **Rendering**: instanceColor is documented as a diffuse multiplier with instanceColor.needsUpdate=true, targeted molecules also get an outline, and the bond pick mesh uses visible=false rather than opacity 0. _(setColorAt is not emissive and cannot lighten black text; an invisible mesh is still raycastable and costs no draw call or transparent sorting.)_
- **Challenge acceptance**: Every predicate is closed by a formula clause (C07 C2H6O, C12 C5H10O ketone, C19 C4H6 acyclic) with its accepted set enumerated in tests; set challenges require the exact multiset on a precisely defined pad (x,z in [52,76), y>=9, all atoms) with feedback naming extra/missing/duplicate molecules and a 'Clear pad' action. _(Open predicates accepted unintended molecules and 'every component on the pad' was undefined, leaving students unable to see why correct builds were rejected.)_
- **Chemistry rules**: Alkene rule covers cumulated double bonds (oracle [#6;X3,X2;!a]=[#6;X3,X2;!a]); urea/carbamate, aryl amine 1°/2°/3°, enol and halomethane rules added; hybridization and pKa engines added as pure modules. _(1,2-butadiene would have failed the oracle test; polyhalomethanes were mislabeled; SCOPE.md ch. 1-2 needs hybridization and most-acidic-hydrogen features.)_
- **Content verification**: All 66 library entries and every target were verified this revision with RDKit (formula, non-isomorphism, DoU) and proven induced-embeddable in the cubic lattice; test/content/buildable.test.ts repeats the embedding on every CI run and drives an end-to-end grid build per challenge. _(Even rings are necessary but not sufficient for buildability under auto-bonding; a test prevents future content from silently becoming unbuildable.)_
- **Deployment**: SCORM 1.2 single SCO with XSDs at the zip root, masteryscore from orgocraft.config.json, Highest Attempt grading, new-window player recommended; Manage Files path runs standalone with localStorage. _(Only cmi.core.score.raw reaches the D2L gradebook; the new player supports resume and Highest Attempt, the legacy importer does not.)_
- **Engine**: WebGLRenderer, 8x8 chunks of 16x32x16 in Uint8Arrays, culled face meshing with linear vertex colours, Amanatides-Woo picking, fixed-step AABB physics, per-element InstancedMesh atoms with baked CPK+symbol textures, instanced bond bars. _(Runs on Chromebooks/integrated GPUs, under ~80 draw calls, and every core module stays pure for vitest.)_

## Open questions for the instructor

- SCOPE.md lists stereochemistry (ch. 5, E/Z), the reaction bench (ch. 8, 9, 11) and the charge tool (ch. 2) as v1; this design defers all three to v2 and covers ch. 8/9/11 with build-the-product challenges and ch. 2 with a most-acidic-hydrogen engine. Default chosen: proceed with this v1; please confirm or tell us which of the three to pull forward (each is roughly a sprint).
- Pass mark and grading: default is masteryscore 70 and Grade Calculation Method = Highest Attempt with the grade item set to 100 points. Confirm the pass mark and whether the 3-challenge Organic II extension pack (benzene, p-xylene, aspirin; +8 points) should be enabled for your section (default: disabled, totalPoints = 41).
- pKa values in acidity.json default to McMurry Table 2.3 approximations (carboxylic acid 5, thiol 10.5, alcohol 16, ketone α-H 20, terminal alkyne 25, amine 36, alkane 50). Confirm these are the numbers you teach; only their order affects grading.
