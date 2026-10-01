/**
 * Game state: roster and challenge progression, progress record and score,
 * inventory and hotbar slot, the targeted component, locked placements,
 * selection, the reaction-bench state and the one event emitter.
 * PURE MODULE (no three, no DOM): the engine (src/app/Game.ts) injects the
 * world readers it needs through `EngineHooks` and the LMS adapter through
 * `ProgressSink`. docs/design/07-ui.md §1.1, 06-engine.md §1, 08-deployment.md §3.8/§6.10,
 * 09-amendment-no-bond.md §1.10, §3.2.
 */
import type { Analysis, MoleculeGraph, ReactionResult, Vec3, WorldGraph } from '../chem/types';
import { analyze } from '../chem/analyze';
import { embedOnLattice } from '../chem/embed';
import type { Challenge, ChallengeRule, ReagentId, SubmissionContext, SubmitResult } from '../content/types';
import { creditDelta, evaluate, pointsFor } from '../content/acceptance';
import { isAttemptLimited, maxAttemptsOf } from '../content/challenges';
import type { OrgocraftConfig } from '../content/challenges';
import { feedbackText } from '../content/feedback';
import type { FeedbackParams } from '../content/feedback';
import { parseEntry } from '../content/library';
import { cardById } from '../content/reagents';
import { itemKey } from '../content/selectors';
import type { SelectionItem } from '../content/selectors';
import { Outcome } from '../lms/types';
import type { AdapterMode, ProgressState, RosterInfo, ScoreSummary } from '../lms/types';
import { RESUME_ATTEMPT_FLOOR, applyExhausted, applyOutcome, summarize, withCurrent, withIsomers } from '../lms/Progress';
import { react } from '../reactions/react';
import { relaxedLayout } from '../reactions/helpers';
import { BLOCK_ELEMENTS } from '../world/types';
import type { BlockElement, CellKey, ComponentId, PairKey, Zone } from '../world/types';
import { createEmitter } from './events';
import type { Emitter, GameEvents } from './events';

// ---------------------------------------------------------------------------
// 07 §1.1 — the State contract the UI consumes (hud.ts re-exports these)
// ---------------------------------------------------------------------------

/** A challenge-owned molecule placed on the pad (select-atom, quiz display) or in the reactant zone (bench). */
export interface LockedPlacement {
  /** Index into rule.molecules (select-atom) / 0 (quiz display, bench reactant) / 1 (bench rx). */
  readonly molecule: number;
  /** cell -> atom id in parseSmiles order of the rule SMILES. */
  readonly cellToAtom: ReadonlyMap<CellKey, number>;
  /** atom id -> cell. */
  readonly atomToCell: readonly CellKey[];
  /** Explicit H block cells per parent atom id (from Embedding.hPos), in hPos order. */
  readonly hCells: ReadonlyMap<number, readonly CellKey[]>;
  readonly analysis: Analysis;
  readonly zone: Zone;
}

export type HotbarTool = 'bond-wand' | 'charge-tool' | 'select-tool';
/** Slot index 0..11: 0-7 elements C N O S F Cl Br I, 8 = H, 9 bond wand, 10 charge tool, 11 select tool. */
export const HOTBAR: readonly (BlockElement | HotbarTool)[] =
  ['C', 'N', 'O', 'S', 'F', 'Cl', 'Br', 'I', 'H', 'bond-wand', 'charge-tool', 'select-tool'];

export interface TargetState {
  readonly component: ComponentId | null;
  readonly cell: CellKey | null;
  readonly pair: PairKey | null;
  readonly analysis: Analysis | null;
  /** cell -> atom id inside `analysis` (world extraction order). */
  readonly cellToAtom: ReadonlyMap<CellKey, number>;
  readonly atomToCell: readonly CellKey[];
  /** Touching-but-unbonded pairs with an endpoint in `component` (09 §1.10); [] when no target. */
  readonly suppressed: readonly PairKey[];
}

/** One bench preview (04 §1 + the ghost's suppressed pairs, 09 §3.2). */
export interface BenchPreview {
  readonly graph: MoleculeGraph;
  readonly pos: readonly Vec3[];
  readonly hPos: ReadonlyMap<number, readonly Vec3[]>;
  readonly buildable: boolean;
  readonly suppressedPairs?: readonly (readonly [number, number])[];
}

/** 04 §1 BenchState. */
export interface BenchState {
  readonly mode: 'idle' | 'predict' | 'choose' | 'free';
  readonly challengeId: string | null;
  readonly reactant: MoleculeGraph | null;
  readonly rx: MoleculeGraph | null;
  readonly cardId: ReagentId | null;
  readonly equiv: 1 | 2;
  readonly result: ReactionResult | null;
  readonly preview: 'hidden' | 'ghost' | 'sticks';
  readonly previews: readonly BenchPreview[];
}

