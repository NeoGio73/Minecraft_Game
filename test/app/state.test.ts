/**
 * State: the non-consuming empty-selection submit (engineering review finding 4) and the reserved slot boxes
 * with the student-atom clearing that credits the inventory (finding 2).
 */
import { describe, it, expect } from 'vitest';
import {
  LOCKED_EXTENT, LOCKED_ORIGINS, REACTANT_MIN, RESERVED_MARGIN, State, inReservedBox, inReservedBoxes, reservedBoxesFor,
  studentCellsInBoxes,
} from '@/app/State';
import type { ProgressSink } from '@/app/State';
import { challengeById, loadConfig, loadFullRoster, maxAttemptsOf, rosterInfo } from '@/content/challenges';
import type { Challenge } from '@/content/types';
import { loadLibrary } from '@/content/library';
import { Outcome } from '@/lms/types';
import type { ProgressState } from '@/lms/types';
import { emptyState } from '@/lms/Progress';
import { World } from '@/world/world';
import { Block, cellKey } from '@/world/types';
import type { BlockElement } from '@/world/types';

loadLibrary();

const ch = (id: string): Challenge => {
  const c = challengeById(id);
  if (!c) throw new Error(`no challenge ${id}`);
  return c;
};

function makeState(inventory: Partial<Record<BlockElement, number>> = { C: 10 }): State {
  const config = loadConfig();
  const fullRoster = loadFullRoster();
  const info = rosterInfo(fullRoster, config);
  const sink: ProgressSink = { update: () => {}, milestone: (s: ProgressState) => s, save: () => {}, saveAndExit: () => Promise.resolve() };
  const state = new State({ fullRoster, rosterInfo: info, config, progress: emptyState(''), mode: 'standalone', studentId: null, sink, inventory });
  state.attachEngine({ molecules: () => [], clearZone: () => {} });
  return state;
}

function goTo(state: State, id: string): void {
  const i = state.roster.findIndex((c) => c.id === id);
  if (i < 0) throw new Error(`challenge ${id} is not enabled`);
  state.setChallenge(i);
}

describe('select-atom submit with nothing selected (finding 4)', () => {
  it('never consumes an attempt, sets no attempted bit and cannot exhaust the challenge', () => {
    const state = makeState();
    goTo(state, 'ch2-select-most-acidic-h-ethanol');
    const id = state.current.challenge.id;
    for (let k = 0; k < 4; k++) {
      const r = state.submit();
      expect(r.kind).toBe('nothing-selected');
      expect(r.passed).toBe(false);
      expect(r.message).toContain('Nothing is selected');
    }
    expect(state.attemptOf(id)).toBe(0);
    expect(state.outcomeOf(id)).toBe(Outcome.NotAttempted);
    // a real wrong pick consumes exactly one attempt and reads wrong-atom
    state.setSelection([{ molecule: 0, atom: 0 }]);
    expect(state.submit().kind).toBe('wrong-atom');
    expect(state.attemptOf(id)).toBe(1);
    expect(state.outcomeOf(id)).toBe(Outcome.Attempted);
    // and an empty submit afterwards still consumes nothing
    state.clearSelection();
    expect(state.submit().kind).toBe('nothing-selected');
    expect(state.attemptOf(id)).toBe(1);
  });

  it('on the last attempt an empty selection is not mis-reported as attempts-exhausted', () => {
    const state = makeState();
    goTo(state, 'ch2-select-most-acidic-h-ethanol');
    const c = state.current.challenge;
    const max = maxAttemptsOf(c.rule);
    for (let k = 1; k < max; k++) {
      state.setSelection([{ molecule: 0, atom: 0 }]);
      expect(state.submit().kind).toBe('wrong-atom');
    }
    expect(state.attemptOf(c.id)).toBe(max - 1);
    state.clearSelection();
    const empty = state.submit();
    expect(empty.kind).toBe('nothing-selected');
    expect(state.attemptOf(c.id)).toBe(max - 1);
    expect(state.outcomeOf(c.id)).toBe(Outcome.Attempted);
    // the genuine last attempt then exhausts normally and reveals the answer
    state.setSelection([{ molecule: 0, atom: 0 }]);
    const last = state.submit();
    expect(last.kind).toBe('attempts-exhausted');
    expect(last.message).toContain('The answer was');
    expect(state.attemptOf(c.id)).toBe(max);
  });
});

