/**
 * Select-atom mode: H mini-block targeting, `[` `]` candidate cycling,
 * heavy-atom fallback, result highlights. docs/design/07-ui.md §11. DOM module
 * (pointer movement only; the 3D outlines are drawn through RenderHooks).
 */
import type { Analysis, MoleculeGraph, Vec3 } from '../chem/types';
import type { SelectAtomRule, SubmitResult } from '../content/types';
import { answerSet, itemKey } from '../content/selectors';
import type { SelectionItem } from '../content/selectors';
import { parseEntry } from '../content/library';
import { PICK_DISTANCE, cellKey, parseCellKey } from '../world/types';
import type { CellKey } from '../world/types';
import { implicitHCell } from '../world/extract';
import { FEEDBACK, STRINGS, atomLabel } from './strings';
import { WRONG_HOLD_MS } from './hud';
import type { HCell, HudContext } from './hud';

export interface Candidate {
  readonly molecule: number;
  readonly atom: number;
  readonly hSlot?: number;
  readonly cell: CellKey;
  readonly center: Vec3;
  readonly half: number;
  /** Hydrogens on the atom (for heavy-atom fallbacks and hover text). */
  readonly hydrogens: number;
  /** A heavy atom on a 'hydrogens' rule: not cycled, selectable as "all hydrogens". */
  readonly fallback: boolean;
}

export interface SelectMode {
  readonly active: boolean;
  hovered(): Candidate | null;
  hoverText(c: Candidate): string;
  /** 'Hydrogen on O3' | 'C2' */
  describe(c: Candidate): string;
  /** Cycled candidates in cycling order (fallbacks excluded). */
  candidates(): readonly Candidate[];
  rebuild(): void;
  cycle(delta: 1 | -1): void;
  /** Place / E on the hovered candidate; true when consumed. */
  place(): boolean;
  /** Ray pick; true when the hovered candidate changed. */
  pick(): boolean;
  onSelectionChanged(): void;
  onSubmitted(result: SubmitResult): void;
  onPassed(): void;
  onChallengeChanged(): void;
  /** true while the mode forces the 'select' hydrogen view (T is ignored). */
  forcesHydrogens(): boolean;
  dispose(): void;
}

const POINTER_RELEASE_PX = 5;

function slab(origin: Vec3, dir: Vec3, center: Vec3, half: number): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = origin[i] ?? 0;
    const d = dir[i] ?? 0;
    const lo = (center[i] ?? 0) - half;
    const hi = (center[i] ?? 0) + half;
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const t = tmin >= 0 ? tmin : tmax;
  return t > 0 && t <= PICK_DISTANCE ? t : null;
}

