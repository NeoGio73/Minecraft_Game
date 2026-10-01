/**
 * Reaction bench panel: reagent cards, equivalents, React, preview state,
 * warnings, product-free results in predict mode. docs/design/07-ui.md §12,
 * 04-reaction-bench.md §8.3, 09-amendment-no-bond.md §3.2. DOM module.
 */
import type { Analysis, MoleculeGraph, ReactionResult } from '../chem/types';
import { analyze } from '../chem/analyze';
import type { ReagentCard, ReagentId, SubmitResult } from '../content/types';
import { cardById, enabledReagents } from '../content/reagents';
import { loadConfig } from '../content/challenges';
import { loadLibrary, parseEntry } from '../content/library';
import type { MoleculeEntry } from '../content/types';
import { Outcome } from '../lms/types';
import { BENCH, CHAPTER_TITLES, REACTION_STEREO_TEXT, STRINGS, keyName } from './strings';
import type { Chapter } from '../content/types';
import { clearChildren, focusables, formulaNode, h, rovingTabindex, setHidden, setText } from './hud';
import type { HudContext, Panel, UiEvents } from './hud';

export interface BenchPanel extends Panel {
  open(opener?: HTMLElement | null): void;
  close(): void;
  toggle(opener?: HTMLElement | null): void;
  readonly isOpen: boolean;
  onChallengeChanged(): void;
  onReacted(e: UiEvents['bench:reacted']): void;
  onCleared(): void;
  onSubmitted(result: SubmitResult): void;
  /** One-line summary for the scene mirror (§16.3). */
  plainText(): string;
}

const analysisCache = new WeakMap<MoleculeGraph, Analysis>();
function analysisOf(g: MoleculeGraph): Analysis {
  let a = analysisCache.get(g);
  if (!a) {
    a = analyze(g);
    analysisCache.set(g, a);
  }
  return a;
}
function nameOrFormula(g: MoleculeGraph): string {
  const a = analysisOf(g);
  return a.name ?? a.formula;
}
function hasTripleCC(g: MoleculeGraph): boolean {
  return g.bonds.some((b) => b.order === 3 && g.atoms[b.a]?.el === 'C' && g.atoms[b.b]?.el === 'C');
}

let alkylHalideCache: MoleculeEntry[] | null = null;
/** Library entries whose groups include a methyl or primary alkyl halide (the free-play rx picker). */
function alkylHalides(): MoleculeEntry[] {
  if (alkylHalideCache) return alkylHalideCache;
  const out: MoleculeEntry[] = [];
  for (const e of loadLibrary().entries) {
    if (e.requiresDiagonalBonds) continue;
    try {
      const a = analyze(parseEntry(e));
      if (a.groups.some((g) => g.group === 'halide' && (g.subtype === 'methyl' || g.subtype === 'primary'))) out.push(e);
    } catch {
      // unparsable entry: the validator reports it; skip here
    }
  }
  alkylHalideCache = out;
  return out;
}

