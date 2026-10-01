/**
 * test/lms/adapter.test.ts — 08-deployment §13.2 (A-* cases) with a fake
 * window.API that records every call; §13.3 (D-* discovery cases) and §13.4
 * (K-* packaging cases) are included here because their subjects
 * (src/lms/scorm-api.ts, scripts/*.mjs) belong to the same package. Runs in
 * vitest's node environment: no jsdom. `browserDeps` is exercised against a
 * hand-made fake window/document installed on globalThis for one test.
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmitter } from '@/app/events';
import type { AdapterMode, RosterInfo, ScormApi12 } from '@/lms/types';
import { COMMIT_THROTTLE_MS, MODE_BADGE, Outcome, progressStorageKey } from '@/lms/types';
import {
  applyExhausted,
  applyOutcome,
  decode,
  emptyState,
  encodeLocal,
  withCurrent,
  withIsomers,
  type ProgressStateV2,
} from '@/lms/Progress';
import { readProgressMirror, safeLocalStorage, writeProgressMirror } from '@/lms/storage';
import { discover, findApi, isScormApi, type WindowLike } from '@/lms/scorm-api';
import {
  DEGRADED_BADGE,
  ENDED_BADGE,
  REVIEW_BADGE,
  ScormAdapter,
  browserDeps,
  type AdapterDeps,
} from '@/lms/ScormAdapter';
// @ts-ignore no declaration files for the node scripts; their shapes are typed below
import * as scormPkg from '../../scripts/package-scorm.mjs';
// @ts-ignore see above
import * as pathCheck from '../../scripts/check-relative-paths.mjs';

// ---------------------------------------------------------------------------
// Fixtures and harness (§13.2)
// ---------------------------------------------------------------------------

const roster6: RosterInfo = {
  ids: ['a', 'b', 'c', 'd', 'e', 'f'],
  points: [2, 4, 4, 8, 2, 4],
  enabled: [true, true, true, true, true, true],
  passMark: 70,
};

export interface FakeApi extends ScormApi12 {
  calls: [string, ...string[]][];
  data: Record<string, string>;
  failNext: Set<string>;
  throwNext: Set<string>;
  /** What LMSGetLastError returns; a failing LMSSetValue sets it to '405'. */
  lastError: string;
}

const allApis: FakeApi[] = [];

export function fakeApi(initial: Partial<Record<string, string>> = {}): FakeApi {
  const data: Record<string, string> = {
    'cmi.core.student_id': 'stu-1',
    'cmi.core.lesson_mode': 'normal',
    'cmi.core.lesson_status': 'not attempted',
    'cmi.core.entry': 'ab-initio',
    'cmi.suspend_data': '',
    'cmi.core.lesson_location': '',
    'cmi.core.score.raw': '',
    'cmi.student_data.mastery_score': '70',
    ...initial,
  };
  const calls: FakeApi['calls'] = [];
  const failNext = new Set<string>();
  const throwNext = new Set<string>();
  const api: FakeApi = {
    calls,
    data,
    failNext,
    throwNext,
    lastError: '0',
    LMSInitialize: (p) => {
      calls.push(['LMSInitialize', p]);
      return failNext.delete('LMSInitialize') ? 'false' : 'true';
    },
    LMSFinish: (p) => {
      calls.push(['LMSFinish', p]);
      return 'true';
    },
    LMSGetValue: (k) => {
      calls.push(['LMSGetValue', k]);
      return data[k] ?? '';
    },
    LMSSetValue: (k, v) => {
      calls.push(['LMSSetValue', k, v]);
      if (throwNext.delete(k)) throw new Error(`boom ${k}`);
      if (failNext.delete(k)) {
        api.lastError = '405';
        return 'false';
      }
      data[k] = v;
      return 'true';
    },
    LMSCommit: (p) => {
      calls.push(['LMSCommit', p]);
      return failNext.delete('LMSCommit') ? 'false' : 'true';
    },
    LMSGetLastError: () => {
      calls.push(['LMSGetLastError']);
      return api.lastError;
    },
    LMSGetErrorString: (c) => `error ${c}`,
    LMSGetDiagnostic: (c) => `diag ${c}`,
  };
  allApis.push(api);
  return api;
}

interface HarnessOptions {
  storage?: Map<string, string> | null;
  mirror?: [string, string];
  discover?: () => ScormApi12 | null;
}

export function harness(api: ScormApi12 | null, opts: HarnessOptions = {}) {
  let t = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let seq = 0;
  const hidden: (() => void)[] = [];
  const pagehide: ((p: boolean) => void)[] = [];
  const pageshow: ((p: boolean) => void)[] = [];
  const map = opts.storage === null ? null : (opts.storage ?? new Map<string, string>());
  if (map && opts.mirror) map.set(opts.mirror[0], opts.mirror[1]);
  const storage = map
    ? {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => {
          map.set(k, v);
        },
        removeItem: (k: string) => {
          map.delete(k);
        },
      }
    : null;
  const emitter = createEmitter();
  const events: { name: string; e: { mode: AdapterMode; studentId: string | null; message: string } | { raw: number | null; status: string } }[] = [];
  emitter.on('lms:status', (e) => events.push({ name: 'lms:status', e }));
  emitter.on('lms:committed', (e) => events.push({ name: 'lms:committed', e }));
  const logs: string[] = [];
  let discoverCalls = 0;
  const deps: AdapterDeps = {
    discover: () => {
      discoverCalls++;
      return opts.discover ? opts.discover() : api;
    },
    storage,
    roster: roster6,
    emitter,
    lifecycle: {
      onHidden: (fn) => hidden.push(fn),
      onPageHide: (fn) => pagehide.push(fn),
      onPageShow: (fn) => pageshow.push(fn),
    },
    timers: {
      now: () => t,
      setTimeout: (fn, ms) => {
        const id = ++seq;
        timers.set(id, { at: t + ms, fn });
        return id;
      },
      clearTimeout: (h) => {
        timers.delete(h as number);
      },
    },
    log: (level, m) => logs.push(`${level}: ${m}`),
  };
  const advance = (ms: number): void => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      t = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    t = end;
  };
  return {
    deps,
    storage: map,
    events,
    logs,
    advance,
    now: () => t,
    pendingTimers: () => timers.size,
    discoverCalls: () => discoverCalls,
    fire: {
      hidden: () => hidden.forEach((f) => f()),
      pagehide: (p = false) => pagehide.forEach((f) => f(p)),
      pageshow: (p = true) => pageshow.forEach((f) => f(p)),
    },
    close: vi.fn(),
  };
}

type Harness = ReturnType<typeof harness>;

function setsOf(api: FakeApi, key: string): string[] {
  return api.calls.filter((c) => c[0] === 'LMSSetValue' && c[1] === key).map((c) => c[2] ?? '');
}

function countCalls(api: FakeApi, fn: string): number {
  return api.calls.filter((c) => c[0] === fn).length;
}

function statusEvents(h: Harness): string[] {
  return h.events.filter((x) => x.name === 'lms:status').map((x) => (x.e as { message: string }).message);
}