describe('reserved slot boxes (finding 2)', () => {
  it('reservedBoxesFor: select-atom slots, the quiz display slot, the bench reactant zone, nothing for build rules', () => {
    expect(reservedBoxesFor(ch('ch2-select-most-acidic-h-ethanol').rule)).toEqual([{ min: LOCKED_ORIGINS[0], extent: LOCKED_EXTENT }]);
    expect(reservedBoxesFor(ch('ch11-select-fastest-sn2-substrate').rule).map((b) => b.min)).toEqual(LOCKED_ORIGINS.slice(0, 3));
    expect(reservedBoxesFor(ch('ch11-predict-e2-2-bromobutane').rule)).toEqual([{ min: REACTANT_MIN, extent: [10, 21, 10] }]);
    expect(reservedBoxesFor(ch('ch1-build-methane').rule)).toEqual([]);
    const quiz = loadFullRoster().find((c) => c.rule.type === 'quiz' && c.rule.display !== undefined);
    expect(quiz).toBeDefined();
    expect(reservedBoxesFor(quiz!.rule)).toEqual([{ min: LOCKED_ORIGINS[0], extent: LOCKED_EXTENT }]);
  });

  it('inReservedBox covers the box plus RESERVED_MARGIN on every side; the spawn column is never reserved', () => {
    const box = { min: LOCKED_ORIGINS[0]!, extent: LOCKED_EXTENT };   // x 55..62, y 10..29, z 55..62
    expect(RESERVED_MARGIN).toBe(1);
    expect(inReservedBox(box, 55, 10, 55)).toBe(true);
    expect(inReservedBox(box, 62, 29, 62)).toBe(true);
    expect(inReservedBox(box, 54, 9, 54)).toBe(true);     // margin corner
    expect(inReservedBox(box, 63, 30, 63)).toBe(true);    // margin corner
    expect(inReservedBox(box, 53, 10, 55)).toBe(false);
    expect(inReservedBox(box, 64, 10, 55)).toBe(false);
    expect(inReservedBox(box, 55, 31, 55)).toBe(false);
    expect(inReservedBox(box, 55, 10, 64)).toBe(false);
    expect(inReservedBox(box, 54, 10, 55, 0)).toBe(false);
    const three = reservedBoxesFor(ch('ch11-select-fastest-sn2-substrate').rule);
    expect(inReservedBoxes(three, 64, 9, 64)).toBe(false);
    expect(inReservedBoxes(three, 63, 9, 64)).toBe(false);
    expect(inReservedBoxes(three, 66, 9, 56)).toBe(true);   // slot 1
    expect(inReservedBoxes(three, 56, 9, 67)).toBe(true);   // slot 2
  });

  it('clearing the boxes removes only the student atoms inside (+1 cell) and credits the inventory', () => {
    const world = new World();
    const state = makeState({ C: 10 });
    world.setBlock(56, 10, 56, Block.AtomC);   // inside slot 0
    world.setBlock(56, 11, 56, Block.AtomH);   // its explicit H block
    world.setBlock(63, 9, 63, Block.AtomC);    // margin cell
    world.setBlock(64, 9, 60, Block.AtomC);    // outside (x = 64)
    world.setBlock(70, 9, 70, Block.AtomC);    // far away
    const boxes = reservedBoxesFor(ch('ch2-select-most-acidic-h-ethanol').rule);
    const cells = studentCellsInBoxes(world.index.atoms, boxes, new Set());
    expect([...cells].sort()).toEqual([cellKey(56, 10, 56), cellKey(56, 11, 56), cellKey(63, 9, 63)].sort());
    // locked cells are never cleared
    expect(studentCellsInBoxes(world.index.atoms, boxes, new Set([cellKey(56, 10, 56), cellKey(56, 11, 56)]))).toEqual([cellKey(63, 9, 63)]);
    // the engine's loop (Game.clearReservedBoxes): heavy atoms are removed with their orphaned H blocks and credited
    let credited = 0;
    for (const cell of cells) {
      const atom = world.index.atoms.get(cell);
      if (!atom) continue;   // removed with its parent already
      if (atom.el === 'H') {
        world.setBlock(atom.x, atom.y, atom.z, Block.Air);
        continue;
      }
      world.removeAtomBlock(atom.x, atom.y, atom.z);
      state.addInventory(atom.el, 1);
      credited++;
    }
    expect(credited).toBe(2);
    expect(state.inventory.C).toBe(12);
    expect(world.getBlock(56, 10, 56)).toBe(Block.Air);
    expect(world.getBlock(56, 11, 56)).toBe(Block.Air);
    expect(world.getBlock(63, 9, 63)).toBe(Block.Air);
    expect(world.getBlock(64, 9, 60)).toBe(Block.AtomC);
    expect(world.getBlock(70, 9, 70)).toBe(Block.AtomC);
  });
});

describe('deferred analysis flag (finding 1b, synchronous fallback)', () => {
  it('setAnalysisDeferred marks the target stale, emits once per change and is pruned with the component', () => {
    const state = makeState();
    const seen: { component: number; deferred: boolean }[] = [];
    state.events.on('analysis:deferred', (e) => seen.push(e));
    state.setAnalysisDeferred(3, true);
    state.setAnalysisDeferred(3, true);
    expect(seen).toEqual([{ component: 3, deferred: true }]);
    state.setTarget(3, null, null);
    expect(state.target.analysisDeferred).toBe(true);
    state.setAnalysisDeferred(3, false);
    expect(state.target.analysisDeferred).toBe(false);
    expect(seen.length).toBe(2);
    state.setAnalysisDeferred(4, true);
    state.pruneAnalyses(new Set([3]));
    state.setTarget(4, null, null);
    expect(state.target.analysisDeferred).toBe(false);
  });
});
