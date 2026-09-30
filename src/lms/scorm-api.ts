/**
 * SCORM 1.2 API discovery: walk `window.parent` up to API_WALK_DEPTH frames,
 * then the `window.opener` chain, then `window.top.opener`. Every cross-window
 * property read is wrapped in try/catch because the D2L Content Service serves
 * the SCO from a different origin than the LMS host. `API_1484_11` (SCORM
 * 2004) is never looked for and `document.domain` is never touched.
 * Spec: docs/design/08-deployment.md §5.
 */
import type { ScormApi12 } from './types';
import { API_WALK_DEPTH } from './types';

/** The subset of Window the discovery walk touches. Every property read may throw (cross-origin). */
export interface WindowLike {
  readonly API?: unknown;
  readonly parent?: WindowLike | null;
  readonly opener?: WindowLike | null;
  readonly top?: WindowLike | null;
}

const REQUIRED_FUNCTIONS = ['LMSInitialize', 'LMSFinish', 'LMSGetValue', 'LMSSetValue', 'LMSCommit', 'LMSGetLastError'] as const;

export function isScormApi(x: unknown): x is ScormApi12 {
  if (!x || (typeof x !== 'object' && typeof x !== 'function')) return false;
  const o = x as Record<string, unknown>;
  try {
    return REQUIRED_FUNCTIONS.every((k) => typeof o[k] === 'function');
  } catch {
    return false;
  }
}

/** Walk `start` and its parents (at most `maxDepth` frames) for `API`. A frame
 *  whose `API` is unreadable (cross-origin intermediate) does not end the
 *  walk; only an unreadable `.parent`, `parent === self` or the depth cap does. */
export function findApi(start: WindowLike, maxDepth: number = API_WALK_DEPTH): ScormApi12 | null {
  let win: WindowLike | null | undefined = start;
  for (let depth = 0; depth < maxDepth && win; depth++) {
    let api: unknown;
    try {
      api = win.API;
    } catch {
      api = undefined; // cross-origin frame: unreadable, but its parent may be ours
    }
    if (isScormApi(api)) return api;
    let parent: WindowLike | null | undefined;
    try {
      parent = win.parent;
    } catch {
      return null; // only an unreadable .parent ends the chain
    }
    if (!parent || parent === win) return null; // reached top
    win = parent;
  }
  return null;
}

/** Own window and parents, then `opener`, then `top.opener`. Never throws. */
export function discover(win: WindowLike = window as unknown as WindowLike): ScormApi12 | null {
  let api: ScormApi12 | null = null;
  try {
    api = findApi(win);
  } catch {
    api = null;
  }
  if (!api) {
    try {
      const opener = win.opener;
      if (opener) api = findApi(opener);
    } catch {
      /* cross-origin opener */
    }
  }
  if (!api) {
    try {
      const t = win.top;
      const opener = t ? t.opener : null;
      if (opener) api = findApi(opener);
    } catch {
      /* cross-origin top or opener */
    }
  }
  return api;
}
