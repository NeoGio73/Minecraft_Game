/**
 * ROH_TO_RX: alcohol -> alkyl halide with HX (SN1), SOCl2 / PBr3 / HF-pyridine
 * (SN2 with inversion). PURE MODULE. See docs/design/04-reaction-bench.md section 5.5.
 */
import { withoutBond } from '../chem/graph';
import {
  JUSTIFY, WARN, findCOH, hydrogensOf, isAllylic, isBenzylic, isStereocenter, noReaction, pushWarning,
  remapAfterRemoval, sameProduct, sp3, substituteAt, substituteInvert, substituteRacemize, substrateClass, weakestStereo,
} from './helpers';
import type { CXSite, RuleFn, RuleResult } from './helpers';
import { applyShift, checkShift } from './rearrangement';

export const ROH_MECHANISM: Readonly<Record<'ROH_HX_HCL' | 'ROH_HX_HBR' | 'ROH_SOCL2' | 'ROH_PBR3' | 'ROH_HF_PYR', 'SN1' | 'SN2'>> = {
  ROH_HX_HCL: 'SN1', ROH_HX_HBR: 'SN1', ROH_SOCL2: 'SN2', ROH_PBR3: 'SN2', ROH_HF_PYR: 'SN2',
};

function mechanismOf(id: string): 'SN1' | 'SN2' {
  const m = (ROH_MECHANISM as Readonly<Record<string, 'SN1' | 'SN2' | undefined>>)[id];
  if (!m) throw new Error(`ROH_TO_RX: card ${id} is not an alcohol-to-halide card`);
  return m;
}

export const applyRohToRx: RuleFn = (g, card, opts): RuleResult => {
  const X = card.halogen;
  if (!X) throw new Error(`ROH_TO_RX: card ${card.id} has no halogen`);
  const all = findCOH(g);
  const sites = all.filter((s) => sp3(g, s.c));
  if (sites.length === 0) return noReaction(all.length > 0 ? JUSTIFY.rohSp2 : JUSTIFY.noSubstrate(card));
  const warnings: string[] = [];
  if (sites.length > 1) warnings.push(WARN.multipleSites(sites.length, 'C–OH'));
  const s = sites[0]!;
  const site: CXSite = { c: s.c, x: s.o, bond: s.bond, halogen: X };
  const cls = substrateClass(g, s.c, s.o);
  const stabilised = isAllylic(g, s.c, s.o) || isBenzylic(g, s.c, s.o);
  const mech = mechanismOf(card.id);
  const centreStereo = (p: RuleResult['major'][number], c: number): RuleResult['stereo'] =>
    isStereocenter(p, hydrogensOf(p), c) ? 'racemic' : 'none';

  if (mech === 'SN1') {
    const fast = cls === 3 || stabilised;
    if (!fast) warnings.push(WARN.rohSlow);
    const unrearranged = substituteRacemize(g, site, X);
    const cU = remapAfterRemoval(s.c, s.o);
    let major = [unrearranged];
    let stereo = cls === 1 ? 'none' as const : centreStereo(unrearranged, cU);
    let mixture = false;
    const shift = fast && opts.rearrangement !== 'ignore' ? checkShift(withoutBond(g, s.bond), s.c) : null;
    if (shift) {
      const { graph: rearranged } = substituteAt(applyShift(g, shift), s.o, shift.to, X);
      const stereoR = centreStereo(rearranged, remapAfterRemoval(shift.to, s.o));
      if (opts.rearrangement === 'apply') {
        major = [rearranged];
        stereo = stereoR;
        pushWarning(warnings, WARN.rearrangementApplied);
      } else if (!sameProduct(unrearranged, rearranged)) {
        major = [unrearranged, rearranged];
        stereo = weakestStereo(stereo, stereoR);
        mixture = true;
        pushWarning(warnings, WARN.rearrangement);
      }
    }
    return {
      major, mechanism: 'SN1', stereo, warnings, justification: fast ? JUSTIFY.rohSn1 : JUSTIFY.rohSlow, mixture,
    };
  }
  if (cls === 3) return noReaction(JUSTIFY.rohTertiary, warnings);
  const hadTet = g.atoms[s.c]!.tet !== undefined;
  const product = substituteInvert(g, site, X);
  return {
    major: [product], mechanism: 'SN2', stereo: hadTet ? 'absolute' : 'none', warnings, justification: JUSTIFY.rohSn2,
  };
};
