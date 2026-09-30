import { describe, it, expect } from 'vitest';
import { createEmitter } from '@/app/events';

describe('createEmitter', () => {
  it('delivers typed events and supports unsubscribe', () => {
    const em = createEmitter();
    const seen: number[] = [];
    const off = em.on('score:changed', (e) => seen.push(e.raw));
    em.emit('score:changed', { earned: 2, total: 10, raw: 20, solved: 1, count: 5 });
    off();
    em.emit('score:changed', { earned: 4, total: 10, raw: 40, solved: 2, count: 5 });
    expect(seen).toEqual([20]);
  });
  it('once fires a single time and isolates throwing listeners', () => {
    const em = createEmitter();
    let n = 0;
    em.once('quiz:close', () => n++);
    em.on('quiz:close', () => { throw new Error('boom'); });
    em.on('quiz:close', () => n += 10);
    em.emit('quiz:close', { challengeId: 'x' });
    em.emit('quiz:close', { challengeId: 'x' });
    expect(n).toBe(21);
  });
});
