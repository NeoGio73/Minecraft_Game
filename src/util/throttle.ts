/**
 * Small rate limiters for the frame loop. PURE MODULE (no three, no DOM; the
 * clock is injected so tests can drive it).
 */

export interface Throttled<A extends unknown[]> {
  /** Calls `fn` now when at least `ms` passed since the last call, else remembers the arguments for `flush()`. Returns true when it ran. */
  (...args: A): boolean;
  /** Runs the pending call (if any) regardless of the interval. Returns true when it ran. */
  flush(): boolean;
  /** true while a call is waiting for the interval to elapse. */
  readonly pending: boolean;
}

/**
 * Leading-edge throttle with a remembered trailing call: the first call runs at
 * once, further calls inside `ms` are coalesced into one pending call that runs
 * on the next invocation after the interval (or on `flush()`).
 */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number, now: () => number): Throttled<A> {
  let last = -Infinity;
  let queued: A | null = null;
  const run = (args: A): void => {
    last = now();
    queued = null;
    fn(...args);
  };
  const call = ((...args: A): boolean => {
    if (now() - last >= ms) {
      run(args);
      return true;
    }
    queued = args;
    return false;
  }) as Throttled<A>;
  Object.defineProperty(call, 'pending', { get: () => queued !== null });
  call.flush = (): boolean => {
    if (queued === null) return false;
    run(queued);
    return true;
  };
  return call;
}

/** A tick gate: `due(now)` is true at most once per `ms` (first call always true). */
export class Interval {
  private last = -Infinity;
  constructor(readonly ms: number) {}
  due(now: number): boolean {
    if (now - this.last < this.ms) return false;
    this.last = now;
    return true;
  }
  reset(): void {
    this.last = -Infinity;
  }
}

/** Running mean over the last `size` samples (frame-time display). */
export class RollingMean {
  private readonly buf: number[];
  private i = 0;
  private n = 0;
  private sum = 0;
  constructor(readonly size: number) {
    this.buf = new Array<number>(Math.max(1, size)).fill(0);
  }
  push(v: number): void {
    if (this.n < this.buf.length) this.n++;
    else this.sum -= this.buf[this.i] as number;
    this.buf[this.i] = v;
    this.sum += v;
    this.i = (this.i + 1) % this.buf.length;
  }
  get mean(): number {
    return this.n === 0 ? 0 : this.sum / this.n;
  }
}
