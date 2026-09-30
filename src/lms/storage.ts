/**
 * Per-student progress mirror in localStorage. DOM module: `safeLocalStorage`
 * is the one function that touches `window`; everything else takes a
 * `StorageLike` so it can be exercised with an in-memory map.
 * Spec: docs/design/08-deployment.md §4.
 */
import { progressStorageKey } from './types';
import { UNKNOWN_STUDENT_ID } from './Progress';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PROBE_KEY = '__orgocraft_probe__';

/** window.localStorage behind a probe write; null when access throws or the
 *  probe fails (private mode, blocked storage, quota, sandboxed frame). */
export function safeLocalStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    if (!s) return null;
    s.setItem(PROBE_KEY, '1');
    s.removeItem(PROBE_KEY);
    return s;
  } catch {
    return null;
  }
}

/** The mirror string for this learner, or null (no storage, unknown learner,
 *  nothing stored, or the read threw). Only `orgocraft.v1.progress.<id>` is
 *  read, so another learner's record on the same browser is never seen. */
export function readProgressMirror(storage: StorageLike | null, studentId: string): string | null {
  if (!storage || studentId === UNKNOWN_STUDENT_ID) return null;
  try {
    return storage.getItem(progressStorageKey(studentId));
  } catch {
    return null;
  }
}

/** true when the write succeeded. */
export function writeProgressMirror(storage: StorageLike | null, studentId: string, encodedLocal: string): boolean {
  if (!storage || studentId === UNKNOWN_STUDENT_ID) return false;
  try {
    storage.setItem(progressStorageKey(studentId), encodedLocal);
    return true;
  } catch {
    return false;
  }
}

export function clearProgressMirror(storage: StorageLike | null, studentId: string): void {
  if (!storage || studentId === UNKNOWN_STUDENT_ID) return;
  try {
    storage.removeItem(progressStorageKey(studentId));
  } catch {
    /* ignore: the game runs with in-memory state when storage is unavailable */
  }
}
