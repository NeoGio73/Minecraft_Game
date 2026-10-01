/**
 * Reagent card loader: `loadReagents`, `cardById`, `isReagentEnabled`.
 * PURE MODULE. See docs/design/05-content.md section 10 and 04-reaction-bench.md section 2.
 */
import reagentsJson from './reagents.json';
import type { ReagentCard, ReagentId } from './types';
import type { OrgocraftConfig } from './challenges';

const CARDS = reagentsJson as unknown as readonly ReagentCard[];

let byId: Map<ReagentId, ReagentCard> | null = null;

function index(): Map<ReagentId, ReagentCard> {
  if (byId) return byId;
  byId = new Map();
  for (const c of CARDS) byId.set(c.id, c);
  return byId;
}

/** Every card in `reagents.json` order (a fresh array; cards are shared, immutable records). */
export function loadReagents(): ReagentCard[] {
  return [...CARDS];
}

/** Throws on an unknown id (a content bug). */
export function cardById(id: ReagentId): ReagentCard {
  const c = index().get(id);
  if (!c) throw new Error(`unknown reagent card: ${String(id)}`);
  return c;
}

/** `config.enabledReagents` overrides `enabledByDefault` when present; diagonal-only cards need `config.diagonalBonds`. */
export function isReagentEnabled(card: ReagentCard, config: Pick<OrgocraftConfig, 'enabledReagents' | 'diagonalBonds'>): boolean {
  if (card.requiresDiagonalBonds === true && !config.diagonalBonds) return false;
  if (config.enabledReagents !== undefined) return config.enabledReagents.includes(card.id);
  return card.enabledByDefault;
}

/** The cards a configuration enables, in file order. */
export function enabledReagents(config: Pick<OrgocraftConfig, 'enabledReagents' | 'diagonalBonds'>): ReagentCard[] {
  return CARDS.filter((c) => isReagentEnabled(c, config));
}
