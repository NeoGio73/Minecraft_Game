/**
 * Challenge panel: roster grouped by chapter, current challenge, submit,
 * feedback, progress and score. docs/design/07-ui.md §9 (and §11.3/§11.4 for
 * the selection line and the pKa readout of select-atom challenges). DOM module.
 */
import type { Challenge, SubmitResult } from '../content/types';
import { pointsForAttempt } from '../content/types';
import { isAttemptLimited, maxAttemptsOf } from '../content/challenges';
import { answerSet } from '../content/selectors';
import type { SelectionItem } from '../content/selectors';
import { parseEntry } from '../content/library';
import type { Analysis, MoleculeGraph } from '../chem/types';
import { Outcome } from '../lms/types';
import { STRINGS, atomLabel, keyName } from './strings';
import { clearChildren, h, setHidden, setText } from './hud';
import type { HudContext, Panel, UiEvents } from './hud';

export interface ChallengePanel extends Panel {
  onChallengeChanged(): void;
  onSubmitted(result: SubmitResult): void;
  onPassed(e: UiEvents['challenge:passed']): void;
  onScoreChanged(e: UiEvents['score:changed']): void;
  refreshSelection(): void;
  refreshShortcuts(): void;
  toggleHint(): void;
  openRoster(focus: boolean): void;
  closeRoster(): void;
  toggleRoster(): void;
  setCollapsed(collapsed: boolean): void;
  /** "H on O3" / "C2 (all 3 hydrogens)" / "C2, C3" / '' */
  selectionText(): string;
  /** The `.cp-status` word of the current challenge. */
  statusText(): string;
}

type StatusKey = 'notStarted' | 'attempted' | 'exhausted' | 'reduced' | 'solved';
type Tone = 'ok' | 'err' | 'warn' | 'info';

function toneOf(r: SubmitResult): { tone: Tone; glyph: string; prefix: string } {
  if (r.passed) return { tone: 'ok', glyph: STRINGS.feedbackGlyph.ok, prefix: STRINGS.feedbackPrefix.ok };
  if (r.kind === 'correct') return { tone: 'info', glyph: STRINGS.feedbackGlyph.info, prefix: STRINGS.feedbackPrefix.info };
  if (r.kind === 'correct-reduced') return { tone: 'ok', glyph: STRINGS.feedbackGlyph.ok, prefix: STRINGS.feedbackPrefix.reduced };
  if (r.kind === 'attempts-exhausted') return { tone: 'warn', glyph: STRINGS.feedbackGlyph.warn, prefix: STRINGS.feedbackPrefix.warn };
  if (r.kind === 'nothing-targeted' || r.kind === 'no-hydrogens') return { tone: 'info', glyph: STRINGS.feedbackGlyph.info, prefix: STRINGS.feedbackPrefix.first };
  return { tone: 'err', glyph: STRINGS.feedbackGlyph.err, prefix: STRINGS.feedbackPrefix.err };
}