export function mountSelectMode(ctx: HudContext): SelectMode {
  const { state, hooks } = ctx;
  const doc = ctx.canvas.ownerDocument;
  let active = false;
  let rule: SelectAtomRule | null = null;
  let cycled: Candidate[] = [];
  let fallbacks: Candidate[] = [];
  let hoveredC: Candidate | null = null;
  let cycledIndex = -1;
  let keyboardHover: Candidate | null = null;
  let movedSince = 0;
  let correct: Candidate[] = [];
  let wrong: Candidate[] = [];
  let wrongTimer: ReturnType<typeof setTimeout> | null = null;

  const onPointerMove = (e: PointerEvent): void => {
    if (!keyboardHover) return;
    movedSince += Math.abs(e.movementX) + Math.abs(e.movementY);
    if (movedSince >= POINTER_RELEASE_PX) keyboardHover = null;
  };
  doc.addEventListener('pointermove', onPointerMove);

  function toHCell(c: Candidate): HCell {
    return c.hSlot === undefined ? { cell: c.cell, center: c.center, half: c.half } : { cell: c.cell, slot: c.hSlot, center: c.center, half: c.half };
  }

  function keyOf(c: Candidate): string {
    return itemKey({ molecule: c.molecule, atom: c.atom, ...(c.hSlot === undefined ? {} : { hSlot: c.hSlot }) });
  }

  function isSelected(c: Candidate): boolean {
    if (c.hSlot !== undefined || !c.fallback) return state.selection.some((s) => keyOf(c) === itemKey(s));
    // heavy fallback on a hydrogens rule: selected when every hydrogen of the atom is
    if (c.hydrogens === 0) return false;
    const slots = new Set(state.selection.filter((s) => s.molecule === c.molecule && s.atom === c.atom && s.hSlot !== undefined).map((s) => s.hSlot));
    return slots.size >= c.hydrogens || state.selection.some((s) => s.molecule === c.molecule && s.atom === c.atom && s.hSlot === undefined);
  }

  function selectedCandidates(): Candidate[] {
    const all = [...cycled, ...fallbacks];
    const keys = new Set(state.selection.map(itemKey));
    const out: Candidate[] = [];
    for (const c of all) {
      if (c.hSlot === undefined && c.fallback) {
        if (keys.has(keyOf(c))) out.push(c);
        continue;
      }
      if (keys.has(keyOf(c))) out.push(c);
    }
    return out;
  }

  function pushHighlights(): void {
    if (!active) {
      hooks.setSelectHighlights({ hovered: null, selected: [], correct: [], wrong: [] });
      return;
    }
    hooks.setSelectHighlights({
      hovered: hoveredC ? toHCell(hoveredC) : null,
      selected: selectedCandidates().map(toHCell),
      correct: correct.map(toHCell),
      wrong: wrong.map(toHCell),
    });
  }

  function label(c: Candidate): string {
    const lp = state.locked.find((l) => l.molecule === c.molecule);
    const info = lp?.analysis.atoms[c.atom];
    return info ? atomLabel(info.el, c.atom) : `#${c.atom + 1}`;
  }

  function describe(c: Candidate): string {
    return c.hSlot === undefined ? label(c) : STRINGS.candidateH(label(c));
  }

  function hoverText(c: Candidate): string {
    if (c.hSlot !== undefined) return STRINGS.targetHCandidate(label(c), isSelected(c));
    if (c.fallback) return STRINGS.targetHeavyFallback(label(c), c.hydrogens);
    return STRINGS.targetAtomSelect(label(c), isSelected(c));
  }

  function rebuild(): void {
    const prevKeys = cycled.map(keyOf);
    const prevIndex = cycledIndex;
    const prevKeyboard = keyboardHover !== null;
    cycled = [];
    fallbacks = [];
    if (!active || !rule) return;
    const placements = [...state.locked].sort((a, b) => a.molecule - b.molecule);
    for (const lp of placements) {
      const m = lp.molecule;
      for (let atom = 0; atom < lp.atomToCell.length; atom++) {
        const cell = lp.atomToCell[atom];
        if (!cell) continue;
        const [x, y, z] = parseCellKey(cell);
        const n = lp.analysis.hydrogens[atom] ?? 0;
        if (rule.target === 'atoms') {
          cycled.push({ molecule: m, atom, cell, center: [x + 0.5, y + 0.5, z + 0.5], half: 0.31, hydrogens: n, fallback: false });
          continue;
        }
        const explicit = lp.hCells.get(atom) ?? [];
        for (let slot = 0; slot < n; slot++) {
          let c: Vec3 | null;
          let half: number;
          const ex = explicit[slot];
          if (slot < explicit.length && ex) {
            const p = parseCellKey(ex);
            c = [p[0], p[1], p[2]];
            half = 0.275;
          } else {
            c = implicitHCell(hooks.getBlock, x, y, z, slot - explicit.length);
            half = 0.2;
          }
          if (c === null) continue;
          const hcell = ex && slot < explicit.length ? ex : cellKey(c[0], c[1], c[2]);
          cycled.push({ molecule: m, atom, hSlot: slot, cell: hcell, center: [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5], half, hydrogens: n, fallback: false });
        }
        fallbacks.push({ molecule: m, atom, cell, center: [x + 0.5, y + 0.5, z + 0.5], half: 0.31, hydrogens: n, fallback: true });
      }
    }
    // Analyze (F) and every molecule:analyzed rebuild the lists; when the candidates are unchanged the keyboard-cycled
    // position survives, re-pointed at the fresh candidate objects (engineering review finding 9).
    const sameCandidates = prevKeys.length === cycled.length && prevKeys.every((k, i) => k === keyOf(cycled[i]!));
    if (sameCandidates && prevIndex >= 0 && prevIndex < cycled.length) {
      cycledIndex = prevIndex;
      if (prevKeyboard) {
        keyboardHover = cycled[prevIndex]!;
        hoveredC = keyboardHover;
      }
    } else {
      if (cycledIndex >= cycled.length) cycledIndex = -1;
      keyboardHover = null;
    }
    pushHighlights();
  }

  function pick(): boolean {
    if (!active) return false;
    let next: Candidate | null = null;
    if (keyboardHover) {
      next = keyboardHover;
    } else {
      const ray = hooks.crosshairRay();
      let best = Infinity;
      for (const c of cycled) {
        const t = slab(ray.origin, ray.dir, c.center, c.half);
        if (t !== null && t < best) { best = t; next = c; }
      }
      const hit = hooks.atomHit();
      if (hit && hit.t < best) {
        const cell = cellKey(hit.x, hit.y, hit.z);
        const lp = state.locked.find((l) => l.cellToAtom.has(cell));
        if (lp) {
          const atom = lp.cellToAtom.get(cell) ?? -1;
          const c = [...cycled, ...fallbacks].find((x) => x.hSlot === undefined && x.molecule === lp.molecule && x.atom === atom);
          if (c) { best = hit.t; next = c; }
        }
      }
    }
    if (next === hoveredC) return false;
    hoveredC = next;
    pushHighlights();
    return true;
  }

  function cycle(delta: 1 | -1): void {
    if (!active || cycled.length === 0) return;
    const n = cycled.length;
    cycledIndex = cycledIndex < 0 ? (delta > 0 ? 0 : n - 1) : (cycledIndex + delta + n) % n;
    const c = cycled[cycledIndex]!;
    keyboardHover = c;
    movedSince = 0;
    hoveredC = c;
    pushHighlights();
    state.announce(STRINGS.candidate(cycledIndex + 1, n, describe(c)), 'polite');
  }

  function place(): boolean {
    if (!active || !rule || !hoveredC) return false;
    const c = hoveredC;
    if (rule.target === 'hydrogens' && c.hSlot === undefined && c.hydrogens === 0) {
      state.announce(FEEDBACK['no-hydrogens']({}), 'assertive');
      return true;
    }
    const item: SelectionItem = c.hSlot === undefined ? { molecule: c.molecule, atom: c.atom } : { molecule: c.molecule, atom: c.atom, hSlot: c.hSlot };
    if (rule.match === 'any') {
      if (isSelected(c)) state.clearSelection();
      else state.setSelection([item]);
    } else {
      state.toggleSelection(item);
    }
    return true;
  }

  function clearResults(): void {
    correct = [];
    wrong = [];
    if (wrongTimer !== null) { clearTimeout(wrongTimer); wrongTimer = null; }
  }

  function answerCandidates(): Candidate[] {
    if (!rule) return [];
    try {
      const graphs: MoleculeGraph[] = rule.molecules.map((s) => parseEntry(s));
      const analyses: Analysis[] = [];
      for (let i = 0; i < rule.molecules.length; i++) {
        const lp = state.locked.find((l) => l.molecule === i);
        if (!lp) return [];
        analyses.push(lp.analysis);
      }
      const ans = answerSet(rule.selector, graphs, analyses);
      const keys = new Set(ans.map(itemKey));
      return [...cycled, ...fallbacks].filter((c) => keys.has(keyOf(c)) && (c.hSlot !== undefined || rule?.target === 'atoms'));
    } catch {
      return [];
    }
  }

  function enter(): void {
    const r = state.current.challenge.rule;
    if (r.type !== 'select-atom') return;
    active = true;
    rule = r;
    cycledIndex = -1;
    hoveredC = null;
    keyboardHover = null;
    clearResults();
    hooks.setHydrogenMode(r.target === 'hydrogens' ? 'select' : ctx.settings().showHydrogens ? 'blocks' : 'studs');
    state.selectSlot(11);
    rebuild();
  }

  function exit(): void {
    if (!active) return;
    active = false;
    rule = null;
    cycled = [];
    fallbacks = [];
    hoveredC = null;
    keyboardHover = null;
    clearResults();
    hooks.setHydrogenMode(ctx.settings().showHydrogens ? 'blocks' : 'studs');
    pushHighlights();
  }

  return {
    get active() { return active; },
    hovered: () => hoveredC,
    hoverText,
    describe,
    candidates: () => cycled,
    rebuild,
    cycle,
    place,
    pick,
    onSelectionChanged() {
      if (active) pushHighlights();
    },
    onSubmitted(result) {
      if (!active) return;
      clearResults();
      if (result.passed) {
        correct = selectedCandidates();
      } else if (result.kind === 'wrong-atom') {
        wrong = selectedCandidates();
        wrongTimer = setTimeout(() => {
          wrongTimer = null;
          wrong = [];
          state.clearSelection();
          pushHighlights();
        }, WRONG_HOLD_MS);
      } else if (result.kind === 'attempts-exhausted') {
        wrong = selectedCandidates();
        correct = answerCandidates();
      }
      pushHighlights();
    },
    onPassed() {
      if (active) pushHighlights();
    },
    onChallengeChanged() {
      const r = state.current.challenge.rule;
      if (r.type === 'select-atom') {
        if (active) exit();
        enter();
      } else {
        exit();
      }
    },
    forcesHydrogens: () => active && rule?.target === 'hydrogens',
    dispose() {
      doc.removeEventListener('pointermove', onPointerMove);
      if (wrongTimer !== null) clearTimeout(wrongTimer);
      active = false;
    },
  };
}