function lastCommitted(h: Harness): { raw: number | null; status: string } | undefined {
  const c = h.events.filter((x) => x.name === 'lms:committed');
  return c[c.length - 1]?.e as { raw: number | null; status: string } | undefined;
}

/** start() with the API present: resolves at t = 0. */
async function startLms(h: Harness): Promise<{ adapter: ScormAdapter; mode: AdapterMode }> {
  const adapter = new ScormAdapter(h.deps);
  const p = adapter.start();
  h.advance(0);
  const mode = await p;
  return { adapter, mode };
}

const full = (s: ProgressStateV2, i: number, p: number): ProgressStateV2 => applyOutcome(s, i, Outcome.SolvedFull, p);
const half = (s: ProgressStateV2, i: number, p: number): ProgressStateV2 =>
  applyOutcome(s, i, Outcome.SolvedReduced, Math.floor(p / 2));
const tried = (s: ProgressStateV2, i: number): ProgressStateV2 => applyOutcome(s, i, Outcome.Attempted, 0);

/** a,b,c solved (a,b full, c reduced): raw 33. */
const threeSolvedRaw33 = (sid = 'stu-1'): ProgressStateV2 => half(full(full(emptyState(sid), 0, 2), 1, 4), 2, 4);
/** a,b,c solved full: raw 42. */
const threeSolvedFull = (sid = 'stu-1'): ProgressStateV2 => full(full(full(emptyState(sid), 0, 2), 1, 4), 2, 4);
/** a,b,c,d solved full: raw 75. */
const fourSolved = (sid = 'stu-1'): ProgressStateV2 => full(threeSolvedFull(sid), 3, 8);
const allTried = (s: ProgressStateV2): ProgressStateV2 => {
  for (let i = 0; i < 6; i++) s = tried(s, i);
  return s;
};
const allSolved = (sid = 'stu-1'): ProgressStateV2 => {
  let s = emptyState(sid);
  roster6.points.forEach((p, i) => {
    s = full(s, i, p);
  });
  return s;
};

const KEY = progressStorageKey('stu-1');

afterAll(() => {
  // A-X3: over every state produced in this file, cmi.core.exit is never 'logout' or 'time-out'.
  for (const api of allApis) {
    for (const v of setsOf(api, 'cmi.core.exit')) {
      expect(v).not.toBe('logout');
      expect(v).not.toBe('time-out');
      expect(['suspend', '']).toContain(v);
    }
  }
});

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

