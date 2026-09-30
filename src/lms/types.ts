/**
 * OrgoCraft LMS contracts: SCORM 1.2 API surface, progress state, adapter
 * mode. Progress.ts (pure) codes against these; ScormAdapter.ts (DOM) too.
 */

// ---------------------------------------------------------------------------
// SCORM 1.2 run-time API as exposed on window.API
// ---------------------------------------------------------------------------

export type ScormBool = 'true' | 'false';

export type CmiKey =
  | 'cmi.core.student_id'
  | 'cmi.core.student_name'
  | 'cmi.core.lesson_location'
  | 'cmi.core.credit'
  | 'cmi.core.lesson_status'
  | 'cmi.core.entry'
  | 'cmi.core.score.raw'
  | 'cmi.core.score.min'
  | 'cmi.core.score.max'
  | 'cmi.core.total_time'
  | 'cmi.core.lesson_mode'
  | 'cmi.core.exit'
  | 'cmi.core.session_time'
  | 'cmi.suspend_data'
  | 'cmi.launch_data'
  | 'cmi.student_data.mastery_score';

export interface ScormApi12 {
  LMSInitialize(param: ''): ScormBool;
  LMSFinish(param: ''): ScormBool;
  LMSGetValue(key: CmiKey | string): string;
  LMSSetValue(key: CmiKey | string, value: string): ScormBool;
  LMSCommit(param: ''): ScormBool;
  LMSGetLastError(): string;
  LMSGetErrorString(code: string): string;
  LMSGetDiagnostic(code: string): string;
}

export type LessonStatus = 'passed' | 'completed' | 'failed' | 'incomplete' | 'browsed' | 'not attempted';
export type ExitValue = 'time-out' | 'suspend' | 'logout' | '';
export type EntryValue = 'ab-initio' | 'resume' | '';
export type LessonMode = 'browse' | 'normal' | 'review';

/** SCORM 1.2 field limits (CMIString256 / CMIString4096). */
export const LESSON_LOCATION_MAX = 255;
export const SUSPEND_DATA_MAX = 4096;
/** Our own ceiling, asserted by a test on the all-solved roster. */
export const SUSPEND_DATA_BUDGET = 512;

/** Discovery: walk up to this many parents, then opener chains. */
export const API_WALK_DEPTH = 10;
export const API_DISCOVERY_INTERVAL_MS = 250;
export const API_DISCOVERY_TIMEOUT_MS = 2000;
/** Non-milestone commits are throttled to one per this interval. */
export const COMMIT_THROTTLE_MS = 30_000;

// ---------------------------------------------------------------------------
// Adapter mode
// ---------------------------------------------------------------------------

export type AdapterMode = 'discovering' | 'lms' | 'standalone';

export const MODE_BADGE: Readonly<Record<AdapterMode, string>> = {
  discovering: 'Connecting to the course...',
  lms: 'Connected to course gradebook',
  standalone: 'Progress saved on this device - not connected to the gradebook',
};

export const STORAGE_KEY_PREFIX = 'orgocraft.v1.progress.';
export const STORAGE_KEY_SETTINGS = 'orgocraft.v1.settings';
export const STORAGE_KEY_INVENTORY = 'orgocraft.v1.inventory';
/** studentId used in standalone mode. */
export const LOCAL_STUDENT_ID = 'local';

export function progressStorageKey(studentId: string): string {
  return STORAGE_KEY_PREFIX + studentId;
}

// ---------------------------------------------------------------------------
// Progress state (pure; codec in Progress.ts)
// ---------------------------------------------------------------------------

/** Per-challenge outcome, indexed by roster position. */
export const Outcome = {
  NotAttempted: 0,
  Attempted: 1,
  /** Solved on a later attempt at reduced credit. */
  SolvedReduced: 2,
  /** Solved with full credit. */
  SolvedFull: 3,
} as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

export interface ProgressState {
  /** Codec version. */
  readonly version: 2;
  /** Learner this state belongs to (cmi.core.student_id, or LOCAL_STUDENT_ID). */
  readonly studentId: string;
  /** Bitmask over roster index: bit i set = challenge i attempted (any outcome >= 1). */
  readonly attempted: bigint;
  /** Bitmask: bit i set = solved (outcome >= 2). Subset of `attempted`. */
  readonly solved: bigint;
  /** Bitmask: bit i set = solved at reduced credit (outcome == 2). Subset of `solved`. */
  readonly reduced: bigint;
  /** Points earned so far (sum over solved challenges of full or reduced points). */
  readonly earned: number;
  /** Highest raw score ever written to the LMS in this attempt (monotonic). */
  readonly reportedRaw: number;
  /** Current challenge id, mirrored to cmi.core.lesson_location. */
  readonly currentChallengeId: string;
  /** Canonical hashes accepted per isomer-set challenge id (NOT persisted to
   *  suspend_data; localStorage only; empty after an LMS-only resume). */
  readonly isomersDone: Readonly<Record<string, readonly string[]>>;
}

/** Everything the score model needs from the roster. */
export interface RosterInfo {
  /** Challenge ids in roster order (index = bit position). */
  readonly ids: readonly string[];
  /** Points per index. */
  readonly points: readonly number[];
  /** Enabled per index (instructor config); disabled ones never count. */
  readonly enabled: readonly boolean[];
  readonly passMark: number;
}

export interface ScoreSummary {
  readonly earned: number;
  readonly total: number;
  readonly raw: number;
  readonly solvedCount: number;
  readonly enabledCount: number;
  readonly allAttempted: boolean;
  readonly allSolved: boolean;
}

/** What the adapter writes at a milestone / at exit. */
export interface LmsWrite {
  readonly scoreRaw: number | null;      // null = do not write (still 0 or not higher)
  readonly lessonStatus: LessonStatus;
  readonly lessonLocation: string;
  readonly suspendData: string;
  readonly exit?: ExitValue;
}

/** Codec string layout (Progress.ts):
 *  v2|<hex attempted>|<hex solved>|<hex reduced>|<earned>|<reportedRaw>|<currentChallengeId>
 *  Hex is the bigint in base 16 without a prefix; LSB = roster index 0.
 *  All-solved roster of 80 challenges encodes in < 120 characters. */
export const SUSPEND_DATA_VERSION = 'v2';

/** Result of merging LMS suspend_data with the localStorage mirror. */
export interface ResumeDecision {
  readonly state: ProgressState;
  readonly source: 'lms' | 'local' | 'fresh';
  /** true when the local mirror had more progress than the LMS and was used;
   *  the adapter must NOT auto-commit a score in that case. */
  readonly restoredFromLocal: boolean;
}
