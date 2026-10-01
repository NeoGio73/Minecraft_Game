/**
 * OrgoCraft progress model (PURE MODULE: no three, no DOM, no browser storage).
 *
 * Holds the score model, the `cmi.suspend_data` codec (v2, 8 fields), the
 * local-mirror codec (10 fields), the LMS write rules (`lmsWrite`, `exitValue`)
 * and the resume merge between the LMS string and the learner's own mirror.
 * Spec: docs/design/08-deployment.md §3; contracts: docs/design/00-contracts.md §4.
 *
 * Contract note. `src/lms/types.ts` carries the fourth bitmask `exhausted`
 * (08-deployment §1); `ProgressStateV2` is now an alias of the contract type
 * kept for existing importers. `exhaustedOf` / `asV2` still accept a record
 * written before the mask existed (a missing `exhausted` reads as `0n`).
 */
import type {
  ExitValue,
  LessonStatus,
  LmsWrite,
  ProgressState,
  ResumeDecision,
  RosterInfo,
  ScoreSummary,
} from './types';
import { LESSON_LOCATION_MAX, Outcome, SUSPEND_DATA_VERSION } from './types';
import { pointsForAttempt, rawScore } from '../content/types';

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/** Alias of the contract type (the `exhausted` mask lives in src/lms/types.ts). */
export type ProgressStateV2 = ProgressState;

export class ProgressDecodeError extends Error {
  constructor(
    message: string,
    readonly field: number,
  ) {
    super(message);
    this.name = 'ProgressDecodeError';
  }
}

/** Challenge ids must match this (asserted over the roster by test/lms/progress.test.ts). */
export const CHALLENGE_ID_RE = /^[A-Za-z0-9._-]+$/;
/** Isomer hashes are FNV-1a 64-bit lowercase hex (00-contracts §1 Analysis.hash). */
export const ISOMER_HASH_RE = /^[0-9a-f]{16}$/;
/** Student id used when cmi.core.student_id is empty in LMS mode; the mirror is disabled for it. */
export const UNKNOWN_STUDENT_ID = '';
/** Attempt count State.ts assigns to an attempted-but-unsolved attempt-limited challenge after a resume (08 §3.8). */
export const RESUME_ATTEMPT_FLOOR = 1;

const SUSPEND_FIELDS = 8;
const LOCAL_FIELDS = 10;
const HEX_RE = /^(0|[1-9a-f][0-9a-f]*)$/;
const UINT_RE = /^(0|[1-9][0-9]*)$/;
const RAW_MAX = 100;
const STUDENT_ID_MAX = 64;
/** Largest CMITimespan the SCO reports: 9999:59:59.99 in centiseconds. */
const TIMESPAN_MAX_CS = 9999 * 360_000 + 59 * 6_000 + 59 * 100 + 99;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The `exhausted` mask of a state written against either contract shape. */
export function exhaustedOf(state: ProgressState): bigint {
  const x = (state as Partial<ProgressState>).exhausted;
  return typeof x === 'bigint' ? x : 0n;
}

/** Returns `state` itself when it already carries `exhausted` (identity for the
 *  idempotency rules), else a copy with `exhausted: 0n`. */
export function asV2(state: ProgressState): ProgressState {
  return typeof (state as Partial<ProgressState>).exhausted === 'bigint' ? state : { ...state, exhausted: 0n };
}

function bitOf(index: number): bigint {
  if (!Number.isInteger(index) || index < 0) throw new RangeError(`bad roster index ${index}`);
  return 1n << BigInt(index);
}

/** Number of set bits. */
export function popcount(mask: bigint): number {
  let n = 0;
  let m = mask < 0n ? -mask : mask;
  while (m > 0n) {
    if (m & 1n) n++;
    m >>= 1n;
  }
  return n;
}

/** Rank used by resume(): [popcount(solved), popcount(attempted), earned], compared lexicographically. */
export function progressRank(state: ProgressState): readonly [number, number, number] {
  return [popcount(state.solved), popcount(state.attempted), state.earned];
}

/** Lexicographic comparison of two ranks: negative, zero or positive. */
export function compareRank(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** cmi.core.student_id -> storage-safe id: trim, [^A-Za-z0-9_.@-] -> '_', first 64 chars. '' stays ''. */
export function sanitizeStudentId(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_.@-]/g, '_')
    .slice(0, STUDENT_ID_MAX);
}

