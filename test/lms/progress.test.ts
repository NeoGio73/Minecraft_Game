/**
 * test/lms/progress.test.ts — 08-deployment §13.1 (P-* cases).
 * Pure: exercises src/lms/Progress.ts only.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RosterInfo } from '@/lms/types';
import { Outcome, SUSPEND_DATA_BUDGET } from '@/lms/types';
import {
  CHALLENGE_ID_RE,
  ProgressDecodeError,
  applyExhausted,
  applyOutcome,
  asV2,
  compareRank,
  decode,
  decodeLocal,
  emptyState,
  encode,
  encodeLocal,
  exhaustedOf,
  exitValue,
  formatTimespan,
  isNewAttempt,
  lmsWrite,
  popcount,
  progressRank,
  resume,
  sanitizeStudentId,
  summarize,
  withCurrent,
  withIsomers,
  type ProgressStateV2,
} from '@/lms/Progress';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const roster6: RosterInfo = {
  ids: ['a', 'b', 'c', 'd', 'e', 'f'],
  points: [2, 4, 4, 8, 2, 4],
  enabled: [true, true, true, true, true, true],
  passMark: 70,
};
const roster6dis: RosterInfo = { ...roster6, enabled: [true, true, true, false, true, true] };

const CHALLENGES_JSON = fileURLToPath(new URL('../../src/content/challenges.json', import.meta.url));
const hasRealRoster = existsSync(CHALLENGES_JSON);

interface RawChallenge {
  id: string;
  points: number;
}

/** RosterInfo built straight from the JSON (WP-10 imports nothing from src/content besides types). */
function realRoster(): RosterInfo {
  const raw = JSON.parse(readFileSync(CHALLENGES_JSON, 'utf8')) as { challenges?: RawChallenge[] } | RawChallenge[];
  const list = Array.isArray(raw) ? raw : (raw.challenges ?? []);
  return {
    ids: list.map((c) => c.id),
    points: list.map((c) => c.points),
    enabled: list.map(() => true),
    passMark: 70,
  };
}

const full = (s: ProgressStateV2, i: number, p: number): ProgressStateV2 => applyOutcome(s, i, Outcome.SolvedFull, p);
const half = (s: ProgressStateV2, i: number, p: number): ProgressStateV2 =>
  applyOutcome(s, i, Outcome.SolvedReduced, Math.floor(p / 2));
const tried = (s: ProgressStateV2, i: number): ProgressStateV2 => applyOutcome(s, i, Outcome.Attempted, 0);

/** The §3.4 example row 2: a,b,d full, c reduced, e attempted, raw 67 reported, on ch1-select-sp2-carbons. */
function exampleState(): ProgressStateV2 {
  let s = emptyState('s');
  s = full(s, 0, 2);
  s = full(s, 1, 4);
  s = half(s, 2, 4);
  s = full(s, 3, 8);
  s = tried(s, 4);
  s = { ...s, reportedRaw: 67 };
  return withCurrent(s, 'ch1-select-sp2-carbons');
}

