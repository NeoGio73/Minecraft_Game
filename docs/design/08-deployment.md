# 08 — Deployment: LMS adapter, persistence, packaging, instructor guide, CI

Owner: WP-10 (`src/lms/*`, `scorm/`, `scripts/check-relative-paths.mjs`, `scripts/package-*.mjs`, `docs/INSTRUCTOR.md`) and WP-11 for `.github/workflows/build.yml` and the `Game.ts` wiring in §6.10. Conforms to `docs/design/00-contracts.md` §4 and `src/lms/types.ts` (names and shapes used verbatim). Precedence: `docs/SCOPE.md` > 00-contracts > this document > `docs/research/scorm.md`, `docs/research/d2l-hosting.md`, `docs/research/critic-round1.md` > `docs/DESIGN-draft-revised.md` §2, §8, §9.2, §9.3.

Critic items closed here (critic-round1): **2.6** per-student mirror key from `cmi.core.student_id`, no automatic score commit after a local restore — enforced by the adapter's `scoreGate` on every write path, not only in `start()` (§3.6 W9, §3.7, §6.3); **2.6 exit** `cmi.core.exit` never `logout` (§3.6); **2.6 Save & Exit** no `window.close()` (§6.6); **2.5/2.6 attempted** the `attempted` bitmask is in `suspend_data` (§3.4); **2.4** stage sizing in a fixed-height cross-origin iframe (§7); **5.1** the total is never a literal (§3.3).

## 0. Files, modes, one-paragraph model

| File | Kind | Holds |
|---|---|---|
| `src/lms/types.ts` | pure (contract, read-only) | `ScormApi12`, `ProgressState`, `RosterInfo`, `ScoreSummary`, `LmsWrite`, `ResumeDecision`, `AdapterMode`, `MODE_BADGE`, storage keys, limits |
| `src/lms/Progress.ts` | pure | score model, `suspend_data` codec, local-mirror codec, `lmsWrite`, `exitValue`, `resume` |
| `src/lms/storage.ts` | DOM (reads `localStorage` inside one guarded function) | `StorageLike`, `safeLocalStorage()`, mirror read/write/clear |
| `src/lms/scorm-api.ts` | DOM (window walk) | `WindowLike`, `findApi`, `discover`, `isScormApi` |
| `src/lms/ScormAdapter.ts` | DOM-free class with injected deps (§6.1); `browserDeps()` touches `window`/`document` only when called | discovery loop, call sequence, throttling, lifecycle hooks, standalone mode |
| `scorm/imsmanifest.template.xml` | data | §10.1 |
| `scorm/xsd/*.xsd` | data | four SCORM 1.2 control files (§10.2) |
| `scripts/check-relative-paths.mjs` | node | §8.2 |
| `scripts/package-d2l.mjs` | node | §9 |
| `scripts/package-scorm.mjs` | node | §10.3 |
| `docs/INSTRUCTOR.md` | doc | §11 (exact content) |
| `.github/workflows/build.yml` | CI | §12 |
| `test/lms/progress.test.ts`, `test/lms/adapter.test.ts`, `test/lms/scorm-api.test.ts`, `test/lms/packaging.test.ts` | vitest, node | §13 |

Model in one paragraph. The game has one progress record per learner (`ProgressState`): four bitmasks over roster index (`attempted ⊇ solved ⊇ reduced`, `attempted ⊇ exhausted`), the points earned, the highest raw score ever written to the LMS in this attempt, and the current challenge id. The record is serialised to a `v2|…` string that is (a) written to `cmi.suspend_data` in LMS mode and (b) mirrored, with an extra isomer-hash field, to `localStorage['orgocraft.v1.progress.<studentId>']` in both modes. At launch the adapter finds `window.API` (walking parents, then openers), initialises, reads the learner id and the stored string, merges it with the learner's own mirror (or discards the mirror when the LMS says this is a brand-new attempt, §6.2 step 7), and plays. A record restored from the mirror is never reported by itself: `scoreGate` holds back `score.raw`, `passed` and `failed` until the learner earns the next milestone. Every solved challenge is a milestone: the raw score (percent of enabled points, integer, monotonic) is written together with the status and the suspend string, then committed. Session end (Save & Exit, or `pagehide`) writes `cmi.core.exit` (`suspend`, or `''` when everything is solved), commits, and calls `LMSFinish` once. Without an API the game runs in standalone mode with the mirror only.

## 1. Contract additions

Exact TypeScript. Nothing here edits `src/lms/types.ts`; these live in the files named in the comments.

```ts
// src/lms/Progress.ts ---------------------------------------------------------
import type { ProgressState, RosterInfo, ScoreSummary, LmsWrite, ResumeDecision, ExitValue, Outcome } from './types';

export class ProgressDecodeError extends Error {
  constructor(message: string, readonly field: number) { super(message); this.name = 'ProgressDecodeError'; }
}
/** Empty state for a learner. */
export function emptyState(studentId: string): ProgressState;
/** state with currentChallengeId replaced (no other change). */
export function withCurrent(state: ProgressState, challengeId: string): ProgressState;
/** state with isomersDone[challengeId] = hashes (used by isomer-set acceptance). */
export function withIsomers(state: ProgressState, challengeId: string, hashes: readonly string[]): ProgressState;
/** Suspend-data codec (8 fields). */
export function encode(state: ProgressState): string;
export function decode(s: string, studentId: string): ProgressState;               // throws ProgressDecodeError
/** Local-mirror codec (10 fields = suspend + isomers + studentId). */
export function encodeLocal(state: ProgressState): string;
export function decodeLocal(s: string, studentId: string): ProgressState;          // throws ProgressDecodeError
export function applyOutcome(state: ProgressState, index: number, outcome: Outcome, points: number): ProgressState;
/** An attempt-limited challenge whose attempts are used up with the answer revealed (`attempts-exhausted`):
 *  sets attempted|exhausted, never solved. Idempotent. */
export function applyExhausted(state: ProgressState, index: number): ProgressState;
export function summarize(state: ProgressState, roster: RosterInfo): ScoreSummary;
/** scoreGated = true (adapter after a local restore, §3.7): scoreRaw is null and lessonStatus is computed
 *  from reportedRaw alone (no 'passed'/'failed' from a restored record). Default false. */
export function lmsWrite(state: ProgressState, roster: RosterInfo, atExit: boolean, scoreGated?: boolean): LmsWrite;
/** '' when every enabled challenge is solved, else 'suspend'. Never 'logout' or 'time-out'. */
export function exitValue(summary: ScoreSummary): ExitValue;
export function resume(lmsString: string, localString: string | null, studentId: string, roster: RosterInfo): ResumeDecision;
/** true when the LMS launch is a brand-new attempt (instructor reset or first launch): empty suspend_data,
 *  entry 'ab-initio', status 'not attempted' or '', score.raw 0. The adapter then discards the mirror (§6.2 step 7). */
export function isNewAttempt(entry: string, initialStatus: string, lmsString: string, lmsRaw: number): boolean;
/** cmi.core.student_id -> storage-safe id: trim, [^A-Za-z0-9_.@-] -> '_', first 64 chars. '' stays ''. */
export function sanitizeStudentId(raw: string): string;
/** CMITimespan "HHHH:MM:SS.SS" for a duration in ms (hours 2..4 digits, capped at 9999). */
export function formatTimespan(ms: number): string;
/** Rank used by resume(): [popcount(solved), popcount(attempted), earned], compared lexicographically. */
export function progressRank(state: ProgressState): readonly [number, number, number];
/** Number of set bits. */
export function popcount(mask: bigint): number;
/** Challenge ids and isomer hashes must match these (asserted by test/lms/progress.test.ts over the roster). */
export const CHALLENGE_ID_RE = /^[A-Za-z0-9._-]+$/;
export const ISOMER_HASH_RE = /^[0-9a-f]{16}$/;
/** Student id used when cmi.core.student_id is empty in LMS mode; the mirror is disabled for it. */
export const UNKNOWN_STUDENT_ID = '';

// src/lms/types.ts — contract CHANGE (applied by the contracts owner, not by WP-10) -----------------
// ProgressState gains a fourth bitmask; nothing else in the interface moves.
//   /** Bitmask: bit i set = attempts used up on an attempt-limited challenge with the answer revealed
//    *  (wrong on the last attempt, or solved on the last attempt for 0 points). Subset of `attempted`. */
//   readonly exhausted: bigint;
// Codec comment becomes: v2|<hex attempted>|<hex solved>|<hex reduced>|<hex exhausted>|<earned>|<reportedRaw>|<currentChallengeId>
// Required wording changes elsewhere (recorded here because this document may not edit them):
//   00-contracts §2 SubmitResult: "pointsEarned is 0 when the challenge was already solved" -> "already solved with at
//     least that credit (a full-credit build after an acceptAlso half-credit solve earns points − floor(points/2))".
//   00-contracts §4: "three bigint bitmasks" -> "four (attempted ⊇ solved ⊇ reduced, attempted ⊇ exhausted)"; codec 8 fields.
//   05-content §12 item 1: closed — the upgrade is implemented (§3.2 rule A3′); the §4 acceptAlso notes stay as written.
//   07-ui §1.1 State.attemptOf and §2.2 panel CSS: see §3.8 and §7 of this document.

// src/lms/storage.ts ----------------------------------------------------------
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
/** window.localStorage behind a probe write; null when access throws or the probe fails. */
export function safeLocalStorage(): StorageLike | null;
export function readProgressMirror(storage: StorageLike | null, studentId: string): string | null;
export function writeProgressMirror(storage: StorageLike | null, studentId: string, encodedLocal: string): boolean;
export function clearProgressMirror(storage: StorageLike | null, studentId: string): void;

// src/lms/scorm-api.ts --------------------------------------------------------
/** The subset of Window the discovery walk touches. Every property read may throw (cross-origin). */
export interface WindowLike {
  readonly API?: unknown;
  readonly parent?: WindowLike | null;
  readonly opener?: WindowLike | null;
  readonly top?: WindowLike | null;
}
export function isScormApi(x: unknown): x is ScormApi12;
export function findApi(start: WindowLike, maxDepth?: number): ScormApi12 | null;   // default API_WALK_DEPTH
export function discover(win?: WindowLike): ScormApi12 | null;                    // default: window

// src/lms/ScormAdapter.ts -----------------------------------------------------
export interface Lifecycle {
  /** document 'visibilitychange' with visibilityState === 'hidden'. */
  onHidden(fn: () => void): void;
  /** window 'pagehide'; persisted = event.persisted. */
  onPageHide(fn: (persisted: boolean) => void): void;
  /** window 'pageshow'; persisted = event.persisted. */
  onPageShow(fn: (persisted: boolean) => void): void;
}
export interface Timers {
  now(): number;                                        // ms, monotonic (performance.now)
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface AdapterDeps {
  readonly discover: () => ScormApi12 | null;
  readonly storage: StorageLike | null;
  readonly lifecycle: Lifecycle;
  readonly timers: Timers;
  readonly roster: RosterInfo;
  readonly emitter: Emitter;                            // src/app/events
  readonly log: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;
}
export type LessonModeValue = 'browse' | 'normal' | 'review' | '';
export interface AdapterSnapshot {
  readonly mode: AdapterMode;
  readonly studentId: string | null;                    // sanitized cmi.core.student_id, 'local', or null while discovering
  readonly readOnly: boolean;                           // lesson_mode review/browse: no LMS writes
  readonly finished: boolean;                           // LMSFinish was called
  readonly source: ResumeDecision['source'] | null;
  readonly restoredFromLocal: boolean;
  readonly scoreGated: boolean;                         // §3.7: true from a local restore until the next milestone
  readonly lastCommitAt: number | null;
  readonly lastStatusWritten: LessonStatus | null;
  readonly errors: number;                              // API calls that returned 'false' or threw
}
export class ScormAdapter {
  constructor(deps: AdapterDeps);
  /** Discovery + LMSInitialize + resume. Resolves with the mode; never rejects. */
  start(): Promise<AdapterMode>;
  /** The state produced by start() (after resume). Valid once start() resolved. */
  get state(): ProgressState;
  get mode(): AdapterMode;
  get studentId(): string | null;
  get snapshot(): AdapterSnapshot;
  /** Non-milestone state change (attempt used, current challenge changed, isomer accepted):
   *  stores the state, writes the mirror, schedules a throttled commit. */
  update(state: ProgressState): void;
  /** Milestone (a challenge was solved): stores, mirrors, writes score/status/location/suspend, commits NOW.
   *  Returns the state with reportedRaw advanced when score.raw was accepted. */
  milestone(state: ProgressState): ProgressState;
  /** Throttled commit of the current state (one per COMMIT_THROTTLE_MS; trailing call scheduled). */
  commit(): void;
  /** Immediate commit (visibilitychange hidden, Save button). */
  flush(): void;
  /** exit + session_time + commit + LMSFinish (once). Resolves after LMSFinish returned. */
  saveAndExit(): Promise<void>;
  /** Detach lifecycle listeners and timers (tests, context-loss restart). */
  dispose(): void;
}
/** Browser wiring; call only from Game.ts. */
export function browserDeps(roster: RosterInfo, emitter: Emitter): AdapterDeps;
/** Badge text for review/browse mode (lms:status.message when readOnly). */
export const REVIEW_BADGE = 'Review mode - your score is not recorded';
/** Badge text while LMS calls are failing (errors > 0 in the last commit). */
export const DEGRADED_BADGE = 'Connected to course gradebook - last save failed, retrying';
/** Milestone commits are never throttled; update()/commit() are. */
export const RESUME_ATTEMPT_FLOOR = 1;

// orgocraft.config.json (defined in 05-content §1; repeated here because the packagers read it)
// { version: string; passMark: number; disabledChallenges: string[]; enabledReagents?: ReagentId[]; diagonalBonds: boolean }
```

`package.json` script additions (WP-10): `"check:paths": "node scripts/check-relative-paths.mjs"`, `"release": "npm run build && npm run check:paths && npm run package:d2l && npm run package:scorm"`. Existing `package:d2l`, `package:scorm`, `smoke` are unchanged.

