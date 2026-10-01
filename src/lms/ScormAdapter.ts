/**
 * ScormAdapter: discovery loop, SCORM 1.2 call sequence, commit throttling,
 * lifecycle hooks (visibilitychange / pagehide / pageshow) and standalone mode.
 *
 * The class is DOM-free: every browser dependency is injected through
 * `AdapterDeps` so the test harness can drive it with a fake API, fake timers
 * and an in-memory mirror. `browserDeps()` is the only place that touches
 * `window`, `document` and `performance`, and only when it is called.
 * Spec: docs/design/08-deployment.md §2, §6.
 */
import type { Emitter } from '../app/events';
import type {
  AdapterMode,
  CmiKey,
  LessonStatus,
  LmsWrite,
  ProgressState,
  ResumeDecision,
  RosterInfo,
  ScormApi12,
} from './types';
import {
  API_DISCOVERY_INTERVAL_MS,
  API_DISCOVERY_TIMEOUT_MS,
  COMMIT_THROTTLE_MS,
  LOCAL_STUDENT_ID,
  MODE_BADGE,
  SUSPEND_DATA_MAX,
} from './types';
import type { ProgressStateV2 } from './Progress';
import {
  asV2,
  emptyState,
  encode,
  encodeLocal,
  exitValue,
  formatTimespan,
  isNewAttempt,
  lmsWrite,
  resume,
  sanitizeStudentId,
  summarize,
  withCurrent,
  UNKNOWN_STUDENT_ID,
} from './Progress';
import { discover } from './scorm-api';
import type { StorageLike } from './storage';
import { clearProgressMirror, readProgressMirror, safeLocalStorage, writeProgressMirror } from './storage';

// ---------------------------------------------------------------------------
// Dependency types
// ---------------------------------------------------------------------------

export interface Lifecycle {
  /** document 'visibilitychange' with visibilityState === 'hidden'. */
  onHidden(fn: () => void): void;
  /** window 'pagehide'; persisted = event.persisted. */
  onPageHide(fn: (persisted: boolean) => void): void;
  /** window 'pageshow'; persisted = event.persisted. */
  onPageShow(fn: (persisted: boolean) => void): void;
}