export interface StateView {
  readonly events: Emitter<GameEvents>;
  readonly mode: AdapterMode;
  readonly studentId: string | null;
  /** Enabled challenges in roster order. */
  readonly roster: readonly Challenge[];
  readonly rosterInfo: RosterInfo;
  readonly progress: ProgressState;
  readonly score: ScoreSummary;
  readonly current: { readonly challenge: Challenge; readonly index: number };
  outcomeOf(id: string): Outcome;
  /** Attempts consumed on an attempt-limited challenge (floored after a resume, 08 §3.8); 0 for build rules. */
  attemptOf(id: string): number;
  isomersDone(id: string): number;
  readonly inventory: Readonly<Record<BlockElement, number>>;
  readonly slot: number;
  readonly target: TargetState;
  /** Every component on the pad (or product zone for bench challenges), in extraction order. */
  readonly padComponents: readonly { readonly id: ComponentId; readonly analysis: Analysis; readonly zone: Zone; readonly locked: boolean }[];
  readonly locked: readonly LockedPlacement[];
  readonly selection: readonly SelectionItem[];
  readonly bench: BenchState;
  readonly lookMode: 'locked' | 'drag' | 'keys';
  readonly paused: boolean;
  /** true after saveAndExit resolved: LMSFinish was called, the session is read-only. */
  readonly finished: boolean;
  readonly player: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };
  /**
   * Atom label of the heavy atom in `cell` (`element + (id + 1)` in the cell's OWN component, extraction order),
   * or, for an explicit H block, the label of its parent atom; null when the cell holds no atom (09 §5.5).
   */
  labelOfCell(cell: CellKey): string | null;
}

export interface StateCommands {
  setChallenge(index: number): void;
  nextChallenge(): void;
  prevChallenge(): void;
  submit(): SubmitResult;
  answerQuiz(choice: string | boolean): SubmitResult;
  chooseReagent(id: ReagentId): SubmitResult;
  react(): ReactionResult | null;
  setBenchCard(id: ReagentId | null): void;
  setEquiv(n: 1 | 2): void;
  setRx(smiles: string | null): void;
  showAnswer(): void;
  clearProductZone(): void;
  clearPad(): void;
  selectSlot(i: number): void;
  cycleSlot(delta: 1 | -1): void;
  toggleSelection(item: SelectionItem): void;
  setSelection(items: readonly SelectionItem[]): void;
  clearSelection(): void;
  setPaused(paused: boolean): void;
  save(): void;
  saveAndExit(): Promise<void>;
  announce(text: string, priority: 'polite' | 'assertive'): void;
}

export type UiState = StateView & StateCommands;

/** Pad cells where challenge-owned molecules are embedded (min corner of the embedding), in rule.molecules order. */
export const LOCKED_ORIGINS: readonly Vec3[] = [[55, 10, 55], [65, 10, 55], [55, 10, 66]];
/** 06 §10.6 slot box (cells): x in [ox, ox+7], y in [10, 29], z in [oz, oz+7]. */
export const LOCKED_EXTENT: Vec3 = [8, 20, 8];
/** 04 §7.2 reactant and product zones (inclusive cell ranges). */
export const REACTANT_MIN: Vec3 = [53, 10, 37];
export const REACTANT_MAX: Vec3 = [62, 30, 46];
export const PRODUCT_MIN: Vec3 = [65, 10, 37];
export const PRODUCT_MAX: Vec3 = [74, 30, 46];