## 2. Modes and lifecycle

```
                 start()
   discovering ───────────────► lms ──(review/browse)──► lms + readOnly
       │                         │
       │ no API in 2 s           │ saveAndExit() | pagehide
       ▼                         ▼
   standalone                 finished (LMS calls are no-ops; mirror keeps working)
```

| Mode | Progress source at start | Writes | Badge (`MODE_BADGE`) | Toolbar (07 §5) |
|---|---|---|---|---|
| `discovering` | — | none | `Connecting to the course...` | save buttons disabled |
| `lms` | `resume(suspend_data, mirror, studentId, roster)` (mirror discarded first when `isNewAttempt`, §6.2 step 7) | LMS fields + mirror (`score.raw`/`passed`/`failed` held back by `scoreGate` after a local restore) | `Connected to course gradebook` (or `REVIEW_BADGE`, `DEGRADED_BADGE`) | `Save & Exit` |
| `standalone` | `resume('', mirror, 'local', roster)` | mirror only | `Progress saved on this device - not connected to the gradebook` | `Save`, `Open in new tab` |

The mode never changes after `start()` resolves (a mid-session switch would confuse the learner and the gradebook); LMS call failures after start are logged, counted and shown through `DEGRADED_BADGE`, and the mirror always has the latest state.

## 3. Progress model (`src/lms/Progress.ts`, pure)

### 3.1 Constants used

| Constant | Value | Source |
|---|---|---|
| `SUSPEND_DATA_VERSION` | `'v2'` | types.ts |
| `SUSPEND_DATA_MAX` | 4096 | SCORM 1.2 CMIString4096 |
| `SUSPEND_DATA_BUDGET` | 512 | types.ts; test asserts the all-solved roster is below it |
| `LESSON_LOCATION_MAX` | 255 | CMIString256 |
| `POINTS_BY_DIFFICULTY` | easy 2, medium 4, hard 8 | content/types |
| `ATTEMPT_MULTIPLIER` | `[1, 0.5, 0]` | content/types |
| `DEFAULT_PASS_MARK` | 70 | content/types; `RosterInfo.passMark` carries the configured value |
| `RESUME_ATTEMPT_FLOOR` | 1 | §3.8 |

### 3.2 State construction and `applyOutcome`

```ts
export function emptyState(studentId: string): ProgressState {
  return { version: 2, studentId, attempted: 0n, solved: 0n, reduced: 0n, exhausted: 0n, earned: 0, reportedRaw: 0, currentChallengeId: '', isomersDone: {} };
}

export function applyOutcome(state: ProgressState, index: number, outcome: Outcome, points: number): ProgressState {
  if (index < 0 || !Number.isInteger(index)) throw new RangeError(`bad roster index ${index}`);
  const bit = 1n << BigInt(index);
  if (outcome === Outcome.NotAttempted) return state;                                  // rule A1
  if (outcome === Outcome.Attempted) {
    if (state.attempted & bit) return state;                                            // A2: idempotent
    return { ...state, attempted: state.attempted | bit };
  }
  if (state.solved & bit) {
    const upgrade = outcome === Outcome.SolvedFull && (state.reduced & bit) !== 0n && (state.exhausted & bit) === 0n;
    if (!upgrade) return state;                                                         // A3: never re-score, never downgrade
    const half = pointsForAttempt(points, 2, false);                                    // A3′: half -> full credit (acceptAlso)
    return { ...state, reduced: state.reduced & ~bit, earned: state.earned + Math.max(0, points - half) };
  }
  const reduced = outcome === Outcome.SolvedReduced ? (state.reduced | bit) : state.reduced;
  const exhausted = outcome === Outcome.SolvedReduced && points <= 0 ? (state.exhausted | bit) : state.exhausted;   // A4
  return { ...state, attempted: state.attempted | bit, solved: state.solved | bit, reduced, exhausted, earned: state.earned + Math.max(0, points) };
}

export function applyExhausted(state: ProgressState, index: number): ProgressState {
  if (index < 0 || !Number.isInteger(index)) throw new RangeError(`bad roster index ${index}`);
  const bit = 1n << BigInt(index);
  if ((state.solved & bit) !== 0n || ((state.attempted & bit) !== 0n && (state.exhausted & bit) !== 0n)) return state;   // A5: idempotent
  return { ...state, attempted: state.attempted | bit, exhausted: state.exhausted | bit };
}
```

Rules:

