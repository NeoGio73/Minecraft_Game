/**
 * Hotbar: 12 slots (8 elements, H, bond wand, charge tool, select tool).
 * docs/design/07-ui.md §6. DOM module.
 */
import { CPK_HEX, CPK_TEXT } from '../world/types';
import type { BlockElement } from '../world/types';
import type { KeyAction } from '../input/keymap';
import { STRINGS, keyName } from './strings';
import { HOTBAR, h, rovingTabindex, setText } from './hud';
import type { HudContext, Panel } from './hud';

const SLOT_KEYS: readonly KeyAction[] = [
  'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9', 'bondWand', 'chargeTool', 'selectTool',
];

const TOOL_SYMBOL: Record<string, string> = { 'bond-wand': '=', 'charge-tool': '±', 'select-tool': '⌖' };

export function mountHotbar(root: HTMLElement, ctx: HudContext): Panel {
  const { state } = ctx;
  const slots: HTMLButtonElement[] = [];
  const counts: HTMLElement[] = [];
  const keys: HTMLElement[] = [];

  HOTBAR.forEach((entry, i) => {
    const isTool = entry === 'bond-wand' || entry === 'charge-tool' || entry === 'select-tool';
    const sym = h('span', { class: 'sym' }, isTool ? TOOL_SYMBOL[entry] ?? '' : entry);
    if (!isTool) {
      const el = entry as BlockElement;
      sym.style.setProperty('--cpk', `#${CPK_HEX[el].toString(16).padStart(6, '0')}`);
      sym.style.setProperty('--cpk-text', CPK_TEXT[el]);
    }
    const count = h('span', { class: 'count' }, '');
    const key = h('span', { class: 'key' }, '');
    const b = h('button', { type: 'button', class: isTool ? 'slot tool' : 'slot', 'data-slot': i, 'aria-pressed': 'false' }, sym, isTool ? null : count, key) as HTMLButtonElement;
    b.addEventListener('click', () => state.selectSlot(i));
    slots.push(b);
    counts.push(count);
    keys.push(key);
    root.appendChild(b);
  });

  const stopRoving = rovingTabindex(root, '.slot');

  function refresh(): void {
    const km = ctx.keys();
    HOTBAR.forEach((entry, i) => {
      const b = slots[i]!;
      const pressed = state.slot === i;
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      b.classList.toggle('is-selected', pressed);
      const action = SLOT_KEYS[i]!;
      const kn = keyName(km[action]);
      setText(keys[i]!, kn);
      b.setAttribute('aria-keyshortcuts', kn);
      if (entry === 'bond-wand') b.setAttribute('aria-label', STRINGS.bondWand);
      else if (entry === 'charge-tool') b.setAttribute('aria-label', STRINGS.chargeTool);
      else if (entry === 'select-tool') b.setAttribute('aria-label', STRINGS.selectTool);
      else {
        const el = entry as BlockElement;
        const n = el === 'H' ? null : state.inventory[el];
        const count = n === null || n === undefined ? null : Number.isFinite(n) ? n : null;
        setText(counts[i]!, count === null ? '∞' : String(count));
        b.setAttribute('aria-label', STRINGS.slotLabel(el, count, i + 1));
        const empty = count === 0;
        if (empty) b.dataset['empty'] = 'true';
        else delete b.dataset['empty'];
      }
    });
  }

  refresh();

  return {
    el: root,
    refresh,
    dispose() {
      stopRoving();
    },
  };
}