describe('ScormAdapter.start', () => {
  it('A-S1 fresh learner: exact call sequence, events, mirror', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter, mode } = await startLms(h);
    expect(mode).toBe('lms');
    expect(adapter.mode).toBe('lms');
    expect(adapter.studentId).toBe('stu-1');
    expect(api.calls).toEqual([
      ['LMSInitialize', ''],
      ['LMSGetValue', 'cmi.core.student_id'],
      ['LMSGetValue', 'cmi.core.lesson_mode'],
      ['LMSGetValue', 'cmi.core.lesson_status'],
      ['LMSGetValue', 'cmi.core.entry'],
      ['LMSGetValue', 'cmi.suspend_data'],
      ['LMSGetValue', 'cmi.core.lesson_location'],
      ['LMSGetValue', 'cmi.core.score.raw'],
      ['LMSGetValue', 'cmi.student_data.mastery_score'],
      ['LMSSetValue', 'cmi.core.score.min', '0'],
      ['LMSSetValue', 'cmi.core.score.max', '100'],
      ['LMSSetValue', 'cmi.core.lesson_status', 'incomplete'],
      ['LMSCommit', ''],
    ]);
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual([]);
    expect(setsOf(api, 'cmi.suspend_data')).toEqual([]);
    expect(h.events[0]).toEqual({
      name: 'lms:status',
      e: { mode: 'discovering', studentId: null, message: MODE_BADGE.discovering },
    });
    expect(h.events[h.events.length - 1]).toEqual({
      name: 'lms:status',
      e: { mode: 'lms', studentId: 'stu-1', message: MODE_BADGE.lms },
    });
    expect(h.storage!.get(KEY)).toBe(encodeLocal(adapter.state));
    expect(adapter.snapshot).toMatchObject({
      mode: 'lms',
      studentId: 'stu-1',
      readOnly: false,
      finished: false,
      source: 'fresh',
      restoredFromLocal: false,
      scoreGated: false,
      lastStatusWritten: 'incomplete',
      errors: 0,
    });
    expect(h.close).not.toHaveBeenCalled();
  });

  it('A-S2 no API: standalone after 9 polls', async () => {
    const h = harness(null);
    const adapter = new ScormAdapter(h.deps);
    const p = adapter.start();
    h.advance(2000);
    const mode = await p;
    expect(mode).toBe('standalone');
    expect(h.discoverCalls()).toBe(9);
    expect(adapter.studentId).toBe('local');
    expect(statusEvents(h)).toEqual([MODE_BADGE.discovering, MODE_BADGE.standalone]);
    expect(h.storage!.get(progressStorageKey('local'))).toBe(encodeLocal(emptyState('local')));
    await expect(adapter.saveAndExit()).resolves.toBeUndefined();
    expect(adapter.snapshot.finished).toBe(true);
    // a Save in standalone mode reports a local save
    adapter.commit();
    expect(lastCommitted(h)).toEqual({ raw: null, status: 'local' });
  });

  it('A-S2b standalone resumes its own mirror and the pre-start navigation', async () => {
    const mirror = withIsomers(threeSolvedFull('local'), 'x', ['0123456789abcdef']);
    const h = harness(null, { mirror: [progressStorageKey('local'), encodeLocal(mirror)] });
    const adapter = new ScormAdapter(h.deps);
    const p = adapter.start();
    adapter.update(withCurrent(emptyState(''), 'e'));
    h.advance(2000);
    await p;
    expect(adapter.state.solved).toBe(7n);
    expect(adapter.state.isomersDone).toEqual({ x: ['0123456789abcdef'] });
    expect(adapter.state.currentChallengeId).toBe('e');
    expect(adapter.snapshot.scoreGated).toBe(false);
    adapter.update(withCurrent(adapter.state, 'f'));
    expect(h.storage!.get(progressStorageKey('local'))).toBe(encodeLocal(adapter.state));
    h.fire.hidden();
    expect(h.storage!.get(progressStorageKey('local'))).toBe(encodeLocal(adapter.state));
  });

  it('A-S3 API appears on the 3rd poll', async () => {
    const api = fakeApi();
    let n = 0;
    const h = harness(api, { discover: () => (++n >= 3 ? api : null) });
    const adapter = new ScormAdapter(h.deps);
    const p = adapter.start();
    h.advance(499);
    expect(h.discoverCalls()).toBe(2);
    expect(adapter.mode).toBe('discovering');
    h.advance(1);
    expect(h.discoverCalls()).toBe(3);
    expect(h.now()).toBe(500);
    expect(await p).toBe('lms');
    expect(countCalls(api, 'LMSInitialize')).toBe(1);
    expect(h.pendingTimers()).toBe(0);
  });

  it('A-S4 LMSInitialize fails: standalone, logged, API not used again', async () => {
    const api = fakeApi();
    api.failNext.add('LMSInitialize');
    const h = harness(api);
    const { adapter, mode } = await startLms(h);
    expect(mode).toBe('standalone');
    expect(h.logs).toContain('error: LMSInitialize returned false: 0 error 0 diag 0');
    expect(api.calls).toEqual([['LMSInitialize', ''], ['LMSGetLastError']]);
    adapter.milestone(full(adapter.state, 0, 2));
    await adapter.saveAndExit();
    expect(api.calls).toHaveLength(2);
  });

  it('A-S4b LMSInitialize false with error 101 (already initialized): continues as initialized, warn logged', async () => {
    const api = fakeApi();
    api.failNext.add('LMSInitialize');
    api.lastError = '101';
    const h = harness(api);
    const { adapter, mode } = await startLms(h);
    expect(mode).toBe('lms');
    expect(adapter.snapshot.errors).toBe(0);
    expect(h.logs).toContain('warn: LMSInitialize returned false with error 101 (already initialized); continuing');
    expect(h.logs.some((l) => l.startsWith('error:'))).toBe(false);
    expect(api.calls.slice(0, 3)).toEqual([['LMSInitialize', ''], ['LMSGetLastError'], ['LMSGetValue', 'cmi.core.student_id']]);
    expect(countCalls(api, 'LMSInitialize')).toBe(1);
    expect(statusEvents(h)[statusEvents(h).length - 1]).toBe(MODE_BADGE.lms);
    adapter.milestone(full(adapter.state, 0, 2));
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual(['8']);
    await adapter.saveAndExit();
    expect(countCalls(api, 'LMSFinish')).toBe(1);
    // any other error code is still "no LMS"
    const api2 = fakeApi();
    api2.failNext.add('LMSInitialize');
    api2.lastError = '201';
    const h2 = harness(api2);
    expect((await startLms(h2)).mode).toBe('standalone');
    expect(h2.logs).toContain('error: LMSInitialize returned false: 201 error 201 diag 201');
    expect(api2.calls).toEqual([['LMSInitialize', ''], ['LMSGetLastError']]);
  });

  it('A-S5 an existing lesson_status is not rewritten at start', async () => {
    const api = fakeApi({ 'cmi.core.lesson_status': 'incomplete' });
    const h = harness(api);
    await startLms(h);
    expect(setsOf(api, 'cmi.core.lesson_status')).toEqual([]);
  });

  it('A-S6 review mode: no writes at all, LMSFinish still once', async () => {
    const api = fakeApi({ 'cmi.core.lesson_mode': 'review' });
    const h = harness(api);
    const { adapter, mode } = await startLms(h);
    expect(mode).toBe('lms');
    expect(adapter.snapshot.readOnly).toBe(true);
    expect(statusEvents(h)[statusEvents(h).length - 1]).toBe(REVIEW_BADGE);
    adapter.milestone(full(adapter.state, 0, 2));
    adapter.update(withCurrent(adapter.state, 'b'));
    adapter.flush();
    h.advance(60_000);
    await adapter.saveAndExit();
    expect(api.calls.filter((c) => c[0] === 'LMSSetValue')).toEqual([]);
    expect(countCalls(api, 'LMSCommit')).toBe(0);
    expect(countCalls(api, 'LMSFinish')).toBe(1);
    expect(adapter.snapshot.finished).toBe(true);
  });

  it('A-S6b review mode writes no mirror', async () => {
    for (const lessonMode of ['review', 'browse']) {
      // a fresh launch: no storage key is written at start, milestone, update, flush, tab switch or Save & Exit
      const api = fakeApi({ 'cmi.core.lesson_mode': lessonMode });
      const h = harness(api);
      const { adapter, mode } = await startLms(h);
      expect(mode).toBe('lms');
      expect(adapter.snapshot.readOnly).toBe(true);
      expect(h.storage!.size).toBe(0);
      adapter.milestone(full(adapter.state, 0, 2));
      adapter.update(withCurrent(adapter.state, 'b'));
      adapter.flush();
      h.fire.hidden();
      h.advance(60_000);
      await adapter.saveAndExit();
      expect(h.storage!.size).toBe(0);
      expect(adapter.state.solved).toBe(1n); // the session itself still tracks the work
      // a mirror from a normal session is neither overwritten nor discarded, even by a new-attempt launch
      const mirror = encodeLocal(threeSolvedFull());
      const api2 = fakeApi({ 'cmi.core.lesson_mode': lessonMode });
      const h2 = harness(api2, { mirror: [KEY, mirror] });
      const { adapter: a2 } = await startLms(h2);
      expect(a2.snapshot.source).toBe('fresh');
      a2.milestone(full(a2.state, 3, 8));
      h2.fire.pagehide();
      expect([...h2.storage!.entries()]).toEqual([[KEY, mirror]]);
      expect(h2.logs).not.toContain('info: new attempt; mirror discarded');
    }
  });

  it('A-S7 empty student id: no mirror, warning logged', async () => {
    const api = fakeApi({ 'cmi.core.student_id': '' });
    const h = harness(api);
    const { adapter } = await startLms(h);
    expect(adapter.studentId).toBe('');
    expect(h.storage!.size).toBe(0);
    expect(h.logs.some((l) => l.startsWith('warn:'))).toBe(true);
    adapter.milestone(full(adapter.state, 0, 2));
    expect(h.storage!.size).toBe(0);
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual(['8']);
  });

  it('A-S8 bookmark fallback and the LMS raw floor', async () => {
    const two = full(full(emptyState('stu-1'), 0, 2), 1, 4);
    const api = fakeApi({
      'cmi.suspend_data': `v2|3|3|0|0|6|0|`,
      'cmi.core.lesson_location': 'c',
      'cmi.core.score.raw': '33',
      'cmi.core.lesson_status': 'incomplete',
    });
    const h = harness(api);
    const { adapter } = await startLms(h);
    expect(adapter.state.solved).toBe(two.solved);
    expect(adapter.state.currentChallengeId).toBe('c');
    expect(adapter.state.reportedRaw).toBe(33);
    expect(adapter.snapshot.source).toBe('lms');
    // a location that is not a roster id is ignored
    const api2 = fakeApi({ 'cmi.suspend_data': `v2|3|3|0|0|6|0|`, 'cmi.core.lesson_location': 'zzz' });
    const { adapter: a2 } = await startLms(harness(api2));
    expect(a2.state.currentChallengeId).toBe('');
  });

  it('A-S9 a differing mastery score is logged; config wins', async () => {
    const api = fakeApi({ 'cmi.student_data.mastery_score': '80' });
    const h = harness(api);
    await startLms(h);
    expect(h.logs).toContain('warn: LMS mastery score 80 differs from config passMark 70; config wins');
    const h2 = harness(fakeApi({ 'cmi.student_data.mastery_score': '' }));
    await startLms(h2);
    expect(h2.logs.some((l) => l.includes('mastery'))).toBe(false);
  });

  it('A-S10 an update during discovery only records the navigation', async () => {
    for (const location of ['', 'b']) {
      const api = fakeApi({ 'cmi.core.lesson_location': location });
      const h = harness(api);
      const adapter = new ScormAdapter(h.deps);
      const p = adapter.start();
      adapter.update(withCurrent(emptyState(''), 'c'));
      expect(api.calls).toEqual([]);
      expect([...h.storage!.keys()].some((k) => k.includes('null'))).toBe(false);
      h.advance(0);
      await p;
      expect(api.calls[0]).toEqual(['LMSInitialize', '']);
      expect([...h.storage!.keys()].some((k) => k.includes('null'))).toBe(false);
      expect(adapter.state.currentChallengeId).toBe('c');
      expect(decode(h.storage!.get(KEY)!.split('|').slice(0, 8).join('|'), 'stu-1').currentChallengeId).toBe('c');
    }
  });
});