| # | Rule |
|---|---|
| A1 | `NotAttempted` is a no-op. |
| A2 | `Attempted` sets the bit once; a second call returns the same object. State applies it on **every** failed submission of **any** rule (build rules included) except the non-consuming kinds `nothing-targeted`, `no-hydrogens` and the no-card `wrong-reagent` (05 §7); so `allAttempted` (W4) means "every enabled challenge was submitted at least once". |
| A3 | A solved challenge is never re-scored and never downgraded: `SolvedReduced` after `SolvedFull`, `SolvedFull` after `SolvedFull`, and anything after an exhausted solve return the same object (`SubmitResult.pointsEarned = 0`, `STRINGS.alreadySolvedSuffix`). |
| A3′ | **Upgrade.** `SolvedFull` on a bit that is `reduced` and not `exhausted` clears `reduced` and adds `points − pointsForAttempt(points, 2, false)` to `earned` (`points` = the challenge's full points). This is the `acceptAlso` case of 05 §4: the six predict-product challenges promise "the minor product earns half credit … the major product earns full credit", and 05 §12 item 1 asks for exactly this. State passes `pointsEarned = points − half` (2 → 1, 4 → 2, 8 → 4) to the UI for that submission and emits `challenge:passed` (§6.10 item 3). Attempt-limited rules never reach A3′ because State accepts no submission on them after a solve. |
| A4 | `SolvedReduced` with `points ≤ 0` (a select-atom answered correctly on its last attempt: `pointsForAttempt(p, 3, false) = 0`, 05 §2 item 3) sets `solved`, `reduced` **and** `exhausted`: the challenge counts as done for `allSolved` and the roster glyph, contributes **0** points in `summarize` (§3.3), and can never be upgraded. Half credit is never 0 (`floor(2/2) = 1`), so `points ≤ 0` is unambiguous. |
| A5 | `applyExhausted` records `attempts-exhausted` (wrong on the last allowed attempt, answer revealed): `attempted|exhausted`, not `solved`. Idempotent; a no-op on a solved bit. |

`points` is the value already multiplied by `pointsForAttempt` (the caller passes `SubmitResult.pointsEarned`, or the full points for an A3′ upgrade). Invariant after every call: `reduced ⊆ solved ⊆ attempted`, `exhausted ⊆ attempted`, `(exhausted ∩ solved) ⊆ reduced`.

`withCurrent(state, id)` returns `{ ...state, currentChallengeId: id }` (State.ts calls it on `challenge:changed`; `id` must match `CHALLENGE_ID_RE`, else it is replaced by `''`). `withIsomers(state, id, hashes)` replaces `isomersDone[id]` with the sorted, de-duplicated hashes.

### 3.3 `summarize`

```ts
export function summarize(state: ProgressState, roster: RosterInfo): ScoreSummary {
  let earned = 0, total = 0, solvedCount = 0, enabledCount = 0, allAttempted = true, allSolved = true;
  for (let i = 0; i < roster.ids.length; i++) {
    if (!roster.enabled[i]) continue;
    const bit = 1n << BigInt(i);
    const p = roster.points[i] ?? 0;
    enabledCount++; total += p;
    const solved = (state.solved & bit) !== 0n;
    const attempted = (state.attempted & bit) !== 0n;
    if (solved) {
      solvedCount++;
      earned += (state.exhausted & bit) !== 0n ? 0 : (state.reduced & bit) !== 0n ? pointsForAttempt(p, 2, false) : p;   // A4, A3′
    }
    allSolved &&= solved; allAttempted &&= attempted;
  }
  if (enabledCount === 0) { allSolved = false; allAttempted = false; }
  return { earned, total, raw: rawScore(earned, total), solvedCount, enabledCount, allAttempted, allSolved };
}
```

`earned` is **recomputed from the bitmasks and the current roster**, never read from `state.earned`: a challenge the instructor disabled after a learner solved it drops out of both `earned` and `total`. `state.earned` is the running sum maintained by `applyOutcome` and is carried in the codec for diagnostics; `test/lms/progress.test.ts` asserts `summarize(...).earned === state.earned` whenever no challenge was disabled. `total` is `Σ points[i]` over `enabled[i]` — the same value as `totalPoints(rosterInfo(...))` in 05 §1, never a literal (critic 5.1). `raw = rawScore(earned, total)` (0 when `total = 0`). A reduced solve earns `pointsForAttempt(p, 2, false) = floor(p / 2)`: 1, 2, 4; a reduced solve whose bit is also `exhausted` earns 0 (A4) — the `exhausted` mask exists so that the bitmasks can tell half credit from zero credit and `summarize(...).earned === state.earned` holds for every outcome sequence `pointsFor` can produce (P-A4, P-A5).

### 3.4 `suspend_data` codec (8 fields)

Grammar (`|` separated, no whitespace, ASCII only). `v2` is unshipped, so the fourth mask is added to it rather than to a `v3`:

```
suspend := "v2" "|" hex "|" hex "|" hex "|" hex "|" uint "|" uint "|" id
hex     := "0" | [1-9a-f] [0-9a-f]*            bigint.toString(16): lowercase, no prefix, no leading zeros; LSB = roster index 0
uint    := "0" | [1-9] [0-9]*                  earned points; reportedRaw 0..100
id      := "" | [A-Za-z0-9._-]+                currentChallengeId ('' = none)
fields  := attempted, solved, reduced, exhausted, earned, reportedRaw, currentChallengeId  (in this order after "v2")
```

```ts
const hex = (m: bigint): string => m.toString(16);
export function encode(state: ProgressState): string {
  return [SUSPEND_DATA_VERSION, hex(state.attempted), hex(state.solved), hex(state.reduced), hex(state.exhausted),
          String(state.earned), String(state.reportedRaw), state.currentChallengeId].join('|');
}
```

`decode(s, studentId)`, numbered:
1. `parts = s.split('|')`; if `parts.length !== 8` → `ProgressDecodeError('expected 8 fields', parts.length)`.
2. `parts[0] !== 'v2'` → `ProgressDecodeError('unsupported version', 0)`. (There is no shipped v1; a `v1|` string is an error, not a migration.)
3. Fields 1–4: must match `/^(0|[1-9a-f][0-9a-f]*)$/` → `BigInt('0x' + f)`; else error with that field index.
4. Fields 5–6: must match `/^(0|[1-9][0-9]*)$/` and `Number(f) ≤ Number.MAX_SAFE_INTEGER`; `reportedRaw` additionally clamped to `0..100`.
5. Field 7: `''` or `CHALLENGE_ID_RE`; else replaced by `''` (not an error: a renamed id must not discard the bitmasks).
6. Repair (silent, documented): `attempted |= solved | exhausted`, `solved |= reduced`, `reduced &= solved`, `reduced |= exhausted & solved` — after which the §3.2 invariant holds. Bits beyond the roster length are kept (challenges are only ever appended; an older build reading a newer string keeps the bits).
7. Return `{ version: 2, studentId, attempted, solved, reduced, exhausted, earned, reportedRaw, currentChallengeId, isomersDone: {} }`.

Examples (roster order = file order; bit 0 = first challenge):

| State | String |
|---|---|
| fresh | `v2|0|0|0|0|0|0|` |
| `roster6` of §13.1 (points 2,4,4,8,2,4): ch 0,1,3 solved full, ch 2 solved reduced (4 → 2 pts), ch 4 attempted only, earned 2+4+2+8 = 16, raw 67 reported, on ch 4 (`ch1-select-sp2-carbons`) | `v2|1f|f|4|0|16|67|ch1-select-sp2-carbons` |
| same, but ch 4 (a select-atom) was answered wrongly three times (`applyExhausted`) | `v2|1f|f|4|10|16|67|ch1-select-sp2-carbons` |
| 80 challenges all solved, none reduced, earned 320, raw 100, id 40 chars | `v2|ffffffffffffffffffff|ffffffffffffffffffff|0|0|320|100|<40 chars>` = 2+1+20+1+20+1+1+1+1+1+3+1+3+1+40 = **97 chars** |

Length bound: for `n` challenges the string is at most `2 + 4·(1 + ⌈n/4⌉) + 1 + digits(earned) + 1 + 3 + 1 + 64` characters; with `n = 89` and `earned ≤ 999` that is 2 + 4·24 + 1 + 3 + 1 + 3 + 1 + 64 = 171 — far under `SUSPEND_DATA_BUDGET` (512), which is in turn far under the SCORM 1.2 hard cap (4096). The budget test (§13.1) encodes the all-solved real roster and asserts `< SUSPEND_DATA_BUDGET`.

`isomersDone` is **not** in this string (it can hold dozens of 16-char hashes); it lives in the local mirror only (§3.5). After an LMS-only resume on a new device an in-progress isomer set restarts from zero accepted isomers (the solved bit, if set, is untouched).

### 3.5 Local mirror codec (10 fields)

```
local   := suspend "|" isomers "|" sid
isomers := "" | entry (";" entry)*
entry   := id "=" hash ("," hash)*             hash = 16 lowercase hex chars (FNV-1a 64, 00-contracts §1 Analysis.hash)
sid     := sanitized student id ("" when unknown; "local" in standalone)
```

`encodeLocal(state) = encode(state) + '|' + entries.join(';') + '|' + state.studentId` with entries in ascending id order and hashes sorted. `decodeLocal(s, studentId)`: split on `|` → exactly 10 parts, else error; `decode(parts[0..7].join('|'), studentId)`; parse isomers (`parts[8]`; an entry whose id fails `CHALLENGE_ID_RE` or whose hash fails `ISOMER_HASH_RE` is dropped, never fatal); `parts[9] !== studentId` → `ProgressDecodeError('student id mismatch', 9)` — defence in depth on top of the per-student key. Challenge ids never contain `|`, `;`, `,`, `=` because of `CHALLENGE_ID_RE`; `test/lms/progress.test.ts` asserts every id in `challenges.json` matches it.

### 3.6 `lmsWrite` and `exitValue`

```ts
export function lmsWrite(state: ProgressState, roster: RosterInfo, atExit: boolean, scoreGated = false): LmsWrite {
  const s = summarize(state, roster);
  const visibleRaw = scoreGated ? state.reportedRaw : s.raw;                           // W9: a restored raw is invisible
  const best = Math.max(visibleRaw, state.reportedRaw);
  const scoreRaw = !scoreGated && s.raw > 0 && s.raw > state.reportedRaw ? s.raw : null;   // W1, W2, W9
  const lessonStatus: LessonStatus =
    best >= roster.passMark ? 'passed'                                                 // W3
    : atExit && s.allAttempted && !scoreGated ? 'failed'                               // W4, W9
    : 'incomplete';                                                                    // W5
  return {
    scoreRaw,
    lessonStatus,
    lessonLocation: state.currentChallengeId.slice(0, LESSON_LOCATION_MAX),
    suspendData: encode(state),
    ...(atExit ? { exit: exitValue(s) } : {}),
  };
}
export function exitValue(s: ScoreSummary): ExitValue { return s.allSolved ? '' : 'suspend'; }
```

Score reporting rules (every one has a test in §13.1):

| # | Rule | Reason |
|---|---|---|
| W1 | `score.raw` is never written while `raw = 0` | a learner who only opens the game must not get a 0 under First/Last Attempt calculation (scorm.md) |
| W2 | `score.raw` is written only when `raw > reportedRaw` (monotonic within an attempt); `min = 0`, `max = 100` are written once at start | a restore or a roster change can never lower the gradebook |
| W3 | `passed` as soon as `max(raw, reportedRaw) ≥ passMark`; once passed, always passed | the game enforces the pass mark itself; it does not rely on D2L applying `masteryscore` |
| W4 | `failed` only when `atExit` (Save & Exit, §6.6) **and** every enabled challenge has an `attempted` bit **and** not passed **and** not `scoreGated` | `pagehide` is not an intentional end (§6.5), so a browser close never writes `failed`; `attempted` is set on every failed submission of any rule, build rules included (A2), so "all attempted" means every challenge was tried, not "every build solved"; `attempted` is in the codec so the rule survives a resume (critic 2.5/2.6) |
| W5 | otherwise `incomplete`; a milestone after a `failed` write recomputes and may write `incomplete` or `passed` again | the learner may keep working in the same attempt |
| W6 | `exit` = `''` when `allSolved`, else `'suspend'`; **never** `'logout'`, never `'time-out'` | `logout` ends the attempt (the learner could not continue from 70 toward 100) and some players log the learner out (critic 2.6). `passed` + `suspend` is a valid 1.2 pair and D2L resumes it |
| W7 | `lesson_location` = current challenge id (≤ 255 chars) | bookmark; the adapter also uses it as a fallback for `currentChallengeId` (§6.2 step 9) |
| W8 | the total is computed from `RosterInfo`, never a literal | critic 5.1 |
| W9 | `scoreGated = true` (the adapter passes its `scoreGate`, set by a local restore and cleared by the next `milestone`, §3.7/§6.3): `scoreRaw` is `null`, and `lessonStatus` is computed as if `raw = reportedRaw` — so neither `passed` nor `failed` can come from a restored record; `lessonLocation`, `suspendData` and `exit` are written normally (a bookmark is not a grade) | a mirror restored from a previous attempt (instructor reset, D2L resume bug) must not reach the gradebook through a throttled commit, a tab switch, `pagehide` or Save & Exit (00-contracts §4, critic 2.6); tests P-W8, A-M6..A-M9 |

### 3.7 `resume` — merging the LMS string with the learner's mirror

```ts
export function resume(lmsString: string, localString: string | null, studentId: string, roster: RosterInfo): ResumeDecision {
  const lms = tryDecode(lmsString, studentId);                 // null when '' or ProgressDecodeError
  const local = tryDecodeLocal(localString, studentId);        // null when null/'' or ProgressDecodeError (incl. sid mismatch)
  if (!lms && !local) return { state: emptyState(studentId), source: 'fresh', restoredFromLocal: false };
  if (lms && (!local || compareRank(progressRank(local), progressRank(lms)) <= 0)) {
    return { state: { ...lms, isomersDone: local?.isomersDone ?? {} }, source: 'lms', restoredFromLocal: false };   // R2
  }
  const chosen = local!;
  return { state: { ...chosen, reportedRaw: lms ? lms.reportedRaw : 0 }, source: 'local', restoredFromLocal: true };   // R3
}
```

```ts
export function isNewAttempt(entry: string, initialStatus: string, lmsString: string, lmsRaw: number): boolean {
  return lmsString === '' && entry === 'ab-initio' && (initialStatus === 'not attempted' || initialStatus === '') && lmsRaw === 0;
}
```

Decision table (`rank = [popcount(solved), popcount(attempted), earned]`, lexicographic). The first row is decided by the adapter **before** `resume` is called (§6.2 step 7): it is the only case in which the learner's own mirror is thrown away. `scoreGate` is the adapter flag of §6.3 that `restoredFromLocal` sets:

| LMS launch | lms string | local (same student) | Result | `scoreGate` |
|---|---|---|---|---|
| `isNewAttempt` (entry `ab-initio`, status `not attempted`/`''`, `score.raw` empty/0, suspend `''`) | empty | any | mirror **cleared** (`clearProgressMirror`), then `fresh`, empty state; log `info: new attempt; mirror discarded` when a mirror existed | `false` |
| otherwise | empty/invalid | none/invalid/other student | `fresh`, empty state | `false` |
| otherwise | present | none | `lms` | `false` |
| otherwise (entry `resume`, or a status/score the LMS kept while dropping `suspend_data`) | empty | present | `local`, `restoredFromLocal = true`, `reportedRaw = 0` (then `max(·, lmsRaw)` in step 8) | `true` until the next `milestone` |
| otherwise | present | present, `rank(local) ≤ rank(lms)` | `lms` (+ `isomersDone` from the mirror) | `false` |
| otherwise | present | present, `rank(local) > rank(lms)` | `local`, `restoredFromLocal = true`, `reportedRaw = lms.reportedRaw` | `true` until the next `milestone` |

Why the first row: when an instructor resets a learner's attempt in Brightspace, the new attempt launches with empty `suspend_data`, `lesson_status` `not attempted`, no score and `cmi.core.entry` `ab-initio`; without the row the learner's mirror would silently restore the reset progress. `entry` is the one signal that separates "fresh attempt" from "the LMS lost my suspend data" (`resume`), and a kept status or score also proves a previous session, so those launches keep the merge. Consequence, stated in INSTRUCTOR.md §3 and §6: a genuinely new attempt (some D2L versions start one when the pop-up is closed without Save & Exit) restarts the game from zero; the previous attempt's score is protected by Highest Attempt grading, not by the mirror. Standalone mode never sees an `entry` and always merges.

Why not a union of bitmasks: both strings belong to the same learner, but a union could combine a stale mirror from a previous *attempt* (instructor reset) with the new attempt and the outcome would be untestable by inspection; picking one whole record keeps provenance. `reportedRaw` always reflects **what this LMS attempt actually holds** (0 when the LMS string was empty): so the next milestone writes `score.raw` as soon as `raw > 0` and above the LMS value. No score is written by `resume` itself, and none by any later write path while `scoreGate` is set — `update()`/`commit()`/`flush()` (throttled commit, tab switch), `endSession` (`pagehide`, Save & Exit) all call `lmsWrite(…, scoreGate)` and W9 blanks `scoreRaw`, `passed` and `failed` (critic blocker 2.6, 00-contracts R11). The first `score.raw` after a local restore is written at the next `milestone`, which clears the gate first, from the merged state (so the learner is not penalised: the write carries the full raw).

The mirror is keyed by the sanitized `cmi.core.student_id` (§4), so a second learner on the same browser profile never sees the first learner's string: `readProgressMirror(storage, 'B')` only reads `orgocraft.v1.progress.B`. Test §13.1 case P-R6 covers it. There is no "Restore progress?" dialog (00-contracts §4 specifies the merge; 07-ui has no such dialog); the rule is silent restore + no auto-commit.

### 3.8 Attempt floor after resume (requirement on `State.ts`, WP-11)

The codec stores no attempt counts, but it stores whether the attempts were used up. When `State` is constructed from `adapter.state` (§6.10 item 6), for every attempt-limited challenge (`quiz`, `select-atom`, `choose-reagent`; `maxAttemptsOf(rule)` finite) whose `solved` bit is clear:

| bits | `State.attemptOf(id)` at session start | Effect |
|---|---|---|
| `exhausted` set | `maxAttemptsOf(rule)` (2 for quiz/choose-reagent, 3 for select-atom) | no attempt left; the challenge renders as `attempts-exhausted` (07 §10.2 `is-correct` option / §11.4 green answer set / roster glyph `◔ No attempts left`) with the answer shown again, and State refuses submissions on it |
| `attempted` set, `exhausted` clear | `RESUME_ATTEMPT_FLOOR` (= 1, one attempt already consumed) | the learner keeps the remaining attempts at their reduced credit |
| neither | 0 | unchanged |

This closes the relaunch loophole: a quiz answered wrongly twice reveals the correct option, and before the `exhausted` mask a relaunch would have granted "attempt 2" for half credit on a known answer. Build rules are unaffected (unlimited attempts, full points). A solved bit with `exhausted` (A4) is a solved challenge; State treats it as any other solved one. Requirement on WP-11's `State.ts` (U3, closed).

## 4. Storage (`src/lms/storage.ts`)

```ts
export function safeLocalStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = '__orgocraft_probe__';
    s.setItem(probe, '1'); s.removeItem(probe);
    return s;
  } catch { return null; }                                   // private mode, blocked storage, quota, sandbox
}
export function readProgressMirror(storage: StorageLike | null, studentId: string): string | null {
  if (!storage || studentId === UNKNOWN_STUDENT_ID) return null;
  try { return storage.getItem(progressStorageKey(studentId)); } catch { return null; }
}
export function writeProgressMirror(storage: StorageLike | null, studentId: string, encodedLocal: string): boolean {
  if (!storage || studentId === UNKNOWN_STUDENT_ID) return false;
  try { storage.setItem(progressStorageKey(studentId), encodedLocal); return true; } catch { return false; }
}
export function clearProgressMirror(storage: StorageLike | null, studentId: string): void {
  if (!storage || studentId === UNKNOWN_STUDENT_ID) return;
  try { storage.removeItem(progressStorageKey(studentId)); } catch { /* ignore */ }
}
```

Keys: `progressStorageKey(studentId)` = `orgocraft.v1.progress.` + sanitized id (types.ts). `STORAGE_KEY_SETTINGS` and `STORAGE_KEY_INVENTORY` are written by `Settings.ts` (07) and are not per-student (settings are device preferences; inventory is gameplay convenience). Every access is inside try/catch; the game runs with in-memory state when storage is unavailable, and the badge text does not change (standalone with no storage still says "saved on this device" — the toast after Save says `STRINGS.savedLocally`; unresolved U5 asks 07 whether to add a "could not save" toast when `writeProgressMirror` returns false).

## 5. API discovery (`src/lms/scorm-api.ts`)

```ts
export function isScormApi(x: unknown): x is ScormApi12 {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return ['LMSInitialize', 'LMSFinish', 'LMSGetValue', 'LMSSetValue', 'LMSCommit', 'LMSGetLastError']
    .every((k) => typeof o[k] === 'function');
}

export function findApi(start: WindowLike, maxDepth = API_WALK_DEPTH): ScormApi12 | null {
  let win: WindowLike | null | undefined = start;
  for (let depth = 0; depth < maxDepth && win; depth++) {
    let api: unknown;
    try { api = win.API; } catch { api = undefined; }         // cross-origin frame: unreadable, but its parent may be ours
    if (isScormApi(api)) return api;
    let parent: WindowLike | null | undefined;
    try { parent = win.parent; } catch { return null; }       // only an unreadable .parent ends the chain
    if (!parent || parent === win) return null;               // reached top
    win = parent;
  }
  return null;
}

export function discover(win: WindowLike = window as unknown as WindowLike): ScormApi12 | null {
  let api = findApi(win);
  if (!api) { try { if (win.opener) api = findApi(win.opener); } catch { /* cross-origin opener */ } }
  if (!api) { try { const t = win.top; if (t && t.opener) api = findApi(t.opener); } catch { /* ignore */ } }
  return api;
}
```

Order and limits: own window → parents (≤ `API_WALK_DEPTH` = 10 frames) → `window.opener` chain → `window.top.opener` chain. `document.domain` is never touched; `API_1484_11` (SCORM 2004) is never looked for (single-SCO 1.2 package; a 2004 launch runs standalone and the badge says so). The D2L Content Service serves the SCO from `content.<region>.content-service.brightspace.com`; its player must expose `API` in a frame same-origin with the content or in the opener (scorm.md). A cross-origin *intermediate* frame does not end the walk: reading `.API` on it throws a `SecurityError`, but `window.parent` is readable across origins, so the loop swallows the throw and continues upward (origin A → B → A layouts expose `API` on the grandparent; the ADL and pipwerks wrappers walk the same way). Only a throw on `.parent` itself, `parent === self`, or the depth cap ends the chain; nothing crashes and `discover` then tries the opener chains.

## 6. `ScormAdapter` (`src/lms/ScormAdapter.ts`)

### 6.1 Dependencies and browser wiring

```ts
export function browserDeps(roster: RosterInfo, emitter: Emitter): AdapterDeps {
  return {
    discover: () => discover(),
    storage: safeLocalStorage(),
    lifecycle: {
      onHidden: (fn) => document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') fn(); }),
      onPageHide: (fn) => window.addEventListener('pagehide', (e) => fn((e as PageTransitionEvent).persisted)),
      onPageShow: (fn) => window.addEventListener('pageshow', (e) => fn((e as PageTransitionEvent).persisted)),
    },
    timers: { now: () => performance.now(), setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (h) => window.clearTimeout(h as number) },
    roster, emitter,
    log: (level, message, detail) => console[level === 'info' ? 'log' : level]('[lms] ' + message, detail ?? ''),
  };
}
```

`beforeunload` and `unload` are never registered (unreliable on mobile; they disable bfcache — scorm.md). The class holds `api: ScormApi12 | null`, `state`, `mode`, `studentId`, `readOnly`, `finished`, `scoreGate: boolean` (§3.7; `false` until a local restore, `false` again after the next `milestone`), `pendingCurrent: string | null` (a `currentChallengeId` received by `update()` while still `discovering`, §6.3), `lastCommitAt`, `pendingCommit` (timer handle), `lastStatusWritten`, `lastLocationWritten`, `lastSuspendWritten`, `startedAt`, `errors`.

### 6.2 `start()` — discovery and the initialisation sequence

1. `mode = 'discovering'`; emit `lms:status { mode: 'discovering', studentId: null, message: MODE_BADGE.discovering }`.
2. Poll `deps.discover()` at `t = 0, 250, 500, …, 2000 ms` (`API_DISCOVERY_INTERVAL_MS`, `API_DISCOVERY_TIMEOUT_MS`: 9 calls at most; the loop stops at the first non-null). Typical D2L launches resolve at `t = 0`.
3. No API → §6.8 (standalone) and resolve `'standalone'`.
4. `LMSInitialize("")`. Return value `'false'` (or a throw) → log `error` with `LMSGetLastError()` + `LMSGetErrorString(code)`, then §6.8 (standalone; the API is not used again). Return value `'true'` → continue.
5. Reads, in this order, every one through `get(key)` (§6.7):

| Step | Call | Use |
|---|---|---|
| 5a | `LMSGetValue("cmi.core.student_id")` | `studentId = sanitizeStudentId(value)`; `''` disables the mirror (log `warn`) |
| 5b | `LMSGetValue("cmi.core.lesson_mode")` | `readOnly = value === 'review' \|\| value === 'browse'` |
| 5c | `LMSGetValue("cmi.core.lesson_status")` | `initialStatus`; `lastStatusWritten = initialStatus` when it is one of the six values, else `null` |
| 5d | `LMSGetValue("cmi.core.entry")` | `entry` (`ab-initio` / `resume` / `''`); logged, and used by step 7 (`isNewAttempt`) |
| 5e | `LMSGetValue("cmi.suspend_data")` | `lmsString` |
| 5f | `LMSGetValue("cmi.core.lesson_location")` | `lmsLocation` |
| 5g | `LMSGetValue("cmi.core.score.raw")` | `lmsRaw = parseInt` (NaN → 0); monotonic floor when suspend data was lost but the score kept |
| 5h | `LMSGetValue("cmi.student_data.mastery_score")` | if non-empty and `parseInt(value) !== roster.passMark` → log `warn` `"LMS mastery score X differs from config passMark Y; config wins"` |

6. Unless `readOnly`: `LMSSetValue("cmi.core.score.min", "0")`, `LMSSetValue("cmi.core.score.max", "100")`, and if `initialStatus` is `'not attempted'` or `''`: `LMSSetValue("cmi.core.lesson_status", "incomplete")` (`lastStatusWritten = 'incomplete'`); then `LMSCommit("")`.
7. `mirror = readProgressMirror(storage, studentId)`. If `isNewAttempt(entry, initialStatus, lmsString, lmsRaw)` (§3.7 row 1): `clearProgressMirror(storage, studentId)`, `mirror = null`, and when the read returned a string log `info` `"new attempt; mirror discarded"`. Then `decision = resume(lmsString, mirror, studentId, roster)`.
8. `state = decision.state` with `reportedRaw = max(state.reportedRaw, lmsRaw)`; `scoreGate = decision.restoredFromLocal` (§3.6 W9).
9. If `state.currentChallengeId === ''` and `lmsLocation` is a roster id → `state = withCurrent(state, lmsLocation)`.
9a. If `pendingCurrent !== null` (an `update()` arrived during discovery, §6.3) → `state = withCurrent(state, pendingCurrent)`; `pendingCurrent = null`. The learner's navigation before the API answered wins over the bookmark.
10. `writeProgressMirror(storage, studentId, encodeLocal(state))` (the mirror now equals the merged record).
11. `initialStatus === 'passed'` → `statusFloorPassed = true`: the adapter never writes a status other than `passed` in this session (the LMS may have kept the status while dropping suspend data).
12. Register lifecycle hooks (§6.5). `startedAt = now()`. `mode = 'lms'`.
13. Emit `lms:status { mode: 'lms', studentId, message: readOnly ? REVIEW_BADGE : MODE_BADGE.lms }`; log `info` `"lms mode; student=<id>; source=<decision.source>; restoredFromLocal=<bool>; entry=<5d>"`. Resolve `'lms'`.

Nothing in `start()` writes `score.raw`, `suspend_data` or `lesson_location` — the first content write happens at the first `update`/`milestone`; and while `scoreGate` is set no write path at all emits `score.raw`, `passed` or `failed` (§3.6 W9).

### 6.3 `update`, `milestone`, `commit`, `flush`, throttling

```ts
update(state) {
  if (this.mode === 'discovering') { this.pendingCurrent = state.currentChallengeId; return; }   // §6.2 step 9a; no mirror under 'null'
  this.state = state;
  writeProgressMirror(this.deps.storage, this.studentId, encodeLocal(state));
  if (this.mode === 'lms') this.commit();                       // throttled
}

milestone(state) {
  this.state = state;
  writeProgressMirror(this.deps.storage, this.studentId, encodeLocal(state));
  this.scoreGate = false;                                       // an earned milestone lifts the restore gate (§3.7)
  if (this.mode !== 'lms' || this.readOnly || this.finished || !this.api) return state;
  const w = lmsWrite(state, this.deps.roster, false);           // gate already cleared: full raw
  const accepted = this.writeFields(w);                         // §6.4; returns true when score.raw was set and accepted
  const committed = this.call('LMSCommit', '');
  this.lastCommitAt = this.deps.timers.now();
  this.cancelPending();
  if (accepted && w.scoreRaw !== null) this.state = { ...this.state, reportedRaw: w.scoreRaw };
  this.deps.emitter.emit('lms:committed', { raw: accepted ? w.scoreRaw : null, status: w.lessonStatus });
  return this.state;
}

commit() {
  if (this.mode !== 'lms' || this.readOnly || this.finished) { if (this.mode === 'standalone') this.deps.emitter.emit('lms:committed', { raw: null, status: 'local' }); return; }
  const now = this.deps.timers.now();
  const due = this.lastCommitAt === null ? 0 : this.lastCommitAt + COMMIT_THROTTLE_MS;
  if (now >= due) { this.flush(); return; }
  if (this.pendingCommit === null) this.pendingCommit = this.deps.timers.setTimeout(() => { this.pendingCommit = null; this.flush(); }, due - now);
}

flush() {
  if (this.mode !== 'lms' || this.readOnly || this.finished || !this.api) return;
  this.cancelPending();
  const w = lmsWrite(this.state, this.deps.roster, false, this.scoreGate);   // W9: no score.raw / passed / failed while gated
  const accepted = this.writeFields(w);
  this.call('LMSCommit', '');
  this.lastCommitAt = this.deps.timers.now();
  if (accepted && w.scoreRaw !== null) this.state = { ...this.state, reportedRaw: w.scoreRaw };
  this.deps.emitter.emit('lms:committed', { raw: accepted ? w.scoreRaw : null, status: w.lessonStatus });
}
```

Throttle semantics: a milestone always commits immediately and resets the window; `update()`/`commit()` commit immediately when ≥ 30 s (`COMMIT_THROTTLE_MS`) passed since the last commit, otherwise exactly one trailing commit is scheduled for the end of the window (later calls inside the window do not add timers). `flush()` bypasses the window and cancels the pending timer. `milestone()` returns the state with `reportedRaw` advanced so `State.ts` adopts it (`state.progress = adapter.milestone(next)`); after `flush()` the caller reads `adapter.state`. Note that `flush()` can also advance `reportedRaw`: a throttled commit writes `score.raw` when a state change raised `raw` without a milestone (does not happen in v1 because only solves change `earned`, but the code path is uniform) — except while `scoreGate` is set, when `lmsWrite` returns `scoreRaw: null` and a status computed from `reportedRaw` (W9): after a local restore the restored raw can only leave the device through `milestone()`. Before `start()` resolves, `update()` only records the current challenge id (`pendingCurrent`): `this.state` would be overwritten by step 8 anyway, and `writeProgressMirror` with `studentId === null` would create `orgocraft.v1.progress.null`.

### 6.4 `writeFields(w: LmsWrite): boolean` — the exact strings

| Order | Condition | Call |
|---|---|---|
| 1 | `w.scoreRaw !== null` | `LMSSetValue("cmi.core.score.raw", String(w.scoreRaw))` — integer, no decimals |
| 2 | `status = statusFloorPassed ? 'passed' : w.lessonStatus`; `status !== lastStatusWritten` | `LMSSetValue("cmi.core.lesson_status", status)` |
| 3 | `w.lessonLocation !== lastLocationWritten` | `LMSSetValue("cmi.core.lesson_location", w.lessonLocation)` |
| 4 | `w.suspendData !== lastSuspendWritten` | `LMSSetValue("cmi.suspend_data", w.suspendData)`; if `w.suspendData.length > SUSPEND_DATA_MAX` the value is **not** written and an `error` is logged (cannot happen with the codec; guarded anyway) |
| 5 | `w.exit !== undefined` | `LMSSetValue("cmi.core.exit", w.exit)` |

Returns `true` iff step 1 ran and returned `'true'`. `last*Written` are updated only when the set returned `'true'`. Steps 2–4 are skipped when unchanged to keep D2L's SCORM log readable; a status that the LMS rejects (`'false'`) stays un-cached so it is retried at the next commit.

### 6.5 `visibilitychange`, `pagehide`, `pageshow`

- `onHidden` → `flush()` (immediate commit, **no** `LMSFinish`): tab switch, app switch on mobile, D2L chrome click. Nothing else changes; the learner may come back.
- `onPageHide(persisted)` → `endSession(false)` (§6.6, `atExit = false`): writes `cmi.core.exit` = `exitValue(summary)`, `cmi.core.session_time`, commits, `LMSFinish("")` once. Status follows W5, never `failed`, because closing a window is not a deliberate end.
- `onPageShow(persisted = true)` (bfcache restore after a `pagehide`) → the API was terminated: the adapter stays `finished`, LMS writes remain no-ops, the mirror keeps working, and the badge is set to `MODE_BADGE.standalone` via `lms:status { mode: 'lms', studentId, message: 'Session ended - progress is saved on this device; reopen the activity from the course to continue reporting' }` (string constant `ENDED_BADGE` in `ScormAdapter.ts`). Re-initialising a finished 1.2 session is not defined by the spec, so it is not attempted.

### 6.6 `saveAndExit()` and `endSession(atExit)`

```ts
async saveAndExit(): Promise<void> { this.endSession(true); }

private endSession(atExit: boolean): void {
  if (this.mode !== 'lms' || this.finished || !this.api) { this.finished = true; return; }
  this.cancelPending();
  writeProgressMirror(this.deps.storage, this.studentId, encodeLocal(this.state));
  if (!this.readOnly) {
    const w = lmsWrite(this.state, this.deps.roster, atExit, this.scoreGate);   // atExit=true may yield 'failed' (W4) and always sets exit; gated: no score/passed/failed (W9)
    const exit = w.exit ?? exitValue(summarize(this.state, this.deps.roster));
    this.writeFields({ ...w, exit });
    this.set('cmi.core.session_time', formatTimespan(this.deps.timers.now() - this.startedAt));
    this.call('LMSCommit', '');
  }
  this.call('LMSFinish', '');
  this.finished = true;
  this.deps.emitter.emit('lms:committed', { raw: null, status: 'finished' });
}
```

Save & Exit right after a local restore (`scoreGate` still set, nothing solved this session) writes no `score.raw` and no `passed`/`failed`, only location, suspend string, `exit` and `session_time` (test A-M8): an instructor who reset an attempt sees `incomplete` with no score until the learner earns something. Exact sequence for Save & Exit (not passed, not all solved, not all attempted): `LMSSetValue("cmi.core.lesson_status","incomplete")` (only if changed) → `LMSSetValue("cmi.core.lesson_location", id)` (if changed) → `LMSSetValue("cmi.suspend_data", "v2|…")` (if changed) → `LMSSetValue("cmi.core.exit","suspend")` → `LMSSetValue("cmi.core.session_time","00:12:34.56")` → `LMSCommit("")` → `LMSFinish("")`. Passed but not all solved: `lesson_status` `passed` (already), `exit` `suspend`. All enabled solved: `exit` `""`. **Never** `logout` (critic 2.6). `LMSFinish` is guarded by `finished`; a second `saveAndExit()` or a later `pagehide` is a no-op. `window.close()`, `window.top.close()` and `opener.close()` are never called: inside the D2L new-window player the SCO is an iframe of the popup with `opener === null`, and `top.close()` would close the player before its own commit (critic 2.6 Save & Exit). After the promise resolves the UI shows the finished overlay of 07 §13.3 (`Progress saved` / `Use the player's Exit button to close this window.`). `session_time` is `formatTimespan(ms)`: `HH:MM:SS.SS`, `HH` zero-padded to 2 and growing to 4 digits, capped at `9999:59:59.99`.

### 6.7 Call wrappers and error handling

```ts
private call(fn: 'LMSInitialize' | 'LMSCommit' | 'LMSFinish', arg: ''): boolean {
  try { const r = this.api![fn](arg); if (r === 'true') return true; this.logLmsError(fn); return false; }
  catch (e) { this.errors++; this.deps.log('error', `${fn} threw`, e); return false; }
}
private get(key: CmiKey): string {
  try { const v = this.api!.LMSGetValue(key); return typeof v === 'string' ? v : String(v ?? ''); }
  catch (e) { this.errors++; this.deps.log('error', `LMSGetValue(${key}) threw`, e); return ''; }
}
private set(key: CmiKey, value: string): boolean {
  try { const r = this.api!.LMSSetValue(key, value); if (r === 'true') return true; this.logLmsError(`LMSSetValue(${key})`); return false; }
  catch (e) { this.errors++; this.deps.log('error', `LMSSetValue(${key}) threw`, e); return false; }
}
private logLmsError(what: string): void {
  this.errors++;
  let code = '', text = '', diag = '';
  try { code = this.api!.LMSGetLastError(); text = this.api!.LMSGetErrorString(code); diag = this.api!.LMSGetDiagnostic(code); } catch { /* ignore */ }
  this.deps.log('error', `${what} returned false: ${code} ${text} ${diag}`.trim());
}
```

Play is never blocked by an LMS error. After a commit in which any call failed, `lms:status` is emitted with `message: DEGRADED_BADGE`; after the next fully successful commit it is emitted again with `MODE_BADGE.lms`. `LMSGetValue` on an unsupported element returns `''` in 1.2 (and sets error 401), which the adapter treats as "empty" without counting an error for the optional reads 5d, 5g, 5h.

### 6.8 Standalone mode

Entered when no API is found within 2 s, or when `LMSInitialize` fails. `studentId = LOCAL_STUDENT_ID` (`'local'`); `decision = resume('', readProgressMirror(storage, 'local'), 'local', roster)`; `state = decision.state` (then `withCurrent(state, pendingCurrent)` when an `update()` arrived during discovery, as in §6.2 step 9a); `mode = 'standalone'`; emit `lms:status { mode: 'standalone', studentId: 'local', message: MODE_BADGE.standalone }`; register `onHidden` → `writeProgressMirror` (cheap, keeps the mirror fresh), no `pagehide` handler needed (every `update`/`milestone` already wrote the mirror). `commit()` emits `lms:committed { raw: null, status: 'local' }` so the toolbar shows `STRINGS.savedLocally` (07 §5). `saveAndExit()` resolves immediately with `finished = true` (the button is hidden in standalone anyway). The toolbar shows `Open in new tab` (same-origin, D2L session cookie carries over) — in LMS mode it is hidden because a new tab cannot reach `window.API`.

### 6.9 Events and strings

| Event | When | Payload |
|---|---|---|
| `lms:status` | mode changes; badge text changes (review, degraded, ended) | `{ mode, studentId, message }` — `message` is one of `MODE_BADGE[mode]`, `REVIEW_BADGE`, `DEGRADED_BADGE`, `ENDED_BADGE` |
| `lms:committed` | after every `LMSCommit` (`status` = the `lessonStatus` written), after a standalone save (`status: 'local'`), after `LMSFinish` (`status: 'finished'`) | `{ raw: number \| null, status: string }` |

Student-facing strings owned by this document (07 re-exports them from `src/lms/types.ts` / `ScormAdapter.ts`, never retypes):

| Constant | Text |
|---|---|
| `MODE_BADGE.discovering` | `Connecting to the course...` |
| `MODE_BADGE.lms` | `Connected to course gradebook` |
| `MODE_BADGE.standalone` | `Progress saved on this device - not connected to the gradebook` |
| `REVIEW_BADGE` | `Review mode - your score is not recorded` |
| `DEGRADED_BADGE` | `Connected to course gradebook - last save failed, retrying` |
| `ENDED_BADGE` | `Session ended - progress is saved on this device; reopen the activity from the course to continue reporting` |

### 6.10 `Game.ts` wiring (WP-11)

1. `roster = rosterInfo(loadFullRoster(), config)`; `adapter = new ScormAdapter(browserDeps(roster, emitter))`.
2. `mode = await adapter.start()`; `state.progress = adapter.state`; `state.mode = mode`; `state.studentId = adapter.studentId`. The world renders during discovery; building is allowed; submissions are queued behind `start()` (the challenge panel's submit button is disabled while `discovering`).
3. On `challenge:passed` (State applied `applyOutcome` with `SolvedFull`/`SolvedReduced`): `state.progress = adapter.milestone(state.progress)`; then emit `score:changed`. State's mapping of a passing `SubmitResult` to an outcome: `pointsEarned === pointsFor(c, 1, false)` → `SolvedFull`; `kind === 'correct-reduced'` or `pointsEarned > 0` below full → `SolvedReduced`; a correct answer with `pointsEarned === 0` on an attempt-limited rule → `SolvedReduced` with `points 0` (A4, exhausted). A full-credit build on a challenge whose bit is `reduced` and not `exhausted` (an `acceptAlso` half-credit solve, A3′) is `SolvedFull` with the full `points`: State rewrites `pointsEarned = points − pointsForAttempt(points, 2, false)` on the result it shows, emits `challenge:passed`, and the milestone carries the upgraded raw. Any other pass of an already-solved challenge gets `pointsEarned = 0` and `STRINGS.alreadySolvedSuffix`, no event.
4. On **every** `challenge:submitted` with `passed: false` whose `kind` is not `nothing-targeted`, `no-hydrogens` or the no-card `wrong-reagent` (05 §7: not an attempt), State applies `Outcome.Attempted` — build rules included, so W4's `allAttempted` means every challenge was tried; when the result is `attempts-exhausted` State applies `applyExhausted(state, index)` instead (A5, §3.8). On those, on `challenge:changed` (`withCurrent`) and on an accepted isomer (`withIsomers`): `adapter.update(state.progress)` (a no-op except for `pendingCurrent` while `discovering`).
5. `State.save()` → `adapter.flush()` (LMS) or `adapter.commit()` (standalone; emits `lms:committed` local). `State.saveAndExit()` → `await adapter.saveAndExit()`; `state.finished = true`.
6. Attempt floor and exhausted lock (§3.8) applied when `State` is constructed from `adapter.state`: `attemptOf(id) = maxAttemptsOf(rule)` for `exhausted` bits, `RESUME_ATTEMPT_FLOOR` for attempted-but-unsolved attempt-limited bits, 0 otherwise.

## 7. Framing and layout (SCORM embedded mode, critic 2.4)

Normative CSS is in 06 §11.4 (R16): framed → `#stage { height: 100vh }` (the iframe's own height; D2L's SCORM embedded player is a fixed-height cross-origin frame that cannot auto-resize to the document), top-level → `aspect-ratio: 16/9; max-height: 100dvh; min-height: 480px`; `aspect-ratio` is never used inside a frame. Consequences for deployment:

- In the D2L classic content viewer (Path A, same-origin `d2l-iframe-fit-user-content`, default 580 px, `overflow: hidden`) the stage is exactly the frame height. 07 §2.2's geometry alone does not fit 580 px: the challenge panel (top 56, `max-height: calc(100% − 96px)` = 484 → bottom edge 540, x 16..376) overlaps the hotbar band (y ≈ 508..564, x ≈ 262..838 at 1100 px width) by 32 px, and 07 has no rule below 900 px width other than the tab strip. This document therefore requires the following addition to 07 §2.2 (WP-07; tracked as U8 until 07 carries it verbatim):

  ```css
  @media (max-height: 639px) {
    #challenge-panel, #molecule-panel { max-height: calc(100% - 152px); }   /* ends 16 px above the 56 px hotbar band */
    #bench-panel { bottom: 88px; max-height: calc(100% - 152px); }
  }
  ```

  plus a `Collapse` button in each panel header (`aria-expanded`, label `Collapse` / `Expand`) that reduces the panel to its 40 px title bar; both panels start collapsed when the stage is < 640 px tall. Below 640 px the panels shrink and can be collapsed; the toolbar, the hotbar and the panel title bars are all visible at 580 px. `Fullscreen` is offered (the viewer iframe carries `allowfullscreen`). Smoke check (`scripts/smoke.mjs`, 06 §15): at viewport 1100 × 580 the bounding boxes of `#challenge-panel` and `#hotbar` do not intersect (`a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left` must hold, with both panels expanded and collapsed).
- In the SCORM embedded player the stage is the player's frame height; `Open in new tab` is hidden (no API in a new tab). A `Fullscreen` button appears when the player allows fullscreen (07 §5 hides it when `document.fullscreenEnabled` is false; whether the Content Service iframe carries `allowfullscreen`/`allow="fullscreen"` is unverified, scorm.md). INSTRUCTOR.md recommends **Open player in new window** for this reason.
- `<title>OrgoCraft</title>` is set (D2L reads it); no `http://` subresources exist; the canvas is `tabindex="0"` and Space/Arrow keys are `preventDefault`-ed only while it is focused (06 §10), so the SCORM player page never scrolls under the game.

## 8. Build output and `scripts/check-relative-paths.mjs`

### 8.1 Build output

`vite.config.ts` (in repo): `base: './'`, `build.assetsDir: 'assets'`, `sourcemap: false`, `target: 'es2020'`. WP-11 adds `build.chunkSizeWarningLimit: 1500` and no `manualChunks`, so `dist/` is exactly `index.html`, `assets/index-<hash>.js`, `assets/index-<hash>.css` (plus nothing from `public/`, which stays empty). `orgocraft.config.json`, `challenges.json`, `molecules.json`, `reagents.json` are imported (`resolveJsonModule`) and bundled: no runtime `fetch`, no MIME dependency, nothing to edit inside a package (changing the pass mark or disabling challenges is a rebuild — INSTRUCTOR.md §"Changing the pass mark"; unresolved U1).

### 8.2 `check-relative-paths.mjs`

Exports (imported by both packagers, runnable standalone with `node scripts/check-relative-paths.mjs [distDir]`, exit 1 on failure):

```js
export const RESTRICTED_EXTENSIONS = ['.sh', '.bat', '.exe', '.dll', '.config', '.cmd', '.ps1', '.jar'];
export const TEXT_EXTENSIONS = ['.html', '.js', '.css', '.json', '.svg', '.webmanifest'];
export const ABSOLUTE_URL_PATTERNS = [
  /\bsrc="\/(?!\/)/g, /\bhref="\/(?!\/)/g, /\bsrc='\/(?!\/)/g, /\bhref='\/(?!\/)/g,
  /["'`]\/assets\//g, /url\(\s*["']?\/(?!\/)/g, /\bimport\(\s*["']\/(?!\/)/g, /\bfetch\(\s*["']\/(?!\/)/g,
  /\bfrom\s+["']\/(?!\/)/g, /\bnew URL\(\s*["']\/(?!\/)/g,
];
export function listFiles(dir): string[]          // recursive, forward slashes, relative to dir, sorted, index.html first
export function checkRelativePaths(distDir): { ok: boolean; problems: string[] }
```

Algorithm: (1) `dist/index.html` must exist, else problem `dist/index.html missing - run npm run build`. (2) For every file: if its extension (lowercased) is in `RESTRICTED_EXTENSIONS` → problem `restricted extension: <path>` (D2L's uploader rejects them). (3) For every file with a `TEXT_EXTENSIONS` extension, for every pattern, every match → problem `<path>:<line>: root-absolute URL "<match>"` (line = 1 + count of `\n` before the match index). (4) `index.html` must contain `src="./assets/` and `href="./assets/` (Vite's relative base emits `./assets/…`), else problem `index.html does not reference ./assets/ - is base './' set?`. (5) Print problems, exit 1 if any; print `check-relative-paths: OK (<n> files)` otherwise. Protocol-relative `//` and `data:` URLs are not flagged.

## 9. Path A package: `scripts/package-d2l.mjs`

Output `release/orgocraft-v<version>-d2l.zip` whose only top-level entry is the folder `orgocraft-v<version>/` holding the contents of `dist/`.

1. `version = JSON.parse(readFileSync('orgocraft.config.json')).version`; must match `/^\d+\.\d+\.\d+$/` (else exit 1: `orgocraft.config.json.version must be semver`). The zip name, the folder name and the manifest all use this value; `package.json.version` is not used.
2. `checkRelativePaths('dist')` → exit 1 with its problems.
3. `mkdirSync('release', { recursive: true })`; delete an existing zip of the same name.
4. `archiver('zip', { zlib: { level: 9 } })`; for every file of `listFiles('dist')`: `archive.file('dist/' + f, { name: 'orgocraft-v<version>/' + f, date: FIXED_DATE })` with `FIXED_DATE = new Date('2000-01-01T00:00:00Z')` (stable bytes across runs so CI artifacts are reproducible); `archive.finalize()`.
5. Verify: reopen the zip's central directory (parse the End-Of-Central-Directory record; no extra dependency) and assert the entry count equals the file count and every entry starts with `orgocraft-v<version>/`; assert the zip is < 50 MB (sanity; D2L's limit is 2 GB).
6. Print `wrote release/orgocraft-v<version>-d2l.zip (<n> files, <kB> kB)`.