/** CMITimespan "HHHH:MM:SS.SS" for a duration in ms (hours 2..4 digits, capped at 9999:59:59.99). */
export function formatTimespan(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const cs = Math.min(TIMESPAN_MAX_CS, Math.floor(safeMs / 10));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6_000);
  const s = Math.floor((cs % 6_000) / 100);
  const c = cs % 100;
  const pad2 = (n: number): string => String(n).padStart(2, '0');
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad2(c)}`;
}

// ---------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------

/** Empty state for a learner. */
export function emptyState(studentId: string): ProgressStateV2 {
  return {
    version: 2,
    studentId,
    attempted: 0n,
    solved: 0n,
    reduced: 0n,
    exhausted: 0n,
    earned: 0,
    reportedRaw: 0,
    currentChallengeId: '',
    isomersDone: {},
  };
}

/** state with currentChallengeId replaced (no other change). An id that fails
 *  CHALLENGE_ID_RE is replaced by '' so the codec grammar always holds. */
export function withCurrent(state: ProgressState, challengeId: string): ProgressStateV2 {
  const id = CHALLENGE_ID_RE.test(challengeId) ? challengeId : '';
  return { ...asV2(state), currentChallengeId: id };
}

/** state with isomersDone[challengeId] = hashes (sorted, de-duplicated). An
 *  empty list removes the entry. Used by isomer-set acceptance. */
export function withIsomers(state: ProgressState, challengeId: string, hashes: readonly string[]): ProgressStateV2 {
  const unique = Array.from(new Set(hashes)).sort();
  const isomersDone: Record<string, readonly string[]> = { ...state.isomersDone };
  if (unique.length === 0) delete isomersDone[challengeId];
  else isomersDone[challengeId] = unique;
  return { ...asV2(state), isomersDone };
}

// ---------------------------------------------------------------------------
// Outcomes (rules A1..A5 of 08-deployment §3.2)
// ---------------------------------------------------------------------------

/** `points` is the value already multiplied by `pointsForAttempt` (the caller
 *  passes `SubmitResult.pointsEarned`, or the full points for an A3′ upgrade). */
export function applyOutcome(state: ProgressState, index: number, outcome: Outcome, points: number): ProgressStateV2 {
  const bit = bitOf(index);
  const s = asV2(state);
  if (outcome === Outcome.NotAttempted) return s; // A1
  if (outcome === Outcome.Attempted) {
    if (s.attempted & bit) return s; // A2: idempotent
    return { ...s, attempted: s.attempted | bit };
  }
  if (s.solved & bit) {
    const upgrade = outcome === Outcome.SolvedFull && (s.reduced & bit) !== 0n && (s.exhausted & bit) === 0n;
    if (!upgrade) return s; // A3: never re-score, never downgrade
    const half = pointsForAttempt(points, 2, false); // A3′: half -> full credit (acceptAlso)
    return { ...s, reduced: s.reduced & ~bit, earned: s.earned + Math.max(0, points - half) };
  }
  // A solve on a bit whose attempts were already used up with the answer
  // revealed (applyExhausted) is a zero-credit solve: State refuses such
  // submissions (§3.8), and if one slips through the answer was known, so it
  // earns nothing — this keeps `summarize(...).earned === state.earned` and the
  // (exhausted ∩ solved) ⊆ reduced invariant for every outcome sequence.
  const revealed = (s.exhausted & bit) !== 0n;
  const zeroCredit = revealed || (outcome === Outcome.SolvedReduced && points <= 0); // A4
  const reduced = outcome === Outcome.SolvedReduced || zeroCredit ? s.reduced | bit : s.reduced;
  const exhausted = zeroCredit ? s.exhausted | bit : s.exhausted;
  return {
    ...s,
    attempted: s.attempted | bit,
    solved: s.solved | bit,
    reduced,
    exhausted,
    earned: s.earned + (zeroCredit ? 0 : Math.max(0, points)),
  };
}

/** An attempt-limited challenge whose attempts are used up with the answer
 *  revealed (`attempts-exhausted`): sets attempted|exhausted, never solved.
 *  Idempotent; a no-op on a solved bit. */
export function applyExhausted(state: ProgressState, index: number): ProgressStateV2 {
  const bit = bitOf(index);
  const s = asV2(state);
  if ((s.solved & bit) !== 0n || ((s.attempted & bit) !== 0n && (s.exhausted & bit) !== 0n)) return s; // A5
  return { ...s, attempted: s.attempted | bit, exhausted: s.exhausted | bit };
}

// ---------------------------------------------------------------------------
// Score summary (§3.3)
// ---------------------------------------------------------------------------

export function summarize(state: ProgressState, roster: RosterInfo): ScoreSummary {
  const exhausted = exhaustedOf(state);
  let earned = 0;
  let total = 0;
  let solvedCount = 0;
  let enabledCount = 0;
  let allAttempted = true;
  let allSolved = true;
  for (let i = 0; i < roster.ids.length; i++) {
    if (!roster.enabled[i]) continue;
    const bit = 1n << BigInt(i);
    const p = roster.points[i] ?? 0;
    enabledCount++;
    total += p;
    const solved = (state.solved & bit) !== 0n;
    const attempted = (state.attempted & bit) !== 0n;
    if (solved) {
      solvedCount++;
      // A4: an exhausted solve earns 0; A3′: a reduced solve earns floor(p / 2).
      earned += (exhausted & bit) !== 0n ? 0 : (state.reduced & bit) !== 0n ? pointsForAttempt(p, 2, false) : p;
    }
    allSolved &&= solved;
    allAttempted &&= attempted;
  }
  if (enabledCount === 0) {
    allSolved = false;
    allAttempted = false;
  }
  return { earned, total, raw: rawScore(earned, total), solvedCount, enabledCount, allAttempted, allSolved };
}

// ---------------------------------------------------------------------------
// suspend_data codec (§3.4): v2|attempted|solved|reduced|exhausted|earned|reportedRaw|currentChallengeId
// ---------------------------------------------------------------------------

const hex = (m: bigint): string => m.toString(16);

export function encode(state: ProgressState): string {
  return [
    SUSPEND_DATA_VERSION,
    hex(state.attempted),
    hex(state.solved),
    hex(state.reduced),
    hex(exhaustedOf(state)),
    String(state.earned),
    String(state.reportedRaw),
    state.currentChallengeId,
  ].join('|');
}

function parseHexField(parts: readonly string[], index: number): bigint {
  const f = parts[index] ?? '';
  if (!HEX_RE.test(f)) throw new ProgressDecodeError(`field ${index} is not a hex mask`, index);
  return BigInt('0x' + f);
}

function parseUintField(parts: readonly string[], index: number): number {
  const f = parts[index] ?? '';
  if (!UINT_RE.test(f)) throw new ProgressDecodeError(`field ${index} is not an unsigned integer`, index);
  const n = Number(f);
  if (n > Number.MAX_SAFE_INTEGER) throw new ProgressDecodeError(`field ${index} is out of range`, index);
  return n;
}

/** Throws ProgressDecodeError; `field` names the offending field index. */
export function decode(s: string, studentId: string): ProgressStateV2 {
  const parts = String(s ?? '').split('|');
  if (parts.length !== SUSPEND_FIELDS) throw new ProgressDecodeError(`expected ${SUSPEND_FIELDS} fields`, parts.length);
  if (parts[0] !== SUSPEND_DATA_VERSION) throw new ProgressDecodeError('unsupported version', 0);
  let attempted = parseHexField(parts, 1);
  let solved = parseHexField(parts, 2);
  let reduced = parseHexField(parts, 3);
  const exhausted = parseHexField(parts, 4);
  const earned = parseUintField(parts, 5);
  const reportedRaw = Math.min(RAW_MAX, parseUintField(parts, 6));
  const rawId = parts[7] ?? '';
  // A renamed id must not discard the bitmasks: an invalid id is dropped, not fatal.
  const currentChallengeId = rawId === '' || CHALLENGE_ID_RE.test(rawId) ? rawId : '';
  // Silent repair so the §3.2 invariant holds: reduced ⊆ solved ⊆ attempted,
  // exhausted ⊆ attempted, (exhausted ∩ solved) ⊆ reduced. Bits beyond the
  // roster length are kept (challenges are only ever appended).
  solved |= reduced;
  attempted |= solved | exhausted;
  reduced &= solved;
  reduced |= exhausted & solved;
  return {
    version: 2,
    studentId,
    attempted,
    solved,
    reduced,
    exhausted,
    earned,
    reportedRaw,
    currentChallengeId,
    isomersDone: {},
  };
}

// ---------------------------------------------------------------------------
// Local mirror codec (§3.5): suspend|isomers|studentId
// ---------------------------------------------------------------------------

function encodeIsomers(isomersDone: ProgressState['isomersDone']): string {
  const ids = Object.keys(isomersDone)
    .filter((id) => CHALLENGE_ID_RE.test(id))
    .sort();
  const entries: string[] = [];
  for (const id of ids) {
    const hashes = Array.from(new Set((isomersDone[id] ?? []).filter((h) => ISOMER_HASH_RE.test(h)))).sort();
    if (hashes.length > 0) entries.push(`${id}=${hashes.join(',')}`);
  }
  return entries.join(';');
}

function decodeIsomers(field: string): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  if (field === '') return out;
  for (const entry of field.split(';')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const id = entry.slice(0, eq);
    if (!CHALLENGE_ID_RE.test(id)) continue;
    const hashes = Array.from(new Set(entry.slice(eq + 1).split(',').filter((h) => ISOMER_HASH_RE.test(h)))).sort();
    if (hashes.length === 0) continue;
    out[id] = hashes;
  }
  return out;
}

/** Local-mirror codec (10 fields = suspend + isomers + studentId). */
export function encodeLocal(state: ProgressState): string {
  return `${encode(state)}|${encodeIsomers(state.isomersDone)}|${state.studentId}`;
}

/** Throws ProgressDecodeError, including `field === 9` when the mirror belongs to another learner. */
export function decodeLocal(s: string, studentId: string): ProgressStateV2 {
  const parts = String(s ?? '').split('|');
  if (parts.length !== LOCAL_FIELDS) throw new ProgressDecodeError(`expected ${LOCAL_FIELDS} fields`, parts.length);
  const base = decode(parts.slice(0, SUSPEND_FIELDS).join('|'), studentId);
  const isomersDone = decodeIsomers(parts[8] ?? '');
  if (parts[9] !== studentId) throw new ProgressDecodeError('student id mismatch', 9);
  return { ...base, isomersDone };
}

// ---------------------------------------------------------------------------
// LMS write rules (§3.6, W1..W9)
// ---------------------------------------------------------------------------

/** '' when every enabled challenge is solved, else 'suspend'. Never 'logout' or 'time-out'. */
export function exitValue(summary: ScoreSummary): ExitValue {
  return summary.allSolved ? '' : 'suspend';
}

/** scoreGated = true (adapter after a local restore, §3.7): scoreRaw is null and
 *  lessonStatus is computed from reportedRaw alone (no 'passed'/'failed' from a
 *  restored record). Default false. */
export function lmsWrite(state: ProgressState, roster: RosterInfo, atExit: boolean, scoreGated = false): LmsWrite {
  const s = summarize(state, roster);
  const visibleRaw = scoreGated ? state.reportedRaw : s.raw; // W9: a restored raw is invisible
  const best = Math.max(visibleRaw, state.reportedRaw);
  const scoreRaw = !scoreGated && s.raw > 0 && s.raw > state.reportedRaw ? s.raw : null; // W1, W2, W9
  const lessonStatus: LessonStatus =
    best >= roster.passMark
      ? 'passed' // W3
      : atExit && s.allAttempted && !scoreGated
        ? 'failed' // W4, W9
        : 'incomplete'; // W5
  return {
    scoreRaw,
    lessonStatus,
    lessonLocation: state.currentChallengeId.slice(0, LESSON_LOCATION_MAX), // W7
    suspendData: encode(state),
    ...(atExit ? { exit: exitValue(s) } : {}), // W6
  };
}

// ---------------------------------------------------------------------------
// Resume (§3.7)
// ---------------------------------------------------------------------------

function tryDecode(s: string, studentId: string): ProgressStateV2 | null {
  if (!s) return null;
  try {
    return decode(s, studentId);
  } catch {
    return null;
  }
}

function tryDecodeLocal(s: string | null, studentId: string): ProgressStateV2 | null {
  if (!s) return null;
  try {
    return decodeLocal(s, studentId);
  } catch {
    return null;
  }
}

/** true when the LMS launch is a brand-new attempt (instructor reset or first
 *  launch): empty suspend_data, entry 'ab-initio', status 'not attempted' or
 *  '', score.raw 0. The adapter then discards the mirror (§6.2 step 7). */
export function isNewAttempt(entry: string, initialStatus: string, lmsString: string, lmsRaw: number): boolean {
  return (
    lmsString === '' && entry === 'ab-initio' && (initialStatus === 'not attempted' || initialStatus === '') && lmsRaw === 0
  );
}

/** Merge the LMS string with the learner's own mirror. Whole records are
 *  chosen, never unions, so provenance stays inspectable. `roster` is accepted
 *  per the contract; the merge is roster-independent so bits beyond the roster
 *  survive an older build reading a newer string. */
export function resume(
  lmsString: string,
  localString: string | null,
  studentId: string,
  roster: RosterInfo,
): ResumeDecision {
  void roster;
  const lms = tryDecode(lmsString, studentId);
  const local = tryDecodeLocal(localString, studentId);
  if (!lms && !local) return { state: emptyState(studentId), source: 'fresh', restoredFromLocal: false };
  if (lms && (!local || compareRank(progressRank(local), progressRank(lms)) <= 0)) {
    // R2: the LMS record wins ties; isomer hashes only ever live in the mirror.
    return { state: { ...lms, isomersDone: local?.isomersDone ?? {} }, source: 'lms', restoredFromLocal: false };
  }
  // R3: the mirror has more progress; reportedRaw reflects what this LMS attempt actually holds.
  const chosen = local as ProgressStateV2;
  return {
    state: { ...chosen, reportedRaw: lms ? lms.reportedRaw : 0 },
    source: 'local',
    restoredFromLocal: true,
  };
}
