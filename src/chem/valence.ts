/**
 * Target valence, lone pairs and the hotbar legend valence per element.
 * PURE MODULE. Values come from TARGET_VALENCE / VALENCE_ELECTRONS in
 * `types.ts` (acids-bases-hybrid 2.2, McMurry Table 2.3).
 */
import { TARGET_VALENCE, VALENCE_ELECTRONS } from './types';
import type { Charge, ChemApi, Element } from './types';

/** Total bond order (heavy bonds + hydrogens) an atom of `el` with `charge`
 *  must reach; `undefined` when the (element, charge) pair is unsupported. */
export function targetValence(el: Element, charge: Charge): number | undefined {
  return TARGET_VALENCE[el][charge];
}

/** Lone pairs = (V - charge - targetValence) / 2; 0 for unsupported pairs. */
export function lonePairs(el: Element, charge: Charge): number {
  const tv = targetValence(el, charge);
  return tv === undefined ? 0 : (VALENCE_ELECTRONS[el] - charge - tv) / 2;
}

/** Neutral target valence: the number shown in the hotbar legend ("C: 4 bonds"). */
export function maxValence(el: Element): number {
  return TARGET_VALENCE[el][0] as number;
}

const _check: Pick<ChemApi, 'targetValence' | 'lonePairs'> = { targetValence, lonePairs };
void _check;
