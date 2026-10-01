/**
 * Molecule panel: the Analysis view (name, formula, facts, no-bond pairs,
 * functional groups with highlight buttons, stereo, acidity, per-atom table,
 * warnings). docs/design/07-ui.md §8, 09-amendment-no-bond.md §5.6. DOM module.
 */
import type { Analysis, BondLabel, CenterLabel, HydrogenSite } from '../chem/types';
import { splitPairKey } from '../world/types';
import type { CellKey } from '../world/types';
import { ELEMENT_NAME, HYBRIDIZATION_WORD, STRINGS, atomLabel, signed, warningText } from './strings';
import { clearChildren, formulaNode, h, setHidden, setText } from './hud';
import type { HudContext, Panel } from './hud';

export interface MoleculePanel extends Panel {
  /** Plain-text copy of the rendered panel for the scene mirror (§16.3); '' when nothing is targeted. */
  plainText(): string;
  setCollapsed(collapsed: boolean): void;
  /** The targeted component changed: clear the group highlight and the warning memory. */
  onComponentChanged(): void;
}

function haloCountOf(a: Analysis): number {
  const c = a.counts;
  return (c.F ?? 0) + (c.Cl ?? 0) + (c.Br ?? 0) + (c.I ?? 0);
}

export function mountMoleculePanel(root: HTMLElement, ctx: HudContext): MoleculePanel {
  const { state, hooks } = ctx;
  let lines: string[] = [];
  let pressedGroup: number | null = null;
  let prevWarnings = new Set<string>();
  let collapsed = false;

  // --- skeleton ---------------------------------------------------------------
  const title = h('h2', { id: 'mp-title' }, STRINGS.panelTitle);
  const collapseBtn = h('button', { type: 'button', class: 'collapse', 'aria-expanded': 'true', 'aria-controls': 'mp-body' }, STRINGS.collapse) as HTMLButtonElement;
  const header = h('header', { class: 'panel-header' }, title, collapseBtn);
  const body = h('div', { id: 'mp-body', class: 'panel-body' });
  root.append(header, body);
  collapseBtn.addEventListener('click', () => setCollapsed(!collapsed));

  const empty = h('p', { class: 'mp-empty' }, STRINGS.noTarget);
  const name = h('p', { class: 'mp-name' }, '');
  const facts = h('dl', { class: 'mp-facts' });
  const ddFormula = h('dd', null);
  const ddCharge = h('dd', null);
  const ddDou = h('dd', null);
  const ddSize = h('dd', null);
  const dtNoBond = h('dt', null, STRINGS.noBondRow);
  const ddNoBond = h('dd', { class: 'mp-nobond' });
  facts.append(
    h('dt', null, STRINGS.formula), ddFormula,
    h('dt', null, STRINGS.netCharge), ddCharge,
    h('dt', null, STRINGS.dou), ddDou,
    h('dt', null, STRINGS.size), ddSize,
    dtNoBond, ddNoBond,
  );
  const groupsList = h('ul', null);
  const groupsNone = h('p', { class: 'mp-none' }, STRINGS.noGroups);
  const groups = h('section', { class: 'mp-groups' }, h('h3', null, STRINGS.groups), groupsList, groupsNone);
  const chiral = h('p', { class: 'mp-chiral' });
  const centers = h('ul', { class: 'mp-centers' });
  const dbl = h('ul', { class: 'mp-dbl' });
  const rings = h('ul', { class: 'mp-rings' });
  const stereoNone = h('p', { class: 'mp-none' }, STRINGS.noStereo);
  const stereo = h('section', { class: 'mp-stereo' }, h('h3', null, STRINGS.stereo), chiral, centers, dbl, rings, stereoNone);
  const mostAcidic = h('p', { class: 'mp-most-acidic' });
  const mostBasic = h('p', { class: 'mp-most-basic' });
  const acidTable = h('table', null);
  const acidDetails = h('details', null, h('summary', null, STRINGS.allHydrogens), acidTable);
  const acidity = h('section', { class: 'mp-acidity' }, h('h3', null, STRINGS.acidity), mostAcidic, mostBasic, acidDetails);
  const targetedAtom = h('p', { class: 'mp-targeted-atom' });
  const atomTbody = h('tbody', null);
  const atomTable = h('table', null,
    h('caption', null, STRINGS.angleCaption),
    h('thead', null, h('tr', null, ...STRINGS.atomColumns.map((c) => h('th', { scope: 'col' }, c)))),
    atomTbody,
  );
  const atoms = h('section', { class: 'mp-atoms' }, h('h3', null, STRINGS.atoms), targetedAtom, h('details', null, h('summary', null, STRINGS.perAtomTable), atomTable));
  const warnList = h('ul', null);
  const warnings = h('section', { class: 'mp-warnings' }, h('h3', null, STRINGS.warnings), warnList);
  body.append(empty, name, facts, groups, stereo, acidity, atoms, warnings);

  const content = [name, facts, groups, stereo, acidity, atoms, warnings];

  function setCollapsed(c: boolean): void {
    collapsed = c;
    root.dataset['collapsed'] = c ? 'true' : 'false';
    collapseBtn.setAttribute('aria-expanded', c ? 'false' : 'true');
    setText(collapseBtn, c ? STRINGS.expand : STRINGS.collapse);
    setHidden(body, c);
  }

  function centerText(label: CenterLabel): string {
    return STRINGS.centerLabel[label];
  }
  function bondText(label: BondLabel): string {
    return STRINGS.bondLabel[label];
  }

  function hideCharges(): boolean {
    const rule = state.current.challenge.rule;
    if (rule.type !== 'quiz' || !rule.display) return false;
    const hc = (rule.display as { hideCharges?: boolean }).hideCharges === true;
    if (!hc) return false;
    const comp = state.target.component;
    return state.padComponents.some((c) => c.id === comp && c.locked);
  }

  function refresh(): void {
    const a = state.target.analysis;
    lines = [];
    const locked = state.padComponents.some((c) => c.id === state.target.component && c.locked);
    setText(title, locked ? STRINGS.panelTitleLocked : STRINGS.panelTitle);
    if (!a) {
      setHidden(empty, false);
      for (const el of content) setHidden(el, true);
      if (pressedGroup !== null) {
        pressedGroup = null;
        hooks.setGroupHighlight(null);
      }
      return;
    }
    setHidden(empty, true);
    for (const el of content) setHidden(el, false);

    // 2. name and formula
    const nm = a.name ?? STRINGS.unnamed;
    setText(name, nm);
    lines.push(nm);
    clearChildren(ddFormula);
    ddFormula.appendChild(formulaNode(a.formula));
    lines.push(`${STRINGS.formula} ${a.formula}`);

    // 3. facts
    const chargesHidden = hideCharges();
    setText(ddCharge, chargesHidden ? STRINGS.hidden : signed(a.netCharge));
    lines.push(`${STRINGS.netCharge} ${chargesHidden ? STRINGS.hidden : signed(a.netCharge)}`);
    const c = a.counts.C ?? 0;
    const n = a.counts.N ?? 0;
    const hCount = a.hydrogens.reduce((s, x) => s + x, 0);
    const douText = STRINGS.douText(a.dou, c, n, hCount, haloCountOf(a));
    setText(ddDou, douText);
    lines.push(`${STRINGS.dou} ${douText}`);
    const sizeText = STRINGS.sizeText(a.atoms.length, hCount, a.ringCount, a.components);
    setText(ddSize, sizeText);
    lines.push(`${STRINGS.size} ${sizeText}`);
    const sup = state.target.suppressed;
    if (sup.length > 0) {
      const pairs = sup.map((p) => {
        const [x, y] = splitPairKey(p);
        return `${ctx.labelOfCell(x)}–${ctx.labelOfCell(y)}`;
      }).join(', ');
      const t = `${STRINGS.noBondPairs(sup.length)}: ${pairs}`;
      setText(ddNoBond, t);
      setHidden(dtNoBond, false);
      setHidden(ddNoBond, false);
      lines.push(`${STRINGS.noBondRow} ${t}`);
    } else {
      setHidden(dtNoBond, true);
      setHidden(ddNoBond, true);
    }

    // 4. groups
    clearChildren(groupsList);
    if (a.groups.length === 0) {
      setHidden(groupsNone, false);
      setText(groupsNone, STRINGS.noGroups);
      lines.push(`${STRINGS.groups}: ${STRINGS.noGroups.toLowerCase()}`);
      if (pressedGroup !== null) { pressedGroup = null; hooks.setGroupHighlight(null); }
    } else {
      setHidden(groupsNone, true);
      if (pressedGroup !== null && pressedGroup >= a.groups.length) { pressedGroup = null; hooks.setGroupHighlight(null); }
      a.groups.forEach((hit, i) => {
        const atomsText = hit.atoms.map((id) => ctx.labelOfTargetAtom(id)).join(', ');
        const btn = h('button', { type: 'button', 'aria-pressed': pressedGroup === i ? 'true' : 'false', 'aria-label': STRINGS.highlightLabel(hit.label, atomsText) }, STRINGS.highlight);
        btn.addEventListener('click', () => {
          if (pressedGroup === i) {
            pressedGroup = null;
            hooks.setGroupHighlight(null);
          } else {
            pressedGroup = i;
            const cells: CellKey[] = [];
            for (const id of hit.atoms) {
              const cell = state.target.atomToCell[id];
              if (cell) cells.push(cell);
            }
            hooks.setGroupHighlight(cells);
          }
          for (const b of Array.from(groupsList.querySelectorAll('button'))) b.setAttribute('aria-pressed', 'false');
          btn.setAttribute('aria-pressed', pressedGroup === i ? 'true' : 'false');
        });
        groupsList.appendChild(h('li', null, h('span', null, hit.label), ' ', btn));
        lines.push(`${hit.label} (${atomsText})`);
      });
    }

    // 5. stereo
    clearChildren(centers);
    clearChildren(dbl);
    clearChildren(rings);
    if (a.stereo) {
      const st = a.stereo;
      const nCenters = st.centers.filter((x) => x.label !== 'NOT_CENTER').length;
      const line = STRINGS.chiralLine(st.chiral, st.meso, nCenters);
      setText(chiral, line);
      setHidden(chiral, false);
      lines.push(line);
      let shown = 0;
      for (const cen of st.centers) {
        if (cen.label === 'NOT_CENTER') continue;
        const label = ctx.labelOfTargetAtom(cen.atom);
        let text = `${label}: ${centerText(cen.label)}`;
        const li = h('li', null, `${label}: `, h('b', null, centerText(cen.label)));
        if ((cen.label === 'R' || cen.label === 'S') && cen.priorities) {
          const pr = cen.priorities.map((p) => (p === 'H' ? 'H' : ctx.labelOfTargetAtom(p))).join(' > ');
          li.append(` — ${STRINGS.priorities} ${pr}`);
          text += ` — ${STRINGS.priorities} ${pr}`;
        } else if ((cen.label === 'UNSPECIFIED' || cen.label === 'CANNOT_ASSIGN') && cen.hint) {
          li.append(h('br'), h('span', { class: 'hint' }, cen.hint));
          text += `. ${cen.hint}`;
        }
        centers.appendChild(li);
        lines.push(text);
        shown++;
      }
      for (const d of st.doubleBonds) {
        const la = ctx.labelOfTargetAtom(d.a);
        const lb = ctx.labelOfTargetAtom(d.b);
        let lab = bondText(d.label);
        if ((d.label === 'E' || d.label === 'Z') && d.cisTrans) lab += ` (${STRINGS.cisTrans[d.cisTrans]})`;
        const li = h('li', null, `${la}=${lb}: `, h('b', null, lab));
        let text = `${la}=${lb}: ${lab}`;
        if ((d.label === 'COLLINEAR' || d.label === 'NOT_PLANAR' || d.label === 'TWISTED') && d.hint) {
          li.append(' ', h('span', { class: 'hint' }, d.hint));
          text += `. ${d.hint}`;
        }
        dbl.appendChild(li);
        lines.push(text);
        shown++;
      }
      st.ringFaces.forEach((rf, k) => {
        const subs = rf.subs.filter((s) => s.face !== 0);
        if (subs.length < 2) return;
        const first = subs[0]!;
        const second = subs[1]!;
        const text = STRINGS.ringFaces(k + 1, ctx.labelOfTargetAtom(first.ringAtom), ctx.labelOfTargetAtom(second.ringAtom), first.face === second.face);
        rings.appendChild(h('li', null, text));
        lines.push(text);
        shown++;
      });
      setHidden(stereoNone, shown > 0);
      if (shown === 0) lines.push(STRINGS.noStereo);
    } else {
      setHidden(chiral, true);
      setHidden(stereoNone, false);
      lines.push(STRINGS.noStereo);
    }

    // 6. acidity
    const ac = a.acidity;
    if (ac.hydrogens.length === 0) {
      setText(mostAcidic, STRINGS.noHydrogensInMolecule);
      lines.push(STRINGS.noHydrogensInMolecule);
    } else {
      const s = ac.mostAcidic[0];
      if (s) {
        const t = STRINGS.mostAcidic(s.label, s.pKa, s.verified, s.source, ctx.labelOfTargetAtom(s.parentId));
        setText(mostAcidic, t);
        lines.push(t);
      } else {
        setText(mostAcidic, '');
      }
    }
    const b0 = ac.mostBasic[0];
    if (b0) {
      const t = STRINGS.mostBasic(ctx.labelOfTargetAtom(b0.atomId), b0.label, b0.pKaH, b0.verified);
      setText(mostBasic, t);
      setHidden(mostBasic, false);
      lines.push(t);
    } else {
      setHidden(mostBasic, true);
    }
    clearChildren(acidTable);
    setHidden(acidDetails, ac.hydrogens.length === 0);
    if (ac.hydrogens.length > 0) {
      acidTable.appendChild(h('thead', null, h('tr', null, ...STRINGS.acidityColumns.map((col) => h('th', { scope: 'col' }, col)))));
      const tbody = h('tbody', null);
      const seen = new Map<string, { site: HydrogenSite; count: number }>();
      for (const site of ac.hydrogens) {
        const key = `${site.parentId}|${site.classKey}`;
        const e = seen.get(key);
        if (e) e.count++;
        else seen.set(key, { site, count: 1 });
      }
      for (const { site, count } of seen.values()) {
        tbody.appendChild(h('tr', null,
          h('td', null, ctx.labelOfTargetAtom(site.parentId)),
          h('td', null, String(count)),
          h('td', null, site.label),
          h('td', null, `${site.verified ? '' : '≈'}${site.pKa}`),
          h('td', null, site.verified ? site.source : STRINGS.notInMcMurrySource),
        ));
      }
      acidTable.appendChild(tbody);
    }

    // 7. atoms
    const tCell = state.target.cell;
    const tId = tCell ? state.target.cellToAtom.get(tCell) : undefined;
    const tInfo = tId !== undefined ? a.atoms[tId] : undefined;
    if (tInfo && tId !== undefined) {
      const t = STRINGS.targetedAtom(ctx.labelOfTargetAtom(tId), HYBRIDIZATION_WORD[tInfo.hybridization], tInfo.geometry, tInfo.idealAngle);
      setText(targetedAtom, t);
      setHidden(targetedAtom, false);
      lines.push(t);
    } else {
      setHidden(targetedAtom, true);
    }
    clearChildren(atomTbody);
    a.atoms.forEach((info, id) => {
      const isT = id === tId;
      const tr = h('tr', { 'data-atom': id + 1, class: isT ? 'is-targeted' : null, 'aria-current': isT ? 'true' : null },
        h('td', null, String(id + 1)),
        h('td', null, ELEMENT_NAME[info.el]),
        h('td', null, String(info.heavyBondOrderSum)),
        h('td', null, String(info.hydrogens)),
        h('td', null, String(info.lonePairs)),
        h('td', null, chargesHidden ? STRINGS.hidden : signed(info.charge)),
        h('td', null, HYBRIDIZATION_WORD[info.hybridization]),
        h('td', null, info.geometry),
        h('td', null, info.idealAngle === null ? '—' : `${info.idealAngle}°`),
        h('td', null, info.observedAngleNote ?? ''),
      );
      atomTbody.appendChild(tr);
      lines.push(`${atomLabel(info.el, id)}: ${info.heavyBondOrderSum} bond${info.heavyBondOrderSum === 1 ? '' : 's'}, ${info.hydrogens} H, ${HYBRIDIZATION_WORD[info.hybridization]}, ${info.geometry}`);
    });

    // 8. warnings
    clearChildren(warnList);
    const texts = a.warnings.map((w) => warningText(w, a));
    if (texts.length === 0) {
      warnList.appendChild(h('li', { class: 'none' }, STRINGS.noWarnings));
      lines.push(STRINGS.noWarnings);
    } else {
      for (const t of texts) {
        warnList.appendChild(h('li', { class: 'warn' }, h('span', { class: 'glyph', 'aria-hidden': 'true' }, '⚠'), ` ${STRINGS.warningPrefix} ${t}`));
        lines.push(`${STRINGS.warningPrefix} ${t}`);
        if (!prevWarnings.has(t)) state.announce(`${STRINGS.warningPrefix} ${t}`, 'polite');
      }
    }
    prevWarnings = new Set(texts);
  }

  refresh();

  return {
    el: root,
    refresh,
    plainText: () => lines.join(' | '),
    setCollapsed,
    onComponentChanged() {
      prevWarnings = new Set();
      if (pressedGroup !== null) {
        pressedGroup = null;
        hooks.setGroupHighlight(null);
      }
    },
    dispose() {
      // listeners are on child elements removed with the root
    },
  };
}
