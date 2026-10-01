/**
 * Settings dialog: graphics, theme, reduced motion, hydrogens, stereo overlay,
 * look, interface size, key remapping. docs/design/07-ui.md §15. DOM module.
 * Every change applies immediately through ctx.updateSettings (saveSettings +
 * settings:changed per field; hud.ts applies the effects and announces).
 */
import { DEFAULT_KEYS, KEY_ACTIONS, SENSITIVITY_RANGE, TURN_RATE_RANGE, UI_SCALES, effectiveKeys, keyConflict } from '../app/Settings';
import type { KeyAction, Settings } from '../app/Settings';
import { KEY_ACTION_LABEL, STRINGS, keyName } from './strings';
import { clearChildren, h, setText } from './hud';
import type { Dialog, HudContext, UiEvents } from './hud';

export interface SettingsPanel extends Dialog {
  onGfxChanged(e: UiEvents['gfx:changed']): void;
}

export function mountSettingsPanel(root: HTMLElement, ctx: HudContext): SettingsPanel {
  const { state } = ctx;
  let isOpen = false;
  let capturing: KeyAction | null = null;
  let captureCell: HTMLElement | null = null;
  const changeButtons = new Map<KeyAction, HTMLButtonElement>();

  const closeBtn = h('button', { type: 'button', id: 'st-close' }, STRINGS.close) as HTMLButtonElement;

  const select = (id: string, label: string, options: [string, string][]): { row: HTMLElement; input: HTMLSelectElement } => {
    const input = h('select', { id }) as HTMLSelectElement;
    for (const [value, text] of options) input.appendChild(h('option', { value }, text));
    return { row: h('div', { class: 'st-row' }, h('label', { for: id }, label), input), input };
  };
  const checkbox = (id: string, label: string): { row: HTMLElement; input: HTMLInputElement } => {
    const input = h('input', { type: 'checkbox', id }) as HTMLInputElement;
    return { row: h('div', { class: 'st-row st-check' }, input, h('label', { for: id }, label)), input };
  };
  const range = (id: string, label: string, min: number, max: number, step: number): { row: HTMLElement; input: HTMLInputElement; output: HTMLOutputElement } => {
    const input = h('input', { type: 'range', id, min, max, step }) as HTMLInputElement;
    const output = h('output', { for: id }) as HTMLOutputElement;
    return { row: h('div', { class: 'st-row' }, h('label', { for: id }, label), input, output), input, output };
  };

  const graphics = select('st-graphics', STRINGS.graphics, [['standard', STRINGS.graphicsStandard], ['low', STRINGS.graphicsLow]]);
  const theme = select('st-theme', STRINGS.theme, [['auto', STRINGS.themeAuto], ['dark', STRINGS.themeDark], ['light', STRINGS.themeLight]]);
  const motion = select('st-motion', STRINGS.reducedMotion, [['auto', STRINGS.motionAuto], ['on', STRINGS.on], ['off', STRINGS.off]]);
  const hydrogens = checkbox('st-hydrogens', STRINGS.showHydrogens);
  const stereo = checkbox('st-stereo', STRINGS.stereoOverlay);
  const invert = checkbox('st-invert', STRINGS.invertY);
  const sensitivity = range('st-sensitivity', STRINGS.sensitivity, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max, SENSITIVITY_RANGE.step);
  const turnRate = range('st-turn', STRINGS.turnRate, TURN_RATE_RANGE.min, TURN_RATE_RANGE.max, TURN_RATE_RANGE.step);
  const scale = select('st-scale', STRINGS.uiScale, UI_SCALES.map((s) => [String(s), STRINGS.uiScaleLabel(s)] as [string, string]));
  const keysBody = h('tbody', null);
  const keysTable = h('table', { class: 'st-keys' },
    h('thead', null, h('tr', null, ...STRINGS.keyColumns.map((c) => h('th', { scope: 'col' }, c)))), keysBody);
  const resetKeys = h('button', { type: 'button', id: 'st-reset-keys' }, STRINGS.resetKeys) as HTMLButtonElement;
  const form = h('form', { class: 'st-form' },
    graphics.row, theme.row, motion.row, hydrogens.row, stereo.row, invert.row, sensitivity.row, turnRate.row, scale.row,
    h('section', { class: 'st-keys-section' }, h('h3', null, STRINGS.keys), keysTable, resetKeys));
  form.addEventListener('submit', (e) => e.preventDefault());
  const el = h('div', { id: 'settings', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title', hidden: true, tabindex: '-1' },
    h('header', { class: 'dialog-header' }, h('h2', { id: 'settings-title' }, STRINGS.settingsTitle), closeBtn), form);
  root.appendChild(el);

  graphics.input.addEventListener('change', () => ctx.updateSettings({ lowGraphics: graphics.input.value === 'low' }));
  theme.input.addEventListener('change', () => ctx.updateSettings({ theme: theme.input.value as Settings['theme'] }));
  motion.input.addEventListener('change', () => ctx.updateSettings({ reducedMotion: motion.input.value as Settings['reducedMotion'] }));
  hydrogens.input.addEventListener('change', () => ctx.updateSettings({ showHydrogens: hydrogens.input.checked }));
  stereo.input.addEventListener('change', () => ctx.updateSettings({ stereoOverlay: stereo.input.checked }));
  invert.input.addEventListener('change', () => ctx.updateSettings({ invertY: invert.input.checked }));
  sensitivity.input.addEventListener('input', () => { sensitivity.output.value = Number(sensitivity.input.value).toFixed(4); });
  sensitivity.input.addEventListener('change', () => ctx.updateSettings({ sensitivity: Number(sensitivity.input.value) }));
  turnRate.input.addEventListener('input', () => { turnRate.output.value = Number(turnRate.input.value).toFixed(1); });
  turnRate.input.addEventListener('change', () => ctx.updateSettings({ turnRate: Number(turnRate.input.value) }));
  scale.input.addEventListener('change', () => {
    const v = Number(scale.input.value);
    const ok = UI_SCALES.find((s) => s === v);
    if (ok !== undefined) ctx.updateSettings({ uiScale: ok });
  });
  resetKeys.addEventListener('click', () => {
    cancelCapture();
    ctx.updateSettings({ keys: {} });
    refresh();
  });

  function cancelCapture(): void {
    if (!capturing) return;
    capturing = null;
    if (captureCell) setText(captureCell, keyName(ctx.keys()[captureCell.dataset['action'] as KeyAction] ?? ''));
    captureCell = null;
  }

  function startCapture(action: KeyAction, cell: HTMLElement): void {
    cancelCapture();
    capturing = action;
    captureCell = cell;
    setText(cell, STRINGS.pressAKey);
    state.announce(STRINGS.pressAKey, 'polite');
  }

  function onKeyCapture(e: KeyboardEvent): boolean {
    if (!capturing) return false;
    e.preventDefault();
    e.stopPropagation();
    const action = capturing;
    if (e.code === 'Escape') {
      cancelCapture();
      return true;
    }
    const keys = effectiveKeys(ctx.settings());
    const conflict = keyConflict(keys, action, e.code);
    if (conflict === 'reserved') {
      state.announce(STRINGS.keyReserved(keyName(e.code)), 'assertive');
      return true;
    }
    if (conflict !== null) {
      state.announce(STRINGS.keyConflict(KEY_ACTION_LABEL[conflict]), 'assertive');
      return true;
    }
    const overrides: Partial<Record<KeyAction, string>> = { ...ctx.settings().keys };
    if (e.code === DEFAULT_KEYS[action]) delete overrides[action];
    else overrides[action] = e.code;
    capturing = null;
    captureCell = null;
    ctx.updateSettings({ keys: overrides });
    refresh();
    changeButtons.get(action)?.focus();   // the table was rebuilt: keep the keyboard user on the row they remapped
    return true;
  }

  function buildKeys(): void {
    clearChildren(keysBody);
    changeButtons.clear();
    const keys = ctx.keys();
    for (const action of KEY_ACTIONS) {
      const cell = h('td', { 'data-action': action }, keyName(keys[action]));
      const change = h('button', { type: 'button', 'aria-label': `${STRINGS.change}: ${KEY_ACTION_LABEL[action]}` }, STRINGS.change) as HTMLButtonElement;
      change.addEventListener('click', () => startCapture(action, cell));
      changeButtons.set(action, change);
      keysBody.appendChild(h('tr', null, h('th', { scope: 'row' }, KEY_ACTION_LABEL[action]), cell, h('td', null, change)));
    }
  }

  function refresh(): void {
    const s = ctx.settings();
    graphics.input.value = s.lowGraphics ? 'low' : 'standard';
    theme.input.value = s.theme;
    motion.input.value = s.reducedMotion;
    hydrogens.input.checked = s.showHydrogens;
    stereo.input.checked = s.stereoOverlay;
    invert.input.checked = s.invertY;
    sensitivity.input.value = String(s.sensitivity);
    sensitivity.output.value = s.sensitivity.toFixed(4);
    turnRate.input.value = String(s.turnRate);
    turnRate.output.value = s.turnRate.toFixed(1);
    scale.input.value = String(s.uiScale);
    buildKeys();
  }

  function open(opener?: HTMLElement | null): void {
    if (isOpen) return;
    isOpen = true;
    refresh();
    ctx.dialogs.push(el, opener ?? null);
    graphics.input.focus();
  }
  function close(): void {
    if (!isOpen) return;
    cancelCapture();
    isOpen = false;
    ctx.dialogs.pop(el);
  }
  closeBtn.addEventListener('click', () => close());
  const onKey = (e: KeyboardEvent): void => {
    if (onKeyCapture(e)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  el.addEventListener('keydown', onKey);
  refresh();

  return {
    el,
    refresh,
    open,
    close,
    get isOpen() { return isOpen; },
    onGfxChanged(e) {
      graphics.input.value = e.lowGfx ? 'low' : 'standard';
    },
    dispose() {
      el.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
