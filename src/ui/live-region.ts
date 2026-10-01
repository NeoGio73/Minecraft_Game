/**
 * Live regions and the screen-reader scene mirror. docs/design/07-ui.md §16.
 *
 * `#status` (role=status, polite, throttled) and `#toast` (role=alert,
 * assertive, deduplicated) are the ONLY live regions in the page; they are
 * direct children of `#stage`, never inside `#hud`, so an open modal dialog
 * (which makes `#hud` inert) cannot silence them. `#scene-mirror` is a plain
 * region updated at most once per MIRROR_MS by hud.ts.
 */

/** At most one polite DOM write per this interval; the latest non-sticky message wins. */
export const LIVE_POLITE_MS = 1000;
/** Identical assertive text within this window is dropped. */
export const ALERT_DEDUPE_MS = 2000;
/** The toast is shown visually for this long. */
export const TOAST_MS = 4000;

export interface AnnounceOptions {
  /** Challenge and quiz results: queued FIFO instead of replacing the pending message (§16.1). */
  readonly sticky?: boolean;
}

export interface LiveRegion {
  announce(text: string, priority: 'polite' | 'assertive', opts?: AnnounceOptions): void;
  mirror(html: string): void;
  dispose(): void;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function nextFrame(fn: () => void): void {
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
  if (typeof raf === 'function') raf.call(globalThis, fn);
  else setTimeout(fn, 0);
}

function ensure(root: HTMLElement, id: string, tag: string, attrs: Record<string, string>): HTMLElement {
  const doc = root.ownerDocument;
  let el = root.querySelector<HTMLElement>(`#${id}`);
  if (!el) {
    el = doc.createElement(tag);
    el.id = id;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    root.appendChild(el);
  }
  return el;
}

/** root = #stage; uses #status, #toast, #scene-mirror (created when missing). */
export function createLiveRegion(root: HTMLElement): LiveRegion {
  const status = ensure(root, 'status', 'div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const toast = ensure(root, 'toast', 'div', { class: 'sr-only', role: 'alert', 'aria-atomic': 'true' });
  const mirrorEl = ensure(root, 'scene-mirror', 'section', { class: 'sr-only', 'aria-label': 'Scene description' });

  // polite
  let pending: string | null = null;
  const queue: string[] = [];
  let politeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastWrite = -Infinity;
  let disposed = false;

  const write = (el: HTMLElement, text: string): void => {
    if (el.textContent === text) {
      // re-announce identical text: clear, then refill on the next frame
      el.textContent = '';
      nextFrame(() => {
        if (!disposed) el.textContent = text;
      });
    } else {
      el.textContent = text;
    }
  };

  const flushPolite = (): void => {
    politeTimer = null;
    if (disposed) return;
    const next = queue.length ? queue.shift() ?? null : pending;
    if (next === null) return;
    if (next === pending) pending = null;
    const t = now();
    const wait = LIVE_POLITE_MS - (t - lastWrite);
    if (wait > 0) {
      // too soon: put it back and retry
      if (queue.length === 0 && pending === null) pending = next;
      else if (next !== pending) queue.unshift(next);
      politeTimer = setTimeout(flushPolite, wait);
      return;
    }
    lastWrite = t;
    write(status, next);
    if (queue.length || pending !== null) politeTimer = setTimeout(flushPolite, LIVE_POLITE_MS);
  };

  const schedulePolite = (): void => {
    if (politeTimer !== null) return;
    const wait = Math.max(0, LIVE_POLITE_MS - (now() - lastWrite));
    politeTimer = setTimeout(flushPolite, wait);
  };

  // assertive
  let lastAlert = '';
  let lastAlertAt = -Infinity;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const showToast = (text: string): void => {
    write(toast, text);
    toast.classList.remove('sr-only');
    toast.classList.add('is-visible');
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toast.classList.remove('is-visible');
      toast.classList.add('sr-only');
    }, TOAST_MS);
  };

  let lastMirror = '';

  return {
    announce(text, priority, opts) {
      if (disposed || text === '') return;
      if (priority === 'assertive') {
        const t = now();
        if (text === lastAlert && t - lastAlertAt < ALERT_DEDUPE_MS) return;
        lastAlert = text;
        lastAlertAt = t;
        showToast(text);
        return;
      }
      if (opts?.sticky) queue.push(text);
      else pending = text;
      schedulePolite();
    },
    mirror(html) {
      if (html === lastMirror) return;
      lastMirror = html;
      mirrorEl.innerHTML = html;
    },
    dispose() {
      disposed = true;
      if (politeTimer !== null) clearTimeout(politeTimer);
      if (toastTimer !== null) clearTimeout(toastTimer);
      politeTimer = null;
      toastTimer = null;
    },
  };
}
