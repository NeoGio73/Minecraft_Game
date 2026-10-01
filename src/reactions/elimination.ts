/**
 * E1 / E2 builders (Zaitsev / Hofmann selection, E/Z display rule,
 * anti-periplanar E2 geometry) and the DEHYDRATION rule. PURE MODULE.
 * See docs/design/04-reaction-bench.md sections 5.8.1-5.8.4 and DEHYDRATION.
 */
import type { MoleculeGraph } from '../chem/types';
import { bondBetween, neighborsOf, ringsThrough, withEz, withoutBond } from '../chem/graph';
import { parityInOrder } from '../chem/stereo';
import {
  JUSTIFY, WARN, dedupe, deg, eliminate, findCOH, hydrogensOf, noReaction, pushWarning,
  remapAfterRemoval, sameProduct, sigmaPartners, sp3, substrateClass,
} from './helpers';
import type { CXSite, Orientation, RuleFn, RuleResult, Sigma } from './helpers';
import { applyShift, checkShift } from './rearrangement';

export interface ElimResult {
  /** The Zaitsev / Hofmann alkene(s); several only on a tie (`mixture`). */
  readonly major: MoleculeGraph[];
  /** The other alkenes, best first, never `sameProduct` with a major one. */
  readonly minor: MoleculeGraph[];
  readonly mixture: boolean;
  readonly warnings: string[];
}

/** `g` with the leaving atom's bond removed (H counts as they are once `x` has left). */
function withoutLeavingBond(g: MoleculeGraph, x: number): MoleculeGraph {
  const k = g.adj[x]?.[0];
  return k === undefined ? g : withoutBond(g, k);
}

/** Beta carbons of the cation / C–X carbon `cat` (sp3, >= 1 H once `x` has left), ascending. */
export function betaCandidates(g: MoleculeGraph, cat: number, x: number): number[] {
  const gx = withoutLeavingBond(g, x);
  const hyd = hydrogensOf(gx);
  return neighborsOf(g, cat)
    .filter((n) => n !== x && sp3(gx, n) && (hyd[n] ?? 0) >= 1)
    .sort((p, q) => p - q);
}

/** Heavy substituents on the alkene that `cat=beta` would give. */
function substCount(g: MoleculeGraph, cat: number, x: number, beta: number): number {
  const onCat = neighborsOf(g, cat).filter((n) => n !== x && n !== beta).length;
  return onCat + (deg(g, beta) - 1);
}

interface AlkeneBuild { readonly graph: MoleculeGraph; readonly assumedTrans: boolean }

function remapSigma(s: Sigma, removed: number): Sigma {
  return s === 'H' ? 'H' : remapAfterRemoval(s, removed);
}

/**
 * One elimination product with its E/Z tag: the anti-periplanar rule when
 * both carbons carry `tet` (E2 only), else the display rule (E assumed for a
 * 1,2-disubstituted alkene, no tag otherwise). A new C=C inside a ring never
 * carries a tag (00-contracts: ring double bonds never carry an `EzTag`; the
 * ring fixes the geometry, so no E assumption is made and the product still
 * embeds induced).
 */
export function buildAlkene(g: MoleculeGraph, cX: number, beta: number, x: number, antiPeriplanar: boolean): AlkeneBuild {
  const tetC = g.atoms[cX]!.tet;
  const tetB = g.atoms[beta]!.tet;
  const hyd = hydrogensOf(g);
  const e = eliminate(g, cX, beta, x);
  let graph = e.graph;
  if (ringsThrough(graph, e.a, e.b).length > 0) return { graph, assumedTrans: false };
  const pa = remapAfterRemoval(cX, x);
  const pb = remapAfterRemoval(beta, x);
  if (antiPeriplanar && tetC && tetB && (hyd[beta] ?? 0) === 1) {
    const ab = sigmaPartners(g, hyd, cX, [beta, x]);
    const cd = sigmaPartners(g, hyd, beta, [cX, 'H']);
    if (ab.length === 2 && cd.length === 2) {
      const s1 = parityInOrder(g, hyd, cX, [beta, x, ab[0]!, ab[1]!]);
      const s2 = parityInOrder(g, hyd, beta, [cX, 'H', cd[0]!, cd[1]!]);
      if (s1 !== null && s1 !== 0 && s2 !== null && s2 !== 0) {
        let cis = s1 * s2 === 1;
        let refC: Sigma = ab[0]!;
        let refB: Sigma = cd[0]!;
        if (refC === 'H' && ab[1] !== 'H') { refC = ab[1]!; cis = !cis; }
        if (refB === 'H' && cd[1] !== 'H') { refB = cd[1]!; cis = !cis; }
        const rc = remapSigma(refC, x);
        const rb = remapSigma(refB, x);
        const ez = pa < pb ? { refA: rc, refB: rb, cis } : { refA: rb, refB: rc, cis };
        return { graph: withEz(graph, e.bond, ez), assumedTrans: false };
      }
    }
  }
  if (!tetC && !tetB) {
    const ha = neighborsOf(graph, e.a).filter((n) => n !== e.b);
    const hb = neighborsOf(graph, e.b).filter((n) => n !== e.a);
    if (ha.length === 1 && hb.length === 1) {
      graph = withEz(graph, e.bond, { refA: ha[0]!, refB: hb[0]!, cis: false });
      return { graph, assumedTrans: true };
    }
  }
  return { graph, assumedTrans: false };
}

