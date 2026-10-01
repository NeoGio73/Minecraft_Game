/**
 * SN1 / SN2 / E1 / E2 decision table (McMurry 11.3, 11.5, 11.12), rules
 * R0-R6 evaluated in order. PURE MODULE.
 * See docs/design/04-reaction-bench.md section 5.7.
 */
import type { Mechanism, MoleculeGraph } from '../chem/types';
import type { Nucleophile, ReagentCard } from '../content/types';
import { smallestRings } from '../chem/graph';
import { JUSTIFY, WARN, findCX, substrateInfo } from './helpers';
import type { JustifyKey, Orientation } from './helpers';

export type DecisionRule = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';

export interface Decision {
  /** Ordered major first; empty = no reaction (`justification` says why). */
  readonly mechanisms: Mechanism[];
  readonly rule: DecisionRule;
  readonly justification: string;
  readonly warnings: string[];
  readonly orientation: Orientation;
}

/** Amide and acetylide anions: strong bases that McMurry never uses as SN2 nucleophiles on secondary halides. */
export function baseOnly(nuc: Nucleophile): boolean {
  return nuc.basicity === 'strong' && (nuc.atom === 'N' || nuc.atom === 'C');
}

function inSixRing(g: MoleculeGraph, c: number): boolean {
  return smallestRings(g).some((r) => r.length === 6 && r.includes(c));
}

/** Decides the mechanism list for the C–X at `cX` under `card` (a SUBST_ELIM card with `nuc`). */
export function decide(substrate: MoleculeGraph, cX: number, card: ReagentCard): Decision {
  const nuc = card.nuc;
  if (!nuc) throw new Error(`decide: card ${card.id} has no nucleophile attributes`);
  const orientation: Orientation = nuc.bulky ? 'hofmann' : 'zaitsev';
  const warnings: string[] = [];
  const done = (rule: DecisionRule, key: JustifyKey, mechanisms: Mechanism[]): Decision =>
    finish(substrate, cX, { mechanisms, rule, justification: JUSTIFY[key] as string, warnings, orientation });

  const site = findCX(substrate).find((s) => s.c === cX);
  if (!site) return done('R0', 'R0', []);
  const info = substrateInfo(substrate, site);
  if (info.sp2) return done('R1', 'R1', []);
  if (site.halogen === 'F') return done('R2', 'R2', []);
  if (info.betaCarbonyl) warnings.push(WARN.e1cb);
  const sol = card.solvent;
  const cls = info.cls;
  const stabilised = info.allylic || info.benzylic;

  if (nuc.basicity === 'strong') {
    if (cls === 3 && info.betaH === 0 && stabilised) return done('R3', 'R3_tert_sn1', ['SN1']);
    if (cls === 3) return done('R3', 'R3_tert', ['E2']);
    if (cls === 2 && baseOnly(nuc)) return done('R3', 'R3_sec_baseOnly', ['E2']);
    if (cls === 2) {
      return nuc.strength === 'strong' && !nuc.bulky
        ? done('R3', 'R3_sec', ['E2', 'SN2'])
        : done('R3', 'R3_sec_bulky', ['E2']);
    }
    if (cls === 1 && nuc.bulky) return done('R3', 'R3_bulky', ['E2']);
    if (cls === 1 && info.neopentyl) return done('R3', 'R3_neopentyl', ['E2']);
    if (cls === 1) return done('R3', 'R3_prim', ['SN2', 'E2']);
    return done('R3', 'R3_methyl', ['SN2']);
  }
  if (nuc.strength === 'strong' || nuc.strength === 'moderate') {
    if (cls <= 1) return done('R4', 'R4_prim', ['SN2']);
    if (cls === 2 && sol === 'protic' && stabilised) return done('R4', 'R4_sec_sn1', ['SN1', 'E1']);
    if (cls === 2) {
      if (sol === 'protic') warnings.push(WARN.proticSlow);
      return done('R4', 'R4_sec_sn2', ['SN2']);
    }
    if (sol === 'protic') return done('R4', 'R4_tert_protic', ['SN1', 'E1']);
    return done('R4', 'R4_tert_aprotic', []);
  }
  // Weak nucleophile: solvolysis.
  if (cls === 3 || (cls === 2 && stabilised)) return done('R5', 'R5_sn1', ['SN1', 'E1']);
  if (cls === 2) {
    warnings.push(WARN.slowSolvolysis);
    return done('R5', 'R5_sec_slow', ['SN1', 'E1']);
  }
  if (cls === 1 && stabilised) return done('R5', 'R5_allylic', ['SN1', 'E1']);
  return done('R5', 'R5_primary', []);
}

/** Post-filter: eliminations need a beta hydrogen; ring E2 gets the trans-diaxial note. */
function finish(substrate: MoleculeGraph, cX: number, d: Decision): Decision {
  if (d.mechanisms.length === 0) return d;
  const site = findCX(substrate).find((s) => s.c === cX);
  const betaH = site ? substrateInfo(substrate, site).betaH : 0;
  let mechanisms = d.mechanisms;
  if (betaH === 0) mechanisms = mechanisms.filter((m) => m !== 'E1' && m !== 'E2');
  if (mechanisms.length === 0) return { ...d, mechanisms, justification: JUSTIFY.noBetaH };
  const warnings = [...d.warnings];
  if (mechanisms[0] === 'E2' && inSixRing(substrate, cX)) warnings.push(WARN.ringConformation);
  return { ...d, mechanisms, warnings };
}