/** Deterministic PRNG (mulberry32) so the random cases are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMask(rand: () => number, bits: number): bigint {
  let m = 0n;
  for (let i = 0; i < bits; i++) if (rand() < 0.5) m |= 1n << BigInt(i);
  return m;
}

function stripIsomers(s: ProgressStateV2): ProgressStateV2 {
  return { ...s, isomersDone: {} };
}

function checkInvariant(s: ProgressStateV2): void {
  expect(s.reduced & ~s.solved).toBe(0n);
  expect(s.solved & ~s.attempted).toBe(0n);
  expect(s.exhausted & ~s.attempted).toBe(0n);
  expect(s.exhausted & s.solved & ~s.reduced).toBe(0n);
}

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

describe('suspend_data codec', () => {
  it('P-C1 encodes the empty state', () => {
    expect(encode(emptyState('s'))).toBe('v2|0|0|0|0|0|0|');
  });

  it('P-C2 encodes and decodes the §3.4 example rows', () => {
    const s = exampleState();
    expect(encode(s)).toBe('v2|1f|f|4|0|16|67|ch1-select-sp2-carbons');
    expect(decode(encode(s), 's')).toEqual(stripIsomers(s));
    const ex = applyExhausted(s, 4);
    expect(encode(ex)).toBe('v2|1f|f|4|10|16|67|ch1-select-sp2-carbons');
    expect(decode(encode(ex), 's')).toEqual(stripIsomers(ex));
  });

  it('P-C3 round-trips 200 random invariant-respecting states', () => {
    const rand = prng(42);
    const ids = hasRealRoster ? realRoster().ids : ['a', 'ch1-select-sp2-carbons', 'ch3-isomers-c4h10', ''];
    for (let n = 0; n < 200; n++) {
      const attempted = randomMask(rand, 100);
      const solved = attempted & randomMask(rand, 100);
      const reduced = solved & randomMask(rand, 100);
      const exhausted = attempted & randomMask(rand, 100) & ~(solved & ~reduced);
      const s: ProgressStateV2 = {
        version: 2,
        studentId: 's',
        attempted,
        solved,
        reduced,
        exhausted,
        earned: Math.floor(rand() * 1000),
        reportedRaw: Math.floor(rand() * 101),
        currentChallengeId: ids[Math.floor(rand() * ids.length)] ?? '',
        isomersDone: { x: ['0123456789abcdef'] },
      };
      checkInvariant(s);
      expect(decode(encode(s), 's')).toEqual(stripIsomers(s));
    }
  });

  it('P-C4 all-solved rosters stay far below the budget', () => {
    const n = 80;
    const all = (1n << BigInt(n)) - 1n;
    const s: ProgressStateV2 = {
      ...emptyState('s'),
      attempted: all,
      solved: all,
      earned: 320,
      reportedRaw: 100,
      currentChallengeId: 'a'.repeat(40),
    };
    expect(encode(s).length).toBe(97);
    expect(encode(s).length).toBeLessThan(120);
    if (hasRealRoster) {
      const r = realRoster();
      const bits = (1n << BigInt(r.ids.length)) - 1n;
      const longest = r.ids.reduce((a, b) => (b.length > a.length ? b : a), '');
      const real: ProgressStateV2 = {
        ...emptyState('s'),
        attempted: bits,
        solved: bits,
        earned: r.points.reduce((a, b) => a + b, 0),
        reportedRaw: 100,
        currentChallengeId: longest,
      };
      expect(encode(real).length).toBeLessThan(SUSPEND_DATA_BUDGET);
    }
  });

  it('P-C5 rejects bad versions, field counts, masks, integers; clamps reportedRaw', () => {
    const field = (s: string): number => {
      try {
        decode(s, 's');
      } catch (e) {
        expect(e).toBeInstanceOf(ProgressDecodeError);
        return (e as ProgressDecodeError).field;
      }
      throw new Error(`expected ${s} to throw`);
    };
    expect(field('v1|f|f|0|0|0|0|x')).toBe(0);
    expect(field('v2|f|f')).toBe(3);
    expect(field('v2|0g|0|0|0|0|0|')).toBe(1);
    expect(field('v2|0|0|0|0|-1|0|')).toBe(5);
    expect(field('v2|1f|f|4|16|67|ch1-select-sp2-carbons')).toBe(7); // old 7-field layout
    expect(decode('v2|0|0|0|0|0|101|', 's').reportedRaw).toBe(100);
  });

  it('P-C6 repairs solved ⊄ attempted', () => {
    const s = decode('v2|0|3|1|0|0|0|', 's');
    expect(s.attempted).toBe(3n);
    expect(s.solved).toBe(3n);
    expect(s.reduced).toBe(1n);
    expect(s.exhausted).toBe(0n);
    checkInvariant(s);
  });

  it('P-C6b repairs exhausted ⊄ attempted and (exhausted ∩ solved) ⊄ reduced', () => {
    const s = decode('v2|0|1|0|3|0|0|', 's');
    expect(s.attempted).toBe(3n);
    expect(s.solved).toBe(1n);
    expect(s.reduced).toBe(1n);
    expect(s.exhausted).toBe(3n);
    checkInvariant(s);
  });

  it('P-C7 drops an invalid current id without throwing', () => {
    expect(decode('v2|0|0|0|0|0|0|bad id!', 's').currentChallengeId).toBe('');
  });

  it('P-C8 local mirror codec carries isomers and the student id', () => {
    const s = withIsomers(exampleState(), 'ch3-isomers-c4h10', ['fedcba9876543210', '0123456789abcdef', 'fedcba9876543210']);
    const local = encodeLocal(s);
    expect(local.endsWith('|ch3-isomers-c4h10=0123456789abcdef,fedcba9876543210|s')).toBe(true);
    expect(local.split('|')).toHaveLength(10);
    expect(decodeLocal(local, 's')).toEqual(s);
    expect(() => decodeLocal(local, 'other')).toThrow(ProgressDecodeError);
    try {
      decodeLocal(local, 'other');
    } catch (e) {
      expect((e as ProgressDecodeError).field).toBe(9);
    }
    const bad = `${encode(s)}|ch3-isomers-c4h10=xyz|s`;
    expect(decodeLocal(bad, 's').isomersDone).toEqual({});
    const mixed = `${encode(s)}|ch3-isomers-c4h10=xyz,0123456789abcdef;bad id=0123456789abcdef|s`;
    expect(decodeLocal(mixed, 's').isomersDone).toEqual({ 'ch3-isomers-c4h10': ['0123456789abcdef'] });
    expect(() => decodeLocal('v2|0|0|0|0|0|0|', 's')).toThrow(ProgressDecodeError);
  });

  it.skipIf(!hasRealRoster)('P-C9 every roster id matches CHALLENGE_ID_RE', () => {
    for (const id of realRoster().ids) {
      expect(id).toMatch(CHALLENGE_ID_RE);
      expect(id.includes('|')).toBe(false);
    }
  });

  it('withCurrent replaces an invalid id by the empty string', () => {
    expect(withCurrent(emptyState('s'), 'not valid').currentChallengeId).toBe('');
    expect(withCurrent(emptyState('s'), 'ch1.x_y-z').currentChallengeId).toBe('ch1.x_y-z');
  });

  it('withIsomers sorts, de-duplicates and removes empty entries', () => {
    const s = withIsomers(emptyState('s'), 'x', ['b', 'a', 'b']);
    expect(s.isomersDone).toEqual({ x: ['a', 'b'] });
    expect(withIsomers(s, 'x', []).isomersDone).toEqual({});
  });

  it('asV2 / exhaustedOf accept a state written against the frozen contract', () => {
    const contractOnly = { ...emptyState('s') } as Record<string, unknown>;
    delete contractOnly.exhausted;
    const s = contractOnly as unknown as ProgressStateV2;
    expect(exhaustedOf(s)).toBe(0n);
    expect(asV2(s).exhausted).toBe(0n);
    expect(encode(s)).toBe('v2|0|0|0|0|0|0|');
    expect(applyExhausted(s, 1).exhausted).toBe(2n);
  });
});

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

describe('applyOutcome / applyExhausted', () => {
  it('P-A1 Attempted is idempotent', () => {
    const empty = emptyState('s');
    const a = applyOutcome(empty, 2, Outcome.Attempted, 0);
    expect(a.attempted).toBe(4n);
    expect(a.solved).toBe(0n);
    expect(applyOutcome(a, 2, Outcome.Attempted, 0)).toBe(a);
    expect(applyOutcome(a, 2, Outcome.NotAttempted, 0)).toBe(a);
  });

  it('P-A2 never downgrades; upgrades half to full once', () => {
    const empty = emptyState('s');
    const a1 = applyOutcome(empty, 1, Outcome.SolvedFull, 4);
    expect(a1.solved).toBe(2n);
    expect(a1.earned).toBe(4);
    expect(applyOutcome(a1, 1, Outcome.SolvedReduced, 2)).toBe(a1);
    expect(applyOutcome(a1, 1, Outcome.SolvedFull, 4)).toBe(a1);

    const b1 = applyOutcome(empty, 1, Outcome.SolvedReduced, 2);
    expect(b1.solved).toBe(2n);
    expect(b1.reduced).toBe(2n);
    expect(b1.earned).toBe(2);
    const b2 = applyOutcome(b1, 1, Outcome.SolvedFull, 4);
    expect(b2.solved).toBe(2n);
    expect(b2.reduced).toBe(0n);
    expect(b2.earned).toBe(4);
    expect(applyOutcome(b2, 1, Outcome.SolvedFull, 4)).toBe(b2);
  });

  it('P-A3 a zero-point reduced solve is exhausted and never upgraded', () => {
    const s = applyOutcome(emptyState('s'), 0, Outcome.SolvedReduced, 0);
    expect(s.solved).toBe(1n);
    expect(s.reduced).toBe(1n);
    expect(s.exhausted).toBe(1n);
    expect(s.attempted).toBe(1n);
    expect(s.earned).toBe(0);
    expect(applyOutcome(s, 0, Outcome.SolvedFull, 2)).toBe(s);
  });

  it('P-A4 invariants, earned agreement and codec round trip over 500 random sequences', () => {
    const rand = prng(7);
    for (let n = 0; n < 500; n++) {
      let s = emptyState('s');
      const steps = 1 + Math.floor(rand() * 12);
      for (let k = 0; k < steps; k++) {
        const i = Math.floor(rand() * roster6.ids.length);
        const p = roster6.points[i] ?? 0;
        switch (Math.floor(rand() * 6)) {
          case 0:
            s = full(s, i, p);
            break;
          case 1:
            s = half(s, i, p);
            break;
          case 2:
            s = applyOutcome(s, i, Outcome.SolvedReduced, 0);
            break;
          case 3:
            s = tried(s, i);
            break;
          case 4:
            s = applyExhausted(s, i);
            break;
          default:
            s = full(half(s, i, p), i, p);
        }
        checkInvariant(s);
        expect(summarize(s, roster6).earned).toBe(s.earned);
        expect(decode(encode(s), 's')).toEqual(stripIsomers(s));
        expect(lmsWrite(s, roster6, true).exit).not.toBe('logout');
      }
    }
  });

  it('P-A5 an exhausted solve counts as solved but earns nothing', () => {
    const s = applyOutcome(emptyState('s'), 0, Outcome.SolvedReduced, 0);
    const sum = summarize(s, roster6);
    expect(sum.earned).toBe(0);
    expect(sum.solvedCount).toBe(1);
    expect(sum.raw).toBe(0);
    expect(sum.allSolved).toBe(false);
  });

  it('P-A6 applyExhausted is idempotent and survives the codec', () => {
    const a = applyExhausted(emptyState('s'), 4);
    expect(a.attempted).toBe(16n);
    expect(a.exhausted).toBe(16n);
    expect(a.solved).toBe(0n);
    expect(applyExhausted(a, 4)).toBe(a);
    expect(decode(encode(a), 's').exhausted).toBe(16n);
    // The lock against solving an exhausted challenge lives in State.attemptOf (§3.8); applyOutcome itself still
    // marks it solved, but at zero credit (the answer was revealed), so summarize and state.earned stay in step.
    const b = applyOutcome(a, 4, Outcome.SolvedFull, 2);
    expect(b.solved).toBe(16n);
    expect(b.reduced).toBe(16n);
    expect(b.exhausted).toBe(16n);
    expect(b.earned).toBe(0);
    expect(summarize(b, roster6).earned).toBe(0);
    expect(applyExhausted(b, 4)).toBe(b);
    expect(applyOutcome(b, 4, Outcome.SolvedFull, 2)).toBe(b);
  });

  it('rejects a bad index', () => {
    expect(() => applyOutcome(emptyState('s'), -1, Outcome.Attempted, 0)).toThrow(RangeError);
    expect(() => applyExhausted(emptyState('s'), 1.5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

describe('summarize', () => {
  const abc = (): ProgressStateV2 => half(full(full(emptyState('s'), 0, 2), 1, 4), 2, 4);

  it('P-S1 totals come from the roster', () => {
    expect(summarize(abc(), roster6)).toEqual({
      earned: 8,
      total: 24,
      raw: 33,
      solvedCount: 3,
      enabledCount: 6,
      allAttempted: false,
      allSolved: false,
    });
  });

  it('P-S2 disabling an unsolved challenge raises raw', () => {
    const s = summarize(abc(), roster6dis);
    expect(s.total).toBe(16);
    expect(s.raw).toBe(50);
  });

  it('P-S3 a disabled solved challenge drops out of earned (state.earned diverges)', () => {
    const s = full(abc(), 3, 8);
    expect(s.earned).toBe(16);
    expect(summarize(s, roster6dis).earned).toBe(8);
    expect(summarize(s, roster6).earned).toBe(16);
  });

  it('P-S4 allAttempted / allSolved / empty roster', () => {
    let s = emptyState('s');
    for (let i = 0; i < 6; i++) s = tried(s, i);
    const sum = summarize(s, roster6);
    expect(sum.allAttempted).toBe(true);
    expect(sum.allSolved).toBe(false);
    expect(sum.raw).toBe(0);
    const none = summarize(s, { ...roster6, enabled: roster6.enabled.map(() => false) });
    expect(none.allSolved).toBe(false);
    expect(none.allAttempted).toBe(false);
    expect(none.raw).toBe(0);
    expect(none.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lmsWrite / exitValue
// ---------------------------------------------------------------------------

describe('lmsWrite', () => {
  const raw33 = (): ProgressStateV2 => half(full(full(emptyState('s'), 0, 2), 1, 4), 2, 4);
  const raw75 = (): ProgressStateV2 => full(full(full(full(emptyState('s'), 0, 2), 1, 4), 2, 4), 3, 8);
  const allTried = (s: ProgressStateV2): ProgressStateV2 => {
    for (let i = 0; i < 6; i++) s = tried(s, i);
    return s;
  };
  const allSolved = (): ProgressStateV2 => {
    let s = emptyState('s');
    roster6.points.forEach((p, i) => {
      s = full(s, i, p);
    });
    return s;
  };

  it('P-W1 empty state', () => {
    expect(lmsWrite(emptyState('s'), roster6, false)).toEqual({
      scoreRaw: null,
      lessonStatus: 'incomplete',
      lessonLocation: '',
      suspendData: 'v2|0|0|0|0|0|0|',
    });
  });

  it('P-W2 score.raw only above reportedRaw', () => {
    expect(lmsWrite({ ...raw33(), reportedRaw: 33 }, roster6, false).scoreRaw).toBeNull();
    expect(lmsWrite({ ...raw33(), reportedRaw: 30 }, roster6, false).scoreRaw).toBe(33);
  });

  it('P-W3 passed at the pass mark; once passed always passed', () => {
    expect(lmsWrite(raw75(), roster6, false).lessonStatus).toBe('passed');
    const bigger: RosterInfo = { ...roster6, points: [2, 4, 4, 8, 6, 6] }; // 18/30 = 60
    const s = { ...raw75(), reportedRaw: 75 };
    expect(summarize(s, bigger).raw).toBe(60);
    expect(lmsWrite(s, bigger, false).lessonStatus).toBe('passed');
    expect(lmsWrite(s, bigger, false).scoreRaw).toBeNull();
  });

  it('P-W4 failed only at exit with everything attempted', () => {
    const s = allTried(raw33());
    const w = lmsWrite(s, roster6, true);
    expect(w.lessonStatus).toBe('failed');
    expect(w.exit).toBe('suspend');
    expect(lmsWrite(s, roster6, false).lessonStatus).toBe('incomplete');
  });

  it('P-W5 exit is empty only when all solved; never logout', () => {
    expect(lmsWrite(allSolved(), roster6, true).exit).toBe('');
    expect(lmsWrite(allSolved(), roster6, true).lessonStatus).toBe('passed');
    expect(lmsWrite(raw75(), roster6, true).exit).toBe('suspend');
    expect(exitValue(summarize(allSolved(), roster6))).toBe('');
    expect(exitValue(summarize(raw75(), roster6))).toBe('suspend');
  });

  it('P-W6 lesson_location is capped at 255 chars', () => {
    const s = withCurrent(emptyState('s'), 'a'.repeat(300));
    expect(lmsWrite(s, roster6, false).lessonLocation).toHaveLength(255);
  });

  it('P-W7 build-rule failures count as attempts', () => {
    let s = full(emptyState('s'), 0, 2);
    for (let i = 1; i < 6; i++) s = tried(s, i);
    expect(lmsWrite(s, roster6, true).lessonStatus).toBe('failed');
    let noF = full(emptyState('s'), 0, 2);
    for (let i = 1; i < 5; i++) noF = tried(noF, i);
    expect(lmsWrite(noF, roster6, true).lessonStatus).toBe('incomplete');
    expect(lmsWrite(applyExhausted(noF, 5), roster6, true).lessonStatus).toBe('failed');
  });

  it('P-W8 the score gate blanks raw, passed and failed', () => {
    const s = raw75();
    const gated = lmsWrite(s, roster6, false, true);
    expect(gated.scoreRaw).toBeNull();
    expect(gated.lessonStatus).toBe('incomplete');
    const exitGated = lmsWrite(allTried(s), roster6, true, true);
    expect(exitGated.scoreRaw).toBeNull();
    expect(exitGated.lessonStatus).toBe('incomplete');
    expect(exitGated.exit).toBe('suspend');
    expect(exitGated.suspendData).toBe(encode(allTried(s)));
    const reported = lmsWrite({ ...s, reportedRaw: 75 }, roster6, false, true);
    expect(reported.scoreRaw).toBeNull();
    expect(reported.lessonStatus).toBe('passed');
    const open = lmsWrite(s, roster6, false, false);
    expect(open.scoreRaw).toBe(75);
    expect(open.lessonStatus).toBe('passed');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('helpers', () => {
  it('P-T1 formatTimespan', () => {
    expect(formatTimespan(0)).toBe('00:00:00.00');
    expect(formatTimespan(754_560)).toBe('00:12:34.56');
    expect(formatTimespan(3_600_000 * 10_000)).toBe('9999:59:59.99');
    expect(formatTimespan(3_600_000 * 100)).toBe('100:00:00.00');
    expect(formatTimespan(-5)).toBe('00:00:00.00');
    expect(formatTimespan(Number.NaN)).toBe('00:00:00.00');
  });

  it('P-T2 sanitizeStudentId', () => {
    expect(sanitizeStudentId('  John Doe/42@x.edu ')).toBe('John_Doe_42@x.edu');
    expect(sanitizeStudentId('')).toBe('');
    expect(sanitizeStudentId('a'.repeat(70))).toHaveLength(64);
    expect(sanitizeStudentId('a|b;c')).toBe('a_b_c');
  });

  it('popcount', () => {
    expect(popcount(0n)).toBe(0);
    expect(popcount(0x1fn)).toBe(5);
    expect(popcount((1n << 100n) - 1n)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// resume / isNewAttempt
// ---------------------------------------------------------------------------

describe('resume', () => {
  const two = (): ProgressStateV2 => full(full(emptyState('s'), 0, 2), 1, 4);
  const three = (): ProgressStateV2 => full(two(), 2, 4);

  it('P-R1 fresh when nothing is stored', () => {
    expect(resume('', null, 's', roster6)).toEqual({ state: emptyState('s'), source: 'fresh', restoredFromLocal: false });
  });

  it('P-R2 the LMS string alone', () => {
    const L = encode(two());
    const d = resume(L, null, 's', roster6);
    expect(d.source).toBe('lms');
    expect(d.restoredFromLocal).toBe(false);
    expect(d.state).toEqual(decode(L, 's'));
  });

  it('P-R3 the mirror alone: restored, raw reset to what the LMS holds', () => {
    const m = withIsomers({ ...three(), reportedRaw: 40 }, 'x', ['0123456789abcdef']);
    const d = resume('', encodeLocal(m), 's', roster6);
    expect(d.source).toBe('local');
    expect(d.restoredFromLocal).toBe(true);
    expect(d.state.reportedRaw).toBe(0);
    expect(d.state.solved).toBe(7n);
    expect(d.state.isomersDone).toEqual({ x: ['0123456789abcdef'] });
  });

  it('P-R4 the mirror wins with more progress, keeping the LMS reportedRaw', () => {
    const d = resume(encode({ ...two(), reportedRaw: 20 }), encodeLocal(three()), 's', roster6);
    expect(d.source).toBe('local');
    expect(d.restoredFromLocal).toBe(true);
    expect(d.state.reportedRaw).toBe(20);
    expect(d.state.solved).toBe(7n);
  });

  it('P-R5 equal rank: the LMS record wins, isomers come from the mirror', () => {
    const m = withIsomers(three(), 'x', ['0123456789abcdef']);
    const d = resume(encode(three()), encodeLocal(m), 's', roster6);
    expect(d.source).toBe('lms');
    expect(d.restoredFromLocal).toBe(false);
    expect(d.state.isomersDone).toEqual({ x: ['0123456789abcdef'] });
  });

  it('P-R6 another learner\'s mirror is ignored (critic 2.6)', () => {
    const M = encodeLocal(three()); // studentId 's'
    expect(resume('', M, 'B', roster6).source).toBe('fresh');
    expect(resume(encode(two()), M, 'B', roster6).source).toBe('lms');
  });

  it('P-R7 malformed strings fall back', () => {
    expect(resume('garbage', encodeLocal(three()), 's', roster6).source).toBe('local');
    expect(resume('garbage', 'garbage', 's', roster6).source).toBe('fresh');
    expect(resume('', '', 's', roster6).source).toBe('fresh');
  });

  it('P-R8 progressRank orders lexicographically', () => {
    const ranks: (readonly [number, number, number])[] = [
      [3, 3, 8],
      [2, 6, 20],
      [2, 5, 20],
      [2, 5, 19],
    ];
    for (let i = 0; i + 1 < ranks.length; i++) {
      expect(compareRank(ranks[i]!, ranks[i + 1]!)).toBeGreaterThan(0);
      expect(compareRank(ranks[i + 1]!, ranks[i]!)).toBeLessThan(0);
    }
    expect(compareRank([1, 1, 1], [1, 1, 1])).toBe(0);
    expect(progressRank(three())).toEqual([3, 3, 10]);
  });

  it('P-R9 isNewAttempt', () => {
    expect(isNewAttempt('ab-initio', 'not attempted', '', 0)).toBe(true);
    expect(isNewAttempt('ab-initio', '', '', 0)).toBe(true);
    expect(isNewAttempt('resume', 'not attempted', '', 0)).toBe(false);
    expect(isNewAttempt('resume', '', '', 0)).toBe(false);
    // SCORM 1.2 allows an empty entry on a fresh attempt: only 'resume' blocks the discard
    expect(isNewAttempt('', 'not attempted', '', 0)).toBe(true);
    expect(isNewAttempt('', '', '', 0)).toBe(true);
    expect(isNewAttempt('', 'incomplete', '', 0)).toBe(false);
    expect(isNewAttempt('', 'not attempted', '', 33)).toBe(false);
    expect(isNewAttempt('', 'not attempted', 'v2|0|0|0|0|0|0|', 0)).toBe(false);
    expect(isNewAttempt('ab-initio', 'incomplete', '', 0)).toBe(false);
    expect(isNewAttempt('ab-initio', 'not attempted', '', 33)).toBe(false);
    expect(isNewAttempt('ab-initio', 'not attempted', 'v2|0|0|0|0|0|0|', 0)).toBe(false);
  });
});
