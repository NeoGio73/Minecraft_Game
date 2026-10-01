/**
 * Pointer lock request with the verification timeout. DOM module.
 * docs/design/06-engine.md §9.3.
 *
 * `requestLock` must be called synchronously inside the click handler
 * (transient activation); its body runs synchronously up to the first await,
 * so the browser call happens inside the gesture. `pointerlockchange` and
 * `pointerlockerror` on `document` remain the ground truth (handled by
 * LookModes); the returned promise only decides the fallback.
 */

/** Grace period for engines that return undefined instead of a promise. */
export const LOCK_VERIFY_MS = 150;
/** After an unlock (Esc, tab switch) the next click only drags for this long. */
export const RELOCK_COOLDOWN_MS = 1500;
/** Failed attempts after which LookModes stops asking (Settings can reset). */
export const MAX_LOCK_FAILURES = 2;

export type LockOutcome = 'locked' | 'rejected' | 'unverified' | 'unsupported';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type LockRequester = (options?: PointerLockOptions) => Promise<void> | undefined;

export async function requestLock(el: HTMLElement): Promise<LockOutcome> {
  const request = (el as { requestPointerLock?: unknown }).requestPointerLock;
  if (typeof request !== 'function') return 'unsupported';
  const call = request as LockRequester;
  try {
    await call.call(el, { unadjustedMovement: true });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotSupportedError') {
      // unadjustedMovement is not available on this platform: ask for a plain lock
      try {
        await call.call(el);
      } catch {
        return 'rejected';
      }
    } else {
      return 'rejected';
    }
  }
  await sleep(LOCK_VERIFY_MS);
  return document.pointerLockElement === el ? 'locked' : 'unverified';
}

/** true while the pointer is locked to `el`. */
export function isLockedTo(el: Element): boolean {
  return document.pointerLockElement === el;
}

/** Releases the lock if the document holds one (safe to call when it does not). */
export function exitLock(): void {
  if (document.pointerLockElement && typeof document.exitPointerLock === 'function') document.exitPointerLock();
}
