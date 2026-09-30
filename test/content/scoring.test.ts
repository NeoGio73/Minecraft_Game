import { describe, it, expect } from 'vitest';
import { ATTEMPT_MULTIPLIER, POINTS_BY_DIFFICULTY, pointsForAttempt, rawScore } from '@/content/types';
import { cellKey, pairKey, splitPairKey, zoneOf, elementOf, Block, isOpaque } from '@/world/types';

describe('scoring constants', () => {
  it('raw score rounds and clamps', () => {
    expect(rawScore(0, 49)).toBe(0);
    expect(rawScore(49, 49)).toBe(100);
    expect(rawScore(24, 49)).toBe(49);
    expect(rawScore(5, 0)).toBe(0);
  });
  it('attempt multipliers give full, half, zero', () => {
    expect(ATTEMPT_MULTIPLIER).toEqual([1, 0.5, 0]);
    expect(pointsForAttempt(POINTS_BY_DIFFICULTY.medium, 1, false)).toBe(4);
    expect(pointsForAttempt(POINTS_BY_DIFFICULTY.medium, 2, false)).toBe(2);
    expect(pointsForAttempt(POINTS_BY_DIFFICULTY.medium, 3, false)).toBe(0);
    expect(pointsForAttempt(POINTS_BY_DIFFICULTY.easy, 7, true)).toBe(2);
  });
});

describe('world keys and zones', () => {
  it('pair keys are ordered by linear cell index', () => {
    const a = cellKey(5, 9, 60);
    const b = cellKey(4, 9, 60);
    expect(pairKey(a, b)).toBe(`${b}|${a}`);
    expect(splitPairKey(pairKey(a, b))).toEqual([b, a]);
  });
  it('zones', () => {
    expect(zoneOf(60, 9, 60)).toBe('pad');
    expect(zoneOf(55, 9, 40)).toBe('reactant');
    expect(zoneOf(70, 9, 40)).toBe('product');
    expect(zoneOf(10, 9, 10)).toBe('world');
    expect(zoneOf(60, 8, 60)).toBe('world');
  });
  it('block helpers', () => {
    expect(elementOf(Block.OreBr)).toBe('Br');
    expect(elementOf(Block.AtomH)).toBe('H');
    expect(isOpaque(Block.AtomC)).toBe(false);
    expect(isOpaque(Block.Stone)).toBe(true);
  });
});
