/**
 * Challenge acceptance: `evaluate(challenge, ctx)` and one `evaluate<Rule>`
 * per rule type; `pointsFor`, `creditDelta`, `kindForVerdict`. PURE MODULE.
 * See docs/design/05-content.md section 7, 04-reaction-bench.md section 8.4
 * and 09-amendment-no-bond.md section 4.5.
 *
 * Every evaluator is a pure function of (challenge, ctx). `analyze` results
 * are memoised per graph object for the duration of one `evaluate` call.
 */
import { pointsForAttempt } from './types';
import type {
  Challenge, ChooseReagentRule, ExactMoleculeRule, FeedbackKind, FormulaAndGroupsRule, IsomerSetRule,
  NameToStructureRule, PredictProductRule, QuizMcRule, QuizYesNoRule, SelectAtomRule, StereoExactRule,
  SubmissionContext, SubmitResult,
} from './types';
import type { Analysis, CompareVerdict, Element, MoleculeGraph, StereoPolicy } from '../chem/types';
import type { CompareResultExt } from '../chem/compare';
import { sameMolecule } from '../chem/compare';
import { analyze } from '../chem/analyze';
import { smallestRings } from '../chem/graph';
import { chargeSuffix, piBondCount } from '../chem/formula';
import { GROUP_NAME } from '../chem/groups';
import type { ProgressState } from '../lms/types';
import { entryBySmiles, parseEntry } from './library';
import { cardById } from './reagents';
import { isAttemptLimited, isomerHashes } from './challenges';
import { answerSet, itemKey, normalizeSelection } from './selectors';
import type { SelectionItem } from './selectors';
import { feedbackText } from './feedback';
import type { FeedbackParams } from './feedback';

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

/** Points for a passing submission: full for build rules; `pointsForAttempt` for attempt-limited rules;
 *  `reduced` (an acceptAlso match) earns half, floored. */
export function pointsFor(c: Challenge, attempt: number, reduced: boolean): number {
  if (reduced) return pointsForAttempt(c.points, 2, false);
  if (isAttemptLimited(c.rule)) return pointsForAttempt(c.points, attempt, false);
  return c.points;
}

/**
 * Credit delta State reports and passes to applyOutcome for a passing submission on challenge `index`:
 * not yet solved -> pointsEarned; solved reduced, now full -> points - half (the one-time upgrade); otherwise 0.
 */
export function creditDelta(c: Challenge, result: SubmitResult, state: ProgressState, index: number): number {
  if (!result.passed) return 0;
  const bit = 1n << BigInt(index);
  const solved = (state.solved & bit) !== 0n;
  if (!solved) return result.pointsEarned;
  const reduced = (state.reduced & bit) !== 0n;
  const half = pointsForAttempt(c.points, 2, false);
  if (reduced && result.kind === 'correct' && result.pointsEarned >= c.points) return c.points - half;
  return 0;
}

