/**
 * Roster loader and instructor configuration: `OrgocraftConfig`,
 * `loadFullRoster`, `loadRoster`, `rosterInfo`, `totalPoints`, `isEnabled`,
 * `isomerHashes`, `isAttemptLimited`, `maxAttemptsOf`. PURE MODULE.
 * See docs/design/05-content.md sections 1, 2 and 10.
 */
import challengesJson from './challenges.json';
import configJson from '../../orgocraft.config.json';
import { DEFAULT_PASS_MARK } from './types';
import type { Challenge, ChallengeRoster, ChallengeRule, IsomerSetRule, ReagentId } from './types';
import type { RosterInfo } from '../lms/types';
import { parseSmiles } from '../chem/smiles';
import { implicitHydrogens } from '../chem/hydrogens';
import { perceiveAromaticity } from '../chem/aromatic';
import { wlHash } from '../chem/wlhash';

// ---------------------------------------------------------------------------
// Configuration (orgocraft.config.json)
// ---------------------------------------------------------------------------

export interface OrgocraftConfig {
  /** "1.0.0"; also stamped into the manifest. */
  readonly version: string;
  /** Percent, default DEFAULT_PASS_MARK (70); manifest masteryscore. */
  readonly passMark: number;
  /** Challenge ids the instructor switched off. */
  readonly disabledChallenges: readonly string[];
  /** Overrides ReagentCard.enabledByDefault when present. */
  readonly enabledReagents?: readonly ReagentId[];
  /** false in v1; true reveals requiresDiagonalBonds content. */
  readonly diagonalBonds: boolean;
}

export const DEFAULT_CONFIG: OrgocraftConfig = {
  version: '1.0.0',
  passMark: DEFAULT_PASS_MARK,
  disabledChallenges: [],
  diagonalBonds: false,
};

/** The bundled `orgocraft.config.json`, with defaults filled in for absent optional fields. */
export function loadConfig(): OrgocraftConfig {
  const raw = configJson as unknown as Partial<OrgocraftConfig>;
  return {
    version: typeof raw.version === 'string' ? raw.version : DEFAULT_CONFIG.version,
    passMark: typeof raw.passMark === 'number' && Number.isFinite(raw.passMark) ? raw.passMark : DEFAULT_CONFIG.passMark,
    disabledChallenges: Array.isArray(raw.disabledChallenges) ? [...raw.disabledChallenges] : [],
    ...(Array.isArray(raw.enabledReagents) ? { enabledReagents: [...raw.enabledReagents] } : {}),
    diagonalBonds: raw.diagonalBonds === true,
  };
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

const ROSTER = challengesJson as unknown as ChallengeRoster;

/** The roster file as-is (every record, including disabled and diagonal-only) in file order = bit order. */
export function loadFullRoster(): readonly Challenge[] {
  return ROSTER.challenges;
}

/** The roster record (version + challenges) for the validator. */
export function loadRosterFile(): ChallengeRoster {
  return ROSTER;
}

export function isEnabled(c: Challenge, config: OrgocraftConfig): boolean {
  if (config.disabledChallenges.includes(c.id)) return false;
  if (c.requiresDiagonalBonds && !config.diagonalBonds) return false;
  return true;
}

/** Enabled challenges in roster (file) order; disabled ones are REMOVED from the array but keep their
 *  roster index in RosterInfo.enabled so progress bitmasks never shift. */
export function loadRoster(config: OrgocraftConfig): Challenge[] {
  return ROSTER.challenges.filter((c) => isEnabled(c, config));
}

/** `{ids, points, enabled, passMark}` over every record of `roster` (pass the FULL roster: index = bit). */
export function rosterInfo(roster: readonly Challenge[], config: OrgocraftConfig): RosterInfo {
  return {
    ids: roster.map((c) => c.id),
    points: roster.map((c) => c.points),
    enabled: roster.map((c) => isEnabled(c, config)),
    passMark: config.passMark,
  };
}

/** Sum of points over enabled challenges. Never a literal. */
export function totalPoints(info: RosterInfo): number {
  let sum = 0;
  for (let i = 0; i < info.points.length; i++) if (info.enabled[i]) sum += info.points[i] ?? 0;
  return sum;
}

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

/** WL hash of a SMILES as `analyze` reports it (`wlHash(perceiveAromaticity(parsed), hydrogens).hash`). */
export function hashOfSmiles(smiles: string): string {
  const g = parseSmiles(smiles).graph;
  const { hydrogens } = implicitHydrogens(g);
  return wlHash(perceiveAromaticity(g), hydrogens).hash;
}

const isomerCache = new WeakMap<IsomerSetRule, { readonly required: ReadonlySet<string>; readonly optional: ReadonlySet<string> }>();

/** WL hashes of IsomerSetRule.isomers (and optionalDiagonalIsomers), computed once per rule object. */
export function isomerHashes(rule: IsomerSetRule): { readonly required: ReadonlySet<string>; readonly optional: ReadonlySet<string> } {
  const hit = isomerCache.get(rule);
  if (hit) return hit;
  const required = new Set<string>(rule.isomers.map(hashOfSmiles));
  const optional = new Set<string>((rule.optionalDiagonalIsomers ?? []).map(hashOfSmiles));
  const rec = { required, optional };
  isomerCache.set(rule, rec);
  return rec;
}

/** true for quiz, select-atom and choose-reagent (attempt-limited); false for build rules. */
export function isAttemptLimited(rule: ChallengeRule): boolean {
  return rule.type === 'quiz' || rule.type === 'select-atom' || rule.type === 'choose-reagent';
}

/** rule.maxAttempts, or Infinity for build rules. */
export function maxAttemptsOf(rule: ChallengeRule): number {
  switch (rule.type) {
    case 'quiz':
    case 'select-atom':
    case 'choose-reagent':
      return rule.maxAttempts;
    default:
      return Infinity;
  }
}

/** The challenge with `id` from the full roster, or undefined. */
export function challengeById(id: string): Challenge | undefined {
  return ROSTER.challenges.find((c) => c.id === id);
}