/**
 * Zaitsev / Hofmann elimination from the carbon `cat` with leaving atom `x`
 * (`x` need not be bonded to `cat` after a 1,2-shift). Empty `major` when
 * there is no beta hydrogen.
 */
export function eliminationSet(g: MoleculeGraph, cat: number, x: number, orientation: Orientation, antiPeriplanar: boolean): ElimResult {
  const warnings: string[] = [];
  const betas = betaCandidates(g, cat, x);
  if (betas.length === 0) return { major: [], minor: [], mixture: false, warnings };
  const hyd = hydrogensOf(withoutLeavingBond(g, x));
  const subst = new Map<number, number>();
  for (const n of betas) subst.set(n, substCount(g, cat, x, n));
  let chosen: number[];
  if (orientation === 'zaitsev') {
    const best = Math.max(...betas.map((n) => subst.get(n)!));
    chosen = betas.filter((n) => subst.get(n) === best);
  } else {
    const best = Math.min(...betas.map((n) => subst.get(n)!));
    const tied = betas.filter((n) => subst.get(n) === best);
    tied.sort((p, q) => (hyd[q] ?? 0) - (hyd[p] ?? 0) || p - q);
    chosen = [tied[0]!];
  }
  const builds = new Map<number, AlkeneBuild>();
  for (const n of betas) builds.set(n, buildAlkene(g, cat, n, x, antiPeriplanar));
  const major = dedupe(chosen.map((n) => builds.get(n)!.graph));
  const mixture = major.length > 1;
  if (mixture) warnings.push(WARN.zaitsevTie);
  const others = betas.filter((n) => !chosen.includes(n));
  others.sort((p, q) => (orientation === 'zaitsev' ? subst.get(q)! - subst.get(p)! : subst.get(p)! - subst.get(q)!) || p - q);
  const minor = dedupe(others.map((n) => builds.get(n)!.graph)).filter((m) => !major.some((p) => sameProduct(p, m)));
  const shown = [...major, ...minor];
  const assumed = [...builds.entries()].some(([, b]) => b.assumedTrans && shown.some((p) => p === b.graph));
  if (assumed) pushWarning(warnings, WARN.ezAssumedTrans);
  return { major, minor, mixture, warnings };
}

/** E2 from the C–X site with the anti-periplanar rule for tagged reactants. */
export function applyE2(g: MoleculeGraph, site: CXSite, orientation: Orientation): ElimResult {
  return eliminationSet(g, site.c, site.x, orientation, true);
}

/**
 * E1 from the cation at `c` (leaving atom `x`) with the 1,2-shift policy:
 * `warn` lists the unrearranged and rearranged alkenes as a mixture, `apply`
 * only the rearranged set, `ignore` only the unrearranged set.
 */
export function applyE1(g: MoleculeGraph, c: number, x: number, orientation: Orientation, policy: 'warn' | 'apply' | 'ignore'): ElimResult {
  const base = eliminationSet(g, c, x, orientation, false);
  const k = bondBetween(g, c, x);
  const shift = policy === 'ignore' || k === undefined ? null : checkShift(withoutBond(g, k), c);
  if (!shift) return base;
  const shifted = eliminationSet(applyShift(g, shift), shift.to, x, orientation, false);
  if (shifted.major.length === 0) return base;
  if (policy === 'apply') {
    return { ...shifted, warnings: [...shifted.warnings, WARN.rearrangementApplied] };
  }
  const major = dedupe([...base.major, ...shifted.major]);
  const minor = dedupe([...base.minor, ...shifted.minor]).filter((m) => !major.some((p) => sameProduct(p, m)));
  const warnings: string[] = [];
  for (const w of [...base.warnings, ...shifted.warnings]) pushWarning(warnings, w);
  if (major.length > 1) {
    pushWarning(warnings, WARN.rearrangement);
    return { major, minor, mixture: true, warnings };
  }
  return { major, minor, mixture: base.mixture, warnings };
}

/** H2SO4_HEAT_ROH: acid-catalysed dehydration (E1, Zaitsev; tertiary fast, secondary slow, primary no). */
export const applyDehydration: RuleFn = (g, card, opts): RuleResult => {
  const sites = findCOH(g).filter((s) => sp3(g, s.c));
  if (sites.length === 0) return noReaction(JUSTIFY.noSubstrate(card));
  const warnings: string[] = [];
  if (sites.length > 1) warnings.push(WARN.multipleSites(sites.length, 'C–OH'));
  const site = sites[0]!;
  const cls = substrateClass(g, site.c, site.o);
  if (cls <= 1) return noReaction(JUSTIFY.dehydrationPrimary, warnings);
  if (cls === 2) warnings.push(WARN.slowDehydration);
  const r = applyE1(g, site.c, site.o, 'zaitsev', opts.rearrangement);
  if (r.major.length === 0) return noReaction(JUSTIFY.noBetaH, warnings);
  for (const w of r.warnings) pushWarning(warnings, w);
  return {
    major: r.major, minor: r.minor, mechanism: 'E1', stereo: 'none', warnings,
    justification: JUSTIFY.dehydration, mixture: r.mixture,
  };
};