/** Maps a CompareVerdict (never SAME) to the FeedbackKind the build rules report. */
export function kindForVerdict(v: CompareVerdict, sameElements: boolean): FeedbackKind {
  switch (v) {
    case 'DIFFERENT_FORMULA': return sameElements ? 'wrong-charge' : 'wrong-formula';
    case 'DIFFERENT_CONSTITUTION': return 'constitutional-isomer';
    case 'ENANTIOMER': return 'enantiomer';
    case 'DIASTEREOMER': return 'diastereomer';
    case 'UNSPECIFIED': return 'unspecified-center';
    case 'INVALID_GEOMETRY': return 'invalid-alkene-geometry';
    case 'SAME': return 'correct';
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const VERDICT_RANK: Readonly<Record<CompareVerdict, number>> = {
  SAME: 0, ENANTIOMER: 1, DIASTEREOMER: 2, UNSPECIFIED: 3, INVALID_GEOMETRY: 4, DIFFERENT_CONSTITUTION: 5, DIFFERENT_FORMULA: 6,
};

const ELEMENT_NAME: Readonly<Record<Element, string>> = {
  H: 'hydrogen', C: 'carbon', N: 'nitrogen', O: 'oxygen', F: 'fluorine', Cl: 'chlorine', Br: 'bromine', I: 'iodine', S: 'sulfur', P: 'phosphorus',
};

class Ev {
  private readonly cache = new Map<MoleculeGraph, Analysis>();
  constructor(readonly c: Challenge, readonly ctx: SubmissionContext) {}

  an(g: MoleculeGraph): Analysis {
    const hit = this.cache.get(g);
    if (hit) return hit;
    const a = analyze(g);
    this.cache.set(g, a);
    return a;
  }

  private text(kind: FeedbackKind, params: FeedbackParams): string {
    return feedbackText(kind, params, this.c.feedback?.[kind]);
  }

  pass(kind: FeedbackKind, params: FeedbackParams, pointsEarned: number, extra: Partial<SubmitResult> = {}): SubmitResult {
    return { passed: true, kind, message: this.text(kind, params), attempt: this.ctx.attempt, pointsEarned, ...extra };
  }

  fail(kind: FeedbackKind, params: FeedbackParams = {}, extra: Partial<SubmitResult> = {}): SubmitResult {
    return { passed: false, kind, message: this.text(kind, params), attempt: this.ctx.attempt, pointsEarned: 0, ...extra };
  }
}

function valenceWarning(a: Analysis): { atom: number; el: string } | null {
  for (const w of a.warnings) {
    if (w.kind === 'over-valence' || w.kind === 'h-block-valence') return { atom: w.atom, el: a.atoms[w.atom]?.el ?? 'An atom' };
  }
  return null;
}

/** Targeted molecule on the pad, analysed; or the failure result. */
function requireTargeted(ev: Ev): { a: Analysis; g: MoleculeGraph } | SubmitResult {
  const t = ev.ctx.targeted;
  if (t === null || ev.ctx.padMolecules.indexOf(t) < 0) return ev.fail('nothing-targeted');
  const a = ev.an(t);
  const v = valenceWarning(a);
  if (v) return ev.fail('valence-error', { atom: v.atom + 1, el: v.el });
  return { a, g: t };
}

function isResult(x: { a: Analysis; g: MoleculeGraph } | SubmitResult): x is SubmitResult {
  return (x as SubmitResult).kind !== undefined;
}

/** Element counts agree (only the net charge differs). */
function sameElements(a: Analysis, b: Analysis): boolean {
  for (const el of Object.keys(a.counts) as Element[]) if (a.counts[el] !== b.counts[el]) return false;
  return true;
}

/** The Hill formula without its net-charge suffix (`C2H3O2-` -> `C2H3O2`, `CH3+` -> `CH3`). */
function formulaWithoutCharge(a: Analysis): string {
  const suffix = chargeSuffix(a.netCharge);
  return suffix !== '' && a.formula.endsWith(suffix) ? a.formula.slice(0, a.formula.length - suffix.length) : a.formula;
}

function nameOrFormula(a: Analysis): string {
  return a.name ?? a.formula;
}

/** The library name of a rule SMILES (stereo included), else the analysed name, else the formula. */
function targetName(smiles: string, ev: Ev): string {
  const e = entryBySmiles(smiles);
  if (e) return e.name;
  return nameOrFormula(ev.an(parseEntry(smiles)));
}

function extraRingOf(student: Analysis, target: Analysis): 1 | undefined {
  return student.ringCount > target.ringCount ? 1 : undefined;
}

/** Student atom number (1-based) to name in stereo feedback for a comparison result. */
function offendingAtomNumber(r: CompareResultExt): number {
  if (r.offendingAtom !== undefined) return r.offendingAtom + 1;
  const t = r.differingCenters?.[0];
  if (t !== undefined) {
    const s = r.mapping?.[t];
    return (s ?? t) + 1;
  }
  return 1;
}

function offendingBondLabel(r: CompareResultExt, student: MoleculeGraph, target: MoleculeGraph): string | undefined {
  if (r.offendingBond !== undefined) {
    const b = student.bonds[r.offendingBond];
    if (b) return `C${b.a + 1}=C${b.b + 1}`;
  }
  const tb = r.differingBonds?.[0];
  if (tb !== undefined) {
    const b = target.bonds[tb];
    if (b && r.mapping) {
      const sa = r.mapping[b.a];
      const sb = r.mapping[b.b];
      if (sa !== undefined && sb !== undefined) return `C${Math.min(sa, sb) + 1}=C${Math.max(sa, sb) + 1}`;
    }
  }
  return undefined;
}

function shapeOf(a: Analysis, r: CompareResultExt): 'T' | 'square-planar' {
  const atom = r.offendingAtom;
  if (atom === undefined || !a.stereo) return 'T';
  const c = a.stereo.centers.find((x) => x.atom === atom);
  return c?.shape === 'square-planar' ? 'square-planar' : 'T';
}

/** Failure params for a non-SAME comparison of `student` against `target` (05 §7.2, §7.5, §7.7). */
function compareFailure(ev: Ev, r: CompareResultExt, student: MoleculeGraph, target: MoleculeGraph): SubmitResult {
  const a = ev.an(student);
  const tA = ev.an(target);
  const kind = kindForVerdict(r.verdict, sameElements(a, tA));
  const params: Record<string, string | number | undefined> = {
    yours: kind === 'wrong-charge' ? a.netCharge : a.formula,
    expected: kind === 'wrong-charge' ? tA.netCharge : tA.formula,
    name: a.name ?? undefined,
    atom: offendingAtomNumber(r),
    bond: offendingBondLabel(r, student, target),
    extraRing: extraRingOf(a, tA),
  };
  if (kind === 'unspecified-center') params['shape'] = shapeOf(a, r);
  return ev.fail(kind, params);
}

// ---------------------------------------------------------------------------
// Build rules
// ---------------------------------------------------------------------------

export function evaluateExactMolecule(rule: ExactMoleculeRule | NameToStructureRule, ctx: SubmissionContext, c: Challenge): SubmitResult {
  const ev = new Ev(c, ctx);
  const t = requireTargeted(ev);
  if (isResult(t)) return t;
  const T = parseEntry(rule.target);
  const r = sameMolecule(t.g, T, { stereo: 'none' });
  if (r.same) {
    const tA = ev.an(T);
    const name = entryBySmiles(rule.target)?.name ?? tA.name ?? (rule.type === 'name-to-structure' ? rule.names[0] : undefined) ?? tA.formula;
    return ev.pass('correct', { name }, pointsFor(c, ctx.attempt, false));
  }
  return compareFailure(ev, r, t.g, T);
}

function describeAtomCount(p: { el: Element; hyb?: string; charge?: number; min?: number; max?: number }): string {
  const noun = ELEMENT_NAME[p.el] ?? p.el;
  const chargeText = p.charge === undefined || p.charge === 0 ? '' : p.charge > 0 ? ' with a +1 charge' : ' with a -1 charge';
  const what = `${p.hyb !== undefined ? `${p.hyb} ` : ''}${noun}`;
  const min = p.min;
  const max = p.max;
  let count: string;
  let n: number;
  if (min !== undefined && max !== undefined) {
    if (min === max) { count = `exactly ${min}`; n = min; } else { count = `between ${min} and ${max}`; n = max; }
  } else if (min !== undefined) { count = `at least ${min}`; n = min; }
  else if (max !== undefined) { count = `at most ${max}`; n = max; }
  else { count = 'any number of'; n = 2; }
  return `${count} ${what}${n === 1 ? '' : 's'}${chargeText}`;
}

export function evaluateFormulaAndGroups(rule: FormulaAndGroupsRule, ctx: SubmissionContext, c: Challenge): SubmitResult {
  const ev = new Ev(c, ctx);
  const t = requireTargeted(ev);
  if (isResult(t)) return t;
  const { a, g } = t;
  const yours = formulaWithoutCharge(a);
  if (yours !== rule.formula) {
    return ev.fail('wrong-formula', { yours: a.formula, expected: rule.formula, extraRing: ringCountOfFormulaHint(a, rule) ? 1 : undefined });
  }
  if (rule.netCharge !== undefined && a.netCharge !== rule.netCharge) {
    return ev.fail('wrong-charge', { yours: a.netCharge, expected: rule.netCharge });
  }
  for (const gid of rule.required) {
    if (!a.groups.some((h) => h.group === gid)) return ev.fail('missing-group', { what: GROUP_NAME[gid] });
  }
  for (const gid of rule.forbidden) {
    const hit = a.groups.find((h) => h.group === gid);
    if (hit) return ev.fail('forbidden-group', { what: hit.label });
  }
  if (rule.ringCount !== undefined && a.ringCount !== rule.ringCount) {
    return ev.fail('wrong-ring-count', { yours: a.ringCount, expected: rule.ringCount });
  }
  if (rule.ringSizes !== undefined) {
    const sizes = smallestRings(g).map((r) => r.length);
    for (const s of rule.ringSizes) {
      if (!sizes.includes(s)) return ev.fail('wrong-ring-count', { yours: sizes.join('/') || 'none', expected: `a ${s}-membered ring` });
    }
  }
  if (rule.piBonds !== undefined) {
    const pi = piBondCount(g);
    if (pi !== rule.piBonds) return ev.fail('wrong-pi-count', { yours: pi, expected: rule.piBonds });
  }
  for (const p of rule.atomCounts ?? []) {
    let n = 0;
    for (const info of a.atoms) {
      if (info.el !== p.el) continue;
      if (p.hyb !== undefined && info.hybridization !== p.hyb) continue;
      if (p.charge !== undefined && info.charge !== p.charge) continue;
      n++;
    }
    if (n < (p.min ?? 0) || n > (p.max ?? Infinity)) return ev.fail('missing-group', { what: describeAtomCount(p) });
  }
  return ev.pass('correct', { name: nameOrFormula(a) }, pointsFor(c, ctx.attempt, false));
}

/** A formula-and-groups student whose only error could be an extra ring (two hydrogens short of the target): hint at the wand. */
function ringCountOfFormulaHint(a: Analysis, rule: FormulaAndGroupsRule): boolean {
  if (rule.ringCount === undefined) return false;
  return a.ringCount > rule.ringCount;
}

export function evaluateIsomerSet(rule: IsomerSetRule, ctx: SubmissionContext, c: Challenge): SubmitResult {
  const ev = new Ev(c, ctx);
  const { required, optional } = isomerHashes(rule);
  const allowed = ctx.diagonalBondsEnabled ? new Set([...required, ...optional]) : required;
  const goal = rule.count + (ctx.diagonalBondsEnabled ? optional.size : 0);
  const t = requireTargeted(ev);
  if (isResult(t)) return t;
  const { a } = t;
  for (const m of ctx.padMolecules) {
    if (m === t.g) continue;
    const am = ev.an(m);
    if (formulaWithoutCharge(am) !== rule.formula || !allowed.has(am.hash)) return ev.fail('extra-molecule', { formula: am.formula });
  }
  if (formulaWithoutCharge(a) !== rule.formula) return ev.fail('wrong-formula', { yours: a.formula, expected: rule.formula });
  if (!allowed.has(a.hash)) return ev.fail('not-an-isomer', { formula: rule.formula, name: a.name ?? undefined });
  const progressDone = ctx.isomersDone.size;
  if (ctx.isomersDone.has(a.hash)) {
    return ev.fail('already-built', { name: nameOrFormula(a) }, { progress: { done: progressDone, total: goal } });
  }
  const done = progressDone + 1;
  const passed = done >= goal;
  if (passed) return ev.pass('correct', { name: nameOrFormula(a) }, pointsFor(c, ctx.attempt, false), { progress: { done, total: goal } });
  return {
    passed: false,
    kind: 'correct',
    message: `Isomer ${done} of ${goal} accepted: ${nameOrFormula(a)}. Keep going.`,
    progress: { done, total: goal },
    attempt: ctx.attempt,
    pointsEarned: 0,
  };
}

export function evaluateStereoExact(rule: StereoExactRule, ctx: SubmissionContext, c: Challenge): SubmitResult {
  const ev = new Ev(c, ctx);
  const t = requireTargeted(ev);
  if (isResult(t)) return t;
  const smilesList = [rule.target, ...(rule.accept ?? [])];
  const targets = smilesList.map(parseEntry);
  const results = targets.map((T) => sameMolecule(t.g, T, { stereo: rule.mode }));
  const hit = results.findIndex((r) => r.same);
  if (hit >= 0) return ev.pass('correct', { name: targetName(smilesList[hit]!, ev) }, pointsFor(c, ctx.attempt, false));
  return compareFailure(ev, results[0]!, t.g, targets[0]!);
}

// ---------------------------------------------------------------------------
// select-atom
// ---------------------------------------------------------------------------

function describeItem(s: SelectionItem, graphs: readonly MoleculeGraph[]): string {
  const el = graphs[s.molecule]?.atoms[s.atom]?.el ?? '?';
  const base = s.hSlot === undefined ? `${el}${s.atom + 1}` : `a hydrogen on ${el}${s.atom + 1}`;
  return graphs.length > 1 ? `${base} of molecule ${s.molecule + 1}` : base;
}

export function evaluateSelectAtom(rule: SelectAtomRule, ctx: SubmissionContext, c: Challenge): SubmitResult {
  const ev = new Ev(c, ctx);
  const graphs = rule.molecules.map(parseEntry);
  const analyses = graphs.map((g) => ev.an(g));
  const A = answerSet(rule.selector, graphs, analyses);
  const S = normalizeSelection(ctx.selection, rule.target, analyses);
  if (S === 'no-hydrogens') return ev.fail('no-hydrogens');
  if (S.length === 0) return ev.fail('wrong-atom', { expected: rule.answerDescription });
  const keysA = new Set(A.map(itemKey));
  const keysS = new Set(S.map(itemKey));
  let ok: boolean;
  if (rule.match === 'all') {
    ok = keysA.size === keysS.size && [...keysS].every((k) => keysA.has(k));
  } else {
    ok = keysS.size > 0 && [...keysS].every((k) => keysA.has(k));
  }
  if (ok) return ev.pass('correct', { expected: rule.answerDescription }, pointsFor(c, ctx.attempt, false));
  if (ctx.attempt >= rule.maxAttempts) return ev.fail('attempts-exhausted', { expected: rule.answerDescription });
  return ev.fail('wrong-atom', { expected: rule.answerDescription, picked: describeItem(S[0]!, graphs) });
}

// ---------------------------------------------------------------------------
// predict-product
// ---------------------------------------------------------------------------

/** Backtracking bijection `comps <-> expected`; returns the matching (comp index -> expected index) or null. */
function bijection(n: number, ok: (i: number, j: number) => boolean): number[] | null {
  const assign: number[] = new Array<number>(n).fill(-1);
  const used: boolean[] = new Array<boolean>(n).fill(false);
  const rec = (i: number): boolean => {
    if (i === n) return true;
    for (let j = 0; j < n; j++) {
      if (used[j] || !ok(i, j)) continue;
      used[j] = true;
      assign[i] = j;
      if (rec(i + 1)) return true;
      used[j] = false;
      assign[i] = -1;
    }
    return false;
  };
  return rec(0) ? assign : null;
}

/** Maximum matching size with a greedy-then-augmenting search (<= 3 x 3 in v1). */
function maxMatching(n: number, m: number, ok: (i: number, j: number) => boolean): number[] {
  const matchOfComp: number[] = new Array<number>(n).fill(-1);
  const matchOfExp: number[] = new Array<number>(m).fill(-1);
  const tryAugment = (i: number, seen: boolean[]): boolean => {
    for (let j = 0; j < m; j++) {
      if (seen[j] || !ok(i, j)) continue;
      seen[j] = true;
      if (matchOfExp[j] === -1 || tryAugment(matchOfExp[j]!, seen)) {
        matchOfExp[j] = i;
        matchOfComp[i] = j;
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < n; i++) tryAugment(i, new Array<boolean>(m).fill(false));
  return matchOfComp;
}

export function evaluatePredictProduct(rule: PredictProductRule, ctx: SubmissionContext, c: Challenge): SubmitResult {
  const ev = new Ev(c, ctx);
  const policy: StereoPolicy = rule.stereoCheck;
  const expected = rule.expected.map(parseEntry);
  const comps = ctx.padMolecules;
  for (const m of comps) {
    const v = valenceWarning(ev.an(m));
    if (v) return ev.fail('valence-error', { atom: v.atom + 1, el: v.el });
  }
  if (comps.length === 0) {
    return ev.fail('missing-molecule', { expected: expected.length, have: 0, formula: ev.an(expected[0]!).formula });
  }
  const cmp = new Map<string, CompareResultExt>();
  const compare = (i: number, j: number): CompareResultExt => {
    const k = `${i}:${j}`;
    const hit = cmp.get(k);
    if (hit) return hit;
    const r = sameMolecule(comps[i]!, expected[j]!, { stereo: policy });
    cmp.set(k, r);
    return r;
  };
  const ok = (i: number, j: number): boolean => compare(i, j).same;
  const productName = rule.expected.map((s) => targetName(s, ev)).join(' and ');

  // 1. exact match under the stereo policy
  if (rule.acceptAny) {
    if (comps.length > 1) return ev.fail('extra-molecule', { formula: ev.an(comps[1]!).formula });
    for (let j = 0; j < expected.length; j++) {
      if (ok(0, j)) return ev.pass('correct', { name: targetName(rule.expected[j]!, ev) }, pointsFor(c, ctx.attempt, false));
    }
  } else if (comps.length === expected.length) {
    const assign = bijection(comps.length, ok);
    if (assign) return ev.pass('correct', { name: productName }, pointsFor(c, ctx.attempt, false));
  }

  // 2. acceptAlso (single component, constitution only)
  if (comps.length === 1 && rule.acceptAlso) {
    for (const alt of rule.acceptAlso) {
      if (sameMolecule(comps[0]!, parseEntry(alt.smiles), { stereo: 'none' }).same) {
        return ev.pass('correct-reduced', { note: alt.note }, pointsFor(c, ctx.attempt, true));
      }
    }
  }

  // 3. diagnostics
  if (rule.acceptAny) {
    let best: { r: CompareResultExt; j: number } | null = null;
    for (let j = 0; j < expected.length; j++) {
      const r = compare(0, j);
      if (best === null || VERDICT_RANK[r.verdict] < VERDICT_RANK[best.r.verdict]) best = { r, j };
    }
    return compareFailure(ev, best!.r, comps[0]!, expected[best!.j]!);
  }
  const matching = maxMatching(comps.length, expected.length, ok);
  const matchedExp = new Set(matching.filter((j) => j >= 0));
  const firstUnmatchedComp = matching.findIndex((j) => j < 0);
  let firstUnmatchedExp = -1;
  for (let j = 0; j < expected.length; j++) if (!matchedExp.has(j)) { firstUnmatchedExp = j; break; }
  if (comps.length > expected.length) {
    const i = firstUnmatchedComp >= 0 ? firstUnmatchedComp : comps.length - 1;
    return ev.fail('extra-molecule', { formula: ev.an(comps[i]!).formula });
  }
  if (comps.length < expected.length) {
    const j = firstUnmatchedExp >= 0 ? firstUnmatchedExp : expected.length - 1;
    return ev.fail('missing-molecule', { expected: expected.length, have: comps.length, formula: ev.an(expected[j]!).formula });
  }
  const i = firstUnmatchedComp >= 0 ? firstUnmatchedComp : 0;
  const j = firstUnmatchedExp >= 0 ? firstUnmatchedExp : 0;
  return compareFailure(ev, compare(i, j), comps[i]!, expected[j]!);
}

// ---------------------------------------------------------------------------
// choose-reagent and quiz
// ---------------------------------------------------------------------------

export function evaluateChooseReagent(rule: ChooseReagentRule, ctx: SubmissionContext, c: Challenge): SubmitResult {
  const ev = new Ev(c, ctx);
  const chosen = ctx.chosenReagent;
  if (chosen === undefined) return ev.fail('wrong-reagent', { reason: 'Pick a reagent card first.' });
  if (rule.correct.includes(chosen)) {
    return ev.pass('correct', { reagent: cardById(chosen).label, expected: cardById(chosen).label }, pointsFor(c, ctx.attempt, false));
  }
  const reason = rule.rejections?.[chosen];
  const labels = rule.correct.map((id) => cardById(id).label).join(' or ');
  if (ctx.attempt >= rule.maxAttempts) return ev.fail('attempts-exhausted', { expected: labels, reason });
  return ev.fail('wrong-reagent', { reason });
}

export function evaluateQuiz(rule: QuizMcRule | QuizYesNoRule, ctx: SubmissionContext, c: Challenge): SubmitResult {
  const ev = new Ev(c, ctx);
  const answer = ctx.quizAnswer;
  let ok: boolean;
  let expected: string;
  if (rule.kind === 'mc') {
    ok = typeof answer === 'string' && rule.correct.includes(answer);
    expected = rule.options.filter((o) => rule.correct.includes(o.id)).map((o) => o.text).join(' or ');
  } else {
    ok = typeof answer === 'boolean' && answer === rule.correct;
    expected = rule.correct ? 'Yes' : 'No';
  }
  if (ok) return ev.pass('correct', { explanation: rule.explanation }, pointsFor(c, ctx.attempt, false));
  if (ctx.attempt >= rule.maxAttempts) return ev.fail('attempts-exhausted', { explanation: rule.explanation, expected });
  return ev.fail('wrong-option');
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function evaluate(challenge: Challenge, ctx: SubmissionContext): SubmitResult {
  const rule = challenge.rule;
  switch (rule.type) {
    case 'exact-molecule':
    case 'name-to-structure':
      return evaluateExactMolecule(rule, ctx, challenge);
    case 'formula-and-groups':
      return evaluateFormulaAndGroups(rule, ctx, challenge);
    case 'isomer-set':
      return evaluateIsomerSet(rule, ctx, challenge);
    case 'stereo-exact':
      return evaluateStereoExact(rule, ctx, challenge);
    case 'select-atom':
      return evaluateSelectAtom(rule, ctx, challenge);
    case 'predict-product':
      return evaluatePredictProduct(rule, ctx, challenge);
    case 'choose-reagent':
      return evaluateChooseReagent(rule, ctx, challenge);
    case 'quiz':
      return evaluateQuiz(rule, ctx, challenge);
    default: {
      const _exhaustive: never = rule;
      void _exhaustive;
      throw new Error('unknown rule type');
    }
  }
}