/** Union of every locked placement's heavy cells and explicit-H cells. */
export function lockedCells(s: Pick<StateView, 'locked'>): ReadonlySet<CellKey> {
  const out = new Set<CellKey>();
  for (const lp of s.locked) {
    for (const c of lp.cellToAtom.keys()) out.add(c);
    for (const list of lp.hCells.values()) for (const c of list) out.add(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Engine-side contract (06 §1)
// ---------------------------------------------------------------------------

/** Per-component detail the engine passes with an analysis (extraction order; 02 §12.3). */
export interface ComponentDetail {
  /** cells[atomId] = cell of that heavy atom. */
  readonly cells: readonly CellKey[];
  /** hCells[atomId] = cells of the explicit H blocks of that atom, hPos order. */
  readonly hCells: readonly (readonly CellKey[])[];
}

/** Engine-side writers (Game.ts only; the HUD never calls them). */
export interface EngineStateCommands {
  /** Emits target:changed on change. */
  setTarget(component: ComponentId | null, cell: CellKey | null, pair: PairKey | null): void;
  /** null removes; emits molecule:analyzed. `suppressed` = suppressedPairsOfComponent(index, component). */
  setAnalysis(component: ComponentId, analysis: Analysis | null, zone: Zone, suppressed?: readonly PairKey[], detail?: ComponentDetail): void;
  /** Drops analyses whose component id is no longer in `live` (after a world edit). */
  pruneAnalyses(live: ReadonlySet<ComponentId>): void;
  setLocked(placements: readonly LockedPlacement[]): void;
  /** Emits inventory:changed; H ignored. */
  addInventory(el: BlockElement, n: number): void;
  setLookMode(mode: 'locked' | 'drag' | 'keys'): void;
  /** No event (the mirror reads it). */
  setPlayer(x: number, y: number, z: number, yaw: number): void;
  /** Adopts the adapter's merged record once start() resolved (08 §6.10 item 2, §3.8). */
  setLms(mode: AdapterMode, studentId: string | null, progress: ProgressState): void;
  attachEngine(hooks: EngineHooks): void;
}

/** Where the progress record goes (the ScormAdapter in the browser; a fake in tests). */
export interface ProgressSink {
  update(state: ProgressState): void;
  milestone(state: ProgressState): ProgressState;
  /** Standalone: mirror write; LMS: immediate commit. */
  save(): void;
  saveAndExit(): Promise<void>;
}

/** World readers and writers the pure state needs from the engine. */
export interface EngineHooks {
  /** Molecules of a zone with their component ids, extraction order. */
  molecules(zone: Zone): readonly { readonly component: ComponentId; readonly graph: WorldGraph }[];
  /** Removes every student-placed atom block of a zone (locked cells stay) and credits the inventory. */
  clearZone(zone: Zone): void;
}

export interface StateOptions {
  /** The full roster file (index = progress bit). */
  readonly fullRoster: readonly Challenge[];
  readonly rosterInfo: RosterInfo;
  readonly config: OrgocraftConfig;
  readonly progress: ProgressState;
  readonly mode: AdapterMode;
  readonly studentId: string | null;
  readonly sink: ProgressSink;
  /** Stored counts (H omitted); absent elements start at 0. */
  readonly inventory?: Readonly<Partial<Record<BlockElement, number>>> | null;
}

export type EngineState = UiState & EngineStateCommands;

interface AnalysisRecord {
  readonly analysis: Analysis;
  readonly zone: Zone;
  readonly suppressed: readonly PairKey[];
  readonly cells: readonly CellKey[];
  readonly hCells: readonly (readonly CellKey[])[];
}

const NO_TARGET: TargetState = { component: null, cell: null, pair: null, analysis: null, cellToAtom: new Map(), atomToCell: [], suppressed: [] };

const IDLE_BENCH: BenchState = {
  mode: 'idle', challengeId: null, reactant: null, rx: null, cardId: null, equiv: 1, result: null, preview: 'hidden', previews: [],
};

function extentOf(points: readonly Vec3[]): Vec3 {
  if (points.length === 0) return [0, 0, 0];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      const v = p[k] as number;
      if (v < (min[k] as number)) min[k] = v;
      if (v > (max[k] as number)) max[k] = v;
    }
  }
  return [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1];
}

/** 09 §3.2 previewFor: a lattice ghost when the embedding fits the product zone, else sticks from the relaxed layout. */
export function previewFor(graph: MoleculeGraph): BenchPreview {
  const e = embedOnLattice(graph);
  if (e) {
    const all: Vec3[] = [...e.pos];
    for (const list of e.hPos.values()) all.push(...list);
    const ext = extentOf(all);
    const max: Vec3 = [PRODUCT_MAX[0] - PRODUCT_MIN[0] + 1, PRODUCT_MAX[1] - PRODUCT_MIN[1] + 1, PRODUCT_MAX[2] - PRODUCT_MIN[2] + 1];
    if (ext[0] <= max[0] && ext[1] <= max[1] && ext[2] <= max[2]) {
      return { graph, pos: e.pos, hPos: e.hPos, suppressedPairs: e.suppressedPairs, buildable: true };
    }
  }
  return { graph, pos: relaxedLayout(graph), hPos: new Map(), suppressedPairs: [], buildable: false };
}

function isBenchRule(rule: ChallengeRule): boolean {
  return rule.type === 'predict-product' || rule.type === 'choose-reagent';
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class State implements EngineState {
  readonly events: Emitter<GameEvents> = createEmitter<GameEvents>();
  readonly roster: readonly Challenge[];
  readonly rosterInfo: RosterInfo;
  private readonly fullRoster: readonly Challenge[];
  private readonly config: OrgocraftConfig;
  private readonly sink: ProgressSink;
  private readonly bitOf = new Map<string, number>();
  private readonly byId = new Map<string, Challenge>();
  private engine: EngineHooks | null = null;

  private modeValue: AdapterMode;
  private studentIdValue: string | null;
  private progressValue: ProgressState;
  private scoreCache: { for: ProgressState; score: ScoreSummary } | null = null;
  /** Outcomes applied while the adapter was still discovering; replayed onto the merged record (08 §6.10 item 2). */
  private pending: ((s: ProgressState) => ProgressState)[] = [];
  private pendingMilestone = false;
  /** 08 §3.8 resume floors per challenge id. */
  private floors = new Map<string, number>();
  private readonly sessionAttempts = new Map<string, number>();

  private currentValue: { readonly challenge: Challenge; readonly index: number };
  private inventoryValue: Record<BlockElement, number>;
  private slotValue = 0;
  private targetValue: TargetState = NO_TARGET;
  private readonly analyses = new Map<ComponentId, AnalysisRecord>();
  private lockedValue: readonly LockedPlacement[] = [];
  private lockedSet: ReadonlySet<CellKey> = new Set();
  private selectionValue: readonly SelectionItem[] = [];
  private benchValue: BenchState = IDLE_BENCH;
  private lookModeValue: 'locked' | 'drag' | 'keys' = 'keys';
  private pausedValue = false;
  private finishedValue = false;
  private playerValue = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(opts: StateOptions) {
    this.fullRoster = opts.fullRoster;
    this.rosterInfo = opts.rosterInfo;
    this.config = opts.config;
    this.sink = opts.sink;
    opts.fullRoster.forEach((c, i) => {
      this.bitOf.set(c.id, i);
      this.byId.set(c.id, c);
    });
    this.roster = opts.fullRoster.filter((_, i) => opts.rosterInfo.enabled[i] === true);
    if (this.roster.length === 0) throw new Error('State: the roster has no enabled challenge');
    this.modeValue = opts.mode;
    this.studentIdValue = opts.studentId;
    this.progressValue = opts.progress;
    this.applyFloors(opts.progress);
    const inv: Record<BlockElement, number> = {} as Record<BlockElement, number>;
    for (const el of BLOCK_ELEMENTS) inv[el] = el === 'H' ? Infinity : Math.max(0, Math.floor(opts.inventory?.[el] ?? 0));
    this.inventoryValue = inv;
    const startIndex = Math.max(0, this.roster.findIndex((c) => c.id === opts.progress.currentChallengeId));
    this.currentValue = { challenge: this.roster[startIndex] as Challenge, index: startIndex };
    this.benchValue = this.benchFor(this.currentValue.challenge);
  }

  // -- view -------------------------------------------------------------------

  get mode(): AdapterMode { return this.modeValue; }
  get studentId(): string | null { return this.studentIdValue; }
  get progress(): ProgressState { return this.progressValue; }
  get score(): ScoreSummary {
    if (!this.scoreCache || this.scoreCache.for !== this.progressValue) {
      this.scoreCache = { for: this.progressValue, score: summarize(this.progressValue, this.rosterInfo) };
    }
    return this.scoreCache.score;
  }
  get current(): { readonly challenge: Challenge; readonly index: number } { return this.currentValue; }
  get inventory(): Readonly<Record<BlockElement, number>> { return this.inventoryValue; }
  get slot(): number { return this.slotValue; }
  get target(): TargetState { return this.targetValue; }
  get locked(): readonly LockedPlacement[] { return this.lockedValue; }
  get selection(): readonly SelectionItem[] { return this.selectionValue; }
  get bench(): BenchState { return this.benchValue; }
  get lookMode(): 'locked' | 'drag' | 'keys' { return this.lookModeValue; }
  get paused(): boolean { return this.pausedValue; }
  get finished(): boolean { return this.finishedValue; }
  get player(): { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number } { return this.playerValue; }

  get padComponents(): readonly { readonly id: ComponentId; readonly analysis: Analysis; readonly zone: Zone; readonly locked: boolean }[] {
    const benchZone = isBenchRule(this.currentValue.challenge.rule);
    const out: { id: ComponentId; analysis: Analysis; zone: Zone; locked: boolean }[] = [];
    for (const [id, rec] of this.analyses) {
      if (rec.zone !== 'pad' && !(benchZone && rec.zone === 'product')) continue;
      out.push({ id, analysis: rec.analysis, zone: rec.zone, locked: rec.cells.some((c) => this.lockedSet.has(c)) });
    }
    return out.sort((a, b) => a.id - b.id);
  }

  outcomeOf(id: string): Outcome {
    const i = this.bitOf.get(id);
    if (i === undefined) return Outcome.NotAttempted;
    const bit = 1n << BigInt(i);
    const p = this.progressValue;
    if ((p.solved & bit) !== 0n) return (p.reduced & bit) !== 0n ? Outcome.SolvedReduced : Outcome.SolvedFull;
    if ((p.attempted & bit) !== 0n) return Outcome.Attempted;
    return Outcome.NotAttempted;
  }

  attemptOf(id: string): number {
    const c = this.byId.get(id);
    if (!c || !isAttemptLimited(c.rule)) return 0;
    return (this.sessionAttempts.get(id) ?? 0) + (this.floors.get(id) ?? 0);
  }

  isomersDone(id: string): number {
    return (this.progressValue.isomersDone[id] ?? []).length;
  }

  labelOfCell(cell: CellKey): string | null {
    for (const rec of this.analyses.values()) {
      const i = rec.cells.indexOf(cell);
      if (i >= 0) {
        const a = rec.analysis.atoms[i];
        return a ? `${a.el}${i + 1}` : null;
      }
      for (let p = 0; p < rec.hCells.length; p++) {
        if ((rec.hCells[p] as readonly CellKey[]).includes(cell)) {
          const a = rec.analysis.atoms[p];
          return a ? `${a.el}${p + 1}` : null;
        }
      }
    }
    return null;
  }

  // -- challenge navigation ------------------------------------------------------

  setChallenge(index: number): void {
    const n = this.roster.length;
    const i = ((index % n) + n) % n;
    const challenge = this.roster[i] as Challenge;
    this.currentValue = { challenge, index: i };
    this.benchValue = this.benchFor(challenge);
    if (this.selectionValue.length > 0) {
      this.selectionValue = [];
      this.emitSelection();
    }
    this.progressValue = withCurrent(this.progressValue, challenge.id);
    this.sinkUpdate();
    this.events.emit('challenge:changed', { id: challenge.id, index: i });
  }

  nextChallenge(): void { this.setChallenge(this.currentValue.index + 1); }
  prevChallenge(): void { this.setChallenge(this.currentValue.index - 1); }

  private benchFor(c: Challenge): BenchState {
    const rule = c.rule;
    if (rule.type === 'predict-product') {
      let card: { equiv?: 1 | 2 } | null = null;
      try { card = cardById(rule.reagentId); } catch { card = null; }
      return {
        mode: 'predict', challengeId: c.id, reactant: parseEntry(rule.reactant), rx: rule.rx ? parseEntry(rule.rx) : null,
        cardId: rule.reagentId, equiv: rule.equiv ?? card?.equiv ?? 1, result: null, preview: 'hidden', previews: [],
      };
    }
    if (rule.type === 'choose-reagent') {
      const product = parseEntry(rule.product);
      const preview = previewFor(product);
      return {
        mode: 'choose', challengeId: c.id, reactant: parseEntry(rule.reactant), rx: null, cardId: null, equiv: 1, result: null,
        preview: preview.buildable ? 'ghost' : 'sticks', previews: [preview],
      };
    }
    return { ...IDLE_BENCH, mode: 'free', challengeId: null };
  }

  // -- submissions ----------------------------------------------------------------

  submit(): SubmitResult { return this.evaluateCurrent({}); }
  answerQuiz(choice: string | boolean): SubmitResult {
    const c = this.currentValue.challenge;
    const result = this.evaluateCurrent({ quizAnswer: choice });
    if (c.rule.type === 'quiz') this.events.emit('quiz:answer', { challengeId: c.id, choice, correct: result.passed, attempt: result.attempt });
    return result;
  }
  chooseReagent(id: ReagentId): SubmitResult { return this.evaluateCurrent({ chosenReagent: id }); }

  private evaluateCurrent(extra: { quizAnswer?: string | boolean; chosenReagent?: ReagentId }): SubmitResult {
    const c = this.currentValue.challenge;
    const rule = c.rule;
    const limited = isAttemptLimited(rule);
    const solved = this.outcomeOf(c.id) >= Outcome.SolvedReduced;
    if (limited && !solved && this.attemptOf(c.id) >= maxAttemptsOf(rule)) {
      return this.refuseExhausted(c);
    }
    const zone: Zone = rule.type === 'predict-product' ? 'product' : 'pad';
    const comps = this.engine ? this.engine.molecules(zone) : [];
    const targeted = comps.find((m) => m.component === this.targetValue.component)?.graph ?? null;
    const ctx: SubmissionContext = {
      padMolecules: comps.map((m) => m.graph),
      targeted,
      selection: this.selectionValue,
      ...(extra.chosenReagent !== undefined ? { chosenReagent: extra.chosenReagent } : {}),
      ...(extra.quizAnswer !== undefined ? { quizAnswer: extra.quizAnswer } : {}),
      isomersDone: new Set(this.progressValue.isomersDone[c.id] ?? []),
      attempt: this.attemptOf(c.id) + 1,
      diagonalBondsEnabled: this.config.diagonalBonds,
    };
    const result = evaluate(c, ctx);
    return this.finish(c, result, targeted, extra.chosenReagent !== undefined);
  }

  /** 08 §3.8: the exhausted lock refuses a submission and shows the answer again. */
  private refuseExhausted(c: Challenge): SubmitResult {
    const rule = c.rule;
    const params: Record<string, string | number | undefined> = {};
    if (rule.type === 'quiz') {
      params['explanation'] = rule.explanation;
      params['expected'] = rule.kind === 'mc' ? rule.options.filter((o) => rule.correct.includes(o.id)).map((o) => o.text).join(' or ') : rule.correct ? 'Yes' : 'No';
    } else if (rule.type === 'select-atom') {
      params['expected'] = rule.answerDescription;
    } else if (rule.type === 'choose-reagent') {
      params['expected'] = rule.correct.map((id) => { try { return cardById(id).label; } catch { return id; } }).join(' or ');
    }
    const result: SubmitResult = {
      passed: false, kind: 'attempts-exhausted',
      message: feedbackText('attempts-exhausted', params as FeedbackParams, c.feedback?.['attempts-exhausted']),
      attempt: this.attemptOf(c.id), pointsEarned: 0,
    };
    const idx = this.bitOf.get(c.id);
    if (idx !== undefined) this.applyProgress((s) => applyExhausted(s, idx), false);
    this.events.emit('challenge:submitted', { id: c.id, result });
    return result;
  }

  private finish(c: Challenge, raw: SubmitResult, targeted: MoleculeGraph | null, hadCard: boolean): SubmitResult {
    const idx = this.bitOf.get(c.id);
    let result = raw;
    const consuming = raw.kind !== 'nothing-targeted' && raw.kind !== 'no-hydrogens' && !(raw.kind === 'wrong-reagent' && !hadCard);
    if (isAttemptLimited(c.rule) && consuming) this.sessionAttempts.set(c.id, (this.sessionAttempts.get(c.id) ?? 0) + 1);
    let passedEvent: { pointsEarned: number } | null = null;
    if (idx !== undefined && raw.passed) {
      const full = pointsFor(c, 1, false);
      const bit = 1n << BigInt(idx);
      const solvedBefore = (this.progressValue.solved & bit) !== 0n;
      const delta = creditDelta(c, raw, this.progressValue, idx);
      if (!solvedBefore) {
        const outcome: Outcome = raw.pointsEarned >= full ? Outcome.SolvedFull : Outcome.SolvedReduced;
        const points = raw.pointsEarned;
        this.applyProgress((s) => applyOutcome(s, idx, outcome, points), true);
        if (raw.kind === 'correct' && points > 0 && points < full) result = { ...raw, kind: 'correct-reduced' };
        passedEvent = { pointsEarned: points };
      } else if (delta > 0) {
        const points = c.points;
        this.applyProgress((s) => applyOutcome(s, idx, Outcome.SolvedFull, points), true);
        result = { ...raw, pointsEarned: delta };
        passedEvent = { pointsEarned: delta };
      } else {
        result = { ...raw, pointsEarned: 0 };
      }
    } else if (idx !== undefined && consuming) {
      if (raw.kind === 'attempts-exhausted') this.applyProgress((s) => applyExhausted(s, idx), false);
      else this.applyProgress((s) => applyOutcome(s, idx, Outcome.Attempted, 0), false);
    }
    if (c.rule.type === 'isomer-set' && raw.kind === 'correct' && targeted) {
      const hash = analyze(targeted).hash;
      const done = this.progressValue.isomersDone[c.id] ?? [];
      if (!done.includes(hash)) {
        const id = c.id;
        this.applyProgress((s) => withIsomers(s, id, [...(s.isomersDone[id] ?? []), hash]), false);
      }
    }
    this.events.emit('challenge:submitted', { id: c.id, result });
    if (passedEvent) {
      this.events.emit('challenge:passed', { id: c.id, pointsEarned: passedEvent.pointsEarned, attempt: result.attempt });
      this.emitScore();
    }
    return result;
  }

  /** Applies a progress transition; while the adapter is discovering it is queued and replayed on setLms. */
  private applyProgress(fn: (s: ProgressState) => ProgressState, milestone: boolean): void {
    this.progressValue = fn(this.progressValue);
    if (this.modeValue === 'discovering') {
      this.pending.push(fn);
      this.pendingMilestone ||= milestone;
      this.sink.update(this.progressValue);
      return;
    }
    if (milestone) this.progressValue = this.sink.milestone(this.progressValue);
    else this.sink.update(this.progressValue);
  }

  private sinkUpdate(): void {
    this.sink.update(this.progressValue);
  }

  private emitScore(): void {
    const s = this.score;
    this.events.emit('score:changed', { earned: s.earned, total: s.total, raw: s.raw, solved: s.solvedCount, count: s.enabledCount });
  }

  // -- bench ---------------------------------------------------------------------

  react(): ReactionResult | null {
    const b = this.benchValue;
    if (this.finishedValue) return null;
    let reactant: MoleculeGraph | null = b.reactant;
    if (b.mode === 'free') {
      const comps = this.engine ? this.engine.molecules('reactant') : [];
      reactant = comps.length === 1 ? (comps[0] as { graph: WorldGraph }).graph : null;
    } else if (b.mode !== 'predict') {
      return null;
    }
    if (!reactant || !b.cardId) return null;
    let card;
    try { card = cardById(b.cardId); } catch { return null; }
    const result = react(reactant, card, { equiv: b.equiv, ...(b.rx ? { rx: b.rx } : {}) });
    const previews = result.noReaction ? [] : result.major.map(previewFor);
    const hidden = b.mode === 'predict' && this.outcomeOf(this.currentValue.challenge.id) < Outcome.SolvedReduced;
    this.benchValue = {
      ...b, reactant, result, previews,
      preview: hidden || previews.length === 0 ? 'hidden' : previews.some((p) => !p.buildable) ? 'sticks' : 'ghost',
    };
    this.events.emit('bench:reacted', { reagentId: b.cardId, result });
    return result;
  }

  setBenchCard(id: ReagentId | null): void {
    const b = this.benchValue;
    if (b.mode !== 'free') return;
    let equiv: 1 | 2 = b.equiv;
    if (id) { try { equiv = cardById(id).equiv ?? b.equiv; } catch { /* unknown card: keep */ } }
    this.benchValue = { ...b, cardId: id, equiv };
  }

  setEquiv(n: 1 | 2): void {
    const b = this.benchValue;
    const rule = this.currentValue.challenge.rule;
    if (b.mode === 'predict' && rule.type === 'predict-product' && rule.equiv !== undefined) return;
    this.benchValue = { ...b, equiv: n };
  }

  setRx(smiles: string | null): void {
    const b = this.benchValue;
    if (b.mode !== 'free') return;
    let rx: MoleculeGraph | null = null;
    if (smiles) { try { rx = parseEntry(smiles); } catch { rx = null; } }
    this.benchValue = { ...b, rx };
  }

  showAnswer(): void {
    const b = this.benchValue;
    const rule = this.currentValue.challenge.rule;
    if (b.mode !== 'predict' || rule.type !== 'predict-product') return;
    if (this.outcomeOf(this.currentValue.challenge.id) < Outcome.SolvedReduced) return;
    const previews = rule.expected.map((s) => previewFor(parseEntry(s)));
    this.benchValue = { ...b, previews, preview: previews.some((p) => !p.buildable) ? 'sticks' : 'ghost' };
  }

  clearProductZone(): void {
    const b = this.benchValue;
    if (this.engine) {
      this.engine.clearZone('product');
      if (b.mode === 'free') this.engine.clearZone('reactant');
    }
    this.benchValue = { ...b, result: null, previews: b.mode === 'choose' ? b.previews : [], preview: b.mode === 'choose' ? b.preview : 'hidden' };
    this.events.emit('bench:cleared', {});
  }

  clearPad(): void {
    this.engine?.clearZone('pad');
    this.clearSelection();
  }

  // -- hotbar and inventory ---------------------------------------------------------

  selectSlot(i: number): void {
    const n = HOTBAR.length;
    const s = ((Math.round(i) % n) + n) % n;
    this.slotValue = s;
    this.emitInventory();
  }

  cycleSlot(delta: 1 | -1): void {
    this.selectSlot(this.slotValue + delta);
  }

  addInventory(el: BlockElement, n: number): void {
    if (el === 'H') return;
    this.inventoryValue = { ...this.inventoryValue, [el]: Math.max(0, this.inventoryValue[el] + n) };
    this.emitInventory();
  }

  private emitInventory(): void {
    this.events.emit('inventory:changed', { counts: this.inventoryValue, slot: this.slotValue });
  }

  // -- selection --------------------------------------------------------------------

  toggleSelection(item: SelectionItem): void {
    const k = itemKey(item);
    const had = this.selectionValue.some((s) => itemKey(s) === k);
    this.selectionValue = had ? this.selectionValue.filter((s) => itemKey(s) !== k) : [...this.selectionValue, item];
    this.emitSelection();
  }

  setSelection(items: readonly SelectionItem[]): void {
    const seen = new Set<string>();
    const out: SelectionItem[] = [];
    for (const it of items) {
      const k = itemKey(it);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
    this.selectionValue = out;
    this.emitSelection();
  }

  clearSelection(): void {
    if (this.selectionValue.length === 0) return;
    this.selectionValue = [];
    this.emitSelection();
  }

  private emitSelection(): void {
    const cells: CellKey[] = [];
    const hydrogens: { cell: CellKey; slot: number }[] = [];
    for (const it of this.selectionValue) {
      const lp = this.lockedValue.find((l) => l.molecule === it.molecule);
      const cell = lp ? lp.atomToCell[it.atom] : this.targetValue.atomToCell[it.atom];
      if (!cell) continue;
      if (it.hSlot === undefined) cells.push(cell);
      else hydrogens.push({ cell, slot: it.hSlot });
    }
    this.events.emit('selection:changed', { cells, hydrogens });
  }

  // -- misc commands ------------------------------------------------------------------

  setPaused(paused: boolean): void { this.pausedValue = paused; }

  save(): void { this.sink.save(); }

  async saveAndExit(): Promise<void> {
    await this.sink.saveAndExit();
    this.finishedValue = true;
  }

  announce(text: string, priority: 'polite' | 'assertive'): void {
    this.events.emit('live:announce', { text, priority });
  }

  // -- engine commands ---------------------------------------------------------------

  attachEngine(hooks: EngineHooks): void { this.engine = hooks; }

  setLms(mode: AdapterMode, studentId: string | null, progress: ProgressState): void {
    this.modeValue = mode;
    this.studentIdValue = studentId;
    let merged = progress;
    const replay = this.pending.splice(0);
    const milestone = this.pendingMilestone;
    this.pendingMilestone = false;
    for (const fn of replay) merged = fn(merged);
    this.applyFloors(progress);
    this.progressValue = withCurrent(merged, this.currentValue.challenge.id);
    if (milestone && mode !== 'discovering') this.progressValue = this.sink.milestone(this.progressValue);
    else this.sink.update(this.progressValue);
    this.emitScore();
  }

  /** 08 §3.8: attempt floors from the resumed bits (fixed for the session). */
  private applyFloors(progress: ProgressState): void {
    this.floors = new Map();
    for (const c of this.fullRoster) {
      if (!isAttemptLimited(c.rule)) continue;
      const i = this.bitOf.get(c.id);
      if (i === undefined) continue;
      const bit = 1n << BigInt(i);
      if ((progress.solved & bit) !== 0n) continue;
      if ((progress.exhausted & bit) !== 0n) this.floors.set(c.id, maxAttemptsOf(c.rule));
      else if ((progress.attempted & bit) !== 0n) this.floors.set(c.id, RESUME_ATTEMPT_FLOOR);
    }
  }

  setTarget(component: ComponentId | null, cell: CellKey | null, pair: PairKey | null): void {
    const t = this.targetValue;
    if (t.component === component && t.cell === cell && t.pair === pair) return;
    this.targetValue = this.buildTarget(component, cell, pair);
    this.events.emit('target:changed', { component, cell, pair });
  }

  private buildTarget(component: ComponentId | null, cell: CellKey | null, pair: PairKey | null): TargetState {
    const rec = component === null ? undefined : this.analyses.get(component);
    if (!rec) return { ...NO_TARGET, component, cell, pair };
    const cellToAtom = new Map<CellKey, number>();
    rec.cells.forEach((c, i) => cellToAtom.set(c, i));
    return { component, cell, pair, analysis: rec.analysis, cellToAtom, atomToCell: rec.cells, suppressed: rec.suppressed };
  }

  setAnalysis(component: ComponentId, analysis: Analysis | null, zone: Zone, suppressed: readonly PairKey[] = [], detail?: ComponentDetail): void {
    if (analysis === null) {
      this.analyses.delete(component);
    } else {
      const cells = detail?.cells ?? this.analyses.get(component)?.cells ?? [];
      const hCells = detail?.hCells ?? this.analyses.get(component)?.hCells ?? [];
      this.analyses.set(component, { analysis, zone, suppressed, cells, hCells });
    }
    if (this.targetValue.component === component) {
      const t = this.targetValue;
      this.targetValue = this.buildTarget(t.component, t.cell, t.pair);
    }
    if (analysis !== null) this.events.emit('molecule:analyzed', { component, analysis, zone });
  }

  pruneAnalyses(live: ReadonlySet<ComponentId>): void {
    for (const id of Array.from(this.analyses.keys())) if (!live.has(id)) this.analyses.delete(id);
    const t = this.targetValue;
    if (t.component !== null && !live.has(t.component)) {
      this.targetValue = NO_TARGET;
      this.events.emit('target:changed', { component: null, cell: null, pair: null });
    }
  }

  setLocked(placements: readonly LockedPlacement[]): void {
    this.lockedValue = placements;
    this.lockedSet = lockedCells({ locked: placements });
  }

  setLookMode(mode: 'locked' | 'drag' | 'keys'): void { this.lookModeValue = mode; }

  setPlayer(x: number, y: number, z: number, yaw: number): void { this.playerValue = { x, y, z, yaw }; }
}
