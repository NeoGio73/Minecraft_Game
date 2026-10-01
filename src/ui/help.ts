/**
 * Help overlay: controls table (from the effective keys), looking, building,
 * the chair-hexagon ring diagram, stereochemistry, bench, element legend,
 * scoring. docs/design/07-ui.md §14, 09-amendment-no-bond.md §5.7. DOM module.
 */
import { TARGET_VALENCE } from '../chem/types';
import { BLOCK_ELEMENTS, CPK_HEX } from '../world/types';
import { KEY_ACTIONS } from '../input/keymap';
import { ELEMENT_NAME, KEY_ACTION_LABEL, STRINGS, keyName } from './strings';
import { clearChildren, h, setText } from './hud';
import type { Dialog, HudContext } from './hud';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Oblique projection of the unit cube with the chair hexagon (0,0,0)-(1,0,0)-(1,1,0)-(1,1,1)-(0,1,1)-(0,0,1) in bold. */
function ringDiagram(label: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 170');
  svg.setAttribute('width', '200');
  svg.setAttribute('height', '170');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('class', 'ring-diagram');
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = label;
  svg.appendChild(title);
  const P = (x: number, y: number, z: number): [number, number] => [30 + x * 100 + z * 45, 140 - y * 100 + z * -35];
  const corners: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const line = (a: [number, number, number], b: [number, number, number], cls: string): void => {
    const l = document.createElementNS(SVG_NS, 'line');
    const [x1, y1] = P(a[0], a[1], a[2]);
    const [x2, y2] = P(b[0], b[1], b[2]);
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
    l.setAttribute('class', cls);
    svg.appendChild(l);
  };
  for (const [i, j] of edges) line(corners[i]!, corners[j]!, 'cube-edge');
  const chair: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1], [0, 0, 1]];
  for (let k = 0; k < chair.length; k++) line(chair[k]!, chair[(k + 1) % chair.length]!, 'ring-edge');
  chair.forEach((c, k) => {
    const [cx, cy] = P(c[0], c[1], c[2]);
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', '7');
    circle.setAttribute('class', 'ring-atom');
    svg.appendChild(circle);
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(cx));
    t.setAttribute('y', String(cy + 3));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'ring-label');
    t.textContent = String(k + 1);
    svg.appendChild(t);
  });
  return svg;
}

export function mountHelp(root: HTMLElement, ctx: HudContext): Dialog {
  const { state } = ctx;
  let isOpen = false;
  const H = STRINGS.help;

  const closeBtn = h('button', { type: 'button', id: 'help-close' }, STRINGS.close) as HTMLButtonElement;
  const controlsBody = h('tbody', null);
  const controlsTable = h('table', { class: 'help-controls' },
    h('thead', null, h('tr', null, ...H.controlColumns.map((c) => h('th', { scope: 'col' }, c)))), controlsBody);
  const scoring = h('p', null);
  const legendBody = h('tbody', null);
  const bonds = (el: string): string => H.bonds(TARGET_VALENCE[el as keyof typeof TARGET_VALENCE]?.[0] ?? 0);
  for (const el of BLOCK_ELEMENTS) {
    const swatch = h('span', { class: 'swatch', 'aria-hidden': 'true' });
    swatch.style.background = `#${CPK_HEX[el].toString(16).padStart(6, '0')}`;
    legendBody.appendChild(h('tr', null,
      h('td', null, el), h('td', null, ELEMENT_NAME[el]), h('td', null, swatch), h('td', null, bonds(el)), h('td', null, H.ore(el))));
  }
  const legendTable = h('table', { class: 'help-legend' },
    h('thead', null, h('tr', null, ...H.legendColumns.map((c) => h('th', { scope: 'col' }, c)))), legendBody);

  const el = h('div', { id: 'help', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title', hidden: true, tabindex: '-1' },
    h('header', { class: 'dialog-header' }, h('h2', { id: 'help-title' }, H.title), closeBtn),
    h('section', null, h('h3', null, H.controls), h('p', null, H.exitKeys), controlsTable),
    h('section', null, h('h3', null, H.looking), h('p', null, H.lookingBody)),
    h('section', null, h('h3', null, H.building), h('p', null, H.buildingBody)),
    h('section', null, h('h3', null, H.rings), ringDiagram(H.ringsSvgLabel), h('p', null, H.ringsBody)),
    h('section', null, h('h3', null, H.stereo), h('p', null, H.stereoBody)),
    h('section', null, h('h3', null, H.bench), h('p', null, H.benchBody)),
    h('section', null, h('h3', null, H.legend), legendTable),
    h('section', null, h('h3', null, H.scoring), scoring),
  );
  root.appendChild(el);

  function refresh(): void {
    const keys = ctx.keys();
    clearChildren(controlsBody);
    for (const action of KEY_ACTIONS) {
      controlsBody.appendChild(h('tr', null, h('td', null, KEY_ACTION_LABEL[action]), h('td', null, h('kbd', null, keyName(keys[action])))));
    }
    for (const [label, key] of H.mouseRows) controlsBody.appendChild(h('tr', null, h('td', null, label), h('td', null, key)));
    for (const [label, key] of H.fixedRows) controlsBody.appendChild(h('tr', null, h('td', null, label), h('td', null, h('kbd', null, key))));
    setText(scoring, state.mode === 'lms' ? H.scoringLms : H.scoringLocal);
  }

  function open(opener?: HTMLElement | null): void {
    if (isOpen) return;
    isOpen = true;
    refresh();
    ctx.dialogs.push(el, opener ?? null);
    closeBtn.focus();
  }
  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    ctx.dialogs.pop(el);
  }
  closeBtn.addEventListener('click', () => close());
  const onKey = (e: KeyboardEvent): void => {
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
    dispose() {
      el.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