// ---------------------------------------------------------------------------
// Mirror merge and the score gate
// ---------------------------------------------------------------------------

describe('ScormAdapter mirror merge and score gate', () => {
  it('A-M1 local restore: gated until the next milestone, which reports the full raw', async () => {
    const api = fakeApi({ 'cmi.core.entry': 'resume' });
    const h = harness(api, { mirror: [KEY, encodeLocal(threeSolvedFull())] });
    const { adapter } = await startLms(h);
    expect(adapter.snapshot.restoredFromLocal).toBe(true);
    expect(adapter.snapshot.scoreGated).toBe(true);
    expect(adapter.snapshot.source).toBe('local');
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual([]);
    const commitsBefore = countCalls(api, 'LMSCommit');
    const next = adapter.milestone(full(adapter.state, 3, 8));
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual(['75']);
    expect(setsOf(api, 'cmi.core.lesson_status')).toEqual(['incomplete', 'passed']);
    expect(setsOf(api, 'cmi.suspend_data')).toHaveLength(1);
    expect(countCalls(api, 'LMSCommit')).toBe(commitsBefore + 1);
    expect(next.reportedRaw).toBe(75);
    expect(adapter.state.reportedRaw).toBe(75);
    expect(adapter.snapshot.scoreGated).toBe(false);
    expect(lastCommitted(h)).toEqual({ raw: 75, status: 'passed' });
  });

  it('A-M2 another learner\'s mirror is never read or touched', async () => {
    const other = progressStorageKey('stu-9');
    const otherValue = encodeLocal(allSolved('stu-9'));
    const api = fakeApi();
    const h = harness(api, { mirror: [other, otherValue] });
    const { adapter } = await startLms(h);
    expect(adapter.snapshot.source).toBe('fresh');
    expect(adapter.state.solved).toBe(0n);
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual([]);
    expect(h.storage!.get(KEY)).toBe(encodeLocal(emptyState('stu-1')));
    expect(h.storage!.get(other)).toBe(otherValue);
  });

  async function restoredRaw33(): Promise<{ api: FakeApi; h: Harness; adapter: ScormAdapter }> {
    const api = fakeApi({ 'cmi.core.entry': 'resume' });
    const h = harness(api, { mirror: [KEY, encodeLocal(threeSolvedRaw33())] });
    const { adapter } = await startLms(h);
    adapter.update(withCurrent(adapter.state, 'b'));
    h.advance(COMMIT_THROTTLE_MS);
    return { api, h, adapter };
  }

  it('A-M6 throttled commits after a local restore never carry a score or status', async () => {
    const { api } = await restoredRaw33();
    expect(countCalls(api, 'LMSCommit')).toBe(2);
    expect(setsOf(api, 'cmi.suspend_data')).toHaveLength(1);
    expect(setsOf(api, 'cmi.core.lesson_location')).toEqual(['b']);
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual([]);
    expect(setsOf(api, 'cmi.core.lesson_status')).toEqual(['incomplete']);
  });

  it('A-M7 a tab switch after a local restore writes no score', async () => {
    const { api, h } = await restoredRaw33();
    h.fire.hidden();
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual([]);
    expect(setsOf(api, 'cmi.core.lesson_status')).not.toContain('passed');
  });

  it('A-M8 Save & Exit after a local restore: no score, no passed/failed, exit suspend', async () => {
    const restored = allTried(fourSolved());
    const api = fakeApi({ 'cmi.core.entry': 'resume' });
    const h = harness(api, { mirror: [KEY, encodeLocal(restored)] });
    const { adapter } = await startLms(h);
    adapter.update(withCurrent(adapter.state, 'b'));
    h.advance(COMMIT_THROTTLE_MS);
    await adapter.saveAndExit();
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual([]);
    expect(setsOf(api, 'cmi.core.lesson_status')).toEqual(['incomplete']);
    expect(setsOf(api, 'cmi.core.exit')).toEqual(['suspend']);
    const suspend = setsOf(api, 'cmi.suspend_data');
    expect(suspend.length).toBeGreaterThan(0);
    const last = decode(suspend[suspend.length - 1]!, 'stu-1');
    expect(last.solved).toBe(restored.solved);
    expect(last.attempted).toBe(restored.attempted);
    expect(countCalls(api, 'LMSFinish')).toBe(1);
  });

  it('A-M9 the first milestone after a local restore reports the full raw once', async () => {
    const { api, h, adapter } = await restoredRaw33();
    adapter.milestone(full(adapter.state, 3, 8)); // restored 8 + 8 = 16/24 = 67: the full merged raw, not just this session's
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual(['67']);
    expect(setsOf(api, 'cmi.core.lesson_status')).toEqual(['incomplete']);
    expect(adapter.state.reportedRaw).toBe(67);
    expect(adapter.snapshot.scoreGated).toBe(false);
    // the same from a mirror with a,b,c at full credit reaches the pass mark in one step
    const api2 = fakeApi({ 'cmi.core.entry': 'resume' });
    const h2 = harness(api2, { mirror: [KEY, encodeLocal(threeSolvedFull())] });
    const { adapter: a2 } = await startLms(h2);
    a2.milestone(full(a2.state, 3, 8));
    expect(setsOf(api2, 'cmi.core.score.raw')).toEqual(['75']);
    expect(setsOf(api2, 'cmi.core.lesson_status')).toEqual(['incomplete', 'passed']);
    const sets = api.calls.filter((c) => c[0] === 'LMSSetValue').length;
    h.fire.hidden();
    expect(api.calls.filter((c) => c[0] === 'LMSSetValue').length).toBe(sets);
  });

  it('A-M10 the exhausted mask survives a commit and a relaunch', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    adapter.update(applyExhausted(adapter.state, 4));
    expect(decode(api.data['cmi.suspend_data']!, 'stu-1').exhausted).toBe(16n);
    const h2 = harness(api);
    const { adapter: again } = await startLms(h2);
    expect(again.state.exhausted).toBe(16n);
    expect(again.snapshot.source).toBe('lms');
  });

  it('A-M11 a brand-new LMS attempt (entry ab-initio or empty) discards the mirror; a kept status, score or resume entry keeps it', async () => {
    const mirror = encodeLocal(threeSolvedFull());
    // the default launch (entry 'ab-initio'), and the same with an empty entry, which SCORM 1.2 allows on a fresh attempt
    for (const entry of ['ab-initio', '']) {
      const a = harness(fakeApi({ 'cmi.core.entry': entry }), { mirror: [KEY, mirror] });
      const { adapter: aa } = await startLms(a);
      expect(aa.snapshot.source).toBe('fresh');
      expect(aa.snapshot.restoredFromLocal).toBe(false);
      expect(aa.snapshot.scoreGated).toBe(false);
      expect(aa.state.solved).toBe(0n);
      expect(a.logs).toContain('info: new attempt; mirror discarded');
      expect(a.storage!.get(KEY)).toBe(encodeLocal(emptyState('stu-1')));
    }

    const variants: Partial<Record<string, string>>[] = [
      { 'cmi.core.entry': 'resume' },
      { 'cmi.core.score.raw': '33' },
      { 'cmi.core.lesson_status': 'incomplete' },
      { 'cmi.core.entry': '', 'cmi.core.score.raw': '33' },
      { 'cmi.core.entry': '', 'cmi.core.lesson_status': 'incomplete' },
    ];
    for (const v of variants) {
      const h = harness(fakeApi(v), { mirror: [KEY, mirror] });
      const { adapter } = await startLms(h);
      expect(adapter.snapshot.source).toBe('local');
      expect(adapter.snapshot.restoredFromLocal).toBe(true);
      expect(adapter.snapshot.scoreGated).toBe(true);
      expect(adapter.state.solved).toBe(7n);
      expect(h.logs).not.toContain('info: new attempt; mirror discarded');
    }
    // a fresh launch without any mirror logs nothing about discarding
    const clean = harness(fakeApi());
    await startLms(clean);
    expect(clean.logs).not.toContain('info: new attempt; mirror discarded');
  });

  it('A-M3 a zero-raw milestone writes suspend_data but no score', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    adapter.milestone(applyOutcome(adapter.state, 0, Outcome.SolvedReduced, 0));
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual([]);
    expect(setsOf(api, 'cmi.suspend_data')).toHaveLength(1);
    expect(lastCommitted(h)).toEqual({ raw: null, status: 'incomplete' });
  });

  it('A-M4 unchanged fields are not rewritten', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    const s = adapter.milestone(threeSolvedRaw33());
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual(['33']);
    expect(s.reportedRaw).toBe(33);
    const before = api.calls.length;
    adapter.milestone(s);
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual(['33']);
    expect(setsOf(api, 'cmi.core.lesson_status')).toEqual(['incomplete']);
    expect(setsOf(api, 'cmi.suspend_data')).toHaveLength(1);
    expect(api.calls.slice(before)).toEqual([['LMSCommit', '']]);
  });

  it('A-M5 a rejected score.raw is retried at the next milestone; badge degrades and recovers', async () => {
    const api = fakeApi();
    api.failNext.add('cmi.core.score.raw');
    const h = harness(api);
    const { adapter } = await startLms(h);
    const s = adapter.milestone(threeSolvedRaw33());
    expect(countCalls(api, 'LMSGetLastError')).toBe(1);
    expect(s.reportedRaw).toBe(0);
    expect(lastCommitted(h)).toEqual({ raw: null, status: 'incomplete' });
    expect(statusEvents(h)[statusEvents(h).length - 1]).toBe(DEGRADED_BADGE);
    expect(adapter.snapshot.errors).toBe(1);
    expect(h.logs).toContain('error: LMSSetValue(cmi.core.score.raw) returned false: 405 error 405 diag 405');
    const s2 = adapter.milestone(full(s, 3, 8)); // 16/24 = 67
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual(['33', '67']);
    expect(s2.reportedRaw).toBe(67);
    expect(statusEvents(h)[statusEvents(h).length - 1]).toBe(MODE_BADGE.lms);
    expect(lastCommitted(h)).toEqual({ raw: 67, status: 'incomplete' });
    // the suspend string records the raw the LMS holds
    expect(decode(api.data['cmi.suspend_data']!, 'stu-1').reportedRaw).toBe(67);
  });
});

