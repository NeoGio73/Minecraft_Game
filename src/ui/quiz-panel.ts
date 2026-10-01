/**
 * Quiz dialog: multiple choice (1–5) and yes/no. docs/design/07-ui.md §10.
 * DOM module. Option order: Fisher–Yates with mulberry32(fnv1a32(id|student)).
 */
import type { Challenge, QuizMcRule, QuizYesNoRule, SubmitResult } from '../content/types';
import { isAttemptLimited, maxAttemptsOf } from '../content/challenges';
import { mulberry32 } from '../util/prng';
import { Outcome } from '../lms/types';
import { STRINGS, atomLabel } from './strings';
import { clearChildren, h, setHidden, setText } from './hud';
import type { Dialog, HudContext, UiEvents } from './hud';

export interface QuizPanel extends Dialog {
  onSubmitted(e: UiEvents['challenge:submitted']): void;
  onAnswer(e: UiEvents['quiz:answer']): void;
}

/** 32-bit FNV-1a of a string (the seed of the per-student option order; 07 §10.4). */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface Option { readonly id: string; readonly text: string; readonly shortcuts: readonly string[] }

type Rule = QuizMcRule | QuizYesNoRule;

export function shuffledOptions(rule: Rule, seedText: string): Option[] {
  if (rule.kind === 'yesno') {
    return [
      { id: 'yes', text: STRINGS.yes, shortcuts: ['Digit1', 'Numpad1', 'KeyY'] },
      { id: 'no', text: STRINGS.no, shortcuts: ['Digit2', 'Numpad2', 'KeyN'] },
    ];
  }
  const opts = rule.options.map((o) => ({ id: o.id, text: o.text }));
  if (rule.shuffle) {
    const rnd = mulberry32(fnv1a32(seedText));
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = opts[i]!;
      opts[i] = opts[j]!;
      opts[j] = t;
    }
  }
  return opts.map((o, i) => ({ id: o.id, text: o.text, shortcuts: [`Digit${i + 1}`, `Numpad${i + 1}`] }));
}