## 10. Path B package: manifest, XSDs, `scripts/package-scorm.mjs`

### 10.1 `scorm/imsmanifest.template.xml` (complete)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="orgocraft" version="{{VERSION}}"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-orgocraft">
    <organization identifier="ORG-orgocraft">
      <title>OrgoCraft: Organic Chemistry I</title>
      <item identifier="ITEM-orgocraft" identifierref="RES-orgocraft" isvisible="true">
        <title>OrgoCraft</title>
        <adlcp:masteryscore>{{MASTERY}}</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-orgocraft" type="webcontent" adlcp:scormtype="sco" href="index.html">
{{FILES}}
    </resource>
  </resources>
</manifest>
```

Placeholders: `{{VERSION}}` ← `orgocraft.config.json.version`; `{{MASTERY}}` ← `orgocraft.config.json.passMark` as an integer string `0..100` (exit 1 otherwise); `{{FILES}}` ← one line per `dist/` file, `index.html` first then sorted, each `      <file href="<path>"/>` (6-space indent, forward slashes, no leading `./`, XML-escaped `& < > "`). No `<file>` entries for the XSDs (they are package control files, not resource files). The `xmlns:imsmd` namespace is not declared because no `imsmd:` element is used; `schemaLocation` still lists it (as the pipwerks and Adapt manifests do). Single SCO: exactly one `<item>` and one `<resource>`.

