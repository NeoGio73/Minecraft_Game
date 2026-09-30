# OrgoCraft — Design Document (v1)

A Minecraft-style voxel world that teaches college-level organic chemistry. Vite + TypeScript + Three.js, no backend, delivered inside a D2L Brightspace course shell either as uploaded course content (Manage Files) or as a SCORM 1.2 package that reports a score to the gradebook.

This document is the single source of truth for the engineering team. Where it conflicts with `docs/SCOPE.md` (an earlier wish list that includes stereochemistry and a reaction bench), **this document wins for v1**; those items are carried in section 10 as v2 work and in the open questions.

---

## 1. Goals, audience, non-goals

### Goals
1. Students build molecules by placing element blocks in a 3D world; the game continuously reports formula, implicit hydrogens, degrees of unsaturation, functional groups and (when known) the name, so every build is a formative check.
2. A fixed, ordered roster of 25 challenges (section 5) covers Lewis structures/valence, constitutional isomers, IUPAC decoding, unsaturation, rings, functional-group classification, aromatic substitution patterns, carboxylic-acid derivatives and three drug molecules.
3. The score (0–100) reaches the D2L gradebook through SCORM 1.2 when launched as a SCORM object, and is saved locally otherwise.
4. Runs on the machines students actually have (Chromebooks, integrated GPUs, phones in a pinch) inside an LMS iframe, and is fully keyboard-operable (WCAG 2.1 AA target; public colleges are under 28 CFR 35.200).

### Audience
College organic chemistry students (Organic I primarily; the last eight challenges reach into Organic II topics and can be disabled per course, see section 5). Instructor textbook per `docs/SCOPE.md` is McMurry (OpenStax chapter order); each challenge cites a McMurry chapter, with the Klein/Wade equivalents noted once in section 5.

### Non-goals for v1 (explicit)
- No reactions or mechanisms beyond the two "build the product" challenges (Fischer esterification, amide formation) which are graded as structure builds, not simulated.
- No stereochemistry: R/S, E/Z, cis/trans are ignored; targets are compared after stereo stripping. The grid data model keeps positions so v2 can add it.
- No formal charges (all atoms neutral). Nitro compounds, carboxylates, ammonium, carbocations are out.
- No odd-membered rings (3, 5, 7). Face-adjacency bonding on a cubic lattice is bipartite; see section 4.5. No diagonal-bond tool in v1.
- No explicit hydrogen blocks: hydrogens are implicit and auto-filled.
- No IUPAC name generator: naming is library lookup only.
- No multiplayer, accounts, server, analytics or external network calls of any kind.
- No world persistence: terrain edits and inventory are not part of the graded state (inventory is mirrored to localStorage as a convenience only).

---

## 2. Deployment

### 2.1 Build configuration (Vite)
`vite.config.ts` (already in the repo) keeps:
- `base: './'` — mandatory. D2L serves uploaded files from `/content/enforced/<orgUnitId>-<orgUnitCode>/<folder>/index.html`, and the SCORM Content Service serves from `https://content.<region>.content-service.brightspace.com/vault/.../scormcontent/index.html`. A root-absolute `/assets/...` URL 404s in both.
- `build.assetsDir: 'assets'`, `build.sourcemap: false`, `build.target: 'es2020'` (Vite 7 floor guarantees WebGL2 anyway).
- Add `build.chunkSizeWarningLimit: 1500` and no dynamic `import()` / `manualChunks`: output is exactly `index.html`, `assets/index-<hash>.js`, `assets/index-<hash>.css`.
- No files in `public/` referenced by absolute path. All runtime assets are generated at runtime (canvas textures); there are no image/model/wasm assets to fetch.
- `scripts/check-relative-paths.mjs` runs after `vite build` and fails if `dist/` contains `"/assets/`, `src="/` or `href="/`.
- Output must never contain restricted extensions (`.sh .bat .exe .dll .config .cmd .ps1 .jar`), which D2L's uploader rejects. The packaging scripts assert this.

### 2.2 Path A — Manage Files upload (course content, no grade)
Script: `npm run package:d2l` → `release/orgocraft-v<version>-d2l.zip` containing a **single versioned folder** `orgocraft-v<version>/` with the contents of `dist/`.

Instructor steps (documented in `docs/INSTRUCTOR.md`):
1. Course Admin → Manage Files → Upload → choose the zip (default limit 2 GB; ours is < 1 MB).
2. Open the zip's action menu → Unzip. Wait for the background-job notification.
3. Tick `orgocraft-v<version>/index.html` → "Add Content Topics" → choose the module and a topic title.
4. Never click "Edit HTML" on the topic: the Brightspace Editor strips `<script>` tags.
5. For an update, upload a new versioned folder and use "Change File" on the topic (avoids the reported stale-`index.html` cache problem; hashed asset names handle the rest).

