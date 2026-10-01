/**
 * Toolbar: LMS badge, Fullscreen, Open in new tab, Help, Settings, Save /
 * Save & Exit. docs/design/07-ui.md §5. DOM module.
 */
import { MODE_BADGE } from '../lms/types';
import type { AdapterMode } from '../lms/types';
import { STRINGS, keyName } from './strings';
import { h, rovingTabindex, setHidden, setText } from './hud';
import type { HudContext, Panel, UiEvents } from './hud';

export interface ToolbarPanel extends Panel {
  onStatus(e: UiEvents['lms:status']): void;
}

export function mountToolbar(root: HTMLElement, ctx: HudContext): ToolbarPanel {
  const { state, hooks, stage } = ctx;
  const doc = root.ownerDocument;
  let mode: AdapterMode = state.mode;

  const badge = h('span', { id: 'lms-badge', class: 'badge', 'data-mode': mode, role: 'status' }, MODE_BADGE[mode]);
  const spacer = h('span', { class: 'spacer' });
  const fullscreen = h('button', { type: 'button', id: 'tb-fullscreen' }, STRINGS.fullscreen) as HTMLButtonElement;
  const newTab = h('a', { id: 'tb-newtab', href: doc.defaultView?.location.href ?? '#', target: '_blank', rel: 'noopener' }, STRINGS.openInNewTab) as HTMLAnchorElement;
  const help = h('button', { type: 'button', id: 'tb-help', 'aria-haspopup': 'dialog' }, STRINGS.help.title) as HTMLButtonElement;
  const settings = h('button', { type: 'button', id: 'tb-settings', 'aria-haspopup': 'dialog' }, STRINGS.settings) as HTMLButtonElement;
  const save = h('button', { type: 'button', id: 'tb-save' }, STRINGS.save) as HTMLButtonElement;
  const saveExit = h('button', { type: 'button', id: 'tb-save-exit' }, STRINGS.saveAndExit) as HTMLButtonElement;
  root.append(badge, spacer, fullscreen, newTab, help, settings, save, saveExit);

  const fullscreenEnabled = (): boolean => {
    try {
      return Boolean(doc.fullscreenEnabled);
    } catch {
      return false;
    }
  };
  const isFullscreen = (): boolean => {
    try {
      return doc.fullscreenElement === stage;
    } catch {
      return false;
    }
  };

  fullscreen.addEventListener('click', () => {
    if (isFullscreen()) {
      try {
        void doc.exitFullscreen?.();
      } catch {
        // ignore
      }
      return;
    }
    hooks.requestFullscreen().catch(() => state.announce(STRINGS.fullscreenFailed, 'assertive'));
  });
  const onFsChange = (): void => { setText(fullscreen, isFullscreen() ? STRINGS.exitFullscreen : STRINGS.fullscreen); };
  doc.addEventListener('fullscreenchange', onFsChange);

  help.addEventListener('click', () => ctx.openHelp(help));
  settings.addEventListener('click', () => ctx.openSettings(settings));
  save.addEventListener('click', () => {
    state.save();
    state.announce(STRINGS.savedLocally, 'polite');
  });
  let exiting = false;
  saveExit.addEventListener('click', () => {
    if (exiting) return;
    void ctx.dialogs.confirm(STRINGS.confirmSaveExit, STRINGS.saveAndExit).then((ok) => {
      if (!ok) return;
      exiting = true;
      saveExit.disabled = true;
      return state.saveAndExit().then(() => {
        ctx.showFinished();
        refresh();
      }, () => {
        exiting = false;
        refresh();
      });
    });
  });

  const stopRoving = rovingTabindex(root, 'button, a');

  function refresh(): void {
    setHidden(fullscreen, !fullscreenEnabled());
    setHidden(newTab, mode !== 'standalone');
    setHidden(save, mode !== 'standalone');
    setHidden(saveExit, mode !== 'lms');
    const discovering = mode === 'discovering';
    save.disabled = discovering || state.finished;
    saveExit.disabled = discovering || state.finished || exiting;
    fullscreen.disabled = state.finished;
    settings.disabled = state.finished;
    newTab.setAttribute('aria-disabled', state.finished ? 'true' : 'false');
    if (state.finished) newTab.setAttribute('tabindex', '-1');
    help.setAttribute('aria-keyshortcuts', keyName(ctx.keys().help));
    onFsChange();
  }

  refresh();

  return {
    el: root,
    refresh,
    onStatus(e) {
      mode = e.mode;
      badge.dataset['mode'] = e.mode;
      setText(badge, e.message || MODE_BADGE[e.mode]);
      refresh();
    },
    dispose() {
      stopRoving();
      doc.removeEventListener('fullscreenchange', onFsChange);
    },
  };
}