### 10.2 `scorm/xsd/` — the four control files

| File | targetNamespace | Where to get it |
|---|---|---|
| `imscp_rootv1p1p2.xsd` | `http://www.imsproject.org/xsd/imscp_rootv1p1p2` | `https://github.com/pipwerks/SCORM-Manifests/tree/master/SCORM%201.2%20Manifest/SCORM-schemas/` or `https://github.com/adaptlearning/adapt-contrib-spoor/tree/master/scorm/1.2/` |
| `adlcp_rootv1p2.xsd` | `http://www.adlnet.org/xsd/adlcp_rootv1p2` | same |
| `imsmd_rootv1p2p1.xsd` | `http://www.imsglobal.org/xsd/imsmd_rootv1p2p1` | same |
| `ims_xml.xsd` | `http://www.w3.org/XML/1998/namespace` | same (imported by the other three) |

WP-10 downloads the four files once and commits them under `scorm/xsd/` unchanged (they are the ADL/IMS originals, redistributed with every SCORM 1.2 package ever published). `test/lms/packaging.test.ts` asserts each exists, is non-empty, starts with `<?xml` or `<xs:schema`/`<xsd:schema`, and contains its `targetNamespace` string. If a file cannot be fetched at all, `package-scorm.mjs --no-xsd` builds a package without them (a warning is printed; 1EdTech says referenced XSDs "must be at the root", D2L's enforcement is unverified — scorm.md); minimal hand-written stubs are **not** shipped because a stub that does not validate the manifest is worse than none.

### 10.3 `package-scorm.mjs`

Exports `buildManifest({ template, files, mastery, version })` and `listDistFiles(dir)` (= `listFiles`) so the manifest builder is unit-tested; `main()` runs when executed directly.

1. Read `orgocraft.config.json`: `version` (semver), `passMark` (integer 0..100) → exit 1 with a message otherwise.
2. `checkRelativePaths('dist')` → exit 1 on problems.
3. `files = listFiles('dist')`; `manifest = buildManifest({ template: read('scorm/imsmanifest.template.xml'), files, mastery: passMark, version })`. `buildManifest` also asserts that every placeholder was replaced (no `{{` remains) and that `index.html` is the first `<file>`.
4. XSDs: for each of the four names, `scorm/xsd/<name>` must exist unless `--no-xsd`; else exit 1 `missing scorm/xsd/<name> - see docs/design/08-deployment.md §10.2`.
5. Zip `release/orgocraft-v<version>-scorm12.zip`, **root level** (no wrapping folder): `imsmanifest.xml` (generated text), the four XSDs, then every `dist/` file at its own path (`index.html`, `assets/…`); fixed dates as in §9.
6. Verify by reading back the central directory: first entry is `imsmanifest.xml`; every `href` in the generated manifest exists in the zip; no entry contains `\`; exit 1 otherwise.
7. Print `wrote release/orgocraft-v<version>-scorm12.zip (masteryscore <passMark>, <n> files)`.

Both packagers refuse to run when `dist/` is older than `src/` (compare max mtime of `src/**` and `orgocraft.config.json` with `dist/index.html`; message `dist/ is older than src/ - run npm run build first`), so a stale package cannot be produced by accident.

## 11. `docs/INSTRUCTOR.md` — exact content

The file below is written verbatim (the `<version>` placeholder is replaced by hand at release time; everything else is final text).

````markdown
# OrgoCraft — Instructor guide (D2L Brightspace)

OrgoCraft is a browser game for Organic Chemistry I (McMurry chapters 1–11). It runs entirely in the student's browser: there is no server, no account and no data leaves your Brightspace course. You can deliver it in two ways.

| | Path A — course file (no grade) | Path B — SCORM package (grade item) |
|---|---|---|
| File | `orgocraft-v<version>-d2l.zip` | `orgocraft-v<version>-scorm12.zip` |
| Where it goes | Manage Files, then a Content topic | Content → New SCORM/xAPI Object |
| Score | Saved on the student's device only | Reported to a grade item (0–100) |
| Progress across devices | No | Yes (through the SCORM attempt) |
| Badge shown in the game | "Progress saved on this device - not connected to the gradebook" | "Connected to course gradebook" |

Use Path B when the game counts toward a grade. Use Path A for practice or if SCORM is not enabled at your institution. The two packages contain the same game.

## 1. Path A — upload as a course file

1. Course Admin → **Manage Files**.
2. **Upload** → choose `orgocraft-v<version>-d2l.zip` (it is under 1 MB; the limit is 2 GB).
3. Open the zip's action menu (the ▾ next to its name) → **Unzip**. Wait for the notification that the background job finished.
4. Tick `orgocraft-v<version>/index.html` → **Add Content Topics** → choose the module and give the topic a title (for example "OrgoCraft — build molecules").
5. Open the topic once to confirm the game loads and the badge says "Progress saved on this device".

Do **not** click **Edit HTML** on the topic: the Brightspace editor removes the game's script tag and the page goes blank. To update the game later, upload the new zip (it unzips into a new `orgocraft-v<newversion>/` folder), then on the topic choose **Change File** and pick the new `index.html`. Never overwrite files inside the old folder — students' browsers may keep the old `index.html` and show a blank page.

## 2. Path B — upload as a SCORM package with a grade item

Use the **new SCORM player** (Content Service). Do not import the zip through Course Admin → Import/Export/Copy Components: that is the legacy player, which only records the latest attempt, marks the topic complete as soon as it is opened, and is not reported in Data Hub.

1. Content → open the module → **Upload/Create** → **New SCORM/xAPI Object**.
2. In the "Add Course Package" dialog click **Upload** and choose `orgocraft-v<version>-scorm12.zip`. Wait for the upload to finish.
3. Title: "OrgoCraft" (or your own).
4. **Create a grade item?** → **Yes**.
5. **Grade Calculation Method** → **Highest Attempt**. (Students can replay; the game never lowers a score within an attempt, but a fresh attempt starts at 0 and Highest Attempt keeps their best.)
6. **Course Package Player Options** → **Open player in new window** (recommended, see section 4).
7. **Save**.
8. Grades → **Manage Grades** → open the new item → set **Maximum Points** to **100**, put it in the category you want, and set its weight. The game reports a 0–100 score, so 100 points makes the gradebook value equal to the game's percentage.

If you answered No in step 4, you can still attach a grade item later: open the topic's action menu → **Edit** → grade item settings. Menu labels may differ slightly between Brightspace versions; look for the equivalent wording.

## 3. How the score works

- Every challenge is worth 2 (easy), 4 (medium) or 8 (hard) points. The score is the percentage of points earned over all enabled challenges, rounded to a whole number. The total is shown in the game's challenge panel.
- Build challenges can be retried without penalty. Quizzes, "select the atom" and "choose the reagent" challenges earn full points on the first try, half on the second, nothing after that.
- The score is sent to the gradebook every time a challenge is solved, and again when the student clicks **Save & Exit**. It never goes down within an attempt.
- The pass mark is **70 %** (the package's `masteryscore`). The game sets the SCORM status to *passed* at 70 % and *incomplete* below; *failed* is written only when the student clicks Save & Exit after attempting every challenge (every build challenge submitted at least once, every quiz and selection answered or out of attempts) without reaching 70 %. Brightspace's completion indicator for the topic follows this status.
- Students can leave and come back: the game asks Brightspace to *suspend* the attempt, and progress resumes from where they were. When every challenge is solved the attempt ends normally.
- Progress is also kept in the student's browser, keyed to their Brightspace user id, as a safety copy. Another student on the same computer never sees it. A restored safety copy is never sent to the gradebook by itself — not on Save & Exit, not when the window is closed — it is reported the next time that student solves a challenge.
- Resetting a student's attempt in Brightspace also discards the safety copy on their next launch (a launch with no saved progress, no status and no score is treated as a genuinely new attempt), so a reset really starts them over. If Brightspace keeps the status or score but loses the progress string, the safety copy is used instead.

### Changing the pass mark or hiding challenges

The pass mark, the list of disabled challenge ids and the enabled reagent cards live in `orgocraft.config.json` in the source repository and are built into the package. To change them, ask whoever builds the package to edit that file and run `npm run release`; then re-upload the package (Path B: upload the new zip as a new SCORM object, or use the topic's replace option if your Brightspace version offers it; grade calculation stays Highest Attempt). Editing `imsmanifest.xml` by hand changes only the number Brightspace stores, not the pass mark the game uses.

## 4. Embedded player or new window?

- **Open player in new window** (recommended): the game gets the whole window, the mouse can be captured for looking around, and Fullscreen works. Students must allow pop-ups for your Brightspace site; the game shows an "Open in new tab" link only when it is not connected to the gradebook, so tell students to use the player's own **Exit** button when done (the game shows "Progress saved — use the player's Exit button" after Save & Exit).
- **Embedded player**: the game runs in a fixed-height frame inside the Content page. It still works (the panels shrink and can be collapsed to their title bars below 640 px of height, and a **Fullscreen** button appears when the player allows fullscreen), but it is cramped on laptops.

In both modes, when a student simply closes the window the game saves first (Brightspace is told to suspend the attempt), but closing the pop-up without Save & Exit has been reported to start a new attempt in some Brightspace versions. Highest Attempt grading protects the score either way.

## 5. Testing before release (do this once on your course)

Log in as a **test student** with the Learner role. "View as Learner" does not exercise SCORM resume or grading.

1. Path A only: open the topic; in the browser's developer tools (F12 → Console) there are no red errors and no 404 for `assets/index-….js`.
2. The game fills the frame or window; the toolbar, hotbar (bottom), challenge panel (left) and molecule panel (right) are all visible and nothing covers the hotbar; the page behind does not scroll when pressing Space or the arrow keys while playing.
3. Click the world: the mouse is captured; Esc releases it and opens the pause menu. If capture is refused, dragging turns the view and a "Drag to look" hint appears.
4. Path B: the badge reads "Connected to course gradebook".
5. Solve the first challenge (place one carbon block on the lab pad for "Build methane", press Enter). The panel shows "Solved" and the score line updates.
6. Click **Save & Exit** → confirm → the overlay says "Progress saved". Close the window with the player's Exit button.
7. Grades → the test student's grade for the item shows the percentage the game displayed.
8. Open the activity again as the same test student: the solved challenge is still marked solved and the score is unchanged.
9. Shared-computer check: on the same browser, log out and log in as a second test student, open the activity: no progress is shown and no grade appears for the second student until they solve something.
10. Try once in Chrome with third-party cookies blocked and once in Safari; note any pop-up blocking in new-window mode.
11. Optional: the free SCORM Cloud sandbox (scorm.com) shows every API call the package makes; upload the same zip there if Brightspace shows no score.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank page, console shows 404 for `assets/…` | The topic points at an `index.html` from an old folder, or files were edited in place | Upload a new versioned folder; on the topic use Change File |
| Blank page after clicking "Edit HTML" | The Brightspace editor removed the script tag | Delete the topic and add it again from Manage Files (do not edit) |
| Badge says "Progress saved on this device" in Path B | The SCORM API was not found within 2 s | Make sure the topic was added as a SCORM/xAPI Object (new player), not through Import Components; try "Open player in new window"; check that pop-ups are allowed |
| Badge says "Review mode" | The topic was opened in review/browse mode (for example after the due date, or as an instructor) | Scores are not recorded in review mode; open it as a Learner during the availability window |
| Badge says "last save failed, retrying" | Brightspace rejected a call (session expired, network) | The game keeps a local copy; the next solved challenge retries. If it persists, Save & Exit, reopen the activity |
| Grade never appears | The student never solved a challenge (the game does not write a score of 0), or the grade item is not associated | Solve one challenge and Save & Exit; check the topic's grade item association |
| Score in Grades is lower than the game shows | Grade calculation method is First/Last/Lowest Attempt and a later attempt scored less | Set the method to Highest Attempt |
| Progress lost after closing the pop-up window | The Brightspace player started a new attempt | Ask students to use Save & Exit. A genuinely new attempt (no status, no score) starts the game from zero on purpose (it is indistinguishable from an instructor reset); the previous attempt's score is kept by Highest Attempt grading. If Brightspace kept the status or score, the game restores its local safety copy on the same device and re-reports at the next solved challenge |
| Game is tiny / hotbar cut off in the embedded player | Fixed-height frame | Collapse the panels (button in each panel header), use the Fullscreen button if the player shows one, or switch the topic to "Open player in new window" |
| Mouse look does not work | Pointer capture refused by the browser or a sandboxed frame | Drag to look, or use the arrow keys; Fullscreen usually allows capture |
| "OrgoCraft needs WebGL" message | Browser has WebGL disabled or no GPU driver | Try another browser or enable hardware acceleration |
| Space or arrows scroll the Brightspace page | The game canvas is not focused | Click the game once; Tab leaves the game area on purpose |

## 7. Accessibility and privacy

- Every action has a keyboard equivalent (press H in the game for the list); screen readers receive status announcements; there are no time limits. A 3D game cannot be fully WCAG-conformant; if a student needs an accommodation, contact the developer for the text-mode alternative planned for a later version.
- Nothing is transmitted except the SCORM score, status, bookmark and a short progress string to Brightspace. The local safety copy in the browser contains the same progress string and the Brightspace user id. Clearing site data removes it.
````

## 12. CI: `.github/workflows/build.yml` (WP-11)

```yaml
name: build
on:
  push:
    branches: ['**']
    tags: ['v*']
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      PLAYWRIGHT_BROWSERS_PATH: ${{ github.workspace }}/.pw-browsers
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm run check:paths
      - run: npm run package:d2l
      - run: npm run package:scorm
      - name: Cache Playwright chromium
        uses: actions/cache@v4
        with:
          path: .pw-browsers
          key: pw-chromium-1.63.0-${{ runner.os }}
      - run: npx --yes playwright@1.63.0 install --with-deps chromium
      - run: npm run smoke
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: orgocraft-${{ github.sha }}
          path: |
            release/*.zip
            test-results/
          if-no-files-found: error
  release:
    needs: build
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - name: Tag must equal orgocraft.config.json.version
        run: test "v$(node -p "require('./orgocraft.config.json').version")" = "${GITHUB_REF_NAME}"
      - uses: actions/download-artifact@v4
        with: { name: orgocraft-${{ github.sha }}, path: out }
      - uses: softprops/action-gh-release@v2
        with:
          files: out/release/*.zip
          generate_release_notes: true
```

Rules: the tag `vX.Y.Z` must equal `orgocraft.config.json.version` (the `release` job checks the repository out and its second step, the one-line shell test above, fails otherwise — `GITHUB_REF_NAME` is the bare tag); `smoke` uses `PLAYWRIGHT_BROWSERS_PATH` to find chromium (06 §15.2 glob) so no `CHROME_PATH` is needed on CI; the workflow never publishes anywhere but GitHub Releases (the instructor downloads the two zips from the release page).

## 13. Tests

All in vitest `node` environment; no jsdom. `test/lms/adapter.test.ts` constructs `ScormAdapter` with fake deps (§13.2); `src/lms/ScormAdapter.ts` therefore must not touch `window`/`document` at module scope (`browserDeps` is the only place, and it is not called in tests). `test/pure-imports.test.ts` (WP-11) greps `src/lms/Progress.ts` only.

### 13.1 `test/lms/progress.test.ts`

Fixtures: `roster6 = { ids: ['a','b','c','d','e','f'], points: [2,4,4,8,2,4], enabled: [true,true,true,true,true,true], passMark: 70 }`; `roster6dis` = same with `enabled[3] = false`; `realRoster = rosterInfo(loadFullRoster(), DEFAULT_CONFIG)` (05 §1).

| Id | Case | Expectation |
|---|---|---|
| P-C1 | `encode(emptyState('s'))` | `'v2|0|0|0|0|0|0|'` |
| P-C2 | state from the §3.4 example row 2 | `'v2|1f|f|4|0|16|67|ch1-select-sp2-carbons'`; `decode` of it deep-equals the state with `isomersDone: {}`; row 3 (`applyExhausted(_, 4)`) encodes to `'v2|1f|f|4|10|16|67|ch1-select-sp2-carbons'` |
| P-C3 | round trip over 200 random states (bits ≤ 100 in all four masks, earned ≤ 999, raw ≤ 100, id from the real roster) | `decode(encode(s), 's')` equals `s` (isomersDone stripped) |
| P-C4 | all-solved `realRoster` (every bit of attempted/solved set, exhausted 0, earned = Σ points, raw 100, longest id) | `encode(...).length < SUSPEND_DATA_BUDGET`; for an 80-challenge synthetic roster with a 40-char id `< 120` (97 chars) |
| P-C5 | `decode('v1|f|f|0|0|0|0|x','s')`, `decode('v2|f|f','s')`, `decode('v2|0g|0|0|0|0|0|','s')`, `decode('v2|0|0|0|0|-1|0|','s')`, `decode('v2|1f|f|4|16|67|ch1-select-sp2-carbons','s')` (old 7-field layout), `decode('v2|0|0|0|0|0|101|','s')` | throws `ProgressDecodeError` with `field` 0, 3, 1, 5, 7; the last one clamps `reportedRaw` to 100 without throwing |
| P-C6 | `decode('v2|0|3|1|0|0|0|','s')` (solved ⊄ attempted) | repaired: `attempted = 3n`, `solved = 3n`, `reduced = 1n`, `exhausted = 0n` |
| P-C6b | `decode('v2|0|1|0|3|0|0|','s')` (exhausted ⊄ attempted; exhausted ∩ solved ⊄ reduced) | repaired: `attempted = 3n`, `solved = 1n`, `reduced = 1n`, `exhausted = 3n` |
| P-C7 | `decode('v2|0|0|0|0|0|0|bad id!','s')` | no throw; `currentChallengeId === ''` |
| P-C8 | `encodeLocal` of a state with `isomersDone: { 'ch3-isomers-c4h10': ['0123456789abcdef','fedcba9876543210'] }` | ends with `'|ch3-isomers-c4h10=0123456789abcdef,fedcba9876543210|s'` (10 fields); `decodeLocal` round-trips; `decodeLocal(x, 'other')` throws with `field === 9`; an entry with hash `'xyz'` is dropped silently |
| P-C9 | every id in `challenges.json` | matches `CHALLENGE_ID_RE`; no id contains `\|` |
| P-A1 | `applyOutcome(empty, 2, Attempted, 0)` twice | `attempted === 4n`, `solved === 0n`, second call returns the same object |
| P-A2 | (a) `applyOutcome(empty, 1, SolvedFull, 4)` then `applyOutcome(_, 1, SolvedReduced, 2)`; (b) `applyOutcome(empty, 1, SolvedReduced, 2)` then `applyOutcome(_, 1, SolvedFull, 4)` then `applyOutcome(_, 1, SolvedFull, 4)` again | (a) after first: `solved 2n`, `earned 4`; second call returns the same object (no downgrade, no double count). (b) after first: `solved 2n`, `reduced 2n`, `earned 2`; after second: `solved 2n`, `reduced 0n`, `earned 4` (A3′ upgrade); third call returns the same object |
| P-A3 | `applyOutcome(empty, 0, SolvedReduced, 0)` then `applyOutcome(_, 0, SolvedFull, 2)` | after first: `solved 1n`, `reduced 1n`, `exhausted 1n`, `attempted 1n`, `earned 0` (A4); second call returns the same object (an exhausted solve is never upgraded) |
| P-A4 | invariant over 500 random sequences drawn from every outcome `pointsFor` can produce (`SolvedFull p`, `SolvedReduced floor(p/2)`, `SolvedReduced 0`, `Attempted`, `applyExhausted`, `SolvedFull p` after `SolvedReduced floor(p/2)`) | `reduced ⊆ solved ⊆ attempted`, `exhausted ⊆ attempted`, `(exhausted ∩ solved) ⊆ reduced`; `summarize(s, roster).earned === s.earned` when no challenge is disabled; `encode`/`decode` round-trips every state |
| P-A5 | state of P-A3 (first call) on `roster6` | `summarize(...)` → `earned 0`, `solvedCount 1`, `raw 0`, `allSolved false` |
| P-A6 | `applyExhausted(empty, 4)` twice; then `applyOutcome(_, 4, SolvedFull, 2)` | `attempted 16n`, `exhausted 16n`, `solved 0n`; second call returns the same object; `decode(encode(s), 's').exhausted === 16n`; the `SolvedFull` afterwards is refused by State (§3.8), but `applyOutcome` itself would still solve it — the test documents that the lock lives in `State.attemptOf` |
| P-S1 | `summarize` on roster6 with a,b solved full and c reduced | `earned 8`, `total 24`, `raw 33`, `solvedCount 3`, `enabledCount 6`, `allAttempted false` |
| P-S2 | same state on `roster6dis` | `total 16`; disabling d (unsolved) raises `raw` to 50 |
| P-S3 | state with d solved (8 pts) on `roster6dis` | `earned` excludes d; `state.earned` (which includes it) ≠ summary (documented divergence) |
| P-S4 | all six attempted, none solved | `allAttempted true`, `allSolved false`, `raw 0`; roster with `enabled` all false → `allSolved false`, `raw 0` |
| P-W1 | `lmsWrite(empty, roster6, false)` | `scoreRaw null`, `lessonStatus 'incomplete'`, `exit undefined`, `suspendData 'v2|0|0|0|0|0|0|'` |
| P-W2 | raw 33, `reportedRaw 33` | `scoreRaw null`; `reportedRaw 30` → `scoreRaw 33` |
| P-W3 | a,b,c,d solved full (18/24 → raw 75) | `lessonStatus 'passed'`; with `reportedRaw 75` and a roster change dropping raw to 60 → still `passed` |
| P-W4 | all attempted, raw 33, `atExit true` | `'failed'`, `exit 'suspend'`; `atExit false` → `'incomplete'` |
| P-W5 | all solved, `atExit true` | `exit ''`; passed but not all solved → `'suspend'`; in no case `'logout'` (assert over every state of P-A4 with `atExit` true) |
| P-W6 | `currentChallengeId` of 300 chars | `lessonLocation.length === 255` |
| P-W7 | build-rule failures count as attempts: a solved full (2 pts), b–f `applyOutcome(_, i, Attempted, 0)` (build submissions that failed), `lmsWrite(_, roster6, true)` | `'failed'` (raw 8, all attempted); with f's `Attempted` omitted → `'incomplete'`; with f `applyExhausted` instead → `'failed'` |
| P-W8 | gate (W9): a,b,c,d solved full (raw 75), `reportedRaw 0`: `lmsWrite(s, roster6, false, true)` / `lmsWrite(s, roster6, true, true)` with all six attempted / same with `reportedRaw 75` / `lmsWrite(s, roster6, false, false)` | `scoreRaw null` + `'incomplete'` / `scoreRaw null` + `'incomplete'` (not `failed`), `exit 'suspend'`, `suspendData` = `encode(s)` / `scoreRaw null` + `'passed'` / `scoreRaw 75` + `'passed'` |
| P-T1 | `formatTimespan` of 0, 754_560 (12:34.56), 3_600_000·10_000 | `'00:00:00.00'`, `'00:12:34.56'`, `'9999:59:59.99'` |
| P-T2 | `sanitizeStudentId('  John Doe/42@x.edu ')`, `''`, 70 × `'a'` | `'John_Doe_42@x.edu'`, `''`, length 64 |
| P-R1 | `resume('', null, 's', roster6)` | `source 'fresh'`, `restoredFromLocal false`, state = `emptyState('s')` |
| P-R2 | `resume(L, null, 's', r)` with L = 2 solved | `source 'lms'`, state equals `decode(L)` |
| P-R3 | `resume('', M, 's', r)` with M = 3 solved, `reportedRaw 40` in the mirror | `source 'local'`, `restoredFromLocal true`, `state.reportedRaw === 0`, isomersDone from the mirror |
| P-R4 | L = 2 solved (`reportedRaw 20`), M = 3 solved | `source 'local'`, `reportedRaw 20` |
| P-R5 | L = 3 solved, M = 3 solved with the same rank but different `isomersDone` | `source 'lms'`, `isomersDone` from the mirror |
| P-R6 | `M` encoded for student `'A'`, `resume('', M, 'B', r)` | `source 'fresh'` (mirror ignored — critic 2.6); `resume(L, M, 'B', r)` → `source 'lms'` |
| P-R7 | L malformed (`'garbage'`), M valid | `source 'local'`; both malformed → `'fresh'` |
| P-R8 | `progressRank` ordering: (3 solved, 3 attempted, 8) > (2, 6, 20) > (2, 5, 20) > (2, 5, 19) | lexicographic |
| P-R9 | `isNewAttempt(entry, status, lmsString, lmsRaw)` over `('ab-initio','not attempted','',0)`, `('ab-initio','','',0)`, `('resume','not attempted','',0)`, `('','not attempted','',0)`, `('ab-initio','incomplete','',0)`, `('ab-initio','not attempted','',33)`, `('ab-initio','not attempted','v2|0|0|0|0|0|0|',0)` | `true`, `true`, `false`, `false`, `false`, `false`, `false` |

### 13.2 `test/lms/adapter.test.ts` — fake API and harness

```ts
import type { ScormApi12 } from '@/lms/types';

export interface FakeApi extends ScormApi12 { calls: [string, ...string[]][]; data: Record<string, string>; failNext: Set<string>; }
export function fakeApi(initial: Partial<Record<string, string>> = {}): FakeApi {
  const data: Record<string, string> = {
    'cmi.core.student_id': 'stu-1', 'cmi.core.lesson_mode': 'normal', 'cmi.core.lesson_status': 'not attempted',
    'cmi.core.entry': 'ab-initio', 'cmi.suspend_data': '', 'cmi.core.lesson_location': '', 'cmi.core.score.raw': '',
    'cmi.student_data.mastery_score': '70', ...initial,
  };
  const calls: FakeApi['calls'] = [];
  const failNext = new Set<string>();
  let lastError = '0';
  const api: FakeApi = {
    calls, data, failNext,
    LMSInitialize: (p) => { calls.push(['LMSInitialize', p]); return failNext.delete('LMSInitialize') ? 'false' : 'true'; },
    LMSFinish: (p) => { calls.push(['LMSFinish', p]); return 'true'; },
    LMSGetValue: (k) => { calls.push(['LMSGetValue', k]); return data[k] ?? ''; },
    LMSSetValue: (k, v) => { calls.push(['LMSSetValue', k, v]); if (failNext.delete(k)) { lastError = '405'; return 'false'; } data[k] = v; return 'true'; },
    LMSCommit: (p) => { calls.push(['LMSCommit', p]); return failNext.delete('LMSCommit') ? 'false' : 'true'; },
    LMSGetLastError: () => { calls.push(['LMSGetLastError']); return lastError; },
    LMSGetErrorString: (c) => `error ${c}`,
    LMSGetDiagnostic: (c) => `diag ${c}`,
  };
  return api;
}

export function harness(api: ScormApi12 | null, opts: { storage?: Map<string, string> | null; mirror?: [string, string] } = {}) {
  let t = 0; const timers = new Map<number, { at: number; fn: () => void }>(); let seq = 0;
  const hidden: (() => void)[] = []; const pagehide: ((p: boolean) => void)[] = []; const pageshow: ((p: boolean) => void)[] = [];
  const map = opts.storage === null ? null : (opts.storage ?? new Map<string, string>());
  if (map && opts.mirror) map.set(opts.mirror[0], opts.mirror[1]);
  const storage = map ? { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } } : null;
  const emitter = createEmitter(); const events: { name: string; e: unknown }[] = [];
  for (const n of ['lms:status', 'lms:committed'] as const) emitter.on(n, (e) => events.push({ name: n, e }));
  const logs: string[] = [];
  const deps: AdapterDeps = {
    discover: () => api, storage, roster: roster6, emitter,
    lifecycle: { onHidden: (fn) => hidden.push(fn), onPageHide: (fn) => pagehide.push(fn), onPageShow: (fn) => pageshow.push(fn) },
    timers: { now: () => t, setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; }, clearTimeout: (h) => { timers.delete(h as number); } },
    log: (level, m) => logs.push(`${level}: ${m}`),
  };
  const advance = (ms: number) => { const end = t + ms; for (;;) { const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; t = due[1].at; timers.delete(due[0]); due[1].fn(); } t = end; };
  return { deps, storage: map, events, logs, advance, fire: { hidden: () => hidden.forEach((f) => f()), pagehide: (p = false) => pagehide.forEach((f) => f(p)), pageshow: (p = true) => pageshow.forEach((f) => f(p)) }, close: vi.fn() };
}
```

`start()` awaits timers: the test calls `const p = adapter.start(); h.advance(0); await p` (API present) or `h.advance(2000); await p` (absent). `setsOf(api, key)` = the values of every `['LMSSetValue', key, v]` call.

| Id | Case | Expectation |
|---|---|---|
| A-S1 | API present, fresh learner | resolves `'lms'`; `api.calls` begins exactly: `LMSInitialize ""`, `LMSGetValue cmi.core.student_id`, `…lesson_mode`, `…lesson_status`, `…entry`, `cmi.suspend_data`, `…lesson_location`, `…score.raw`, `cmi.student_data.mastery_score`, `LMSSetValue cmi.core.score.min "0"`, `LMSSetValue cmi.core.score.max "100"`, `LMSSetValue cmi.core.lesson_status "incomplete"`, `LMSCommit ""`; no `score.raw`/`suspend_data` set; `events[0]` = status discovering, last = `{ mode: 'lms', studentId: 'stu-1', message: MODE_BADGE.lms }`; the mirror `orgocraft.v1.progress.stu-1` equals `encodeLocal(adapter.state)` |
| A-S2 | `discover` returns null | after `advance(2000)` resolves `'standalone'`; `discover` was called 9 times; `studentId === 'local'`; badge `MODE_BADGE.standalone`; `saveAndExit()` resolves, no throw |
| A-S3 | API appears on the 3rd poll | resolves `'lms'` at `t = 500`; `LMSInitialize` called once |
| A-S4 | `failNext` has `LMSInitialize` | `'standalone'`; log contains `error: LMSInitialize returned false: 0 error 0 diag 0`; no further API calls |
| A-S5 | `lesson_status` `'incomplete'` initially | no `lesson_status` set at start |
| A-S6 | `lesson_mode` `'review'` | `'lms'`, `snapshot.readOnly true`; **no** `LMSSetValue` at all during start, milestone or saveAndExit; `LMSFinish` still called once at saveAndExit; badge `REVIEW_BADGE` |
| A-S7 | `student_id` `''` | `studentId === ''`; no mirror key written; log has a warn |
| A-S8 | `suspend_data` = 2 solved, `lesson_location 'c'`, current id `''` in the string | `state.currentChallengeId === 'c'`; `score.raw` `'33'` read → `state.reportedRaw === 33` |
| A-S9 | `mastery_score` `'80'` | log contains `warn: LMS mastery score 80 differs from config passMark 70; config wins` |
| A-S10 | `update(withCurrent(emptyState(''), 'c'))` before `advance(0)` (still `discovering`), then `advance(0); await p` | no storage key contains `'null'`; no API call before `LMSInitialize`; `adapter.state.currentChallengeId === 'c'` after start (also when `lesson_location` was `'b'`: the pre-start id wins); the mirror written at step 10 carries `'c'` |
| A-M1 | mirror for `stu-1` with 3 solved, LMS suspend empty, `cmi.core.entry 'resume'` (the LMS kept the attempt but lost the string) | after start: `snapshot.restoredFromLocal true`, `snapshot.scoreGated true`; **no** `LMSSetValue cmi.core.score.raw`; `milestone(applyOutcome(state, 3, SolvedFull, 8))` → `score.raw` set once with `'75'` (18/24), `lesson_status 'passed'`, `suspend_data` set, `LMSCommit` once more; returned state `reportedRaw 75`; `snapshot.scoreGated false` |
| A-M2 | mirror stored under `orgocraft.v1.progress.stu-9` with 5 solved; API student `stu-1` | `snapshot.source 'fresh'`; state empty; no `score.raw`; mirror for `stu-1` written, `stu-9`'s untouched (critic 2.6) |
| A-M6 | as A-M1 (mirror 3 solved, raw 33, entry `resume`), then `update(withCurrent(state, 'b'))`, `advance(30 000)` | `LMSCommit` ran (start + throttled), `suspend_data` and `lesson_location` were set, **no** `LMSSetValue cmi.core.score.raw`, no `lesson_status` other than the start-up `incomplete` |
| A-M7 | as A-M6, then `fire.hidden()` | still no `score.raw`; no `passed` |
| A-M8 | as A-M6 with the mirror at raw 75 (a,b,c,d solved) and all six attempted, then `saveAndExit()` | no `score.raw`; `lesson_status` never `passed` and never `failed` (stays `incomplete`); `cmi.core.exit 'suspend'`; `suspend_data` carries the restored masks; `LMSFinish` once |
| A-M9 | as A-M6, then `milestone(applyOutcome(state, 3, SolvedFull, 8))` | `score.raw` written exactly once, with the full raw `'75'`; `lesson_status 'passed'`; `snapshot.scoreGated false`; a following `fire.hidden()` writes nothing new |
| A-M10 | `update(applyExhausted(adapter.state, 4))` at t=0 | the committed `cmi.suspend_data` decodes with `exhausted === 16n`; after a second `start()` on a new adapter over the same fake `data`, `adapter.state.exhausted === 16n` |
| A-M11 | mirror for `stu-1` with 3 solved; fake data (a) default (`entry 'ab-initio'`, `lesson_status 'not attempted'`, `score.raw ''`, `suspend_data ''`); (b) same with `entry 'resume'`; (c) same as (a) with `score.raw '33'`; (d) same as (a) with `lesson_status 'incomplete'` | (a) `snapshot.source 'fresh'`, `restoredFromLocal false`, log has `info: new attempt; mirror discarded`, the mirror key now holds `encodeLocal(emptyState('stu-1'))`; (b), (c), (d) `source 'local'`, `restoredFromLocal true`, `scoreGated true`, mirror kept |
| A-M3 | `milestone` with a state whose raw is 0 (reduced solve, 0 points) | no `score.raw`; `suspend_data` written; `lms:committed { raw: null, status: 'incomplete' }` |
| A-M4 | milestone raw 33 then milestone with a state of raw 33 again | second call sets no `score.raw`, no `lesson_status`; `suspend_data` set only if the string changed |
| A-M5 | `failNext` has `cmi.core.score.raw` | `LMSGetLastError` called; returned state `reportedRaw` unchanged (0); `lms:committed.raw === null`; badge event `DEGRADED_BADGE`; next successful milestone re-emits `MODE_BADGE.lms` and writes the raw again |
| A-T1 | `update()` at t=0 (no commit yet → immediate), `update()` at t=5 000, `update()` at t=10 000 | `LMSCommit` count: 1 (start) + 1 at t=0; after `advance(30 000)` one trailing commit at t=30 000, total 3 |
| A-T2 | `milestone()` at t=5 000 while a trailing commit is pending | commit happens immediately; the pending timer is cancelled (no extra commit at t=30 000) |
| A-T3 | `fire.hidden()` at t=5 000 with a pending commit | `LMSCommit` immediately; no `LMSFinish`; no `cmi.core.exit` |
| A-X1 | passed (raw 75) but not all solved, `saveAndExit()` | sets `cmi.core.exit "suspend"`, `cmi.core.session_time` matching `/^\d{2,4}:\d{2}:\d{2}\.\d{2}$/`, then `LMSCommit`, then `LMSFinish` once; `lesson_status` stays `passed`; `h.close` never called; second `saveAndExit()` adds no calls |
| A-X2 | all six solved | `cmi.core.exit ""` |
| A-X3 | every state produced in the test file | `setsOf(api, 'cmi.core.exit')` never contains `'logout'` or `'time-out'` |
| A-X4 | all attempted, raw 33, `saveAndExit()` | `lesson_status "failed"` then exit `suspend` |
| A-X5 | all attempted, raw 33, `fire.pagehide()` | `lesson_status` **not** `failed` (`incomplete` already written → no set), exit `suspend`, `LMSFinish` once; a later `milestone()` makes no API call but updates the mirror |
| A-X6 | `fire.pagehide(); fire.pageshow(true)` | `lms:status` with `ENDED_BADGE`; `snapshot.finished true` |
| A-X7 | initial `lesson_status 'passed'`, suspend empty, then a milestone with raw 8 | `lesson_status` never set to anything (floor); `score.raw` `'8'` written only if `> lmsRaw` |
| A-E1 | `LMSSetValue` throws for `cmi.suspend_data` | no exception escapes `milestone`; `errors` incremented; log has `error: LMSSetValue(cmi.suspend_data) threw` |
| A-E2 | `storage: null` | start resolves; no throw on milestone; `writeProgressMirror` returned false (spy) |
| A-E3 | `dispose()` then `advance(60 000)` | no timer fires; no API call |

### 13.3 `test/lms/scorm-api.test.ts`

| Id | Case | Expectation |
|---|---|---|
| D-1 | chain `w0 → w1 → w2(API)` | `findApi(w0)` returns the API; `discover(w0)` too |
| D-2 | `w0 → w1 → w2(API)` where reading `w1.API` throws (cross-origin intermediate frame) but `w1.parent` is readable | `findApi(w0)` returns `w2.API`; no throw escapes |
| D-8 | `w1.parent` getter throws (unreadable chain) | `findApi(w0)` null; `discover(w0)` with `w0.opener → o(API)` returns it |
| D-3 | API on `w0.top.opener` only | found |
| D-4 | 12-deep chain with the API at depth 11 | `findApi` null (depth cap 10); at depth 9 → found |
| D-5 | `w.API = { LMSInitialize: 1 }` | `isScormApi` false, `findApi` null |
| D-6 | `parent === self` at top, no API anywhere | null, no throw |
| D-7 | `API_1484_11` present, no `API` | null (2004 is not used) |

### 13.4 `test/lms/packaging.test.ts`

| Id | Case | Expectation |
|---|---|---|
| K-1 | `buildManifest({ template, files: ['assets/a.js','index.html'], mastery: 70, version: '1.0.0' })` | contains `version="1.0.0"`, `<adlcp:masteryscore>70</adlcp:masteryscore>`, `<file href="index.html"/>` before `<file href="assets/a.js"/>`, no `{{` |
| K-2 | `mastery: 101`, `mastery: 'x'`, `version: '1'` | throws |
| K-3 | file name `a&b "c".js` | href `a&amp;b &quot;c&quot;.js` |
| K-4 | `scorm/xsd/` | four files exist, each contains its `targetNamespace` (§10.2 table) |
| K-5 | `checkRelativePaths` on a temp dir with `index.html` containing `src="/assets/x.js"` and a `run.sh` | `ok false`, problems name both; with `src="./assets/x.js"` and `href="./assets/x.css"` → `ok true` |
| K-6 | the template file | parses as XML with a 40-line hand-written tag-balance check (no dependency); root `manifest`; one `item`, one `resource` |

## 14. Unresolved questions

1. **U1 Runtime-editable config.** `orgocraft.config.json` is bundled; an instructor cannot change the pass mark or disable challenges without a rebuild. A runtime `fetch('./orgocraft.config.json')` would let them edit the file inside the Manage Files folder (Path A) but adds a load-failure path and does nothing for the SCORM package (`masteryscore` would still need regenerating). Decision here: bundled. Confirm with the instructor.
2. **U2 D2L attempt semantics.** Whether the new SCORM player honours `cmi.core.exit = 'suspend'` across window closes, and whether it applies `masteryscore` to override status, could not be verified from primary sources (scorm.md). The design does not depend on either (the game writes status itself; Highest Attempt is recommended), but checklist items 6–9 of INSTRUCTOR.md must be run on the real shell before grading anything.
3. **U3 Attempt floor (§3.8) — closed.** `State.attemptOf(id)` (07 §1.1, WP-11) starts at `maxAttemptsOf(rule)` for `exhausted` bits and at `RESUME_ATTEMPT_FLOOR` for attempted-but-unsolved attempt-limited challenges. 07's "in this session" wording must change to this; the relaunch loophole (a revealed answer earning half credit after a relaunch) is closed by the `exhausted` mask, not accepted.
4. **U4 Review mode string.** `REVIEW_BADGE`, `DEGRADED_BADGE` and `ENDED_BADGE` are defined in `ScormAdapter.ts`, not in `MODE_BADGE` (types.ts is frozen). 07's `strings.ts` re-exports them; confirm 07's `#lms-badge` accepts any `message` string (it does per 07 §5: "sets the badge text to `e.message`").
5. **U5 Storage failure feedback.** When `writeProgressMirror` returns `false` in standalone mode (private window, quota), the Save toast still says `Progress saved on this device.` A `STRINGS.saveFailed` toast would need a 07 addition; the adapter can emit `lms:committed { raw: null, status: 'local-failed' }` if 07 wants to render it.
6. **U6 SCORM Cloud verification.** The package should be run through SCORM Cloud once before hand-over (manifest validation, API trace). This needs an account the CI does not have; it is a manual release step in INSTRUCTOR.md §5 item 11 and in the WP-10 definition of done.
7. **U7 `package.json.version`** stays `0.1.0` and is unused; `orgocraft.config.json.version` drives file names and the manifest. Bumping both in one commit is a release-checklist item, not enforced.
8. **U8 Short-frame layout (§7).** 07 §2.2 must carry the `@media (max-height: 639px)` rule, the `Collapse` button and the "start collapsed below 640 px" rule written in §7, and 06 §15's smoke test the 1100 × 580 non-overlap check; INSTRUCTOR.md §4/§6 already describe that behaviour and must not promise more. Until 07 is updated, the Path A checklist item 2 fails in a 580 px frame.
9. **U9 Contract edits outside this document.** The `exhausted` mask (types.ts `ProgressState`, 00-contracts §4 codec line), the `SubmitResult.pointsEarned` wording in 00-contracts §2, and the closure of 05 §12 item 1 (upgrade implemented) are listed in §1 as exact text for the contracts owner; this document does not edit those files.