In this path the game runs in **standalone mode** (section 2.6): no gradebook, progress in localStorage. The HUD shows "Progress saved on this device — not connected to the gradebook".

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
    <organization identifier="ORG"><title>OrgoCraft: Organic Chemistry</title>
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
- Framing detection: `const framed = window.self !== window.top`.
- **Stage sizing**: never `100vh` inside a frame (D2L's classic viewer auto-sizes the iframe to the document, default 580 px, `overflow-y: hidden`). Stage CSS: framed → `width:100%; aspect-ratio:16/9; min-height:480px`; top-level (SCORM new window, or "Open in new tab") → `height:100dvh`. `html, body { margin:0; overflow:hidden }`. Fullscreen (`document.fullscreenElement`) → stage fills the fullscreen element. Renderer resizes from a `ResizeObserver` on the stage element, debounced to one resize per animation frame, never from `window.innerHeight`.
- **Toolbar** (DOM, top of stage): "Fullscreen" (calls `stage.requestFullscreen()` inside the click handler; hidden if `!document.fullscreenEnabled`), "Open in new tab" (`<a href=location.href target=_blank rel=noopener>`; shown in standalone mode only — in LMS mode a new tab cannot reach the SCORM API, so it is hidden and Fullscreen is offered instead), "Help", "Settings", mode badge.
- **Pointer lock**: attempted only on canvas click (transient activation), see section 3.3. Failure (promise rejection, `pointerlockerror`, or `document.pointerLockElement !== canvas` 150 ms later) switches to drag-look silently and shows the hint "Drag to look". After Esc, never auto-relock; wait for the next click.
- **Keyboard focus**: `<canvas tabindex="0" aria-label="OrgoCraft 3D world. Press H for controls, Escape to open the menu, Tab to leave the world.">`. `pointerdown` → `canvas.focus()`. Key handlers are on `window` but act **only when `document.activeElement === canvas` or pointer lock is held**; in that state `preventDefault()` for Space, Arrow keys, PageUp/Down, Home/End and bound letter keys. Never for Tab, Escape, F-keys, or when a DOM input/dialog has focus. The key set is cleared on canvas `blur`, window `blur` and `visibilitychange` (no stuck movement after clicking the D2L chrome).
- `<title>OrgoCraft</title>` is set (D2L reads it).
- Mixed content: no `http://` subresources exist (there are no subresources besides the bundle).

### 2.5 Score model
- Each challenge has `points` (easy 1, medium 2, hard 4; section 5). `totalPoints` = sum over challenges with `enabled: true`.
- `raw = Math.round(100 * earnedPoints / totalPoints)`, integer 0–100.
- Monotonic within an attempt: `reportedRaw = max(reportedRaw, raw)`; a challenge earns points once; re-submitting a solved challenge is allowed (feedback) but never changes the score.
- `lesson_status`: `incomplete` until all enabled challenges are solved or `raw >= passMark`; then `passed` (if `raw >= passMark`) — we write `passed`/`failed` ourselves and do not rely on the LMS applying `masteryscore`. `failed` is written only when every enabled challenge has been attempted and `raw < passMark` at Save & Exit; otherwise `incomplete` (so a student can come back).
- `score.raw` is **never written while it is 0** (a student who merely opens the game must not get a 0 recorded under First/Last Attempt calculation).

### 2.6 `ScormAdapter` (src/lms/)
Discovery (`scorm-api.ts`):
```ts
function findApi(start: Window): ScormApi12 | null {
  let win: Window | null = start;
  for (let i = 0; i < 10 && win; i++) {
    try { if ((win as any).API) return (win as any).API; } catch { /* cross-origin: stop */ break; }
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
1. Load: `LMSInitialize("")`; read `cmi.core.lesson_status`, `cmi.core.entry`, `cmi.suspend_data`, `cmi.core.lesson_location`; write `cmi.core.score.min="0"`, `cmi.core.score.max="100"`; if status is `not attempted` write `lesson_status="incomplete"`; `LMSCommit("")`.
2. On every challenge acceptance (milestone): write `cmi.core.score.raw` (only if > 0), `cmi.core.lesson_location` (current challenge id, ≤ 255 chars), `cmi.suspend_data`, `lesson_status` per 2.5; `LMSCommit("")`. Non-milestone commits (e.g. current-challenge change) are throttled to one per 30 s.
3. `visibilitychange` → hidden: `LMSCommit("")`.
4. `pagehide` and the "Save & Exit" button: write `cmi.core.exit` (`suspend` if not passed, `logout` if passed), `LMSCommit("")`, `LMSFinish("")` exactly once (guarded by a `finished` flag). Save & Exit additionally calls `window.close()` when `window.opener` exists (new-window mode; closing the popup without finishing starts a new attempt in D2L). `beforeunload` is not used.
5. Any call returning `"false"` logs `LMSGetLastError()` + `LMSGetErrorString()` to the console; play is never blocked.

`suspend_data` codec (`Progress.ts`): `v1|<hex bitmask of solved challenge ids, LSB = C01>|<reportedRaw>|<currentChallengeId>` — e.g. `v1|1f|20|C06`. A unit test asserts the encoded length for all-solved is < 100 chars (hard limit 4096 in SCORM 1.2; D2L will not raise it). The same string is always mirrored to `localStorage['orgocraft.v1.progress']` in both modes; on resume, if the LMS returns empty `suspend_data` but localStorage has a newer string (higher bit count), the local copy is used and re-committed (mitigates the reported new-player resume bugs).

Standalone mode: identical game logic; `Progress` persists to localStorage only; badge "Progress saved on this device — not connected to the gradebook". All localStorage access is wrapped in try/catch (private windows, blocked storage) and the game runs with in-memory state if it throws.

---

## 3. Core loop and controls

### 3.1 Loop
1. **Explore** a small world (128×32×128) with a flat "lab pad" at the centre and ore outcrops around it.
2. **Mine** element ore blocks (C, N, O, S, F, Cl, Br, I) — each yields 3 atoms into the inventory. Breaking a placed atom block returns it to inventory. Stone/dirt/grass are breakable (to reach ore) but not placeable.
3. **Place** atoms from the hotbar onto any block face. A placed atom automatically forms a **single bond to every face-adjacent atom block**. If that would exceed the valence of the new atom or any neighbour, the placement is **refused** with a flash and the message "Carbon can only make 4 bonds here (would make 5)". Unintended rings can still form when valence allows (e.g. closing a square); the molecule panel shows ring count so the student notices.
4. **Bond wand** (hotbar slot 9): point at a bond and press Place to cycle order 1→2→3→1. Raising order is refused (flash + message) if either atom would exceed valence; wrapping from 3 to 1 is always allowed.
5. **Implicit hydrogens** auto-fill every atom to its valence and are rendered as small labels/count on the molecule panel and as small white studs on the atom cube (section 6.6).
6. **Analyze** (F): the molecule under the crosshair is named (library lookup), its groups listed, warnings shown, and the summary is announced in the ARIA live region.
7. **Challenges**: the challenge panel shows the current challenge; **Submit** (Enter or the panel button) evaluates the targeted molecule (or, for set challenges, all molecules on the pad) and accepts/rejects with specific feedback (e.g. "Formula matches C4H10O but this is 2-butanol, not a tertiary alcohol: the carbon bearing OH has 1 H"). Accepted challenges add points and commit the score.

Targeted molecule rule: the connected component containing the atom block under the crosshair (DDA hit, ≤ 6 blocks); if none, the component nearest the player within 8 blocks; if none, "No molecule targeted".

### 3.2 Keys and mouse (defaults; remappable in Settings)
| Action | Primary | Keyboard-only alternative |
|---|---|---|
| Move | W A S D | same |
| Jump | Space | same |
| Sprint | Shift (hold) | same |
| Look | Mouse (pointer lock) or drag | Arrow keys: ←/→ yaw 2.5 rad/s, ↑/↓ pitch 1.5 rad/s (rate in Settings) |
| Mine / remove block | Left mouse button | Q |
| Place atom / cycle bond (bond wand) | Right mouse button | E |
| Hotbar slot | 1–9 | same; `[` `]` also cycle |
| Hotbar cycle | Mouse wheel | `[` `]` |
| Analyze targeted molecule | F | F |
| Submit for current challenge | Enter | Enter |
| Next / previous challenge | . and , | same |
| Toggle help overlay | H | H |
| Pause menu / release pointer | Esc | Esc |
| Debug overlay | F3 | F3 |
| Leave the game canvas | Tab | Tab (documented on-screen; satisfies WCAG 2.1.2) |

All single-letter shortcuts are active only while the canvas has focus (WCAG 2.1.4). `KeyboardEvent.code` is used (layout independent). Mouse buttons: `contextmenu` is prevented on the canvas; wheel listener is `{ passive: false }` with `preventDefault`.

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
export interface MoleculeGraph {
  atoms: Atom[];
  bonds: Bond[];
  adj: number[][];            // adj[atomId] = bond indices
}
export interface Analysis {
  formula: string;            // Hill order, e.g. C9H8O4
  counts: Record<Element, number>;
  hydrogens: number[];        // implicit H per atom
  dou: number;                // degrees of unsaturation
  ringCount: number;          // bonds - atoms + components
  groups: GroupHit[];         // functional groups (4.8)
  warnings: Warning[];        // over-valence etc.
  name: string | null;        // library lookup (4.10)
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

### 4.4 Molecule extraction from the voxel grid (`extract.ts`, using `world/molecule-index.ts`)
- `MoleculeIndex` is derived from the block grid (one source of truth): `atoms: Map<CellKey, {key, el, x, y, z}>`; `bonds: Map<PairKey, BondOrder>` where a bond exists **iff** two atom cells are face-adjacent (|dx|+|dy|+|dz| = 1). `CellKey = x | (z << 7) | (y << 14)`; `PairKey = min * 2^21 + max` (numbers stay < 2^42, exact in doubles).
- `setBlock` maintains the index incrementally: placing an atom adds bonds (order 1) to all face-adjacent atoms; removing an atom deletes its bonds; the bond wand rewrites `bonds.set(pair, order)`.
- `extractMolecules(index): MoleculeGraph[]` = connected components by BFS over the bond map; atom ids are assigned in BFS order from the lowest CellKey so extraction is deterministic. `componentOf(cellKey)` returns the graph containing that cell.

### 4.5 Grid geometry facts the content depends on
- Face adjacency on a cubic lattice is bipartite (parity of x+y+z flips each step), so **all rings have even length**: 4-rings (unit square) and 6-rings are buildable; 3-, 5-, 7-rings are not.
- The only chord-free 6-ring is the cube-vertex hexagon `(0,0,0)-(1,0,0)-(1,1,0)-(1,1,1)-(0,1,1)-(0,0,1)` — geometrically the chair. A planar 2×3 hexagon auto-bonds a chord and is refused/garbled. The help overlay and challenge C12 teach the chair hexagon with a diagram. Each ring atom has exactly three outward free faces; the two "inside" cube vertices `(0,1,0)` and `(1,0,1)` touch three ring atoms and are refused by the valence rule.

### 4.6 SMILES subset parser and aromaticity (`smiles.ts`, `kekulize.ts`, `aromatic.ts`)
Parser (OpenSMILES subset), left-to-right scan:
- Atoms: organic subset `B C N O P S F Cl Br I`, aromatic `b c n o s p`, bracket atoms `[isotope? symbol chiral? Hn? charge? :class?]` — explicit H count is honoured; isotope, chirality (`@`, `@@`) and class are ignored; a non-zero charge is a parse error in v1 (`charge` unsupported).
- Bonds `- = # :` (`/` and `\` treated as single); no bond symbol between aromatic atoms = aromatic bond, otherwise single.
- Branches: push previous atom on `(`, pop on `)`. Ring closures: digit or `%dd` after an atom opens if unseen, closes if open (bond = explicit symbol from either end; if both given they must agree; else aromatic if both atoms aromatic, else single); numbers are reusable; unmatched closure at end = error. `.` resets the previous atom (multiple components allowed for set challenges).
- Kekulization (`kekulize.ts`): after parsing, atoms that need one double bond = aromatic C with (explicit-order sum + aromatic-bond count + explicitH) < 4, and aromatic N with degree 2 and no explicit H; aromatic O/S and `[nH]` need none. Find a perfect matching over needy atoms using only aromatic bonds by backtracking DFS (molecules ≤ 60 atoms; trivial). Matched bonds get order 2, other aromatic bonds order 1; atoms/bonds keep `aromatic = true`. Failure = parse error ("cannot kekulize"). Library SMILES are then validated by a unit test that parses every entry and checks its formula.
- Aromaticity perception (`aromatic.ts`), applied identically to library targets and student graphs, on the Kekulé graph:
  1. Enumerate simple 6-cycles (DFS from each atom, depth ≤ 6; molecules are small).
  2. A 6-cycle is a *candidate* if every atom is C or N and has exactly one double bond (to any partner) and no triple bond.
  3. A candidate is *aromatic* if each atom's double-bond partner lies in this cycle or in another candidate that shares a bond with it (handles both Kekulé forms of naphthalene; rejects quinones and exocyclic methylenes).
  4. For each aromatic cycle set `aromatic = true` on its atoms and on all bonds between its atoms. Kekulé orders are retained for H counting and DoU.
  This rule makes the two Kekulé forms of o-xylene, aspirin, salicylic acid and naphthalene hash identically while still distinguishing benzene from 1,3-cyclohexadiene and 1,3,5-hexatriene. 5-membered heteroaromatics are out of scope (unbuildable in v1).

### 4.7 Canonicalization / isomorphism (`wlhash.ts`, `isomorphism.ts`, `compare.ts`)
Chosen algorithm: **Weisfeiler–Lehman hash as a fast filter, VF2-style backtracking as the arbiter**. No canonical SMILES generator.
- Atom label `L0(v) = el + '/' + H + '/' + charge + '/' + (aromatic ? 'a' : 'k')`; bond label = `'ar'` if aromatic else order.
- WL: `L_i(v) = hash(L_{i-1}(v) + '|' + sorted list of (bondLabel + ':' + L_{i-1}(u)))`; iterate until the number of distinct labels stops growing or 2·|V| rounds; final `hash = hash(sorted multiset of labels)`. `hash` = FNV-1a 64-bit over the string, rendered as hex (stable across runs; used for library index and tests). The stable partition is also exposed as `symmetryClasses` (13C signal count feature, HUD only).
- Quick reject before WL: element histogram, formula, bond-label multiset.
- VF2 confirm (`isIsomorphic(g1, g2)`): order g2's atoms by BFS from its highest-degree atom; map depth-first; candidate images of atom u = intersection over already-mapped neighbours w of u of {unmapped neighbours of map(w)} (all unmapped atoms if u has no mapped neighbour); feasibility = equal L0 label, equal degree, and for every mapped neighbour w of u, bondLabel(u,w) = bondLabel(map(u),map(w)) and no extra bonds among mapped images; backtrack; success when all atoms are mapped. Search is capped at 200 000 states (returns `false` with a warning; unreachable for library-size molecules).
- `sameMolecule(a, b)` = quickReject ∧ hashEqual ∧ isIsomorphic. Both sides go through: Kekulé graph → implicit H → aromaticity perception → labels.

### 4.8 Functional-group detection (`groups.ts`)
Implemented as TypeScript graph predicates over the perceived graph (no SMARTS engine; the SMARTS below document intent and are the test oracle). Notation: `X` = total degree including H, `H` = implicit H count, `deg` = heavy-atom degree, `sp3C` = non-aromatic C with no double/triple bonds, `carbonylC` = C with a double bond to O. Detection runs in the order listed; each hit records the atoms involved; atoms "claimed" by an earlier rule are excluded where noted, so the exclusion order is explicit:

| # | Group | Rule (plain words) | SMARTS oracle | Excludes |
|---|---|---|---|---|
| 1 | carboxylic acid | carbonylC bonded to O with H=1 | `[CX3](=O)[OX2H1]` | claims its OH oxygen |
| 2 | acid anhydride | carbonylC–O–carbonylC | `[CX3](=O)[OX2][CX3](=O)` | claims the bridging O |
| 3 | acyl halide | carbonylC bonded to F/Cl/Br/I | `[CX3](=O)[F,Cl,Br,I]` | claims the halogen |
| 4 | ester | carbonylC (whose other substituent is C or H) bonded to O whose other neighbour is a non-carbonyl C | `[CX3;$(C[#6]),$([CH1])](=O)[OX2][#6;!$(C=O)]` | claims the ester O; anhydrides (2) and carbonates excluded by rule |
| 5 | amide | carbonylC (other substituent C or H) bonded to non-aromatic N with 3 bonds total | `[CX3;$(C[#6]),$([CH1])](=O)[NX3]` | claims the N; urea/carbamate excluded (C has no C/H substituent) |
| 6 | aldehyde | carbonylC with H=1 and one C neighbour; formaldehyde: carbonylC with H=2 | `[CX3H1](=O)[#6]`, `[CX3H2]=O` | acids/formates/DMF excluded because carbonylC has an O or N neighbour |
| 7 | ketone | carbonylC bonded to two carbons | `[#6][CX3](=O)[#6]` | |
| 8 | phenol | O with H=1 bonded to aromatic C | `[OX2H]c` | |
| 9 | alcohol (1°/2°/3°/methanol) | O with H=1 bonded to sp3C; class by that carbon's H count (2/1/0; 3 = methanol) | `[OX2H][CX4;H2]`, `[CX4;H1]`, `[CX4;H0]`, `[CX4;H3]` | acids (1) and phenols (8) never match because the C is not sp3 |
| 10 | ether | O with deg 2, both neighbours carbon and neither a carbonylC | `[OD2]([#6;!$(C=O)])[#6;!$(C=O)]` | O claimed by 4/2 excluded; anisole, cyclic ethers included |
| 11 | aryl amine | non-aromatic N with H=2 bonded to aromatic C | `[NX3;H2]c` | |
| 12 | amine (1°/2°/3°) | non-aromatic N, X=3, not bonded to carbonylC or aromatic C; class by H count 2/1/0 | `[NX3;!$(N-C=O);!$(N-[a])]` | amide N (5) and aniline (11) excluded; aromatic `n` (pyridine) never matches |
| 13 | nitrile | C with a triple bond to N (N degree 1) | `[CX2]#[NX1]` | |
| 14 | alkyl halide (methyl/1°/2°/3°) | halogen bonded to sp3C; class by that carbon's carbon-neighbour count 0/1/2/3 | `[CX4][F,Cl,Br,I]` | |
| 15 | aryl halide | halogen bonded to aromatic C | `c[F,Cl,Br,I]` | acyl halides claimed by 3 |
| 16 | thiol | S with H=1 bonded to C | `[SX2H1][#6]` | |
| 17 | sulfide | S with deg 2, both neighbours carbon | `[SX2]([#6])[#6]` | |
| 18 | alkene | double bond between two non-aromatic carbons | `[CX3]=[CX3]` | aromatic Kekulé C=C excluded by perception (4.6) |
| 19 | alkyne | triple bond between two carbons | `[CX2]#[CX2]` | |
| 20 | arene | each perceived aromatic 6-ring | `a1aaaaa1` | |
| 21 | alkane | no other group and no rings/multiple bonds; `cycloalkane` if ringCount > 0 | — | only when groups 1–20 are empty |
Groups are a **set**: aspirin reports acid + ester + arene. Verified pitfalls this table avoids (from the research probe set): plain `[OX2H]` hits acids/phenols/enols; plain `COC` hits esters/anhydrides; plain `[NX3]` hits amides; `[#6]C(=O)O[#6]` hits anhydrides and misses formates; `C=C` hits Kekulé benzene.

### 4.9 Formula and degrees of unsaturation (`formula.ts`)
- Counts include implicit H. Hill order: `C`, then `H`, then remaining elements alphabetically (`Br, Cl, F, I, N, O, P, S`); if no carbon, all alphabetical. Subscripts as plain digits in data (`C9H8O4`), rendered with `<sub>` in the panel.
- `DoU = (2C + 2 + N − H − X) / 2` with X = F+Cl+Br+I; O, S ignored. Equals rings + π bonds counted on the Kekulé graph (double = 1, triple = 2); the panel shows both the number and the decomposition ("2 = 1 ring + 1 π bond"). `ringCount = bonds − atoms + components`.

### 4.10 Naming strategy (`naming.ts`, `content/library.ts`)
Library lookup only: at load, every library entry is parsed → perceived → hashed into `Map<hash, Entry[]>`. `nameOf(graph)` = entries with equal hash filtered by `isIsomorphic`; return `entry.name` or `null`. The panel shows "Unnamed — C5H12O (not in library)" for unknowns, still with formula/groups. No IUPAC generator in v1.

---

## 5. Content

### 5.1 Challenge roster (`src/content/challenges.json`)
Acceptance types:
- `exact { smiles }` — `sameMolecule(target, submitted)` after H fill, aromaticity perception, stereo stripped.
- `predicate { formula?, carbons?, ringCount?, ringCountMin?, groups?: GroupName[], notIsomorphicTo?: smiles[] }` — all listed clauses must hold.
- `set { smiles: string[] }` — every component on the lab pad (any component with ≥ 1 atom) must be isomorphic to some target, and every target must be present. A stray single atom on the pad rejects with "Stray atom on the pad".

Points: easy 1, medium 2, hard 4. Total = 45 with all enabled → `raw = round(100·earned/45)`. `enabled` defaults to true; the instructor edits `orgocraft.config.json` (`disabledChallenges: []`) before packaging to drop challenges beyond their course (e.g. C18–C25 for a first-semester course). McMurry (OpenStax) chapters cited; Klein/Wade: valence & isomers Klein 1–4/Wade 1–3, functional groups Klein 2/Wade 2, alkenes/alkynes Klein 8–9/Wade 7–9, alcohols/ethers Klein 12–13/Wade 10–14, aromatics Klein 17/Wade 16, carbonyls Klein 19–21/Wade 18–21, amines Klein 22/Wade 19.

| id | title | instruction (shown to student) | acceptance | pts | learning objective |
|---|---|---|---|---|---|
| C01 | One block, four hydrogens | Mine a carbon ore block (dark, labeled C) near the pad and place a single carbon block on the pad. Watch the panel fill in the hydrogens. Submit it. | exact `C` | 1 | Carbon makes 4 bonds; implicit hydrogens; CH4 (McMurry 1) |
| C02 | Ethane | Place two carbon blocks side by side so they bond. | exact `CC` | 1 | Sigma bond, sp3 carbons, C2H6 (McMurry 1) |
| C03 | Ethanol | Build ethanol: an –OH on a two-carbon chain (C2H6O). | exact `CCO` | 1 | Oxygen valence 2; alcohol group (McMurry 3) |
| C04 | Same formula, different molecule | Build a molecule with formula C2H6O that is NOT ethanol. | predicate `{formula:"C2H6O", notIsomorphicTo:["CCO"]}` | 1 | Constitutional isomers; ether vs alcohol (McMurry 3) |
| C05 | Both butanes | Build every isomer of C4H10 (there are two) as separate molecules on the pad. | set `["CCCC","CC(C)C"]` | 2 | Chain branching; isomer enumeration (McMurry 3) |
| C06 | Three pentanes | Build all three isomers of C5H12 on the pad. | set `["CCCCC","CCC(C)C","CC(C)(C)C"]` | 2 | Isomer enumeration; neopentane (McMurry 3) |
| C07 | Decode the name | Build 3-ethyl-2-methylhexane. | exact `CCCC(CC)C(C)C` | 2 | IUPAC parent chain and substituent decoding (McMurry 3) |
| C08 | Double bond | Build ethene: two carbons joined by a double bond (use the bond wand). | exact `C=C` | 1 | π bond, sp2, C2H4 (McMurry 1, 7) |
| C09 | Triple bond | Turn it into ethyne: cycle the bond to order 3. | exact `C#C` | 1 | Triple bond, sp, linear geometry (McMurry 1, 9) |
| C10 | 2-Butene | Build 2-butene (four carbons, double bond between C2 and C3). | exact `CC=CC` | 1 | Alkene locants; introduces cis/trans discussion (McMurry 7) |
| C11 | Unsaturation, no rings | Build any molecule with formula C4H6 and no rings. | predicate `{formula:"C4H6", ringCount:0}` | 2 | DoU = 2 realized as π bonds (accepts 1,3-butadiene, 1-butyne, 2-butyne, 1,2-butadiene) (McMurry 7) |
| C12 | A ring instead | Build any C6H12 molecule that contains a ring. Hint: a flat hexagon will not work on this grid; build the ring on the corners of a cube (see Help → Rings). | predicate `{formula:"C6H12", ringCountMin:1}` | 2 | DoU = 1 realized as a ring; cyclohexane chair (McMurry 4) |
| C13 | Five-carbon ketone | Build a molecule with exactly five carbons that contains a ketone. | predicate `{carbons:5, groups:["ketone"]}` | 2 | Ketone definition (C=O between two carbons) (McMurry 3, 19) |
| C14 | Branched aldehyde | Build 2-methylpropanal (isobutyraldehyde). | exact `CC(C)C=O` | 2 | Aldehyde carbonyl is terminal; branching (McMurry 3, 19) |
| C15 | Tertiary alcohol | Build a tertiary alcohol with four carbons. | predicate `{carbons:4, groups:["alcohol.tertiary"]}` | 2 | 1°/2°/3° alcohol classification (McMurry 17) |
| C16 | Secondary amine | Build a secondary amine with three carbons. | predicate `{carbons:3, groups:["amine.secondary"]}` | 2 | Amine classification by N substitution (accepts N-methylethanamine or azetidine) (McMurry 24) |
| C17 | SN1 substrate | Build 2-bromo-2-methylpropane (tert-butyl bromide). | exact `CC(C)(C)Br` | 2 | Alkyl halide naming; tertiary halide recognition (McMurry 10, 11) |
| C18 | Benzene | Build benzene: a six-carbon ring with alternating double bonds (cube-corner ring). | exact `c1ccccc1` | 2 | Aromatic ring, Kekulé forms, sp2 ring carbons (McMurry 15) |
| C19 | Para-xylene | Build 1,4-dimethylbenzene. | exact `Cc1ccc(C)cc1` | 2 | ortho/meta/para nomenclature (ortho and meta are rejected) (McMurry 15) |
| C20 | Esterification | Build the ester formed from acetic acid and ethanol (Fischer esterification). | exact `CCOC(C)=O` | 2 | Carboxylic acid derivative; which oxygen is retained (McMurry 21) |
| C21 | Amide formation | Build the amide formed from acetyl chloride and methylamine. | exact `CNC(C)=O` | 2 | Nucleophilic acyl substitution product (McMurry 21) |
| C22 | Design an ester | Build any ester with formula C4H8O2. | predicate `{formula:"C4H8O2", groups:["ester"]}` | 2 | Isomer reasoning within a functional class (ethyl acetate, methyl propanoate, propyl formate, isopropyl formate) (McMurry 21) |
| C23 | Aspirin | Build aspirin: a benzene ring bearing a carboxylic acid and, ortho to it, an acetate ester. | exact `CC(=O)Oc1ccccc1C(=O)O` | 4 | Multi-group recognition (acid + ester + arene) (McMurry 15, 21) |
| C24 | Acetaminophen | Build acetaminophen: a para-substituted phenol whose other substituent is an acetamide. | exact `CC(=O)Nc1ccc(O)cc1` | 4 | Phenol vs alcohol; amide vs amine (McMurry 17, 21) |
| C25 | Ibuprofen | Build ibuprofen (C13H18O2): a para-disubstituted benzene with an isobutyl group and a 2-propanoic acid group. | exact `CC(C)Cc1ccc(C(C)C(=O)O)cc1` | 4 | Assembling a 13-heavy-atom drug from a description (McMurry 15, 20) |

Changes relative to the research list: C08 was split into C08/C09 (one acceptance rule per challenge); the research's C13 predicate was replaced by an exact target (2-methylpropanal is the only branched C4 aldehyde, so the predicate added nothing); C24–C26 of the research (R/S, E/Z, caffeine) are dropped for v1 (stereo, odd rings); nitrobenzene is excluded everywhere (charges). The C16 note about azetidine is documented as intentional.

### 5.2 Molecule library (`src/content/molecules.json`)
All SMILES/formula pairs were verified with RDKit by the content researcher; entries added here (marked +) are simple and were checked by hand. Odd-ring molecules (cyclopropane, oxirane, THF, caffeine, nicotine) and charged species are excluded from v1 because they cannot be built.

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
| 3-ethyl-2-methylhexane + | C9H20 | `CCCC(CC)C(C)C` |
| cyclobutane + | C4H8 | `C1CCC1` |
| cyclohexane | C6H12 | `C1CCCCC1` |
| ethene | C2H4 | `C=C` |
| propene | C3H6 | `CC=C` |
| 1-butene | C4H8 | `CCC=C` |
| 2-butene | C4H8 | `CC=CC` |
| 2-methylpropene | C4H8 | `CC(C)=C` |
| 1,3-butadiene | C4H6 | `C=CC=C` |
| 1,2-butadiene + | C4H6 | `CC=C=C` |
| cyclohexene | C6H10 | `C1CCC=CC1` |
| ethyne | C2H2 | `C#C` |
| propyne | C3H4 | `CC#C` |
| 1-butyne + | C4H6 | `CCC#C` |
| 2-butyne | C4H6 | `CC#CC` |
| methanol | CH4O | `CO` |
| ethanol | C2H6O | `CCO` |
| 1-propanol | C3H8O | `CCCO` |
| 2-propanol | C3H8O | `CC(C)O` |
| 1-butanol + | C4H10O | `CCCCO` |
| 2-butanol + | C4H10O | `CCC(C)O` |
| 2-methyl-2-propanol (tert-butanol) | C4H10O | `CC(C)(C)O` |
| ethylene glycol | C2H6O2 | `OCCO` |
| phenol | C6H6O | `Oc1ccccc1` |
| dimethyl ether | C2H6O | `COC` |
| diethyl ether | C4H10O | `CCOCC` |
| anisole | C7H8O | `COc1ccccc1` |
| formaldehyde | CH2O | `C=O` |
| acetaldehyde | C2H4O | `CC=O` |
| propanal | C3H6O | `CCC=O` |
| butanal + | C4H8O | `CCCC=O` |
| 2-methylpropanal + | C4H8O | `CC(C)C=O` |
| benzaldehyde | C7H6O | `O=Cc1ccccc1` |
| acetone | C3H6O | `CC(C)=O` |
| 2-butanone | C4H8O | `CCC(C)=O` |
| 2-pentanone | C5H10O | `CCCC(C)=O` |
| 3-pentanone | C5H10O | `CCC(=O)CC` |
| 3-methyl-2-butanone + | C5H10O | `CC(C)C(C)=O` |
| cyclohexanone | C6H10O | `O=C1CCCCC1` |
| acetophenone | C8H8O | `CC(=O)c1ccccc1` |
| formic acid | CH2O2 | `OC=O` |
| acetic acid | C2H4O2 | `CC(=O)O` |
| propanoic acid | C3H6O2 | `CCC(=O)O` |
| benzoic acid | C7H6O2 | `OC(=O)c1ccccc1` |
| salicylic acid | C7H6O3 | `OC(=O)c1ccccc1O` |
| methyl acetate | C3H6O2 | `COC(C)=O` |
| ethyl acetate | C4H8O2 | `CCOC(C)=O` |
| methyl propanoate + | C4H8O2 | `CCC(=O)OC` |
| propyl formate + | C4H8O2 | `CCCOC=O` |
| isopropyl formate + | C4H8O2 | `CC(C)OC=O` |
| methyl benzoate | C8H8O2 | `COC(=O)c1ccccc1` |
| acetyl chloride | C2H3ClO | `CC(=O)Cl` |
| acetic anhydride | C4H6O3 | `CC(=O)OC(C)=O` |
| acetamide | C2H5NO | `CC(N)=O` |
| N-methylacetamide | C3H7NO | `CNC(C)=O` |
| N,N-dimethylformamide | C3H7NO | `CN(C)C=O` |
| urea | CH4N2O | `NC(N)=O` |
| methylamine | CH5N | `CN` |
| ethylamine | C2H7N | `CCN` |
| dimethylamine | C2H7N | `CNC` |
| N-methylethanamine + | C3H9N | `CCNC` |
| trimethylamine | C3H9N | `CN(C)C` |
| aniline | C6H7N | `Nc1ccccc1` |
| pyridine | C5H5N | `c1ccncc1` |
| acetonitrile | C2H3N | `CC#N` |
| chloromethane | CH3Cl | `CCl` |
| chloroethane | C2H5Cl | `CCCl` |
| 2-chloropropane | C3H7Cl | `CC(C)Cl` |
| bromoethane | C2H5Br | `CCBr` |
| 1-bromobutane + | C4H9Br | `CCCCBr` |
| 2-bromo-2-methylpropane (tert-butyl bromide) | C4H9Br | `CC(C)(C)Br` |
| dichloromethane | CH2Cl2 | `ClCCl` |
| chloroform | CHCl3 | `ClC(Cl)Cl` |
| chlorobenzene | C6H5Cl | `Clc1ccccc1` |
| benzene | C6H6 | `c1ccccc1` |
| toluene | C7H8 | `Cc1ccccc1` |
| o-xylene + | C8H10 | `Cc1ccccc1C` |
| m-xylene + | C8H10 | `Cc1cccc(C)c1` |
| p-xylene | C8H10 | `Cc1ccc(C)cc1` |
| styrene | C8H8 | `C=Cc1ccccc1` |
| naphthalene | C10H8 | `c1ccc2ccccc2c1` |
| methanethiol | CH4S | `CS` |
| ethanethiol | C2H6S | `CCS` |
| dimethyl sulfide | C2H6S | `CSC` |
| aspirin | C9H8O4 | `CC(=O)Oc1ccccc1C(=O)O` |
| ibuprofen | C13H18O2 | `CC(C)Cc1ccc(cc1)C(C)C(=O)O` |
| acetaminophen | C8H9NO2 | `CC(=O)Nc1ccc(O)cc1` |
| dopamine | C8H11NO2 | `NCCc1ccc(O)c(O)c1` |
| glycine | C2H5NO2 | `NCC(=O)O` |
| alanine (stereo stripped) | C3H7NO2 | `CC(N)C(=O)O` |

A unit test parses every entry, asserts the formula, and asserts that no two entries with different names are isomorphic (duplicate-hash entries must be genuine synonyms).

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
Lab pad: cells x ∈ [52, 76), z ∈ [52, 76), surface y = 8 (`LabTile`, edge ring `LabTileEdge`). Spawn at (64, 9, 64) facing −z. Terrain generator (`worldgen.ts`, seeded value noise, seed 1337, identical for every student): bedrock y=0, stone y=1..h−3, dirt to h−1, grass at h with h ∈ [6, 13] outside the pad (pad area flattened to 7 with LabTile at 8). Ore veins: for each element, 3×3×3 blobs placed in stone within 3 cells of the surface at a density that yields ≥ 400 blocks per element world-wide; one small exposed outcrop of each element within 12 blocks of the pad so C01 needs no digging.

### 6.2 Block ids (`blocks.ts`, Uint8)
| id | name | opaque | breakable | notes |
|---|---|---|---|---|
| 0 | Air | no | – | |
| 1 | Bedrock | yes | no | y = 0 |
| 2 | Stone | yes | yes | |
| 3 | Dirt | yes | yes | |
| 4 | Grass | yes | yes | top face greener |
| 5 | Sand | yes | yes | |
| 6 | Glass | no | yes | pad boundary posts |
| 7 | LabTile | yes | no | pad floor |
| 8 | LabTileEdge | yes | no | pad border marker |
| 32–39 | Ore: C, N, O, S, F, Cl, Br, I | yes | yes → 3 atoms | stone colour mixed 50 % with CPK colour; HUD names it |
| 64–71 | Atom: C, N, O, S, F, Cl, Br, I | **no** (drawn separately) | yes → returns to inventory | solid for collision |
Helpers: `isOre(id) = id >= 32 && id < 40`, `isAtom(id) = id >= 64 && id < 72`, `elementOf(id) = ELEMENTS[(id & 31) - 0]` with `ELEMENTS = ['C','N','O','S','F','Cl','Br','I']` (index = id − 32 for ore, id − 64 for atoms), `isOpaque(id) = id !== 0 && id !== 6 && !isAtom(id)`, `isSolid(id) = id !== 0`.

### 6.3 Meshing (`mesher.ts`, pure)
Culled ("naive") face meshing; greedy meshing is rejected (per-quad colour limits, no measurable gain at ~16k terrain blocks).
```ts
export interface MeshBuffers { pos: Float32Array; nor: Float32Array; col: Float32Array; idx: Uint32Array }
export const FACES: ReadonlyArray<{ dir: [number,number,number]; corners: [number,number,number][]; shade: number }>; // +y 1.0, -y 0.5, ±x 0.8, ±z 0.7; CCW from outside; indices [0,1,2, 0,2,3]
export function buildChunkMesh(get: (x,y,z) => BlockId, ox: number, oz: number, paletteLinear: Float32Array, out: MeshBuffers): number; // face count
```
For each non-air, non-atom cell and each of 6 directions, emit the face iff `!isOpaque(get(neighbour))` (neighbour lookups go through `World.getBlock` across chunk borders). Vertex colour = `palette[id] × FACES[f].shade` (grass top uses a second palette slot). Buffers are pooled once at worst case (8192 cells × 6 faces); Uint32 indices (a checkerboard chunk exceeds 65 535 vertices). `applyChunkMesh` (render module): dispose old geometry, `setAttribute` position/normal/color from `.slice()` copies, `setIndex`, **`computeBoundingSphere()`** (otherwise frustum culling pops chunks), mesh at chunk origin with `matrixAutoUpdate = false`. Shared `MeshLambertMaterial({ vertexColors: true })`. Scheduler rebuilds ≤ 2 dirty chunks per frame. Palette values are **linear** (`new Color(hex)` converts sRGB → linear; copy `.r .g .b`).

### 6.4 Picking (`raycast.ts`, pure)
Amanatides–Woo DDA: `raycastVoxels(ox,oy,oz, dx,dy,dz, maxDist = 6, get) → { x,y,z, nx,ny,nz, t, id } | null`. Direction unit length; `step = sign(d)`, `tDelta = |1/d|` (Infinity for 0), `tMax` = distance to first plane per axis; advance the smallest `tMax`, record the crossed axis as the normal (−step). Starting inside a solid returns normal (0,0,0) and placement is skipped. Ray origin = camera position, direction = `camera.getWorldDirection()`. Placement cell = hit + normal; rejected if out of bounds, not air, overlapping the player AABB, or (atoms) violating valence. A `BlockHighlight` (EdgesGeometry of a 1.002 box, 3:1-contrast outline) marks the targeted cell; for the bond wand a highlight marks the targeted bond.

Bond picking: `Raycaster.setFromCamera(new Vector2(0,0), camera).intersectObject(bondPickMesh)` where `bondPickMesh` is an InstancedMesh of fatter (0.3) boxes sharing the bond instance matrices, with `material.transparent = true, opacity = 0, depthWrite = false` (Raycaster does not consult material visibility). `instanceId → PairKey` lookup table maintained by `BondRenderer`.

### 6.5 Player physics (`player/physics.ts`, pure)
```ts
export const PLAYER = { halfW: 0.3, height: 1.8, eye: 1.62, speed: 4.3, sprint: 6.5, jumpVel: 8.5, gravity: -28, maxFall: -40 };
export function stepPlayer(p: PlayerState, input: FrameInput, dt: number, isSolid: (x,y,z) => boolean): void;
```
Fixed 1/60 s timestep with accumulator (real dt clamped to 0.1 s). Move per axis (x, z, then y); after each axis, test every cell overlapping the AABB; on collision snap to the cell face (±1e-4), zero that velocity component, set `onGround` on a −y collision; sub-step any axis delta > 0.5 blocks. Jump only when `onGround`. Atom cells are solid. Player cannot leave the world (x/z clamped to [0.3, 127.7]).

### 6.6 Rendering atoms, bonds and labels (`render/AtomRenderer.ts`, `BondRenderer.ts`, `element-texture.ts`)
- **Atoms**: one `InstancedMesh` per element (`BoxGeometry(0.62)`, max 1024 instances) with a runtime `CanvasTexture` per element that bakes the CPK background colour, a contrasting element symbol (~70 % of the face, bold sans) and a 6 px darker border; `texture.colorSpace = SRGBColorSpace`, mipmaps on, material colour white. Colours (`CPK_HEX`): C 0x3b3b3b (white text), N 0x2b5fe3 (white), O 0xe3242b (white), S 0xf2e21f (black), F 0x90e050 (black), Cl 0x1fd11f (black), Br 0x9e1b1b (white), I 0x940094 (white). Symbol labels satisfy WCAG 1.4.1 (colour never the only cue); a legend is in Help.
- **Implicit hydrogens**: a second InstancedMesh of small white studs (`BoxGeometry(0.16)`) placed on free faces of the atom cube (up to 4, faces chosen deterministically by free-direction order ±x, ±z, ±y), count = implicit H. Toggle in Settings ("Show hydrogens"), default on.
- **Bonds**: one `InstancedMesh` of `BoxGeometry(0.11, 0.11, 1.0)` grey 0x9a9a9a, one instance per bar; midpoint of the two cell centres, quaternion `setFromUnitVectors(+Z, axis)`; order 2 = two bars offset ±0.13 on a perpendicular (+Y for x/z bonds, +X for y bonds), order 3 = 0, ±0.17; bar width 0.08 for orders 2–3; aromatic-perceived bonds are drawn as order 1 plus a thin dashed inner bar (visual only; Kekulé orders remain editable). Max 4096 bars.
- **Rebuild policy**: `AtomRenderer.rebuild()` / `BondRenderer.update()` run on the frame after any atom/bond change (batched), iterating `MoleculeIndex`; `instanceMatrix.needsUpdate = true`, `mesh.count = n`.
- **Highlight of targeted molecule**: atoms of the targeted component get an emissive tint via `setColorAt` (instanceColor), cleared when the target changes.

### 6.7 Lighting, camera, fog
`HemisphereLight(0xdfe9ff, 0x6b6b6b, 1.0)` + `DirectionalLight(0xffffff, 1.2)` at (0.5, 1, 0.3), no shadows. `PerspectiveCamera(70°, aspect, 0.05, 120)`; `scene.fog = new Fog(0x9fc5e8, 40, 110)`, `scene.background` = same colour. Renderer: `new WebGLRenderer({ canvas, antialias: !lowGfx, powerPreference: 'high-performance' })`, `setPixelRatio(Math.min(devicePixelRatio, lowGfx ? 1 : 1.5))`, output colour space left at SRGB default.

### 6.8 Performance knobs
- `lowGfx` decided at start: `prefers-reduced-motion`, `hardwareConcurrency <= 4`, `/CrOS/.test(userAgent)`, or unmasked renderer string containing `SwiftShader`/`llvmpipe`; after 120 frames, mean frame time > 22 ms drops pixel ratio to 1 and disables H studs. User toggle "Low graphics" persisted in `localStorage['orgocraft.v1.settings']`.
- Draw calls: ≤ 64 terrain chunks (frustum culled) + 8 atom meshes + 1 H mesh + 1 bond mesh + 1 pick mesh + highlight ≈ 80.
- Skip rendering when `document.hidden` or an `IntersectionObserver` reports the canvas off-screen in the LMS page.
- `webglcontextlost` → `preventDefault`, pause, show overlay; `webglcontextrestored` → mark all chunks dirty, rebuild atom/bond meshes.
- Reduced motion: no head-bob, no FOV kick on sprint, instant HUD transitions, fades instead of flashes (nothing above 3 Hz; the "refused placement" flash is a single 300 ms fade of the highlight outline).
- `window.__orgocraft = { frames, triangles, calls, version }` updated each frame (smoke test + F3 overlay).

---

## 7. UI / HUD (`src/ui/`, all DOM elements overlaid on the canvas; nothing is painted in WebGL)

Layout inside `#stage` (position: relative): canvas fills the stage; overlays are absolutely positioned with 16 px gutters and a translucent dark backing (`rgba(10,12,16,0.78)`), text `#f4f6f8` (≥ 4.5:1), UI borders `#c9d1d9` (≥ 3:1). Theme tokens on `:root`; dark and light both provided.

- **Toolbar** (top): mode badge ("Connected to course gradebook" / "Progress saved on this device"), Fullscreen, Open in new tab (standalone only), Help (H), Settings, Save & Exit (LMS mode).
- **Crosshair** (centre): 2-colour (white with dark outline, 3:1 against any background); changes shape when the bond wand is active. `aria-hidden`.
- **Target-block info** (below crosshair): "Carbon ore — mine for 3 C", "Oxygen atom (2 bonds, 0 H)", "Bond C–O, order 1 (E: cycle)". Mirrored to the live region only on Analyze, to avoid chatter.
- **Hotbar** (bottom centre, `role="toolbar"`, `aria-label="Hotbar"`): 9 slots as buttons; slots 1–8 element (symbol, name in `aria-label`, count badge), slot 9 bond wand. Selected slot has a visible ring and `aria-pressed`. Wheel/number keys select. Inventory is the hotbar (no separate inventory screen in v1).
- **Molecule panel** (right, `aria-labelledby`): name (or "Unnamed"), formula with `<sub>`, DoU with decomposition, atom count, ring count, functional groups list (each with a "highlight atoms" button that tints the group's atoms), per-atom table on expand (element, bonds, implicit H, hybridization guess sp/sp2/sp3 from σ-partner count), warnings (`role="alert"` container: "Carbon has 5 bonds — remove one", "Planar 6-ring has an unintended chord", "Stray atom"). Auto-updates for the targeted molecule at ≤ 4 Hz.
- **Challenge panel** (left): "Challenge 7 of 25 — Decode the name", instruction text, points, status (not started / solved ✓), Submit button, Previous/Next buttons, progress bar ("Score 24 / 100 — 6 solved"), feedback text after Submit (specific reasons, see 3.1). All buttons reachable by Tab.
- **Pause menu** (Esc; `role="dialog"`, `aria-modal`, focus trapped inside, Esc/Resume returns focus to the canvas): Resume, Help, Settings, Remap keys, Save & Exit.
- **Help overlay**: controls table (3.2), look-mode hint, "How rings work on this grid" diagram (cube-corner hexagon), element colour legend with symbols, exit instructions ("Press Tab to leave the game area; Esc opens this menu and releases the mouse").
- **Settings** (persisted to localStorage): Low graphics, Show hydrogens, Reduced motion, Invert look Y, Mouse sensitivity, Keyboard turn rate, Key remapping (each action → one key; conflicts rejected), Theme (auto/dark/light).
- **Accessibility**: `<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">` receives at most one message per second: hotbar selection, Analyze summary ("Ethanol, C2H6O, alcohol (primary), 0 degrees of unsaturation, no warnings"), challenge results, mode changes. A second hidden `<section aria-label="Scene description">` holds a structured text mirror of the molecule panel plus the list of molecules on the pad (name/formula each), updated on change. Errors (refused placement) go to a `role="alert"` region. All interactive elements have visible focus rings (2 px `#ffd166` outline); the canvas shows a focus ring when focused. No timers anywhere. Colour is never the sole cue (symbols on atoms, glyphs for bond order in the panel, text for status).

---

## 8. Project structure

Pure = no DOM/WebGL imports, unit-tested in node. DOM/WebGL modules are exercised by the Playwright smoke test.

```
index.html                       stage div, canvas (tabindex=0), HUD roots, live regions, <title>OrgoCraft</title>
vite.config.ts                   base './', es2020, chunkSizeWarningLimit 1500, alias @ → src
vitest.config.ts                 node environment, test/**/*.test.ts
tsconfig.json                    strict, Bundler resolution
orgocraft.config.json            passMark (70), disabledChallenges [], version tag used by packagers
package.json                     scripts: dev/build/typecheck/test/package:d2l/package:scorm/smoke
scorm/imsmanifest.template.xml   manifest skeleton with {{FILES}} and {{MASTERY}} placeholders
scorm/xsd/*.xsd                  imscp_rootv1p1p2, adlcp_rootv1p2, imsmd_rootv1p2p1, ims_xml
scripts/check-relative-paths.mjs fails the build if dist/ has root-absolute URLs
scripts/package-d2l.mjs          dist/ → release/orgocraft-v<ver>-d2l.zip (versioned folder inside)
scripts/package-scorm.mjs        dist/ + manifest + XSDs → release/orgocraft-v<ver>-scorm12.zip (root-level)
scripts/smoke.mjs                Playwright smoke test (section 9.2)
src/main.ts                      entry: creates Game, handles fatal errors (no-WebGL message)
src/app/Game.ts                  DOM/WebGL — composition root: world, renderer, input, ui, lms; RAF loop with fixed-step physics
src/app/State.ts                 pure — current challenge, inventory, targeted molecule; tiny event emitter
src/app/Settings.ts              DOM (localStorage) — settings schema, defaults, load/save with try/catch
src/chem/types.ts                pure — Element, Atom, Bond, MoleculeGraph, Analysis, Warning
src/chem/valence.ts              pure — valence table, nextValence, maxValence
src/chem/graph.ts                pure — MoleculeGraph builders, adjacency, degree, cycle enumeration (≤ 6)
src/chem/smiles.ts               pure — SMILES subset parser → MoleculeGraph (Kekulé)
src/chem/kekulize.ts             pure — perfect-matching Kekulization for lowercase aromatic input
src/chem/hydrogens.ts            pure — implicit H + over-valence warnings
src/chem/aromatic.ts             pure — 6-ring aromaticity perception (4.6)
src/chem/formula.ts              pure — Hill formula, element counts, DoU, ring count
src/chem/groups.ts               pure — functional-group predicates (4.8), ordered, with atom sets
src/chem/wlhash.ts               pure — WL refinement, FNV-1a hash, symmetry classes
src/chem/isomorphism.ts          pure — VF2-style matcher with state cap
src/chem/compare.ts              pure — sameMolecule pipeline (H → perceive → labels → hash → VF2)
src/chem/analyze.ts              pure — analyze(graph) → Analysis (formula, DoU, groups, name, warnings)
src/chem/naming.ts               pure — library index by hash, nameOf(graph)
src/content/molecules.json       library (5.2)
src/content/challenges.json      roster (5.1)
src/content/challenges.ts        pure — Challenge types, acceptance evaluation (exact/predicate/set), feedback strings
src/content/library.ts           pure — load + validate molecules.json at startup
src/world/blocks.ts              pure — block ids, isOre/isAtom/isOpaque/isSolid, elementOf, palette hex table
src/world/chunk.ts               pure — Chunk class, cidx
src/world/world.ts               pure — World get/set, dirty marking, MoleculeIndex hookup
src/world/worldgen.ts            pure — seeded terrain + ore placement + lab pad
src/world/mesher.ts              pure — buildChunkMesh into pooled MeshBuffers
src/world/raycast.ts             pure — Amanatides–Woo voxel DDA
src/world/molecule-index.ts      pure — atoms/bonds maps, incremental updates, components, valence checks for placement/bond changes
src/world/extract.ts             pure — MoleculeIndex component → MoleculeGraph
src/player/physics.ts            pure — PLAYER constants, stepPlayer AABB sweep
src/player/camera.ts             three — FirstPersonCamera (yaw/pitch → camera)
src/input/InputManager.ts        DOM — key set, focus handling, preventDefault policy, wheel, contextmenu, blur clearing
src/input/pointerlock.ts         DOM — tryPointerLock with fallbacks and 150 ms verification
src/input/look-modes.ts          DOM — locked / drag / keys sources feeding the camera; touch
src/input/keymap.ts              pure — default bindings, remap validation, serialization
src/render/Renderer.ts           three — WebGLRenderer setup, lowGfx detection, resize (ResizeObserver), context loss, __orgocraft counters
src/render/ChunkRenderer.ts      three — applyChunkMesh, rebuild scheduler (≤ 2/frame), shared material
src/render/AtomRenderer.ts       three — per-element InstancedMesh + H studs + target tint
src/render/BondRenderer.ts       three — bond bars, pick mesh, instanceId → PairKey
src/render/Highlight.ts          three — block and bond outline
src/render/element-texture.ts    DOM canvas — makeElementTexture(symbol, bg, fg)
src/render/palette.ts            three — linear palette Float32Array from blocks.ts hex table
src/render/lights.ts             three — hemisphere + directional + fog
src/ui/hud.ts                    DOM — mounts all panels, throttled updates from State
src/ui/toolbar.ts                DOM — badge, fullscreen, open-in-new-tab, help, settings, save & exit
src/ui/hotbar.ts                 DOM — slots, counts, selection, ARIA toolbar
src/ui/molecule-panel.ts         DOM — Analysis rendering, group highlight buttons, warnings alert
src/ui/challenge-panel.ts        DOM — roster navigation, submit, feedback, progress
src/ui/settings-panel.ts         DOM — settings form + key remap
src/ui/pause-menu.ts             DOM — dialog with focus trap
src/ui/help.ts                   DOM — controls table, ring diagram (inline SVG), legend
src/ui/live-region.ts            DOM — status/alert queues with 1 s throttling; scene description mirror
src/ui/styles.css                tokens, layout (aspect-ratio stage), focus rings, sr-only, dark/light
src/lms/scorm-api.ts             DOM (window walk) — ScormApi12 interface, discover()
src/lms/ScormAdapter.ts          DOM — init/commit/finish sequence, throttling, visibility/pagehide hooks
src/lms/Progress.ts              pure — score model, suspend_data encode/decode, merge rule
src/lms/storage.ts               DOM — guarded localStorage get/set
src/util/prng.ts                 pure — mulberry32
src/util/noise.ts                pure — 2-D value noise
src/util/throttle.ts             pure — throttle/debounce helpers
test/chem/*.test.ts              parser, hydrogens, formula/DoU, aromatic, groups, compare, naming, library validation
test/content/challenges.test.ts  every challenge's acceptance against positive and negative builds
test/world/*.test.ts             mesher, raycast, molecule-index, worldgen invariants
test/player/physics.test.ts      collision sweep
test/lms/progress.test.ts        score model, suspend_data length/roundtrip, merge
docs/DESIGN.md                   this document
docs/SCOPE.md                    earlier instructor wish list (superseded where in conflict)
docs/INSTRUCTOR.md               D2L upload/SCORM steps, gradebook settings, troubleshooting
.github/workflows/build.yml      typecheck, test, build, package, smoke, upload release/*.zip
```

---

## 9. Test plan

### 9.1 Vitest unit tests (node, pure modules)
Chemistry (`test/chem/`):
- `smiles.test.ts`: branches, nested branches, ring closures incl. `%10` and number reuse (`C%10CCCCC%10` ≡ `C1CCCCC1` ≡ `C2CCCCC2`), bond symbols on either/both closure ends, bracket atoms with H count, `.` components, error cases (unmatched closure `C1CCC`, charge, unknown symbol, cannot-kekulize `c1ccc1` is *allowed* to fail).
- `hydrogens.test.ts`: OpenSMILES rule for every element; over-valence warning for a C with 5 bonds; N with 4 bonds.
- `formula.test.ts`: Hill order (`C9H8O4`, `CH4N2O`, `CHCl3`, `ClCCl` → `CH2Cl2`), DoU for all library entries equals rings + π bonds; ring count for cyclohexane (1), naphthalene (2), butane (0).
- `aromatic.test.ts`: both Kekulé forms of o-xylene, aspirin, salicylic acid, naphthalene hash equal; benzene ≠ 1,3-cyclohexadiene ≠ 1,3,5-hexatriene; quinone not aromatic; pyridine aromatic; styrene's vinyl C=C remains an alkene.
- `groups.test.ts`: the 40-molecule probe set from the research with expected hit sets (e.g. `[OX2H]`-style pitfalls: acetic acid is acid only, phenol is phenol only, ethyl acetate is ester only, acetic anhydride is anhydride only, methyl formate is ester, DMF is amide not aldehyde, aniline is aryl amine not amine, chlorobenzene is aryl halide, acetyl chloride is acyl halide not alkyl halide, aspirin is acid + ester + arene, nitrogen of pyridine is nothing).
- `compare.test.ts`: isomer families C4H10 (2), C5H12 (3), C6H14 (5), C3H8O (3), C4H10O (7), C4H8 (5 constitutional), C4H8O carbonyl (3) are pairwise distinct; rewritten pairs equal (`CCCCC(C)`=`CCCCCC`, `OCCCC`=`CCCCO`, `O=C1CCCCC1`=`C1(=O)CCCCC1`); WL hash equality implies VF2 success for every library pair; a regular-graph WL collision fixture is caught by VF2; state cap returns false.
- `naming.test.ts` / `library.test.ts`: every library entry parses, formula matches, no two different names are isomorphic, `nameOf(parse(smiles)) === name`.
Content (`test/content/challenges.test.ts`): for each challenge, at least one positive build (as SMILES) is accepted and two negatives are rejected with the expected feedback kind (e.g. C19 rejects o- and m-xylene; C04 rejects ethanol; C11 rejects cyclobutene; C22 accepts all four esters and rejects butanoic acid; set challenges reject a stray atom and a missing isomer). `suspend_data` for all-solved < 100 chars.
World (`test/world/`):
- `mesher.test.ts`: one block in an empty 3×3×3 → 6 faces / 24 vertices / 36 indices; two adjacent → 10 faces; block next to an atom cell → face still emitted; block next to glass → face emitted; full 16×32×16 solid chunk → only boundary faces; vertex colours are palette × shade.
- `raycast.test.ts`: known hit cell and normal on each axis; miss beyond maxDist; ray starting inside a block returns zero normal; diagonal ray crosses the expected cells.
- `molecule-index.test.ts`: placing adjacent atoms creates bonds; removal deletes bonds; valence refusal (5th neighbour on C; 3rd on O); bond-order raise refused at valence; extraction yields correct components and deterministic atom order; cube-corner hexagon has no chord, planar 2×3 hexagon has one.
- `worldgen.test.ts`: pad is flat and LabTile; ≥ 400 ore per element; an outcrop of each element within 12 blocks of spawn; determinism for seed 1337.
Player: `physics.test.ts`: falls and lands on ground (onGround true, y snapped), cannot walk through a wall, no tunnelling at maxFall, jump only when grounded.
LMS: `progress.test.ts`: raw computation with disabled challenges, monotonic raw, passed/incomplete/failed rules, encode/decode roundtrip, merge prefers the copy with more solved bits; `ScormAdapter` against a 20-line fake `window.API` recording calls (init → set min/max → status incomplete → commit; milestone writes raw only when > 0; finish exactly once).

### 9.2 Playwright smoke test (`scripts/smoke.mjs`, `npm run smoke`)
- Launch `playwright-core` chromium with `executablePath = process.env.CHROME_PATH ?? glob($PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux*/chrome)` (the installed chromium-1194 does not match playwright-core 1.63's expected 1243). Headless WebGL2 on SwiftShader is verified to work.
- Serve `dist/` with a tiny node http server under the nested path `/content/enforced/12345-ORGO/orgocraft-v1/` (proves relative base) and, in a second run, inside a same-origin wrapper page that iframes it with a fake `window.API` (proves SCORM discovery through `parent`).
- Fail on any `pageerror` or console error; `waitForFunction(() => window.__orgocraft?.frames > 10 && window.__orgocraft.triangles > 0, null, { timeout: 20000 })`.
- Scripted play: focus canvas, press `1`, `E` to place a carbon (after positioning via a debug hook `window.__orgocraft.teleport(...)` exposed only when `?debug=1`), expect the molecule panel to read "Methane"; press Enter, expect challenge C01 to be marked solved and the fake API to have received `cmi.core.score.raw`.
- Keyboard-only pass: Tab from the toolbar to the canvas and back (no trap); Esc opens the pause menu and focus lands on "Resume".
- Screenshot to `test-results/smoke.png`; non-zero exit on failure. CI installs the full `playwright@1.63.0` and runs `npx playwright install --with-deps chromium`.

### 9.3 Manual D2L checklist (in `docs/INSTRUCTOR.md`, run on the real course shell before release)
1. Manage Files path: zip uploads, unzips, topic opens; DevTools shows no MIME/404 errors for `assets/index-*.js` under `/content/enforced/`.
2. The stage is not squashed to 580 px; no vertical scroll trap in the D2L page; Fullscreen button works from inside the viewer.
3. Click locks the pointer; Esc releases it and opens the menu; if lock fails, drag-look works and the hint appears; arrow-key look works.
4. Space and arrows do not scroll the D2L page while the canvas is focused; they do scroll normally once focus leaves the canvas (Tab).
5. Keys never stick after clicking the D2L chrome mid-press.
6. Whole game completable keyboard-only (Q/E/F/Enter/arrows).
7. NVDA or VoiceOver announces hotbar changes, Analyze results and challenge results; the scene description is readable.
8. SCORM path (new player, new window): badge says "Connected to course gradebook"; solve C01–C03, Save & Exit; Grades shows the raw score; open again as the same test student — progress resumes; a second attempt with a lower score does not lower the Highest Attempt grade.
9. SCORM embedded mode also works (smaller stage, Fullscreen available).
10. Chrome with third-party cookies blocked and Safari: content loads; note any popup blocking in new-window mode.
11. Re-release to a new versioned folder shows the new build without clearing cache.
12. If the campus enables D2L's HTML sandbox option: scripts still run, pointer lock is refused gracefully, keyboard play works.

---

## 10. Risks, mitigations, v2

### Risks and mitigations
| Risk | Mitigation |
|---|---|
| Pointer lock unavailable or flaky in D2L (sandboxed iframe, SCORM frame, post-Esc relock rejection, Chrome policy changes) | Drag-look and arrow-key look are first-class; on-screen mode hint; never auto-relock; "Open in new tab"/Fullscreen. |
| D2L specifics (MIME types, iframe height, sandbox option, Lessons viewer) were only verifiable from secondary sources | Early real-shell test (checklist 9.3) in the first sprint; layout sized by width; no reliance on any specific MIME type (single JS bundle only). |
| SCORM API not reachable from the Content Service frame layout, or D2L not applying `masteryscore` | Adapter degrades to standalone with a visible badge; we write `passed`/`failed` and always emit numeric `score.raw`; SCORM Cloud test before hand-off. |
| New SCORM player resume bugs / progress reset | localStorage mirror of `suspend_data` merged on resume; Highest Attempt grading recommended. |
| `suspend_data` 4096-char cap | Bitmask codec < 100 chars; unit-tested; move to SCORM 2004 only if v2 needs more state. |
| Kekulé ambiguity breaks aromatic targets | Aromaticity perception (4.6) on both sides; unit tests on both Kekulé forms incl. naphthalene. |
| WL hash collisions / VF2 blow-up | VF2 always confirms; degree/label pre-filters; 200k-state cap. |
| Bipartite lattice: students try flat hexagons and odd rings | Help diagram, C12 hint, panel warning "unintended chord"; odd-ring molecules excluded from v1 content. |
| Auto-bonding creates unintended bonds when building compactly | Placement refused when valence is exceeded (never silently dropped); ring count and per-atom bond table visible; H studs make bonding visible. |
| Predicate challenges accept unintended molecules | Each predicate's accepted set is enumerated in `challenges.test.ts` and reviewed (C11, C13, C16, C22 documented). |
| Stale `index.html` after same-name re-upload | Versioned folders; hashed assets; instructor doc. |
| Low-end GPUs / context loss / SwiftShader | lowGfx heuristics, pixel-ratio cap, context-loss handling, ≤ 80 draw calls. |
| Accessibility conformance of a 3D game is inherently partial | Keyboard-only path, live region and text mirror, no timers, contrast-checked DOM HUD; instructor notified that an accommodation plan (e.g. DOM-only builder, v2) may still be needed. |
| Scope disagreement with `docs/SCOPE.md` (stereo, reactions in v1) | Documented as superseded here; open question 1; data model keeps positions and bond orders so v2 can add stereo and a reaction bench without migration. |

### v2 ideas (short list)
1. **Reactions bench**: rule engine producing product graphs for SN1/SN2/E1/E2 and alkene/alkyne additions (McMurry 8–11), graded by the same comparator.
2. **Stereochemistry**: R/S from grid geometry (seesaw placements, CIP priorities), E/Z from coplanar substituents, planar-centre warnings; enable stereo-aware comparison.
3. **IUPAC naming**: generator for acyclic alkanes/alkenes/alkynes/alcohols/ketones/acids first; library lookup remains the fallback.
4. Diagonal-bond wand (odd rings: cyclopropane, epoxides, five-membered heterocycles, caffeine), charge tool (nitro, carboxylate, carbocations), acids/bases "most acidic H" quiz, 13C signal count from WL symmetry classes, DOM-only accessible builder mode.


## Key decisions

- **Scope**: v1 has no stereochemistry, no reaction bench, no charges, no odd rings, no explicit H blocks; docs/SCOPE.md items beyond this are moved to v2 and the design document states it supersedes SCOPE.md where they conflict. _(The task fixes v1 scope; SCOPE.md was an earlier wish list. Keeping positions and Kekulé bond orders in the data model lets v2 add stereo/reactions without migration.)_
- **Deployment**: Ship two packages from one build: a versioned-folder zip for Manage Files (standalone mode) and a root-level SCORM 1.2 single-SCO zip with XSDs; pass mark from orgocraft.config.json (default 70). _(Manage Files is the low-risk path for content without a grade; only SCORM writes to the gradebook. Both need Vite base './' which the repo already has.)_
- **SCORM**: ScormAdapter walks parent/opener chains with try/catch, writes score.min/max on init, writes score.raw only when > 0, writes passed/failed itself, commits on milestones/visibilitychange, finishes once on pagehide or Save & Exit; suspend_data is a versioned bitmask string mirrored to localStorage. _(D2L only records cmi.core.score.raw; the Content Service is a different origin; new-player resume bugs are reported; SCORM 1.2 caps suspend_data at 4096 chars.)_
- **Score model**: raw = round(100 * earned / total points) with easy 1 / medium 2 / hard 4 weights, monotonic within an attempt; instructor can disable challenges via config to change the total. _(Maps 1:1 onto a 100-point grade item, never lowers a reported score, and lets an Orgo I course exclude second-semester challenges.)_
- **Controls**: Own FirstPersonCamera fed by three look sources (pointer lock, drag, arrow keys) instead of three's PointerLockControls; Q/E/F/Enter keyboard equivalents for mine/place/analyze/submit; shortcuts active only when the canvas has focus. _(PointerLockControls swallows the requestPointerLock rejection; D2L iframes may refuse pointer lock; WCAG 2.1.1/2.1.4 require keyboard operation and focus-scoped single-key shortcuts.)_
- **Chemistry comparator**: Kekulé graph + implicit H + 6-ring aromaticity perception, then WL hash (FNV-1a) as filter and VF2-style backtracking as arbiter; no canonical SMILES generator. _(Reference implementation agreed with RDKit on 5,671 library pairs; WL alone is not a proof; perception is required or ortho-disubstituted aromatics fail for half of correct builds.)_
- **Aromaticity rule**: A 6-cycle of C/N atoms each with exactly one double bond is aromatic if every atom's double-bond partner is in the cycle or in an adjacent candidate cycle. _(The research's 'exactly one ring double bond within this ring' rule fails one Kekulé form of naphthalene; the partner-based rule handles fused rings and still rejects quinones and exocyclic methylenes.)_
- **SMILES targets**: Runtime parser supports lowercase aromatic input with a TypeScript Kekulization (perfect matching), so library entries are stored as verified ordinary SMILES and no Python/RDKit step is in the build. _(Avoids a second toolchain; molecules are small enough that backtracking matching is trivial; a unit test validates every entry's formula.)_
- **Functional groups**: Ordered TypeScript graph predicates with atom claiming (acid → anhydride → acyl halide → ester → amide → aldehyde → ketone → phenol → alcohol → ether → aryl amine → amine → nitrile → alkyl halide → aryl halide → thiol → sulfide → alkene → alkyne → arene → alkane); SMARTS kept as documentation and test oracle. _(No SMARTS engine needed in the browser; the exclusion order reproduces the corrected RDKit-verified patterns and avoids the documented pitfalls.)_
- **Bonding model**: Single bonds form automatically between face-adjacent atom blocks; placements or bond-order raises that would exceed valence are refused with a message rather than silently dropping bonds; bond wand cycles 1→2→3→1. _(Unambiguous behaviour and an immediate valence lesson; avoids hidden state where a bond exists geometrically but not chemically.)_
- **Engine**: WebGLRenderer, 8x8 chunks of 16x32x16 Uint8 blocks, culled face meshing with Uint32 indices and linear vertex colours, Amanatides–Woo picking, per-axis AABB physics at 60 Hz, atoms as per-element InstancedMesh with baked CPK+symbol canvas textures, bonds as instanced bars, implicit-H studs. _(Smallest bundle and widest GPU support; ~80 draw calls; symbol labels satisfy WCAG 1.4.1; one Uint8 grid is the single source of truth for collision, picking and chemistry.)_
- **Content**: 25 ordered challenges (research C01–C23 + C27, with C08 split into ethene/ethyne and C13 made exact) and a ~90-entry verified molecule library excluding odd-ring and charged species. _(Stays within the 15–25 roster, one acceptance rule per challenge, every entry buildable on the bipartite grid.)_
- **Persistence**: Only challenge progress and score are graded state; world edits and inventory are not persisted to the LMS (inventory mirrored to localStorage only); world is deterministic (seed 1337). _(Keeps suspend_data tiny and identical worlds for all students; nothing in the score depends on world state.)_
- **Testing**: Vitest for all pure modules (chemistry, content acceptance, mesher, DDA, physics, progress codec), Playwright smoke under a nested path with a fake SCORM parent, manual D2L checklist. _(Pure/impure split makes the chemistry and engine cores testable in node; the smoke test proves relative base and API discovery without a D2L instance.)_

## Open questions for the instructor

- Scope: docs/SCOPE.md lists stereochemistry (R/S, E/Z) and a reaction bench (McMurry chapters 5, 8, 9, 11) for v1, while this design defers both to v2 and includes aromatic and carbonyl-derivative challenges (C18–C25) instead. Default chosen: ship v1 as designed here; confirm whether you want the aromatic/carbonyl challenges disabled for an Organic I section (set disabledChallenges in orgocraft.config.json) and stereo/reactions prioritized for v2.
- Grading: default pass mark is 70 on a 100-point grade item with Highest Attempt calculation, all 25 challenges counting (45 points total). Confirm the pass mark, whether the item should be pass/fail-graded at all (otherwise lesson_status is reported as completed), and which challenges count.
- Launch: default recommendation is the SCORM package opened in a new window (bigger stage, fewer iframe restrictions), with the Manage Files upload offered for ungraded use. Confirm whether your campus's D2L has the new SCORM player (Content Service) enabled and whether the course uses the classic Content viewer or Lessons, so the manual checklist can be run against the right viewer.