export function mountBenchPanel(root: HTMLElement, ctx: HudContext): BenchPanel {
  const { state } = ctx;
  let isOpen = false;
  let opener: HTMLElement | null = null;
  /** The molecule panel's Collapse state when the bench opened; restored on close (engineering review finding 15). */
  let moleculeWasCollapsed = false;
  let chosen: ReagentId | null = null;
  let correctCards: ReagentId[] = [];
  let rxOptionsBuilt = false;
  /** bench:cleared empties the result section until the next React (§12.4), whatever State keeps in bench.result. */
  let resultCleared = false;

  // --- DOM ----------------------------------------------------------------------
  const title = h('h2', { id: 'bp-title' }, STRINGS.bench);
  const modeEl = h('p', { class: 'bp-mode' });
  const closeBtn = h('button', { type: 'button', id: 'bp-close' }, STRINGS.close) as HTMLButtonElement;
  const header = h('header', { class: 'panel-header' }, title, modeEl, closeBtn);
  const reactantLine = h('p', { class: 'bp-reactant-name' });
  const rxLine = h('p', { class: 'bp-rx' });
  const reactantSec = h('section', { class: 'bp-reactant' }, h('h3', null, BENCH.reactantLocked), reactantLine, rxLine);
  const cardGroup = h('div', { role: 'radiogroup', 'aria-label': STRINGS.reagentCards });
  const cardsSec = h('section', { class: 'bp-cards' }, h('h3', null, STRINGS.reagentCards), cardGroup);
  const equiv1 = h('button', { type: 'button', role: 'radio', 'aria-checked': 'true', 'data-equiv': '1' }, BENCH.equiv(1)) as HTMLButtonElement;
  const equiv2 = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-equiv': '2' }, BENCH.equiv(2)) as HTMLButtonElement;
  const equivGroup = h('div', { role: 'radiogroup', 'aria-label': STRINGS.equivalents }, equiv1, equiv2);
  const equivSec = h('section', { class: 'bp-equiv' }, h('h3', null, STRINGS.equivalents), equivGroup);
  const rxSelect = h('select', { id: 'bp-rx-select' }) as HTMLSelectElement;
  const rxSec = h('section', { class: 'bp-rx-pick' }, h('label', { for: 'bp-rx-select' }, STRINGS.rxLabel), rxSelect);
  const reactBtn = h('button', { type: 'button', id: 'bp-react' }, BENCH.react) as HTMLButtonElement;
  const chooseBtn = h('button', { type: 'button', id: 'bp-choose' }, STRINGS.chooseReagent) as HTMLButtonElement;
  const submitBtn = h('button', { type: 'button', id: 'bp-submit' }, STRINGS.submitProduct) as HTMLButtonElement;
  const answerBtn = h('button', { type: 'button', id: 'bp-answer' }, BENCH.showAnswer) as HTMLButtonElement;
  const clearBtn = h('button', { type: 'button', id: 'bp-clear' }, BENCH.clearZone) as HTMLButtonElement;
  const actions = h('div', { class: 'bp-actions' }, reactBtn, chooseBtn, submitBtn, answerBtn, clearBtn);
  const mech = h('p', { class: 'bp-mech' });
  const just = h('p', { class: 'bp-just' });
  const warn = h('ul', { class: 'bp-warn' });
  const mix = h('p', { class: 'bp-mix' });
  const minor = h('div', { class: 'bp-minor' });
  const stereoLine = h('p', { class: 'bp-stereo' });
  const noReact = h('p', { class: 'bp-noreact' }, BENCH.noReaction);
  const oneReactant = h('p', { class: 'bp-one-reactant' }, BENCH.oneReactant);
  const resultSec = h('section', { class: 'bp-result' }, mech, just, warn, mix, minor, stereoLine, noReact, oneReactant);
  const previewText = h('p', null);
  const breakHint = h('p', { class: 'bp-break' });
  const previewSec = h('section', { class: 'bp-preview' }, previewText, breakHint);
  const idleBody = h('p', { class: 'bp-idle' }, STRINGS.benchIdleBody);
  root.append(header, idleBody, reactantSec, cardsSec, equivSec, rxSec, actions, resultSec, previewSec);

  closeBtn.addEventListener('click', () => close());
  equiv1.addEventListener('click', () => state.setEquiv(1));
  equiv2.addEventListener('click', () => state.setEquiv(2));
  rxSelect.addEventListener('change', () => state.setRx(rxSelect.value === '' ? null : rxSelect.value));
  reactBtn.addEventListener('click', () => {
    const r = state.react();
    setHidden(oneReactant, r !== null || state.bench.mode !== 'free');
    refresh();
  });
  chooseBtn.addEventListener('click', () => submitChoice());
  submitBtn.addEventListener('click', () => { state.submit(); });
  answerBtn.addEventListener('click', () => { state.showAnswer(); refresh(); });
  clearBtn.addEventListener('click', () => { state.clearProductZone(); refresh(); });
  const stopRovingCards = rovingTabindex(cardGroup, '[role="radio"]', { onMove: (el) => { if (state.bench.mode === 'choose') checkCard(el.dataset['id'] as ReagentId); } });
  const stopRovingEquiv = rovingTabindex(equivGroup, '[role="radio"]');
  cardGroup.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && state.bench.mode === 'choose') {
      const t = e.target as HTMLElement;
      if (t.getAttribute('role') === 'radio' && t.getAttribute('aria-checked') === 'true') {
        e.preventDefault();
        submitChoice();
      }
    }
  });

  function submitChoice(): void {
    if (state.bench.mode !== 'choose' || chosen === null || state.finished) return;
    state.chooseReagent(chosen);
    refresh();
  }

  function checkCard(id: ReagentId | null): void {
    chosen = id;
    for (const b of Array.from(cardGroup.querySelectorAll<HTMLElement>('[role="radio"]'))) {
      b.setAttribute('aria-checked', b.dataset['id'] === id ? 'true' : 'false');
    }
    chooseBtn.disabled = chosen === null || state.finished;
  }

  function cardButton(card: ReagentCard, checked: boolean, disabled: boolean): HTMLButtonElement {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': checked ? 'true' : 'false', 'data-id': card.id, 'data-key': card.id, disabled },
      h('b', null, card.label), ' ', h('span', { class: 'rt' }, card.reagentText), ' ', h('span', { class: 'ch' }, card.section),
      card.notInMcMurry10e ? h('span', { class: 'tag' }, ` ${STRINGS.notIn10e}`) : null,
    ) as HTMLButtonElement;
    if (correctCards.includes(card.id)) {
      b.classList.add('is-correct');
      b.appendChild(h('span', { class: 'sr-only' }, ` ${STRINGS.correctAnswerSr}`));
    }
    b.addEventListener('click', () => {
      const mode = state.bench.mode;
      if (mode === 'choose') checkCard(card.id);
      else if (mode === 'free') { state.setBenchCard(card.id); refresh(); }
    });
    return b;
  }

  function renderCards(): void {
    const b = state.bench;
    clearChildren(cardGroup);
    if (b.mode === 'predict') {
      if (b.cardId) cardGroup.appendChild(cardButton(cardById(b.cardId), true, true));
      return;
    }
    if (b.mode === 'choose') {
      const rule = state.current.challenge.rule;
      if (rule.type !== 'choose-reagent') return;
      for (const id of rule.options) {
        try {
          cardGroup.appendChild(cardButton(cardById(id), chosen === id, state.finished));
        } catch {
          // unknown id: content validation rejects it
        }
      }
      return;
    }
    if (b.mode === 'free') {
      const cards = enabledReagents(loadConfig());
      const chapters = Array.from(new Set(cards.map((c) => c.chapter))).sort((x, y) => x - y);
      for (const ch of chapters) {
        const titleText = CHAPTER_TITLES[ch as Chapter];
        cardGroup.appendChild(h('h4', null, titleText ? `Chapter ${ch} — ${titleText}` : `Chapter ${ch}`));
        for (const c of cards.filter((x) => x.chapter === ch)) cardGroup.appendChild(cardButton(c, b.cardId === c.id, false));
      }
    }
  }

  function renderRxOptions(): void {
    if (rxOptionsBuilt) return;
    rxOptionsBuilt = true;
    clearChildren(rxSelect);
    rxSelect.appendChild(h('option', { value: '' }, '—'));
    for (const e of alkylHalides()) rxSelect.appendChild(h('option', { value: e.smiles }, `${e.name} (${e.formula})`));
  }

  function solvedCurrent(): boolean {
    return state.outcomeOf(state.current.challenge.id) >= Outcome.SolvedReduced;
  }

  function renderResult(): void {
    const b = state.bench;
    const r = resultCleared ? null : b.result;
    const children = [mech, just, warn, mix, minor, stereoLine, noReact];
    if (!r) {
      for (const c of children) setHidden(c, true);
      return;
    }
    const restricted = b.mode === 'predict' && !solvedCurrent();
    setText(mech, BENCH.mechanism(r.mechanism));
    setHidden(mech, false);
    setText(just, r.justification);
    setHidden(just, r.justification === '');
    clearChildren(warn);
    for (const w of r.warnings) warn.appendChild(h('li', null, h('span', { class: 'glyph', 'aria-hidden': 'true' }, '⚠'), ` ${STRINGS.warningPrefix} ${w}`));
    setHidden(warn, r.warnings.length === 0);
    const rule = state.current.challenge.rule;
    const acceptAny = b.mode === 'predict' && rule.type === 'predict-product' && rule.acceptAny === true;
    if (r.mixture) {
      setText(mix, BENCH.mixture(r.major.length, acceptAny));
      setHidden(mix, false);
    } else if (r.major.length > 1) {
      setText(mix, BENCH.fragments(r.major.length));
      setHidden(mix, false);
    } else {
      setHidden(mix, true);
    }
    clearChildren(minor);
    if (!restricted && r.minor && r.minor.length > 0) {
      for (const m of r.minor) minor.appendChild(h('p', null, BENCH.minor(nameOrFormula(m))));
      setHidden(minor, false);
    } else {
      setHidden(minor, true);
    }
    const st = REACTION_STEREO_TEXT[r.stereo];
    setText(stereoLine, st);
    setHidden(stereoLine, st === '');
    setHidden(noReact, !r.noReaction);
  }

  function renderPreview(): void {
    const b = state.bench;
    const n = b.previews.reduce((s, p) => s + (p.suppressedPairs?.length ?? 0), 0);
    let text = '';
    let hint = '';
    if (b.mode === 'predict') {
      if (solvedCurrent() && b.preview !== 'hidden') {
        text = STRINGS.previewGhost;
        if (n > 0) hint = BENCH.breakHint(n);
      } else {
        text = STRINGS.previewHidden;
      }
    } else if (b.mode === 'choose' || b.mode === 'free') {
      if (b.previews.length > 0 && b.previews.some((p) => !p.buildable)) text = BENCH.previewOnly;
      else if (b.previews.length > 0 || b.preview === 'ghost') {
        text = STRINGS.previewGhost;
        if (n > 0) hint = BENCH.breakHint(n);
      }
    }
    setText(previewText, text);
    setText(breakHint, hint);
    setHidden(breakHint, hint === '');
    setHidden(previewSec, text === '');
  }

  function refresh(): void {
    const b = state.bench;
    const mode = b.mode;
    setText(modeEl, STRINGS.benchMode[mode]);
    closeBtn.setAttribute('aria-keyshortcuts', keyName(ctx.keys().bench));
    const idle = mode === 'idle';
    setHidden(idleBody, !idle);
    setHidden(reactantSec, idle || !b.reactant);
    if (b.reactant) {
      const a = analysisOf(b.reactant);
      clearChildren(reactantLine);
      reactantLine.append(`${a.name ?? STRINGS.unnamed}, `, formulaNode(a.formula));
      if (b.rx && mode === 'predict') {
        clearChildren(rxLine);
        const ra = analysisOf(b.rx);
        rxLine.append(BENCH.withRx(ra.name ?? ra.formula));
        setHidden(rxLine, false);
      } else {
        setHidden(rxLine, true);
      }
    }
    setHidden(cardsSec, idle);
    if (!idle) renderCards();
    // equivalents
    let card: ReagentCard | null = null;
    try {
      card = b.cardId ? cardById(b.cardId) : null;
    } catch {
      card = null;
    }
    const equivRelevant = card !== null && (card.equiv !== undefined || ((card.rule === 'HX_ADD' || card.rule === 'X2_ADD') && b.reactant !== null && hasTripleCC(b.reactant)));
    const showEquiv = (mode === 'predict' || mode === 'free') && equivRelevant;
    setHidden(equivSec, !showEquiv);
    if (showEquiv) {
      const rule = state.current.challenge.rule;
      const fixed = mode === 'predict' && rule.type === 'predict-product' && rule.equiv !== undefined;
      equiv1.setAttribute('aria-checked', b.equiv === 1 ? 'true' : 'false');
      equiv2.setAttribute('aria-checked', b.equiv === 2 ? 'true' : 'false');
      equiv1.disabled = fixed;
      equiv2.disabled = fixed;
    }
    // rx picker (free play)
    setHidden(rxSec, mode !== 'free');
    if (mode === 'free') {
      renderRxOptions();
      if (!b.rx && rxSelect.value !== '') rxSelect.value = '';
    }
    // actions
    setHidden(reactBtn, !(mode === 'predict' || mode === 'free'));
    reactBtn.disabled = state.finished;
    setHidden(chooseBtn, mode !== 'choose');
    chooseBtn.disabled = chosen === null || state.finished;
    setHidden(submitBtn, mode !== 'predict');
    submitBtn.disabled = state.finished;
    setHidden(answerBtn, !(mode === 'predict' && solvedCurrent()));
    setHidden(clearBtn, !(mode === 'predict' || mode === 'free'));
    setText(clearBtn, mode === 'free' ? STRINGS.clearBothZones : BENCH.clearZone);
    setHidden(actions, idle);
    setHidden(oneReactant, true);
    renderResult();
    renderPreview();
  }

  function open(op?: HTMLElement | null): void {
    opener = op ?? null;
    if (!isOpen) {
      isOpen = true;
      setHidden(root, false);
      moleculeWasCollapsed = ctx.isMoleculeCollapsed();
      ctx.setMoleculeCollapsed(true);
      ctx.setSheet('bench');
    }
    refresh();
    const first = focusables(root).find((el) => el !== closeBtn) ?? closeBtn;
    first.focus({ preventScroll: true });
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    setHidden(root, true);
    ctx.setMoleculeCollapsed(moleculeWasCollapsed);
    ctx.setSheet(null);
    const target = opener && opener.isConnected ? opener : ctx.canvas;
    target.focus({ preventScroll: true });
    opener = null;
  }

  refresh();

  return {
    el: root,
    refresh,
    open,
    close,
    toggle(op) {
      if (isOpen) close();
      else open(op);
    },
    get isOpen() { return isOpen; },
    onChallengeChanged() {
      chosen = null;
      correctCards = [];
      resultCleared = false;
      const t = state.current.challenge.rule.type;
      if (t !== 'predict-product' && t !== 'choose-reagent' && isOpen && state.bench.mode !== 'free') close();
      refresh();
    },
    onReacted() {
      resultCleared = false;
      setHidden(oneReactant, true);
      refresh();
    },
    onCleared() {
      resultCleared = true;
      refresh();
    },
    onSubmitted(result) {
      if (state.bench.mode !== 'choose') { refresh(); return; }
      const rule = state.current.challenge.rule;
      if (rule.type !== 'choose-reagent') return;
      if (result.passed && chosen) correctCards = [chosen];
      else if (result.kind === 'attempts-exhausted') correctCards = [...rule.correct];
      refresh();
    },
    plainText() {
      const b = state.bench;
      const parts: string[] = [STRINGS.benchMode[b.mode] + '.'];
      if (b.reactant) parts.push(`${STRINGS.mirror.reactant} ${nameOrFormula(b.reactant)}.`);
      if (b.cardId) {
        try {
          parts.push(`${STRINGS.mirror.reagent} ${cardById(b.cardId).label}.`);
        } catch {
          // unknown card id
        }
      }
      const products = state.padComponents.filter((c) => c.zone === 'product').map((c) => c.analysis.name ?? c.analysis.formula);
      parts.push(`${STRINGS.mirror.productZone} ${products.length ? products.join(', ') : STRINGS.mirror.empty}.`);
      return parts.join(' ');
    },
    dispose() {
      stopRovingCards();
      stopRovingEquiv();
    },
  };
}
