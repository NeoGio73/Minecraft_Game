/**
 * Pause menu (Escape), the shared confirm dialog and the finished overlay.
 * docs/design/07-ui.md §13. DOM module.
 */
import { MODE_BADGE } from '../lms/types';
import { STRINGS } from './strings';
import { h, setHidden, setText } from './hud';
import type { Dialog, DialogHost, HudContext, UiEvents } from './hud';

export interface PauseMenu extends Dialog {
  onStatus(e: UiEvents['lms:status']): void;
}

export interface ConfirmHost {
  confirm(text: string, okLabel: string): Promise<boolean>;
  dispose(): void;
}

/** §13.2 shared confirm: role=alertdialog, Cancel focused first, Escape = cancel. */
export function createConfirm(root: HTMLElement, host: DialogHost): ConfirmHost {
  const title = h('h2', { id: 'confirm-title' }, STRINGS.confirmTitle);
  const text = h('p', { id: 'confirm-text' });
  const cancel = h('button', { type: 'button', id: 'confirm-cancel', autofocus: true }, STRINGS.cancel) as HTMLButtonElement;
  const ok = h('button', { type: 'button', id: 'confirm-ok' }, STRINGS.ok) as HTMLButtonElement;
  const el = h('div', { id: 'confirm', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title', 'aria-describedby': 'confirm-text', hidden: true, tabindex: '-1' },
    title, text, h('div', { class: 'dialog-actions' }, cancel, ok));
  root.appendChild(el);
  let resolver: ((v: boolean) => void) | null = null;

  const finish = (v: boolean): void => {
    const r = resolver;
    resolver = null;
    host.pop(el);
    r?.(v);
  };
  cancel.addEventListener('click', () => finish(false));
  ok.addEventListener('click', () => finish(true));
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };
  el.addEventListener('keydown', onKey);

  return {
    confirm(message, okLabel) {
      if (resolver) return Promise.resolve(false);
      setText(text, message);
      setText(ok, okLabel);
      return new Promise<boolean>((resolve) => {
        resolver = resolve;
        host.push(el);
        cancel.focus();
      });
    },
    dispose() {
      el.removeEventListener('keydown', onKey);
      if (resolver) finish(false);
      el.remove();
    },
  };
}

/** §13.3: no buttons, the dialog itself takes focus; #hud/#canvas stay inert. Never popped. */
export function showFinishedOverlay(root: HTMLElement, host: DialogHost): HTMLElement {
  let el = root.querySelector<HTMLElement>('#finished');
  if (!el) {
    el = h('div', { id: 'finished', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fin-title', tabindex: '-1', hidden: true },
      h('h2', { id: 'fin-title' }, STRINGS.finishedTitle), h('p', null, STRINGS.finishedBody));
    root.appendChild(el);
  }
  host.push(el, null);
  el.focus({ preventScroll: true });
  return el;
}

export function mountPauseMenu(root: HTMLElement, ctx: HudContext): PauseMenu {
  const { state } = ctx;
  let isOpen = false;
  let statusText = MODE_BADGE[state.mode];

  const lmsLine = h('p', { class: 'pause-lms' }, statusText);
  const resume = h('button', { type: 'button', id: 'pm-resume', autofocus: true }, STRINGS.resume) as HTMLButtonElement;
  const rosterBtn = h('button', { type: 'button', id: 'pm-roster' }, STRINGS.challenges) as HTMLButtonElement;
  const helpBtn = h('button', { type: 'button', id: 'pm-help', 'aria-haspopup': 'dialog' }, STRINGS.help.title) as HTMLButtonElement;
  const settingsBtn = h('button', { type: 'button', id: 'pm-settings', 'aria-haspopup': 'dialog' }, STRINGS.settings) as HTMLButtonElement;
  const clearBtn = h('button', { type: 'button', id: 'pm-clear' }, STRINGS.clearPad) as HTMLButtonElement;
  const saveBtn = h('button', { type: 'button', id: 'pm-save' }, STRINGS.save) as HTMLButtonElement;
  const exitBtn = h('button', { type: 'button', id: 'pm-exit' }, STRINGS.saveAndExit) as HTMLButtonElement;
  const menu = h('menu', null,
    h('li', null, resume), h('li', null, rosterBtn), h('li', null, helpBtn), h('li', null, settingsBtn), h('li', null, clearBtn), h('li', null, saveBtn), h('li', null, exitBtn));
  const el = h('div', { id: 'pause', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-title', hidden: true, tabindex: '-1' },
    h('h2', { id: 'pause-title' }, STRINGS.paused), lmsLine, menu, h('p', { class: 'pause-keys' }, STRINGS.pauseKeys));
  root.appendChild(el);

  function refresh(): void {
    setText(lmsLine, statusText);
    setHidden(saveBtn, state.mode !== 'standalone');
    setHidden(exitBtn, state.mode !== 'lms');
    const discovering = state.mode === 'discovering';
    saveBtn.disabled = discovering || state.finished;
    exitBtn.disabled = discovering || state.finished;
    clearBtn.disabled = state.finished;
  }

  function open(opener?: HTMLElement | null): void {
    if (isOpen) return;
    isOpen = true;
    if (!state.paused) state.setPaused(true);
    refresh();
    ctx.dialogs.push(el, opener ?? ctx.canvas);
    resume.focus();
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    ctx.dialogs.pop(el);
    if (state.paused) state.setPaused(false);
    ctx.showLookHint(STRINGS.clickToLook, null);
  }

  resume.addEventListener('click', () => close());
  rosterBtn.addEventListener('click', () => {
    close();
    ctx.openRoster();
  });
  helpBtn.addEventListener('click', () => ctx.openHelp(helpBtn));
  settingsBtn.addEventListener('click', () => ctx.openSettings(settingsBtn));
  clearBtn.addEventListener('click', () => {
    void ctx.dialogs.confirm(STRINGS.confirmClearPad, STRINGS.clearPad).then((ok) => {
      if (ok) state.clearPad();
    });
  });
  saveBtn.addEventListener('click', () => {
    state.save();
    state.announce(STRINGS.savedLocally, 'polite');
  });
  exitBtn.addEventListener('click', () => {
    void ctx.dialogs.confirm(STRINGS.confirmSaveExit, STRINGS.saveAndExit).then((ok) => {
      if (!ok) return;
      exitBtn.disabled = true;
      return state.saveAndExit().then(() => {
        ctx.showFinished();
      }, () => {
        refresh();
      });
    });
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  el.addEventListener('keydown', onKey);

  return {
    el,
    refresh,
    open,
    close,
    get isOpen() { return isOpen; },
    onStatus(e) {
      statusText = e.message || MODE_BADGE[e.mode];
      refresh();
    },
    dispose() {
      el.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