export function mountQuizPanel(root: HTMLElement, ctx: HudContext): QuizPanel {
  const { state } = ctx;
  let isOpen = false;
  let challenge: Challenge | null = null;
  let rule: Rule | null = null;
  let options: Option[] = [];
  let highlight: number | null = null;
  let locked = false;          // options disabled (correct or exhausted)
  const buttons: HTMLButtonElement[] = [];

  const titleEl = h('h2', { id: 'quiz-title' });
  const prompt = h('p', { id: 'quiz-prompt' });
  const display = h('p', { class: 'quiz-display' });
  const list = h('ol', { class: 'quiz-options', role: 'radiogroup', 'aria-label': STRINGS.answers });
  const attempts = h('p', { class: 'quiz-attempts' });
  const feedback = h('div', { class: 'quiz-feedback' });
  const explanation = h('p', { class: 'quiz-explanation', hidden: true });
  const submitBtn = h('button', { type: 'button', id: 'quiz-submit', disabled: true }, STRINGS.submitAnswer) as HTMLButtonElement;
  const nextBtn = h('button', { type: 'button', id: 'quiz-next', hidden: true }, STRINGS.nextChallenge) as HTMLButtonElement;
  const closeBtn = h('button', { type: 'button', id: 'quiz-close' }, STRINGS.closeQuiz) as HTMLButtonElement;
  const actionsEl = h('div', { class: 'quiz-actions' }, submitBtn, nextBtn, closeBtn);
  const el = h('div', {
    id: 'quiz', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'quiz-title', 'aria-describedby': 'quiz-prompt', hidden: true, tabindex: '-1',
  }, titleEl, prompt, display, list, attempts, feedback, explanation, actionsEl);
  root.appendChild(el);

  function maxAttempts(): number {
    return rule ? maxAttemptsOf(rule) : Infinity;
  }
  function attemptsUsed(): number {
    return challenge ? state.attemptOf(challenge.id) : 0;
  }
  function exhausted(): boolean {
    if (!challenge || !rule) return false;
    const solved = state.outcomeOf(challenge.id) >= Outcome.SolvedReduced;
    return !solved && isAttemptLimited(rule) && attemptsUsed() >= maxAttempts();
  }

  function setHighlight(i: number | null): void {
    highlight = i;
    buttons.forEach((b, k) => {
      b.setAttribute('aria-checked', k === i ? 'true' : 'false');
      b.classList.toggle('is-highlighted', k === i);
      b.tabIndex = k === (i ?? 0) ? 0 : -1;
    });
    submitBtn.disabled = locked || i === null;
  }

  function setLocked(on: boolean): void {
    locked = on;
    for (const b of buttons) b.disabled = on;
    submitBtn.disabled = on || highlight === null;
  }

  function refreshAttempts(): void {
    if (!rule || !isAttemptLimited(rule)) {
      setHidden(attempts, true);
      return;
    }
    setHidden(attempts, false);
    setText(attempts, STRINGS.attemptsLeft(maxAttempts() - attemptsUsed(), maxAttempts()));
  }

  function markCorrect(): void {
    if (!rule) return;
    const correct = rule.kind === 'yesno' ? [rule.correct ? 'yes' : 'no'] : rule.correct;
    buttons.forEach((b, k) => {
      const o = options[k];
      if (o && correct.includes(o.id)) {
        b.classList.add('is-correct');
        if (!b.querySelector('.sr-only')) b.appendChild(h('span', { class: 'sr-only' }, ` ${STRINGS.correctAnswerSr}`));
      }
    });
  }

  function showExplanation(message: string): void {
    if (!rule) return;
    if (rule.explanation && !message.includes(rule.explanation)) {
      setText(explanation, rule.explanation);
      setHidden(explanation, false);
    } else {
      setHidden(explanation, true);
    }
  }

  function renderResult(result: SubmitResult): void {
    const tone = result.passed || result.kind === 'correct-reduced' ? 'ok' : result.kind === 'attempts-exhausted' ? 'warn' : 'err';
    const glyph = tone === 'ok' ? STRINGS.feedbackGlyph.ok : tone === 'warn' ? STRINGS.feedbackGlyph.warn : STRINGS.feedbackGlyph.err;
    const prefix = result.passed ? (result.kind === 'correct-reduced' ? STRINGS.feedbackPrefix.reduced : STRINGS.feedbackPrefix.ok)
      : result.kind === 'attempts-exhausted' ? STRINGS.feedbackPrefix.warn : STRINGS.feedbackPrefix.err;
    let message = result.message;
    if (result.passed && result.pointsEarned === 0) message += STRINGS.alreadySolvedSuffix;
    clearChildren(feedback);
    feedback.dataset['tone'] = tone;
    feedback.append(h('span', { class: 'glyph', 'aria-hidden': 'true' }, glyph), ' ', h('b', null, prefix), ` ${message}`);
    // Not announced from here: the challenge panel announces every result exactly once (07 §9.5, §16.1) and this
    // dialog only mirrors it. A second sticky copy of the same text queued behind the first and delayed every later
    // polite message by at least one LIVE_POLITE_MS window.
    refreshAttempts();
    if (result.passed) {
      setLocked(true);
      showExplanation(message);
      setHidden(nextBtn, false);
      closeBtn.focus();
    } else if (result.kind === 'attempts-exhausted') {
      setLocked(true);
      markCorrect();
      showExplanation(message);
      setHidden(nextBtn, false);
      closeBtn.focus();
    } else {
      setHighlight(null);
      setLocked(false);
      setHidden(explanation, true);
      const first = buttons[0];
      if (first) first.focus();
    }
  }

  function submitHighlighted(): void {
    if (locked || highlight === null || !rule) return;
    const o = options[highlight];
    if (!o) return;
    const choice: string | boolean = rule.kind === 'yesno' ? o.id === 'yes' : o.id;
    const result = state.answerQuiz(choice);
    renderResult(result);
  }

  function build(): void {
    clearChildren(list);
    buttons.length = 0;
    if (!challenge || !rule) return;
    options = shuffledOptions(rule, `${challenge.id}|${state.studentId ?? 'local'}`);
    options.forEach((o, i) => {
      const kbd = h('kbd', null, String(i + 1));
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-id': o.id, 'aria-keyshortcuts': o.shortcuts.map((s) => (s.startsWith('Digit') ? s.slice(5) : s.startsWith('Key') ? s.slice(3) : s)).join(' ') }, kbd, ` ${o.text}`) as HTMLButtonElement;
      b.addEventListener('click', () => {
        if (locked) return;
        if (highlight === i) submitHighlighted();
        else setHighlight(i);
      });
      buttons.push(b);
      list.appendChild(h('li', null, b));
    });
  }

  function onKey(e: KeyboardEvent): void {
    if (!isOpen || !rule) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    const target = e.target as HTMLElement | null;
    const inOption = target ? buttons.includes(target as HTMLButtonElement) : false;
    const idx = options.findIndex((o) => o.shortcuts.includes(e.code));
    if (idx >= 0 && !locked) {
      e.preventDefault();
      if (highlight === idx) submitHighlighted();
      else {
        setHighlight(idx);
        buttons[idx]?.focus();
      }
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !locked && buttons.length > 0) {
      e.preventDefault();
      const n = buttons.length;
      const cur = highlight ?? (e.key === 'ArrowDown' ? -1 : 0);
      const next = e.key === 'ArrowDown' ? (cur + 1) % n : (cur - 1 + n) % n;
      setHighlight(next);
      buttons[next]?.focus();
      return;
    }
    if (e.key === 'Enter') {
      if (target === closeBtn || target === nextBtn) return;
      e.preventDefault();
      submitHighlighted();
      return;
    }
    if (e.key === ' ' && inOption && !locked) {
      e.preventDefault();
      const i = buttons.indexOf(target as HTMLButtonElement);
      setHighlight(highlight === i ? null : i);
    }
  }
  el.addEventListener('keydown', onKey);
  submitBtn.addEventListener('click', submitHighlighted);
  closeBtn.addEventListener('click', () => close());
  nextBtn.addEventListener('click', () => {
    close();
    state.nextChallenge();
  });

  function open(opener?: HTMLElement | null): void {
    const c = state.current.challenge;
    if (c.rule.type !== 'quiz') return;
    if (isOpen) {
      if (challenge?.id === c.id) return;
      close();
    }
    challenge = c;
    rule = c.rule;
    isOpen = true;
    setText(prompt, rule.prompt);
    const d = rule.display;
    if (d && d.markedAtom !== undefined) {
      const lp = state.locked[0];
      const info = lp?.analysis.atoms[d.markedAtom];
      const label = info ? atomLabel(info.el, d.markedAtom) : `#${d.markedAtom + 1}`;
      setText(titleEl, STRINGS.quizTitleMarked(c.chapter, c.section, label));
    } else {
      setText(titleEl, STRINGS.quizTitle(c.chapter, c.section));
    }
    if (d) {
      const lone = (d as { showLonePairs?: boolean }).showLonePairs === true;
      setText(display, lone ? `${STRINGS.quizDisplay} ${STRINGS.quizLonePairs}` : STRINGS.quizDisplay);
      setHidden(display, false);
    } else {
      setHidden(display, true);
    }
    build();
    clearChildren(feedback);
    delete feedback.dataset['tone'];
    setHidden(explanation, true);
    setHidden(nextBtn, true);
    setLocked(false);
    setHighlight(null);
    refreshAttempts();
    if (exhausted()) {
      setLocked(true);
      markCorrect();
      setText(explanation, rule.explanation);
      setHidden(explanation, false);
      feedback.dataset['tone'] = 'warn';
      feedback.append(h('span', { class: 'glyph', 'aria-hidden': 'true' }, STRINGS.feedbackGlyph.warn), ' ', h('b', null, STRINGS.feedbackPrefix.warn), ` ${STRINGS.attemptsLeft(0, maxAttempts())}.`);
      setHidden(nextBtn, false);
    }
    state.events.emit('quiz:open', { challengeId: c.id });
    ctx.dialogs.push(el, opener ?? null);
    const first = exhausted() ? closeBtn : buttons[0] ?? closeBtn;
    first.focus();
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    const id = challenge?.id ?? '';
    ctx.dialogs.pop(el);
    state.events.emit('quiz:close', { challengeId: id });
  }

  return {
    el,
    get isOpen() { return isOpen; },
    open,
    close,
    refresh() {
      if (isOpen) refreshAttempts();
    },
    onSubmitted() {
      // the result was already rendered from answerQuiz's return value; keep attempts current
      if (isOpen) refreshAttempts();
    },
    onAnswer() {
      if (isOpen) refreshAttempts();
    },
    dispose() {
      el.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
