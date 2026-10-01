/**
 * SN1 / SN2 builders and the SUBST_ELIM rule (every chapter-11 card).
 * PURE MODULE. See docs/design/04-reaction-bench.md section 5.8.
 */
import type { Mechanism, MoleculeGraph, ReactionStereo } from '../chem/types';
import { withoutBond } from '../chem/graph';
import {
  JUSTIFY, WARN, dedupe, findCX, hydrogensOf, isStereocenter, noReaction, pushWarning,
  remapAfterRemoval, sameProduct, sp3, substituteAt, substituteInvert, substituteRacemize, weakestStereo,
} from './helpers';
import type { CXSite, RuleFn, RuleResult } from './helpers';
import { decide } from './decision';
import { applyE1, applyE2 } from './elimination';
import { applyShift, checkShift } from './rearrangement';

export interface SubstBuild {
  readonly products: MoleculeGraph[];
  /** The mechanism's own runner-ups (E2/E1 alkenes). */
  readonly runnerUps: MoleculeGraph[];
  readonly stereo: ReactionStereo;
  readonly mixture: boolean;
  readonly warnings: string[];
}

function centerStereo(g: MoleculeGraph, c: number): ReactionStereo {
  return isStereocenter(g, hydrogensOf(g), c) ? 'racemic' : 'none';
}

/** SN2 with inversion at `site.c`. */
export function sn2Product(g: MoleculeGraph, site: CXSite, fragment: string): SubstBuild {
  const hadTet = g.atoms[site.c]!.tet !== undefined;
  const graph = substituteInvert(g, site, fragment);
  const c = remapAfterRemoval(site.c, site.x);
  const stereo: ReactionStereo = hadTet ? 'absolute' : centerStereo(graph, c);
  return { products: [graph], runnerUps: [], stereo, mixture: false, warnings: [] };
}

/** SN1 through the carbocation at `site.c`, with the 1,2-shift policy (04 section 5.6). */
export function sn1Products(g: MoleculeGraph, site: CXSite, fragment: string, policy: 'warn' | 'apply' | 'ignore'): SubstBuild {
  const warnings: string[] = [];
  if (g.atoms[site.c]!.tet !== undefined) warnings.push(WARN.sn1Racemic);
  const unrearranged = substituteRacemize(g, site, fragment);
  const cU = remapAfterRemoval(site.c, site.x);
  const stereoU = centerStereo(unrearranged, cU);
  const shift = policy === 'ignore' ? null : checkShift(withoutBond(g, site.bond), site.c);
  if (!shift) return { products: [unrearranged], runnerUps: [], stereo: stereoU, mixture: false, warnings };
  const shifted = applyShift(g, shift);
  const { graph: rearranged } = substituteAt(shifted, site.x, shift.to, fragment);
  const cR = remapAfterRemoval(shift.to, site.x);
  const stereoR = centerStereo(rearranged, cR);
  if (policy === 'apply') {
    warnings.push(WARN.rearrangementApplied);
    return { products: [rearranged], runnerUps: [], stereo: stereoR, mixture: false, warnings };
  }
  if (sameProduct(unrearranged, rearranged)) {
    return { products: [unrearranged], runnerUps: [], stereo: stereoU, mixture: false, warnings };
  }
  warnings.push(WARN.rearrangement);
  return {
    products: [unrearranged, rearranged], runnerUps: [], stereo: weakestStereo(stereoU, stereoR), mixture: true, warnings,
  };
}

function buildMechanism(g: MoleculeGraph, site: CXSite, mech: Mechanism, fragment: string, orientation: 'zaitsev' | 'hofmann', policy: 'warn' | 'apply' | 'ignore'): SubstBuild {
  switch (mech) {
    case 'SN2': return sn2Product(g, site, fragment);
    case 'SN1': return sn1Products(g, site, fragment, policy);
    case 'E2': {
      const r = applyE2(g, site, orientation);
      return { products: r.major, runnerUps: r.minor, stereo: 'none', mixture: r.mixture, warnings: r.warnings };
    }
    case 'E1': {
      const r = applyE1(g, site.c, site.x, orientation, policy);
      return { products: r.major, runnerUps: r.minor, stereo: 'none', mixture: r.mixture, warnings: r.warnings };
    }
    default:
      throw new Error(`SUBST_ELIM: unexpected mechanism ${mech}`);
  }
}

/** SUBST_ELIM: the decision table picks the mechanisms; the builders make the products (04 section 5.8). */
export const applySubstElim: RuleFn = (g, card, opts): RuleResult => {
  const nuc = card.nuc;
  if (!nuc) throw new Error(`SUBST_ELIM: card ${card.id} has no nucleophile attributes`);
  const all = findCX(g);
  const sp3Sites = all.filter((s) => sp3(g, s.c));
  const sites = sp3Sites.length > 0 ? sp3Sites : all;
  if (sites.length === 0) return noReaction(JUSTIFY.R0);
  const warnings: string[] = [];
  if (sites.length > 1) warnings.push(WARN.multipleSites(sites.length, 'C–X'));
  const site = sites[0]!;
  const d = decide(g, site.c, card);
  for (const w of d.warnings) pushWarning(warnings, w);
  if (d.mechanisms.length === 0) return noReaction(d.justification, warnings);
  const builds = d.mechanisms.map((m) => buildMechanism(g, site, m, nuc.fragment, d.orientation, opts.rearrangement));
  const first = builds[0]!;
  if (first.products.length === 0) return noReaction(JUSTIFY.noBetaH, warnings);
  const major = first.products;
  const minorRaw = [...first.runnerUps, ...builds.slice(1).flatMap((b) => b.products)];
  const minor = dedupe(minorRaw).filter((m) => !major.some((p) => sameProduct(p, m)));
  for (const b of builds) for (const w of b.warnings) pushWarning(warnings, w);
  return {
    major, minor, mechanism: d.mechanisms[0]!, stereo: first.stereo, warnings,
    justification: d.justification, mixture: first.mixture,
  };
};