export interface Timers {
  /** ms, monotonic (performance.now). */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface AdapterDeps {
  readonly discover: () => ScormApi12 | null;
  readonly storage: StorageLike | null;
  readonly lifecycle: Lifecycle;
  readonly timers: Timers;
  readonly roster: RosterInfo;
  readonly emitter: Emitter;
  readonly log: (level: LogLevel, message: string, detail?: unknown) => void;
}

export type LessonModeValue = 'browse' | 'normal' | 'review' | '';

export interface AdapterSnapshot {
  readonly mode: AdapterMode;
  /** sanitized cmi.core.student_id, 'local', or null while discovering. */
  readonly studentId: string | null;
  /** lesson_mode review/browse: no LMS writes. */
  readonly readOnly: boolean;
  /** LMSFinish was called (or the session ended in standalone mode). */
  readonly finished: boolean;
  readonly source: ResumeDecision['source'] | null;
  readonly restoredFromLocal: boolean;
  /** §3.7: true from a local restore until the next milestone. */
  readonly scoreGated: boolean;
  readonly lastCommitAt: number | null;
  readonly lastStatusWritten: LessonStatus | null;
  /** API calls that returned 'false' or threw. */
  readonly errors: number;
}

// ---------------------------------------------------------------------------
// Strings owned by this module (07-ui re-exports them, never retypes)
// ---------------------------------------------------------------------------

/** Badge text for review/browse mode (lms:status.message when readOnly). */
export const REVIEW_BADGE = 'Review mode - your score is not recorded';
/** Badge text while LMS calls are failing (errors > 0 in the last commit). */
export const DEGRADED_BADGE = 'Connected to course gradebook - last save failed, retrying';
/** Badge text after a bfcache restore of a finished session. */
export const ENDED_BADGE =
  'Session ended - progress is saved on this device; reopen the activity from the course to continue reporting';
/** Attempt count State.ts assigns to an attempted-but-unsolved attempt-limited challenge after a resume (§3.8).
 *  Declared in the pure Progress.ts so State.ts can import it; re-exported here per 08 §1. */
export { RESUME_ATTEMPT_FLOOR } from './Progress';

const LESSON_STATUSES: readonly LessonStatus[] = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'];
/** SCORM 1.2 has no "already initialized" code: an LMS whose player already
 *  initialised the session answers LMSInitialize with 'false' and error 101
 *  (general exception). The data model is readable then, so the adapter
 *  continues as initialized instead of falling back to standalone. */
const ERR_ALREADY_INITIALIZED = '101';

function isLessonStatus(s: string): s is LessonStatus {
  return (LESSON_STATUSES as readonly string[]).includes(s);
}

function parseRaw(value: string): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ScormAdapter {
  private readonly deps: AdapterDeps;
  private api: ScormApi12 | null = null;
  private currentState: ProgressStateV2 = emptyState(UNKNOWN_STUDENT_ID);
  private currentMode: AdapterMode = 'discovering';
  private currentStudentId: string | null = null;
  private readOnly = false;
  /** false in review/browse mode: the device mirror is neither written nor
   *  discarded there, so a later normal launch cannot restore and report work
   *  done outside the graded window. */
  private mirrorEnabled = true;
  private finished = false;
  private disposed = false;
  private startPromise: Promise<AdapterMode> | null = null;
  private source: ResumeDecision['source'] | null = null;
  private restoredFromLocal = false;
  /** §3.7: set by a local restore, cleared by the next milestone. */
  private scoreGate = false;
  /** LMS status was 'passed' at launch: never write another status this session. */
  private statusFloorPassed = false;
  /** A currentChallengeId received by update() while still discovering (§6.3). */
  private pendingCurrent: string | null = null;
  private lastCommitAt: number | null = null;
  private pendingCommit: unknown = null;
  private discoveryTimer: unknown = null;
  private lastStatusWritten: LessonStatus | null = null;
  private lastLocationWritten: string | null = null;
  private lastSuspendWritten: string | null = null;
  private startedAt = 0;
  private errors = 0;
  private degraded = false;

  constructor(deps: AdapterDeps) {
    this.deps = deps;
  }

  // -- public surface --------------------------------------------------------

  /** The state produced by start() (after resume). Valid once start() resolved. */
  get state(): ProgressStateV2 {
    return this.currentState;
  }

  get mode(): AdapterMode {
    return this.currentMode;
  }

  get studentId(): string | null {
    return this.currentStudentId;
  }

  get snapshot(): AdapterSnapshot {
    return {
      mode: this.currentMode,
      studentId: this.currentStudentId,
      readOnly: this.readOnly,
      finished: this.finished,
      source: this.source,
      restoredFromLocal: this.restoredFromLocal,
      scoreGated: this.scoreGate,
      lastCommitAt: this.lastCommitAt,
      lastStatusWritten: this.lastStatusWritten,
      errors: this.errors,
    };
  }

  /** Discovery + LMSInitialize + resume. Resolves with the mode; never rejects. */
  start(): Promise<AdapterMode> {
    if (!this.startPromise) {
      this.startPromise = this.run().catch((e: unknown) => {
        // Nothing in run() should throw; if something does, play is not blocked.
        this.deps.log('error', 'start() failed; falling back to standalone', e);
        if (this.currentMode === 'discovering') return this.enterStandalone();
        return this.currentMode;
      });
    }
    return this.startPromise;
  }

  /** Non-milestone state change (attempt used, current challenge changed,
   *  isomer accepted): stores the state, writes the mirror, schedules a
   *  throttled commit. */
  update(state: ProgressState): void {
    if (this.currentMode === 'discovering') {
      // §6.2 step 9a: only the navigation is remembered; the state itself is
      // replaced by the resume result, and the mirror has no learner key yet.
      this.pendingCurrent = state.currentChallengeId;
      return;
    }
    this.currentState = withCurrent(state, state.currentChallengeId);
    this.writeMirror();
    if (this.currentMode === 'lms') this.commit();
  }

  /** Milestone (a challenge was solved): stores, mirrors, writes score /
   *  status / location / suspend, commits NOW. Returns the state with
   *  reportedRaw advanced when score.raw was accepted. */
  milestone(state: ProgressState): ProgressStateV2 {
    this.currentState = withCurrent(state, state.currentChallengeId);
    this.writeMirror();
    this.scoreGate = false; // an earned milestone lifts the restore gate (§3.7)
    if (this.currentMode !== 'lms' || this.readOnly || this.finished || !this.api) return this.currentState;
    const errorsBefore = this.errors;
    const w = lmsWrite(this.currentState, this.deps.roster, false); // gate already cleared: full raw
    const accepted = this.writeState(w);
    this.call('LMSCommit', '');
    this.lastCommitAt = this.deps.timers.now();
    this.cancelPending();
    this.afterCommit(errorsBefore);
    this.deps.emitter.emit('lms:committed', { raw: accepted ? w.scoreRaw : null, status: w.lessonStatus });
    return this.currentState;
  }

  /** Throttled commit of the current state (one per COMMIT_THROTTLE_MS; trailing call scheduled). */
  commit(): void {
    if (this.currentMode !== 'lms' || this.readOnly || this.finished) {
      if (this.currentMode === 'standalone') {
        this.writeMirror();
        this.deps.emitter.emit('lms:committed', { raw: null, status: 'local' });
      }
      return;
    }
    const now = this.deps.timers.now();
    const due = this.lastCommitAt === null ? 0 : this.lastCommitAt + COMMIT_THROTTLE_MS;
    if (now >= due) {
      this.flush();
      return;
    }
    if (this.pendingCommit === null) {
      this.pendingCommit = this.deps.timers.setTimeout(() => {
        this.pendingCommit = null;
        if (!this.disposed) this.flush();
      }, due - now);
    }
  }

  /** Immediate commit (visibilitychange hidden, Save button). */
  flush(): void {
    if (this.currentMode !== 'lms' || this.readOnly || this.finished || !this.api) return;
    this.cancelPending();
    const errorsBefore = this.errors;
    const w = lmsWrite(this.currentState, this.deps.roster, false, this.scoreGate); // W9 while gated
    const accepted = this.writeState(w);
    this.call('LMSCommit', '');
    this.lastCommitAt = this.deps.timers.now();
    this.afterCommit(errorsBefore);
    this.deps.emitter.emit('lms:committed', { raw: accepted ? w.scoreRaw : null, status: w.lessonStatus });
  }

  /** exit + session_time + commit + LMSFinish (once). Resolves after LMSFinish returned. */
  async saveAndExit(): Promise<void> {
    this.endSession(true);
  }

  /** Detach lifecycle listeners and timers (tests, context-loss restart). */
  dispose(): void {
    this.disposed = true;
    this.cancelPending();
    if (this.discoveryTimer !== null) {
      this.deps.timers.clearTimeout(this.discoveryTimer);
      this.discoveryTimer = null;
    }
  }

  // -- start sequence (§6.2) -------------------------------------------------

  private async run(): Promise<AdapterMode> {
    this.currentMode = 'discovering';
    this.emitStatus(MODE_BADGE.discovering);
    const api = await this.discoverApi();
    if (this.disposed) return this.currentMode;
    if (!api) return this.enterStandalone();
    this.api = api;
    if (!this.initialize()) {
      this.api = null; // the API is not used again
      return this.enterStandalone();
    }

    // 5. reads, in this order
    const studentId = sanitizeStudentId(this.get('cmi.core.student_id'));
    if (studentId === UNKNOWN_STUDENT_ID) this.deps.log('warn', 'cmi.core.student_id is empty; local mirror disabled');
    const lessonMode = this.get('cmi.core.lesson_mode');
    this.readOnly = lessonMode === 'review' || lessonMode === 'browse';
    this.mirrorEnabled = !this.readOnly;
    const initialStatus = this.get('cmi.core.lesson_status');
    this.lastStatusWritten = isLessonStatus(initialStatus) ? initialStatus : null;
    const entry = this.get('cmi.core.entry');
    const lmsString = this.get('cmi.suspend_data');
    const lmsLocation = this.get('cmi.core.lesson_location');
    const lmsRaw = parseRaw(this.get('cmi.core.score.raw'));
    const mastery = this.get('cmi.student_data.mastery_score');
    if (mastery !== '') {
      const m = parseInt(mastery, 10);
      if (m !== this.deps.roster.passMark) {
        const shown = Number.isFinite(m) ? String(m) : mastery;
        this.deps.log('warn', `LMS mastery score ${shown} differs from config passMark ${this.deps.roster.passMark}; config wins`);
      }
    }
    this.currentStudentId = studentId;

    // 6. score range and an initial status
    if (!this.readOnly) {
      this.set('cmi.core.score.min', '0');
      this.set('cmi.core.score.max', '100');
      if (initialStatus === 'not attempted' || initialStatus === '') {
        if (this.set('cmi.core.lesson_status', 'incomplete')) this.lastStatusWritten = 'incomplete';
      }
      this.call('LMSCommit', '');
    }

    // 7. mirror and merge (a new attempt in review/browse mode also starts
    //    fresh, but the stored mirror is left alone: it is disabled there)
    let mirror = readProgressMirror(this.deps.storage, studentId);
    if (isNewAttempt(entry, initialStatus, lmsString, lmsRaw)) {
      if (this.mirrorEnabled) {
        clearProgressMirror(this.deps.storage, studentId);
        if (mirror !== null) this.deps.log('info', 'new attempt; mirror discarded');
      }
      mirror = null;
    }
    const decision = resume(lmsString, mirror, studentId, this.deps.roster);

    // 8. the merged record, floored at what the LMS holds
    let state: ProgressStateV2 = {
      ...asV2(decision.state),
      reportedRaw: Math.max(decision.state.reportedRaw, lmsRaw),
    };
    this.source = decision.source;
    this.restoredFromLocal = decision.restoredFromLocal;
    this.scoreGate = decision.restoredFromLocal; // §3.6 W9

    // 9. bookmark fallback, then the learner's own navigation during discovery
    if (state.currentChallengeId === '' && this.deps.roster.ids.includes(lmsLocation)) {
      state = withCurrent(state, lmsLocation);
    }
    if (this.pendingCurrent !== null) {
      state = withCurrent(state, this.pendingCurrent);
      this.pendingCurrent = null;
    }
    this.currentState = state;

    // 10. the mirror now equals the merged record (skipped in review/browse mode: writeMirror is a no-op there)
    this.writeMirror();

    // 11. status floor; the LMS may keep 'passed' while dropping suspend data
    this.statusFloorPassed = initialStatus === 'passed';
    this.lastLocationWritten = lmsLocation;
    this.lastSuspendWritten = lmsString;

    // 12. lifecycle
    this.registerLifecycle();
    this.startedAt = this.deps.timers.now();
    this.currentMode = 'lms';

    // 13. announce
    this.emitStatus(this.readOnly ? REVIEW_BADGE : MODE_BADGE.lms);
    this.deps.log(
      'info',
      `lms mode; student=${studentId}; source=${decision.source}; restoredFromLocal=${decision.restoredFromLocal}; entry=${entry}`,
    );
    return 'lms';
  }

  /** Poll deps.discover() at t = 0, 250, ..., 2000 ms (9 calls at most). The
   *  polls are chained through timer callbacks, not awaited per tick, so a
   *  fake clock that fires due timers in one pass drives the whole loop. */
  private discoverApi(): Promise<ScormApi12 | null> {
    return new Promise<ScormApi12 | null>((resolve) => {
      const deadline = this.deps.timers.now() + API_DISCOVERY_TIMEOUT_MS;
      const poll = (): void => {
        this.discoveryTimer = null;
        if (this.disposed) {
          resolve(null);
          return;
        }
        let api: ScormApi12 | null = null;
        try {
          api = this.deps.discover();
        } catch (e) {
          this.deps.log('warn', 'API discovery threw', e);
        }
        if (api) {
          resolve(api);
          return;
        }
        if (this.deps.timers.now() >= deadline) {
          resolve(null);
          return;
        }
        this.discoveryTimer = this.deps.timers.setTimeout(poll, API_DISCOVERY_INTERVAL_MS);
      };
      poll();
    });
  }

  /** §6.8: no API within 2 s, or LMSInitialize failed. */
  private enterStandalone(): AdapterMode {
    const studentId = LOCAL_STUDENT_ID;
    this.currentStudentId = studentId;
    const decision = resume('', readProgressMirror(this.deps.storage, studentId), studentId, this.deps.roster);
    let state: ProgressStateV2 = asV2(decision.state);
    if (this.pendingCurrent !== null) {
      state = withCurrent(state, this.pendingCurrent);
      this.pendingCurrent = null;
    }
    this.currentState = state;
    this.source = decision.source;
    this.restoredFromLocal = decision.restoredFromLocal;
    this.scoreGate = false; // nothing is ever reported in standalone mode
    this.writeMirror();
    this.currentMode = 'standalone';
    this.deps.lifecycle.onHidden(() => {
      if (!this.disposed) this.writeMirror();
    });
    this.emitStatus(MODE_BADGE.standalone);
    this.deps.log('info', `standalone mode; source=${decision.source}`);
    return 'standalone';
  }

  private registerLifecycle(): void {
    this.deps.lifecycle.onHidden(() => {
      if (!this.disposed) this.flush();
    });
    this.deps.lifecycle.onPageHide(() => {
      if (!this.disposed) this.endSession(false);
    });
    this.deps.lifecycle.onPageShow((persisted) => {
      if (this.disposed || !persisted || !this.finished) return;
      // bfcache restore of a terminated session: the API is gone for good.
      this.emitStatus(ENDED_BADGE);
    });
  }

  // -- session end (§6.6) ----------------------------------------------------

  private endSession(atExit: boolean): void {
    if (this.currentMode !== 'lms' || this.finished || !this.api) {
      this.finished = true;
      return;
    }
    this.cancelPending();
    this.writeMirror();
    if (!this.readOnly) {
      // atExit=true may yield 'failed' (W4) and always sets exit; gated: no score / passed / failed (W9)
      const w = lmsWrite(this.currentState, this.deps.roster, atExit, this.scoreGate);
      const exit = w.exit ?? exitValue(summarize(this.currentState, this.deps.roster));
      this.writeState({ ...w, exit });
      this.set('cmi.core.session_time', formatTimespan(this.deps.timers.now() - this.startedAt));
      this.call('LMSCommit', '');
      this.lastCommitAt = this.deps.timers.now();
    }
    this.call('LMSFinish', '');
    this.finished = true;
    this.deps.emitter.emit('lms:committed', { raw: null, status: 'finished' });
  }

  // -- writes (§6.4) ---------------------------------------------------------

  /** Writes `w` for the current state and, when the LMS accepted score.raw,
   *  advances `reportedRaw` (state and mirror). Returns that acceptance. */
  private writeState(w: LmsWrite): boolean {
    const accepted = this.writeFields(w);
    if (accepted && w.scoreRaw !== null) {
      this.currentState = { ...this.currentState, reportedRaw: w.scoreRaw };
      this.writeMirror();
    }
    return accepted;
  }

  /** Writes the changed fields in the documented order (§6.4). Returns true
   *  iff score.raw was written and accepted. The suspend string is encoded
   *  with the raw the LMS accepted in step 1, so a resume reads the same
   *  `reportedRaw` the gradebook holds and the string is not rewritten at
   *  the next commit only because the score advanced. */
  private writeFields(w: LmsWrite): boolean {
    let accepted = false;
    if (w.scoreRaw !== null) accepted = this.set('cmi.core.score.raw', String(Math.round(w.scoreRaw)));
    const status: LessonStatus = this.statusFloorPassed ? 'passed' : w.lessonStatus;
    if (status !== this.lastStatusWritten && this.set('cmi.core.lesson_status', status)) {
      this.lastStatusWritten = status;
    }
    if (w.lessonLocation !== this.lastLocationWritten && this.set('cmi.core.lesson_location', w.lessonLocation)) {
      this.lastLocationWritten = w.lessonLocation;
    }
    const suspend =
      accepted && w.scoreRaw !== null ? encode({ ...this.currentState, reportedRaw: w.scoreRaw }) : w.suspendData;
    if (suspend !== this.lastSuspendWritten) {
      if (suspend.length > SUSPEND_DATA_MAX) {
        this.deps.log('error', `suspend_data of ${suspend.length} chars exceeds ${SUSPEND_DATA_MAX}; not written`);
      } else if (this.set('cmi.suspend_data', suspend)) {
        this.lastSuspendWritten = suspend;
      }
    }
    if (w.exit !== undefined) this.set('cmi.core.exit', w.exit);
    return accepted;
  }

  private writeMirror(): void {
    if (!this.mirrorEnabled || this.currentStudentId === null) return;
    writeProgressMirror(this.deps.storage, this.currentStudentId, encodeLocal(this.currentState));
  }

  /** Degraded / recovered badge after a commit sequence (§6.7). */
  private afterCommit(errorsBefore: number): void {
    const failed = this.errors > errorsBefore;
    if (failed && !this.degraded) {
      this.degraded = true;
      this.emitStatus(DEGRADED_BADGE);
    } else if (!failed && this.degraded) {
      this.degraded = false;
      this.emitStatus(this.readOnly ? REVIEW_BADGE : MODE_BADGE.lms);
    }
  }

  private cancelPending(): void {
    if (this.pendingCommit !== null) {
      this.deps.timers.clearTimeout(this.pendingCommit);
      this.pendingCommit = null;
    }
  }

  private emitStatus(message: string): void {
    this.deps.emitter.emit('lms:status', { mode: this.currentMode, studentId: this.currentStudentId, message });
  }

  // -- call wrappers (§6.7) --------------------------------------------------

  /** §6.2 step 4. A 'false' whose LMSGetLastError() is 101 (already
   *  initialized by the player) is treated as initialized with a warning; any
   *  other 'false', or a throw, means there is no usable LMS. */
  private initialize(): boolean {
    let r: unknown;
    try {
      r = this.api?.LMSInitialize('');
    } catch (e) {
      this.errors++;
      this.deps.log('error', 'LMSInitialize threw', e);
      return false;
    }
    if (r === 'true') return true;
    const code = this.lastErrorCode();
    if (code === ERR_ALREADY_INITIALIZED) {
      this.deps.log('warn', `LMSInitialize returned false with error ${code} (already initialized); continuing`);
      return true;
    }
    this.logLmsError('LMSInitialize', code);
    return false;
  }

  private call(fn: 'LMSCommit' | 'LMSFinish', arg: ''): boolean {
    try {
      const r = this.api?.[fn](arg);
      if (r === 'true') return true;
      this.logLmsError(fn);
      return false;
    } catch (e) {
      this.errors++;
      this.deps.log('error', `${fn} threw`, e);
      return false;
    }
  }

  private get(key: CmiKey): string {
    try {
      const v: unknown = this.api?.LMSGetValue(key);
      return typeof v === 'string' ? v : String(v ?? '');
    } catch (e) {
      this.errors++;
      this.deps.log('error', `LMSGetValue(${key}) threw`, e);
      return '';
    }
  }

  private set(key: CmiKey, value: string): boolean {
    try {
      const r = this.api?.LMSSetValue(key, value);
      if (r === 'true') return true;
      this.logLmsError(`LMSSetValue(${key})`);
      return false;
    } catch (e) {
      this.errors++;
      this.deps.log('error', `LMSSetValue(${key}) threw`, e);
      return false;
    }
  }

  /** LMSGetLastError() as a string; '' when the call throws. */
  private lastErrorCode(): string {
    try {
      return String(this.api?.LMSGetLastError() ?? '');
    } catch {
      return '';
    }
  }

  /** `code` is passed when the caller already read LMSGetLastError(). */
  private logLmsError(what: string, code?: string): void {
    this.errors++;
    const c = code ?? this.lastErrorCode();
    let text = '';
    let diag = '';
    try {
      text = String(this.api?.LMSGetErrorString(c) ?? '');
      diag = String(this.api?.LMSGetDiagnostic(c) ?? '');
    } catch {
      /* ignore: diagnostics are best effort */
    }
    this.deps.log('error', `${what} returned false: ${c} ${text} ${diag}`.trim());
  }
}

// ---------------------------------------------------------------------------
// Browser wiring; call only from Game.ts
// ---------------------------------------------------------------------------

export function browserDeps(roster: RosterInfo, emitter: Emitter): AdapterDeps {
  return {
    discover: () => discover(),
    storage: safeLocalStorage(),
    lifecycle: {
      onHidden: (fn) =>
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') fn();
        }),
      onPageHide: (fn) => window.addEventListener('pagehide', (e) => fn(Boolean((e as PageTransitionEvent).persisted))),
      onPageShow: (fn) => window.addEventListener('pageshow', (e) => fn(Boolean((e as PageTransitionEvent).persisted))),
    },
    timers: {
      now: () => performance.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (h) => window.clearTimeout(h as number),
    },
    roster,
    emitter,
    log: (level, message, detail) => {
      const method = level === 'info' ? 'log' : level;
      console[method]('[lms] ' + message, detail ?? '');
    },
  };
}