// ---------------------------------------------------------------------------
// Throttling
// ---------------------------------------------------------------------------

describe('ScormAdapter throttling', () => {
  it('A-T1 one immediate commit, then one trailing commit per window', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    expect(countCalls(api, 'LMSCommit')).toBe(1);
    adapter.update(withCurrent(adapter.state, 'b'));
    expect(countCalls(api, 'LMSCommit')).toBe(2);
    h.advance(5_000);
    adapter.update(withCurrent(adapter.state, 'c'));
    h.advance(5_000);
    adapter.update(withCurrent(adapter.state, 'd'));
    expect(countCalls(api, 'LMSCommit')).toBe(2);
    expect(h.pendingTimers()).toBe(1);
    h.advance(30_000);
    expect(countCalls(api, 'LMSCommit')).toBe(3);
    expect(adapter.snapshot.lastCommitAt).toBe(30_000);
    expect(setsOf(api, 'cmi.core.lesson_location')).toEqual(['b', 'd']);
    expect(h.pendingTimers()).toBe(0);
  });

  it('A-T2 a milestone commits at once and cancels the trailing commit', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    adapter.update(withCurrent(adapter.state, 'b'));
    h.advance(5_000);
    adapter.update(withCurrent(adapter.state, 'c'));
    expect(h.pendingTimers()).toBe(1);
    adapter.milestone(full(adapter.state, 0, 2));
    expect(countCalls(api, 'LMSCommit')).toBe(3);
    expect(h.pendingTimers()).toBe(0);
    h.advance(60_000);
    expect(countCalls(api, 'LMSCommit')).toBe(3);
  });

  it('A-T3 hidden flushes immediately without finishing', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    adapter.update(withCurrent(adapter.state, 'b'));
    h.advance(5_000);
    adapter.update(withCurrent(adapter.state, 'c'));
    h.fire.hidden();
    expect(countCalls(api, 'LMSCommit')).toBe(3);
    expect(countCalls(api, 'LMSFinish')).toBe(0);
    expect(setsOf(api, 'cmi.core.exit')).toEqual([]);
    expect(h.pendingTimers()).toBe(0);
    expect(adapter.snapshot.finished).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session end
// ---------------------------------------------------------------------------

describe('ScormAdapter session end', () => {
  it('A-X1 Save & Exit when passed but not all solved', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    adapter.milestone(fourSolved());
    h.advance(754_560);
    const before = api.calls.length;
    await adapter.saveAndExit();
    const tail = api.calls.slice(before);
    expect(tail).toEqual([
      ['LMSSetValue', 'cmi.core.exit', 'suspend'],
      ['LMSSetValue', 'cmi.core.session_time', '00:12:34.56'],
      ['LMSCommit', ''],
      ['LMSFinish', ''],
    ]);
    expect(tail[1]![2]).toMatch(/^\d{2,4}:\d{2}:\d{2}\.\d{2}$/);
    expect(setsOf(api, 'cmi.core.lesson_status')).toEqual(['incomplete', 'passed']);
    expect(adapter.snapshot.finished).toBe(true);
    expect(lastCommitted(h)).toEqual({ raw: null, status: 'finished' });
    expect(h.close).not.toHaveBeenCalled();
    const after = api.calls.length;
    await adapter.saveAndExit();
    adapter.flush();
    adapter.commit();
    h.fire.pagehide();
    expect(api.calls).toHaveLength(after);
    expect(countCalls(api, 'LMSFinish')).toBe(1);
  });

  it('A-X2 all solved: exit is empty', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    adapter.milestone(allSolved());
    await adapter.saveAndExit();
    expect(setsOf(api, 'cmi.core.exit')).toEqual(['']);
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual(['100']);
    expect(setsOf(api, 'cmi.core.lesson_status')).toEqual(['incomplete', 'passed']);
  });

  it('A-X4 Save & Exit with everything attempted and raw 33 writes failed', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    adapter.milestone(allTried(threeSolvedRaw33()));
    await adapter.saveAndExit();
    const order = api.calls.filter((c) => c[0] === 'LMSSetValue' && (c[1] === 'cmi.core.lesson_status' || c[1] === 'cmi.core.exit'));
    expect(order.slice(-2)).toEqual([
      ['LMSSetValue', 'cmi.core.lesson_status', 'failed'],
      ['LMSSetValue', 'cmi.core.exit', 'suspend'],
    ]);
  });

  it('A-X5 pagehide never writes failed; later milestones only touch the mirror', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    adapter.milestone(allTried(threeSolvedRaw33()));
    h.fire.pagehide();
    expect(setsOf(api, 'cmi.core.lesson_status')).toEqual(['incomplete']);
    expect(setsOf(api, 'cmi.core.exit')).toEqual(['suspend']);
    expect(countCalls(api, 'LMSFinish')).toBe(1);
    const n = api.calls.length;
    const next = adapter.milestone(full(adapter.state, 3, 8));
    expect(api.calls).toHaveLength(n);
    expect(h.storage!.get(KEY)).toBe(encodeLocal(next));
    expect(next.solved).toBe(15n);
  });

  it('A-X6 a bfcache restore after pagehide shows the ended badge', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    h.fire.pageshow(false); // initial load: nothing
    expect(statusEvents(h)).not.toContain(ENDED_BADGE);
    h.fire.pagehide();
    h.fire.pageshow(true);
    expect(h.events[h.events.length - 1]).toEqual({
      name: 'lms:status',
      e: { mode: 'lms', studentId: 'stu-1', message: ENDED_BADGE },
    });
    expect(adapter.snapshot.finished).toBe(true);
  });

  it('A-X7 a passed status at launch is a floor', async () => {
    const api = fakeApi({ 'cmi.core.lesson_status': 'passed' });
    const h = harness(api);
    const { adapter } = await startLms(h);
    adapter.milestone(full(adapter.state, 0, 2));
    expect(setsOf(api, 'cmi.core.lesson_status')).toEqual([]);
    expect(setsOf(api, 'cmi.core.score.raw')).toEqual(['8']);
    await adapter.saveAndExit();
    expect(setsOf(api, 'cmi.core.lesson_status')).toEqual([]);

    const api2 = fakeApi({ 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '50' });
    const { adapter: a2 } = await startLms(harness(api2));
    a2.milestone(full(a2.state, 0, 2));
    expect(setsOf(api2, 'cmi.core.score.raw')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Errors and disposal
// ---------------------------------------------------------------------------

describe('ScormAdapter errors', () => {
  it('A-E1 a throwing LMSSetValue is contained', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    api.throwNext.add('cmi.suspend_data');
    expect(() => adapter.milestone(full(adapter.state, 0, 2))).not.toThrow();
    expect(adapter.snapshot.errors).toBe(1);
    expect(h.logs).toContain('error: LMSSetValue(cmi.suspend_data) threw');
    expect(statusEvents(h)[statusEvents(h).length - 1]).toBe(DEGRADED_BADGE);
    // the rejected string is retried at the next commit
    adapter.flush();
    expect(setsOf(api, 'cmi.suspend_data')).toHaveLength(2);
    expect(statusEvents(h)[statusEvents(h).length - 1]).toBe(MODE_BADGE.lms);
  });

  it('A-E1b a throwing LMSCommit / LMSGetValue is contained', async () => {
    const api = fakeApi();
    const throwingCommit = () => {
      throw new Error('commit boom');
    };
    api.LMSCommit = throwingCommit;
    api.LMSGetValue = () => {
      throw new Error('get boom');
    };
    const h = harness(api);
    const { mode, adapter } = await startLms(h);
    expect(mode).toBe('lms');
    expect(adapter.studentId).toBe('');
    expect(h.logs).toContain('error: LMSGetValue(cmi.core.student_id) threw');
    expect(h.logs).toContain('error: LMSCommit threw');
    expect(() => adapter.milestone(full(adapter.state, 0, 2))).not.toThrow();
  });

  it('A-E2 no storage: everything still works', async () => {
    const api = fakeApi();
    const h = harness(api, { storage: null });
    const { adapter, mode } = await startLms(h);
    expect(mode).toBe('lms');
    expect(() => adapter.milestone(full(adapter.state, 0, 2))).not.toThrow();
    expect(writeProgressMirror(null, 'stu-1', 'x')).toBe(false);
    expect(readProgressMirror(null, 'stu-1')).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error('no');
      },
      setItem: () => {
        throw new Error('no');
      },
      removeItem: () => {
        throw new Error('no');
      },
    };
    expect(writeProgressMirror(throwing, 'stu-1', 'x')).toBe(false);
    expect(readProgressMirror(throwing, 'stu-1')).toBeNull();
  });

  it('A-E3 dispose stops timers and lifecycle hooks', async () => {
    const api = fakeApi();
    const h = harness(api);
    const { adapter } = await startLms(h);
    adapter.update(withCurrent(adapter.state, 'b'));
    h.advance(5_000);
    adapter.update(withCurrent(adapter.state, 'c'));
    const n = api.calls.length;
    adapter.dispose();
    expect(h.pendingTimers()).toBe(0);
    h.advance(60_000);
    h.fire.hidden();
    h.fire.pagehide();
    expect(api.calls).toHaveLength(n);
  });

  it('A-E3b dispose during discovery stops polling', () => {
    const h = harness(null);
    const adapter = new ScormAdapter(h.deps);
    void adapter.start();
    h.advance(250);
    adapter.dispose();
    h.advance(5_000);
    expect(h.discoverCalls()).toBe(2);
    expect(h.pendingTimers()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §13.3 API discovery (src/lms/scorm-api.ts)
// ---------------------------------------------------------------------------

interface FakeWin extends WindowLike {
  API?: unknown;
  API_1484_11?: unknown;
  parent?: WindowLike | null;
  opener?: WindowLike | null;
  top?: WindowLike | null;
}

function win(props: Partial<FakeWin> = {}): FakeWin {
  const w: FakeWin = {};
  Object.assign(w, props);
  if (!('parent' in props)) w.parent = w;
  return w;
}

function crossOrigin(w: FakeWin, keys: (keyof FakeWin)[]): FakeWin {
  for (const k of keys) {
    Object.defineProperty(w, k, {
      get() {
        throw new Error('SecurityError');
      },
    });
  }
  return w;
}

describe('scorm-api discovery', () => {
  it('D-1 walks parents', () => {
    const api = fakeApi();
    const w2 = win({ API: api });
    const w1 = win({ parent: w2 });
    const w0 = win({ parent: w1 });
    expect(findApi(w0)).toBe(api);
    expect(discover(w0)).toBe(api);
  });

  it('D-2 a cross-origin intermediate frame does not end the walk', () => {
    const api = fakeApi();
    const w2 = win({ API: api });
    const w1 = crossOrigin(win({ parent: w2 }), ['API']);
    const w0 = win({ parent: w1 });
    expect(findApi(w0)).toBe(api);
  });

  it('D-8 an unreadable parent ends the chain; the opener chain is tried next', () => {
    const api = fakeApi();
    const w1 = crossOrigin(win({}), ['parent', 'API']);
    const o = win({ API: api });
    const w0 = win({ parent: w1, opener: o });
    expect(findApi(w0)).toBeNull();
    expect(discover(w0)).toBe(api);
  });

  it('D-3 top.opener', () => {
    const api = fakeApi();
    const o = win({ API: api });
    const top = win({ opener: o });
    const w0 = win({ parent: top, top });
    expect(discover(w0)).toBe(api);
    const w1 = win({ parent: top, top: crossOrigin(win({}), ['opener']) });
    expect(discover(w1)).toBeNull();
  });

  it('D-4 depth cap', () => {
    const api = fakeApi();
    const chain = (depth: number): FakeWin => {
      let w = win({ API: api });
      for (let i = 0; i < depth; i++) w = win({ parent: w });
      return w;
    };
    expect(findApi(chain(11))).toBeNull();
    expect(findApi(chain(9))).toBe(api);
    expect(findApi(chain(10))).toBeNull();
    expect(findApi(chain(11), 12)).toBe(api);
  });

  it('D-5 a partial API object is not an API', () => {
    const w = win({ API: { LMSInitialize: 1 } });
    expect(isScormApi(w.API)).toBe(false);
    expect(isScormApi(null)).toBe(false);
    expect(isScormApi('x')).toBe(false);
    expect(isScormApi(fakeApi())).toBe(true);
    expect(findApi(w)).toBeNull();
  });

  it('D-6 parent === self with no API', () => {
    const w = win({});
    expect(findApi(w)).toBeNull();
    expect(discover(w)).toBeNull();
    expect(discover(win({ parent: null, opener: null, top: null }))).toBeNull();
  });

  it('D-7 SCORM 2004 is not used', () => {
    const w = win({ API_1484_11: fakeApi() });
    expect(findApi(w)).toBeNull();
    expect(discover(w)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// browserDeps with a hand-made window/document
// ---------------------------------------------------------------------------

describe('browserDeps', () => {
  const g = globalThis as unknown as Record<string, unknown>;

  afterEach(() => {
    delete g.window;
    delete g.document;
  });

  it('wires discovery, storage, lifecycle and timers to the DOM', async () => {
    const api = fakeApi();
    const store = new Map<string, string>();
    const winListeners = new Map<string, ((e: unknown) => void)[]>();
    const docListeners = new Map<string, ((e: unknown) => void)[]>();
    const fakeWindow = {
      API: api,
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        winListeners.set(type, [...(winListeners.get(type) ?? []), fn]);
      },
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout),
    };
    (fakeWindow as { parent?: unknown }).parent = fakeWindow;
    const fakeDocument = {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        docListeners.set(type, [...(docListeners.get(type) ?? []), fn]);
      },
    };
    g.window = fakeWindow;
    g.document = fakeDocument;

    const emitter = createEmitter();
    const deps = browserDeps(roster6, emitter);
    expect(deps.discover()).toBe(api);
    expect(deps.storage).not.toBeNull();
    expect(store.size).toBe(0); // the probe key was removed again
    expect(safeLocalStorage()).not.toBeNull();

    const hidden = vi.fn();
    const pagehide = vi.fn();
    const pageshow = vi.fn();
    deps.lifecycle.onHidden(hidden);
    deps.lifecycle.onPageHide(pagehide);
    deps.lifecycle.onPageShow(pageshow);
    docListeners.get('visibilitychange')!.forEach((f) => f({}));
    expect(hidden).not.toHaveBeenCalled();
    fakeDocument.visibilityState = 'hidden';
    docListeners.get('visibilitychange')!.forEach((f) => f({}));
    expect(hidden).toHaveBeenCalledTimes(1);
    winListeners.get('pagehide')!.forEach((f) => f({ persisted: true }));
    expect(pagehide).toHaveBeenCalledWith(true);
    winListeners.get('pageshow')!.forEach((f) => f({}));
    expect(pageshow).toHaveBeenCalledWith(false);

    expect(typeof deps.timers.now()).toBe('number');
    await new Promise<void>((resolve) => {
      const handle = deps.timers.setTimeout(() => resolve(), 1);
      expect(handle).toBeDefined();
    });
    const never = deps.timers.setTimeout(() => {
      throw new Error('should have been cleared');
    }, 1);
    deps.timers.clearTimeout(never);

    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deps.log('warn', 'hello', 42);
    expect(log).toHaveBeenCalledWith('[lms] hello', 42);
    log.mockRestore();

    // the whole adapter runs on these deps
    const adapter = new ScormAdapter(deps);
    expect(await adapter.start()).toBe('lms');
    expect(store.get(KEY)).toBe(encodeLocal(adapter.state));
  });

  it('safeLocalStorage is null when storage throws or is missing', () => {
    g.window = {
      get localStorage() {
        throw new Error('blocked');
      },
    };
    expect(safeLocalStorage()).toBeNull();
    g.window = {};
    expect(safeLocalStorage()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §13.4 packaging (scripts/package-scorm.mjs, scripts/check-relative-paths.mjs, scorm/)
// ---------------------------------------------------------------------------

interface ScormPkg {
  buildManifest(o: { template: string; files: string[]; mastery: unknown; version: unknown }): string;
  listDistFiles(dir: string): string[];
  manifestHrefs(manifest: string): string[];
  xmlEscape(s: string): string;
  XSD_FILES: string[];
}
interface PathCheck {
  checkRelativePaths(dir: string): { ok: boolean; problems: string[] };
  listFiles(dir: string): string[];
  RESTRICTED_EXTENSIONS: string[];
}
const pkg = scormPkg as unknown as ScormPkg;
const paths = pathCheck as unknown as PathCheck;

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const TEMPLATE = readFileSync(join(REPO, 'scorm', 'imsmanifest.template.xml'), 'utf8');
const XSD_NAMESPACES: Record<string, string> = {
  'imscp_rootv1p1p2.xsd': 'http://www.imsproject.org/xsd/imscp_rootv1p1p2',
  'adlcp_rootv1p2.xsd': 'http://www.adlnet.org/xsd/adlcp_rootv1p2',
  'imsmd_rootv1p2p1.xsd': 'http://www.imsglobal.org/xsd/imsmd_rootv1p2p1',
  'ims_xml.xsd': 'http://www.w3.org/XML/1998/namespace',
};

/** Hand-written tag-balance check (no XML dependency): returns the element stack errors. */
function checkTagBalance(xml: string): { root: string | null; counts: Record<string, number>; balanced: boolean } {
  const body = xml.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack: string[] = [];
  const counts: Record<string, number> = {};
  let root: string | null = null;
  let balanced = true;
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^<>]*?)?)(\/?)>/g)) {
    const closing = m[1] === '/';
    const name = m[2]!;
    const selfClosing = m[4] === '/';
    if (closing) {
      if (stack.pop() !== name) balanced = false;
      continue;
    }
    counts[name] = (counts[name] ?? 0) + 1;
    if (root === null) root = name;
    if (!selfClosing) stack.push(name);
  }
  if (stack.length > 0) balanced = false;
  return { root, counts, balanced };
}

describe('packaging', () => {
  it('K-1 buildManifest fills the placeholders with index.html first', () => {
    const m = pkg.buildManifest({ template: TEMPLATE, files: ['assets/a.js', 'index.html'], mastery: 70, version: '1.0.0' });
    expect(m).toContain('version="1.0.0"');
    expect(m).toContain('<adlcp:masteryscore>70</adlcp:masteryscore>');
    expect(m.indexOf('<file href="index.html"/>')).toBeGreaterThan(0);
    expect(m.indexOf('<file href="index.html"/>')).toBeLessThan(m.indexOf('<file href="assets/a.js"/>'));
    expect(m).not.toContain('{{');
    expect(pkg.manifestHrefs(m).sort()).toEqual(['assets/a.js', 'index.html']);
    expect(checkTagBalance(m).balanced).toBe(true);
    expect(pkg.buildManifest({ template: TEMPLATE, files: ['index.html'], mastery: '85', version: '2.3.4' })).toContain(
      '<adlcp:masteryscore>85</adlcp:masteryscore>',
    );
  });

  it('K-2 buildManifest rejects bad inputs', () => {
    const ok = { template: TEMPLATE, files: ['index.html'], mastery: 70, version: '1.0.0' };
    expect(() => pkg.buildManifest({ ...ok, mastery: 101 })).toThrow();
    expect(() => pkg.buildManifest({ ...ok, mastery: 'x' })).toThrow();
    expect(() => pkg.buildManifest({ ...ok, mastery: 70.5 })).toThrow();
    expect(() => pkg.buildManifest({ ...ok, version: '1' })).toThrow();
    expect(() => pkg.buildManifest({ ...ok, files: ['assets/a.js'] })).toThrow();
    expect(() => pkg.buildManifest({ ...ok, template: 'x {{NOPE}}' })).toThrow();
  });

  it('K-3 file names are XML-escaped', () => {
    const m = pkg.buildManifest({ template: TEMPLATE, files: ['index.html', 'a&b "c".js'], mastery: 70, version: '1.0.0' });
    expect(m).toContain('<file href="a&amp;b &quot;c&quot;.js"/>');
    expect(pkg.manifestHrefs(m)).toContain('a&b "c".js');
    expect(pkg.xmlEscape('<a>')).toBe('&lt;a&gt;');
  });

  it('K-4 the four XSD control files are present with their namespaces', () => {
    expect(pkg.XSD_FILES.sort()).toEqual(Object.keys(XSD_NAMESPACES).sort());
    for (const [name, ns] of Object.entries(XSD_NAMESPACES)) {
      const p = join(REPO, 'scorm', 'xsd', name);
      expect(existsSync(p)).toBe(true);
      const text = readFileSync(p, 'utf8');
      expect(text.length).toBeGreaterThan(0);
      expect(/^(<\?xml|<xs:schema|<xsd:schema)/.test(text.trimStart())).toBe(true);
      expect(text).toContain(`targetNamespace="${ns}"`);
    }
  });

  it('K-5 checkRelativePaths flags root-absolute URLs and restricted extensions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orgocraft-dist-'));
    try {
      mkdirSync(join(dir, 'assets'));
      writeFileSync(join(dir, 'index.html'), '<script src="/assets/x.js"></script>\n<link href="./assets/x.css">');
      writeFileSync(join(dir, 'run.sh'), 'echo');
      writeFileSync(join(dir, 'assets', 'x.js'), 'fetch("./a.json")');
      const bad = paths.checkRelativePaths(dir);
      expect(bad.ok).toBe(false);
      expect(bad.problems.some((p) => p.includes('restricted extension: run.sh'))).toBe(true);
      expect(bad.problems.some((p) => p.startsWith('index.html:1:') && p.includes('src="/'))).toBe(true);
      expect(bad.problems.some((p) => p.startsWith('index.html:1:') && p.includes('"/assets/'))).toBe(true);
      rmSync(join(dir, 'run.sh'));
      writeFileSync(join(dir, 'index.html'), '<script src="./assets/x.js"></script>\n<link href="./assets/x.css">');
      expect(paths.checkRelativePaths(dir)).toEqual({ ok: true, problems: [] });
      expect(paths.listFiles(dir)).toEqual(['index.html', 'assets/x.js']);
      writeFileSync(join(dir, 'assets', 'x.js'), 'import("/chunk.js"); url(/img.png); new URL("/x")\n// line 2\nfetch("/api")');
      const js = paths.checkRelativePaths(dir);
      expect(js.ok).toBe(false);
      expect(js.problems.some((p) => p.startsWith('assets/x.js:3:'))).toBe(true);
      expect(js.problems).toHaveLength(4);
      writeFileSync(join(dir, 'assets', 'x.js'), 'fetch("//cdn.example/x"); url(data:image/png;base64,AAAA)');
      expect(paths.checkRelativePaths(dir).ok).toBe(true);
      rmSync(join(dir, 'index.html'));
      expect(paths.checkRelativePaths(dir).problems).toEqual(['dist/index.html missing - run npm run build']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('K-6 the manifest template is balanced, single-SCO XML', () => {
    const t = checkTagBalance(TEMPLATE);
    expect(t.balanced).toBe(true);
    expect(t.root).toBe('manifest');
    expect(t.counts.item).toBe(1);
    expect(t.counts.resource).toBe(1);
    expect(t.counts.organization).toBe(1);
    expect(TEMPLATE).toContain('adlcp:scormtype="sco"');
    expect(TEMPLATE).toContain('href="index.html"');
    expect(TEMPLATE).toContain('<schemaversion>1.2</schemaversion>');
    for (const ph of ['{{VERSION}}', '{{MASTERY}}', '{{FILES}}']) expect(TEMPLATE).toContain(ph);
    expect(paths.RESTRICTED_EXTENSIONS).toContain('.sh');
  });
});
