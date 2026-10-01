# Review: D2L Brightspace and SCORM 1.2 integration (v1.0.0)

Read-only review of the release zips, `src/lms/*`, the Game/State wiring,
toolbar and pause menu, input, renderer resize, `index.html`, the packaging
scripts and `docs/INSTRUCTOR.md`, against `docs/design/08-deployment.md` and
the SCORM/D2L research. **No blocker.** Both packages import-ready; the grade
path is monotonic, per-student, and never auto-commits a restored local record.

## Major

1. **`isNewAttempt` requires `cmi.core.entry === 'ab-initio'`** (`src/lms/Progress.ts`
   `isNewAttempt()`, consumed by `ScormAdapter.run()` step 7). SCORM 1.2 allows
   `entry` to be `''` on a fresh attempt. Then, after an instructor reset
   (status `not attempted`, raw 0, empty suspend), `resume()` restores the
   device mirror and the next milestone writes the pre-reset score into the
   reset attempt. Since this SCO writes `incomplete` and commits at step 6 of
   every session, `not attempted` + raw 0 + empty suspend alone proves a new
   attempt. Fix:
   `return lmsString === '' && (entry === 'ab-initio' || entry === '') && (initialStatus === 'not attempted' || initialStatus === '') && lmsRaw === 0;`
   (only `entry === 'resume'` blocks the discard). Update test P-R9
   (`('', 'not attempted', '', 0)` → `true`) and A-M11 (an
   `{ 'cmi.core.entry': '' }` variant should discard); update 08 §3.7 row 1.

## Minor

2. **Review/browse sessions write the mirror** (`ScormAdapter.ts` `run()` step 10
   `writeMirror()`, `update()`, `milestone()` when `readOnly`). A later normal
   launch restores and reports work done outside the graded window. Fix: when
   `readOnly`, disable the mirror (`mirrorEnabled = !readOnly` checked in
   `writeMirror()`), skip step 10; add adapter test "review mode writes no mirror".
3. **Standalone shares one mirror key (`local`)**; INSTRUCTOR.md §3 promises
   isolation without qualifying it to Path B. Fix (doc): §1 add "Path A keeps
   progress per browser, not per student: on shared computers students will
   see each other's progress; use Path B for anything graded." §3 prefix with
   "In Path B,". §6 badge row: add "progress made in that state is not graded
   and is shared on that computer".
4. **`LMSInitialize` returning `'false'` with error 101 (already initialized) is
   treated as no LMS** (`ScormAdapter.run()`). Fix: after `'false'`, read
   `LMSGetLastError()`; if `'101'`, continue as initialized (log warn).
5. **INSTRUCTOR.md §3 says `failed` is written only by the game**; with
   `<adlcp:masteryscore>70</adlcp:masteryscore>` the LMS may itself set
   `failed` on exit below 70. Fix (doc): §3 add "Brightspace may also mark the
   attempt *failed* on its own whenever a student exits below 70 % (SCORM
   mastery rule); this does not change the score and the student can still
   resume." §5 add a check: "Save & Exit at a low score, then look at the SCORM
   report: status is *incomplete* (game) or *failed* (Brightspace mastery
   rule); either is fine."
6. **Finished-overlay text assumes a player Exit button and a window**
   (`src/ui/strings.ts` `finishedBody`; INSTRUCTOR §4, §5 step 6). Fix:
   `finishedBody: 'You can close this window, or go back to the course.'`;
   INSTRUCTOR §5 step 6: "Close the window (new-window mode) or return to the
   course (embedded)". Keep no `window.close()`.
7. **Safety copy unavailable in the embedded cross-site player when third-party
   storage is blocked** (Safari; Chrome with third-party cookies blocked);
   `storage.ts` behaves correctly, the guide does not say so. Fix (doc): §4
   embedded player: "the browser safety copy may be unavailable in Safari or
   with third-party cookies blocked; new-window mode is unaffected"; §5 step 10:
   "confirm resume still works there (it relies on Brightspace, not the safety copy)".
8. **`#stage[data-framed="true"] { height: 100vh }` inside D2L's auto-height
   classic viewer needs a live stability check** (`src/ui/styles.css`,
   `src/main.ts` framed detection). Correct for the fixed-height cross-origin
   SCORM frame (Path B); unverified for same-origin Path A. Fix: INSTRUCTOR §5
   step 2: "watch the frame for ~30 s: its height must not keep growing". If it
   grows, apply a width-driven box (`aspect-ratio: 16/9; min-height: 480px`)
   only for the same-origin frame (`window.top.location` readable).
9. **INSTRUCTOR.md covers only the classic Content tool.** Fix: §2 add "In the
   New Content Experience the same dialog is reached with *Create New →
   SCORM/xAPI*; the options are identical." §1 add "In the New Content
   Experience use *Add Existing → Upload/Course files*."
10. **`ims_xml.xsd` binds the XML namespace as the default namespace**;
    namespace-aware parsers reject it (xmllint: "xml namespace URI cannot be
    the default namespace"). Canonical IMS file; D2L does not validate control
    files. Optional fix: delete the `xmlns="http://www.w3.org/XML/1998/namespace"`
    attribute from `scorm/xsd/ims_xml.xsd` (targetNamespace stays).
11. **`.github/workflows/build.yml` absent at review time** (being written);
    the `smoke` step needs `npm run build` first and `scripts/smoke.mjs` does
    not check `dist/` freshness itself.

## Verified correct (summary)

- D2L zip: three entries under `orgocraft-v1.0.0/`, relative asset paths
  only, no root-absolute URLs, no restricted extensions, bytes identical to `dist/`.
- SCORM zip: `imsmanifest.xml` first and at the root, four XSDs with matching
  target namespaces, every href present, single SCO, masteryscore 70 equals
  `orgocraft.config.json.passMark`; manifest well-formed and schema-valid
  against the full imscp+adlcp+imsmd set.
- Discovery order and guards; `LMSInitialize`/`LMSFinish` exactly once;
  `LMSCommit` before `LMSFinish`; score.min/max/raw as strings; monotonic raw;
  `passed` never withdrawn; `failed` only at Save & Exit with all attempted;
  `exit` never `logout`; worst-case suspend_data 154 chars for 91 challenges;
  per-student mirror keyed by sanitized student id with a score gate after a
  local restore; error paths (Initialize false, SetValue false, API throwing,
  no storage) handled.
- Grade trace: `State.evaluateCurrent` → `applyOutcome` → `milestone` →
  `lmsWrite` → `LMSSetValue('cmi.core.score.raw')` → `LMSCommit`; a new
  attempt reports nothing until the first solve, so Highest Attempt never lowers.
- UI/iframe: badges match the guide; Save & Exit without `window.close()`;
  stage sizing and renderer resize; keyboard scroll prevention scoped to the
  active canvas; pointer lock requested in the click handler with verified
  fallback; fullscreen hidden when unsupported.