export function mountChallengePanel(root: HTMLElement, ctx: HudContext): ChallengePanel {
  const { state } = ctx;
  let collapsed = false;
  let hintShown = false;
  let rosterOpen = false;
  let passMarkSeen = state.score.raw >= state.rosterInfo.passMark;
  let lastFeedback: { prefix: string; message: string } | null = null;

  // --- header ----------------------------------------------------------------
  const title = h('h2', { id: 'cp-title' }, '');
  const rosterToggle = h('button', { type: 'button', id: 'cp-roster-toggle', 'aria-expanded': 'false', 'aria-controls': 'cp-roster' }, STRINGS.challenges) as HTMLButtonElement;
  const collapseBtn = h('button', { type: 'button', class: 'collapse', 'aria-expanded': 'true', 'aria-controls': 'cp-body' }, STRINGS.collapse) as HTMLButtonElement;
  const header = h('header', { class: 'panel-header' }, title, rosterToggle, collapseBtn);
  const body = h('div', { id: 'cp-body', class: 'panel-body' });
  root.append(header, body);
  collapseBtn.addEventListener('click', () => setCollapsed(!collapsed));

  // --- roster (built once; statuses refreshed) ---------------------------------
  const roster = h('nav', { id: 'cp-roster', 'aria-label': STRINGS.challengeList, hidden: true });
  const chapterDetails = new Map<number, HTMLDetailsElement>();
  const chapterSummary = new Map<number, HTMLElement>();
  const items: { button: HTMLButtonElement; glyph: HTMLElement; sr: HTMLElement; index: number }[] = [];
  const byChapter = new Map<number, { challenge: Challenge; index: number }[]>();
  state.roster.forEach((challenge, index) => {
    const list = byChapter.get(challenge.chapter) ?? [];
    list.push({ challenge, index });
    byChapter.set(challenge.chapter, list);
  });
  for (const ch of Array.from(byChapter.keys()).sort((a, b) => a - b)) {
    const summary = h('summary', null, '');
    const ol = h('ol', null);
    for (const { challenge, index } of byChapter.get(ch) ?? []) {
      const glyph = h('span', { class: 'st', 'aria-hidden': 'true' }, '');
      const sr = h('span', { class: 'sr-only' }, '');
      const btn = h('button', { type: 'button', 'data-index': index, 'data-key': challenge.id }, glyph, sr, ` ${challenge.section} ${challenge.title} `, h('span', { class: 'pts' }, STRINGS.points(challenge.points))) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        state.setChallenge(index);
        btn.focus();
      });
      items.push({ button: btn, glyph, sr, index });
      ol.appendChild(h('li', null, btn));
    }
    const details = h('details', { 'data-chapter': ch }, summary, ol) as HTMLDetailsElement;
    chapterDetails.set(ch, details);
    chapterSummary.set(ch, summary);
    roster.appendChild(details);
  }
  roster.addEventListener('keydown', (e: KeyboardEvent) => {
    const buttons = items.map((i) => i.button);
    const i = buttons.indexOf(e.target as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      closeRoster();
      rosterToggle.focus();
      return;
    }
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowDown') j = Math.min(buttons.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = buttons.length - 1;
    if (j < 0) return;
    e.preventDefault();
    const target = buttons[j]!;
    const det = target.closest('details') as HTMLDetailsElement | null;
    if (det && !det.open) det.open = true;
    target.focus();
  });
  rosterToggle.addEventListener('click', () => { if (rosterOpen) closeRoster(); else openRoster(true); });

  // --- current challenge ---------------------------------------------------------
  const meta = h('p', { class: 'cp-meta' });
  const status = h('span', { class: 'cp-status' });
  const name = h('h3', { class: 'cp-name' });
  const instruction = h('p', { class: 'cp-instruction' });
  const attempts = h('p', { class: 'cp-attempts' });
  const isomers = h('p', { class: 'cp-isomers' });
  const selection = h('p', { class: 'cp-selection' });
  const submit = h('button', { type: 'button', id: 'cp-submit' }, STRINGS.submitMolecule) as HTMLButtonElement;
  const benchBtn = h('button', { type: 'button', id: 'cp-bench', hidden: true }, STRINGS.openBench) as HTMLButtonElement;
  const answerBtn = h('button', { type: 'button', id: 'cp-answer', hidden: true, 'aria-haspopup': 'dialog' }, STRINGS.answer) as HTMLButtonElement;
  const hintBtn = h('button', { type: 'button', id: 'cp-hint', 'aria-expanded': 'false', 'aria-controls': 'cp-hint-text' }, STRINGS.hint) as HTMLButtonElement;
  const prevBtn = h('button', { type: 'button', id: 'cp-prev' }, STRINGS.previous) as HTMLButtonElement;
  const nextBtn = h('button', { type: 'button', id: 'cp-next' }, STRINGS.next) as HTMLButtonElement;
  const actions = h('div', { class: 'cp-actions' }, submit, benchBtn, answerBtn, hintBtn, prevBtn, nextBtn);
  const hintText = h('p', { id: 'cp-hint-text', hidden: true });
  const feedback = h('div', { class: 'cp-feedback', hidden: true });
  const current = h('section', { class: 'cp-current' }, meta, name, instruction, attempts, isomers, selection, actions, hintText, feedback);

  submit.addEventListener('click', () => { state.submit(); });
  benchBtn.addEventListener('click', () => ctx.openBench(benchBtn));
  answerBtn.addEventListener('click', () => ctx.openQuiz(answerBtn));
  hintBtn.addEventListener('click', () => toggleHint());
  prevBtn.addEventListener('click', () => state.prevChallenge());
  nextBtn.addEventListener('click', () => state.nextChallenge());

  // --- footer ------------------------------------------------------------------------
  const scoreLine = h('p', null);
  const progress = h('progress', { max: '100', value: '0' }) as HTMLProgressElement;
  const footer = h('footer', { class: 'cp-score' }, scoreLine, progress);

  body.append(roster, current, footer);

  // --- helpers -----------------------------------------------------------------------
  function statusKeyOf(c: Challenge): StatusKey {
    const o = state.outcomeOf(c.id);
    if (o === Outcome.SolvedFull) return 'solved';
    if (o === Outcome.SolvedReduced) return 'reduced';
    if (o === Outcome.Attempted) {
      return isAttemptLimited(c.rule) && state.attemptOf(c.id) >= maxAttemptsOf(c.rule) ? 'exhausted' : 'attempted';
    }
    return 'notStarted';
  }
  function earnedOf(c: Challenge): number {
    const o = state.outcomeOf(c.id);
    if (o === Outcome.SolvedFull) return c.points;
    if (o === Outcome.SolvedReduced) return pointsForAttempt(c.points, 2, false);
    return 0;
  }

  function setCollapsed(c: boolean): void {
    collapsed = c;
    root.dataset['collapsed'] = c ? 'true' : 'false';
    collapseBtn.setAttribute('aria-expanded', c ? 'false' : 'true');
    setText(collapseBtn, c ? STRINGS.expand : STRINGS.collapse);
    setHidden(body, c);
  }

  function openRoster(focus: boolean): void {
    rosterOpen = true;
    setHidden(roster, false);
    rosterToggle.setAttribute('aria-expanded', 'true');
    if (collapsed) setCollapsed(false);
    const cur = items.find((i) => i.index === state.current.index);
    const det = cur?.button.closest('details') as HTMLDetailsElement | null;
    if (det) det.open = true;
    if (focus) (cur?.button ?? items[0]?.button ?? rosterToggle).focus();
  }
  function closeRoster(): void {
    rosterOpen = false;
    setHidden(roster, true);
    rosterToggle.setAttribute('aria-expanded', 'false');
  }

  function toggleHint(): void {
    hintShown = !hintShown;
    setHidden(hintText, !hintShown);
    hintBtn.setAttribute('aria-expanded', hintShown ? 'true' : 'false');
    if (hintShown) state.announce(`${STRINGS.hintPrefix} ${state.current.challenge.hint}`, 'polite');
  }

  function refreshShortcuts(): void {
    const k = ctx.keys();
    rosterToggle.setAttribute('aria-keyshortcuts', keyName(k.roster));
    submit.setAttribute('aria-keyshortcuts', keyName(k.submit));
    hintBtn.setAttribute('aria-keyshortcuts', keyName(k.hint));
    prevBtn.setAttribute('aria-keyshortcuts', keyName(k.prevChallenge));
    nextBtn.setAttribute('aria-keyshortcuts', keyName(k.nextChallenge));
    benchBtn.setAttribute('aria-keyshortcuts', keyName(k.bench));
  }

  function selectionText(): string {
    const rule = state.current.challenge.rule;
    if (rule.type !== 'select-atom' || state.selection.length === 0) return '';
    const byAtom = new Map<string, { item: SelectionItem; hSlots: Set<number>; heavy: boolean }>();
    for (const it of state.selection) {
      const key = `${it.molecule}:${it.atom}`;
      const e = byAtom.get(key) ?? { item: it, hSlots: new Set<number>(), heavy: false };
      if (it.hSlot === undefined) e.heavy = true;
      else e.hSlots.add(it.hSlot);
      byAtom.set(key, e);
    }
    const parts: string[] = [];
    for (const e of byAtom.values()) {
      const lp = state.locked.find((l) => l.molecule === e.item.molecule);
      const info = lp?.analysis.atoms[e.item.atom];
      const label = info ? atomLabel(info.el, e.item.atom) : `#${e.item.atom + 1}`;
      const total = lp?.analysis.hydrogens[e.item.atom] ?? 0;
      if (rule.target === 'hydrogens') {
        if (e.heavy || (total > 1 && e.hSlots.size === total)) parts.push(STRINGS.selectedAllH(label, total));
        else if (e.hSlots.size > 1) parts.push(`${e.hSlots.size} ${STRINGS.selectedH(label)}`);
        else parts.push(STRINGS.selectedH(label));
      } else {
        parts.push(label);
      }
    }
    return parts.join(', ');
  }

  function refreshSelection(): void {
    const rule = state.current.challenge.rule;
    if (rule.type !== 'select-atom') {
      setHidden(selection, true);
      return;
    }
    setHidden(selection, false);
    const t = selectionText();
    setText(selection, t ? STRINGS.selection(t) : STRINGS.nothingSelected);
  }

  function siteOf(item: SelectionItem): { label: string; pKa: number; verified: boolean; source: string } | null {
    const lp = state.locked.find((l) => l.molecule === item.molecule);
    if (!lp) return null;
    const ac = lp.analysis.acidity;
    if (item.hSlot !== undefined) {
      const s = ac.hydrogens.find((x) => x.parentId === item.atom && x.slot === item.hSlot);
      return s ? { label: s.label, pKa: s.pKa, verified: s.verified, source: s.verified ? s.source : STRINGS.notInMcMurrySource } : null;
    }
    const b = ac.basicSites.find((x) => x.atomId === item.atom);
    return b ? { label: b.label, pKa: b.pKaH, verified: b.verified, source: b.verified ? b.source : STRINGS.notInMcMurrySource } : null;
  }

  function pkaLines(result: SubmitResult): string[] {
    const rule = state.current.challenge.rule;
    if (rule.type !== 'select-atom') return [];
    const k = rule.selector.kind;
    if (k !== 'most-acidic-h' && k !== 'most-basic-site' && k !== 'most-basic-n') return [];
    const out: string[] = [];
    const picked = state.selection[0];
    const ps = picked ? siteOf(picked) : null;
    if (ps) out.push(STRINGS.pickedSite(ps.label, ps.pKa, ps.verified, ps.source));
    if (result.passed || result.kind === 'attempts-exhausted') {
      try {
        const graphs: MoleculeGraph[] = rule.molecules.map((s) => parseEntry(s));
        const analyses: Analysis[] = rule.molecules.map((_, i) => state.locked.find((l) => l.molecule === i)?.analysis).filter((a): a is Analysis => a !== undefined);
        if (analyses.length === graphs.length) {
          const ans = answerSet(rule.selector, graphs, analyses)[0];
          const as = ans ? siteOf(ans) : null;
          if (as) out.push(STRINGS.answerSite(as.label, as.pKa, as.verified, as.source));
        }
      } catch {
        // a malformed rule SMILES cannot reach a shipped roster (validated); no readout then
      }
    }
    return out;
  }

  function renderFeedback(result: SubmitResult): void {
    const { tone, glyph, prefix } = toneOf(result);
    let message = result.message;
    if (result.passed && result.pointsEarned === 0) message += STRINGS.alreadySolvedSuffix;
    const extra = pkaLines(result);
    clearChildren(feedback);
    feedback.dataset['tone'] = tone;
    feedback.append(h('span', { class: 'glyph', 'aria-hidden': 'true' }, glyph), ' ', h('b', null, prefix), ` ${message}`);
    for (const line of extra) feedback.append(h('p', { class: 'cp-site' }, line));
    if (result.kind === 'extra-molecule') {
      const clear = h('button', { type: 'button', class: 'cp-clear' }, STRINGS.clearPad);
      clear.addEventListener('click', () => {
        void ctx.dialogs.confirm(STRINGS.confirmClearPad, STRINGS.clearPad).then((ok) => { if (ok) state.clearPad(); });
      });
      feedback.append(' ', clear);
    }
    setHidden(feedback, false);
    lastFeedback = { prefix, message };
    ctx.announceSticky([`${prefix} ${message}`, ...extra].join(' '));
  }

  function refreshRoster(): void {
    for (const [ch, summary] of chapterSummary) {
      const list = byChapter.get(ch) ?? [];
      let solved = 0;
      let earned = 0;
      let points = 0;
      for (const { challenge } of list) {
        points += challenge.points;
        const o = state.outcomeOf(challenge.id);
        if (o >= Outcome.SolvedReduced) solved++;
        earned += earnedOf(challenge);
      }
      setText(summary, STRINGS.chapterHeading(ch, solved, list.length, earned, points));
    }
    for (const it of items) {
      const c = state.roster[it.index];
      if (!c) continue;
      const key = statusKeyOf(c);
      setText(it.glyph, STRINGS.statusGlyph[key]);
      setText(it.sr, STRINGS.statusSr[key]);
      it.button.dataset['status'] = key;
      if (it.index === state.current.index) it.button.setAttribute('aria-current', 'true');
      else it.button.removeAttribute('aria-current');
    }
  }

  function refreshFooter(): void {
    const s = state.score;
    const pass = state.rosterInfo.passMark;
    setText(scoreLine, STRINGS.scoreLine(s.earned, s.total, s.raw, s.solvedCount, s.enabledCount, pass));
    progress.value = s.raw;
    progress.setAttribute('aria-label', STRINGS.scoreProgressLabel(s.raw, pass));
  }

  function refresh(): void {
    const cur = state.current;
    const c = cur.challenge;
    setText(title, STRINGS.challengeN(cur.index + 1, state.roster.length));
    refreshRoster();
    const key = statusKeyOf(c);
    clearChildren(meta);
    meta.append(STRINGS.meta(c.chapter, c.section, c.difficulty, c.points), ' · ', status);
    setText(status, STRINGS.status[key]);
    status.dataset['status'] = key;
    setText(name, c.title);
    setText(instruction, c.instruction);
    setText(hintText, c.hint);
    const rule = c.rule;
    const limited = isAttemptLimited(rule);
    setHidden(attempts, !limited);
    if (limited) {
      const max = maxAttemptsOf(rule);
      setText(attempts, STRINGS.attemptsLeft(max - state.attemptOf(c.id), max));
    }
    if (rule.type === 'isomer-set') {
      setHidden(isomers, false);
      setText(isomers, STRINGS.isomersDone(state.isomersDone(c.id), rule.count));
    } else {
      setHidden(isomers, true);
    }
    refreshSelection();
    const isBuild = rule.type === 'exact-molecule' || rule.type === 'formula-and-groups' || rule.type === 'isomer-set' || rule.type === 'name-to-structure' || rule.type === 'stereo-exact';
    setHidden(submit, !(isBuild || rule.type === 'select-atom' || rule.type === 'predict-product'));
    setText(submit, rule.type === 'select-atom' ? STRINGS.submitSelection : rule.type === 'predict-product' ? STRINGS.submitProduct : STRINGS.submitMolecule);
    setHidden(answerBtn, rule.type !== 'quiz');
    setHidden(benchBtn, !(rule.type === 'predict-product' || rule.type === 'choose-reagent'));
    submit.disabled = state.finished;
    answerBtn.disabled = state.finished;
    refreshShortcuts();
    refreshFooter();
  }

  function onChallengeChanged(): void {
    hintShown = false;
    setHidden(hintText, true);
    hintBtn.setAttribute('aria-expanded', 'false');
    clearChildren(feedback);
    setHidden(feedback, true);
    lastFeedback = null;
    const cur = state.current.challenge;
    for (const [ch, det] of chapterDetails) det.open = ch === cur.chapter;
    refresh();
  }

  refresh();
  setHidden(feedback, true);

  return {
    el: root,
    refresh,
    onChallengeChanged,
    onSubmitted(result) {
      renderFeedback(result);
      refresh();
      if (result.progress) {
        setHidden(isomers, false);
        setText(isomers, STRINGS.isomersDone(result.progress.done, result.progress.total));
      }
    },
    onPassed() {
      refreshRoster();
    },
    onScoreChanged(e) {
      refreshFooter();
      const pass = state.rosterInfo.passMark;
      if (!passMarkSeen && e.raw >= pass) {
        passMarkSeen = true;
        state.announce(STRINGS.passMarkReached(pass), 'assertive');
      }
    },
    refreshSelection,
    refreshShortcuts,
    toggleHint,
    openRoster,
    closeRoster,
    toggleRoster() {
      if (rosterOpen) closeRoster();
      else openRoster(true);
    },
    setCollapsed,
    selectionText,
    statusText: () => STRINGS.status[statusKeyOf(state.current.challenge)] + (lastFeedback ? `. ${lastFeedback.prefix} ${lastFeedback.message}` : ''),
    dispose() {
      // listeners live on children of root
    },
  };
}

