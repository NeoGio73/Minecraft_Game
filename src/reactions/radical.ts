/**
 * Radical rules: ALLYLIC_BROMINATION (NBS, hν) and RADICAL_HALOGENATION
 * (Cl2 / Br2, hν). PURE MODULE. See docs/design/04-reaction-bench.md section 5.4.
 */
import type { MoleculeGraph } from '../chem/types';
import { bondBetween, neighborsOf, withBondOrder } from '../chem/graph';
import {
  JUSTIFY, RADICAL_WEIGHTS, WARN, attachFragment, dedupe, deg, findAlkenes, hydrogensOf, isStereocenter,
  noReaction, sameProduct, sp3,
} from './helpers';
import type { RadicalClass, RuleFn, RuleResult } from './helpers';

interface AllylicCandidate { readonly c: number; readonly a: number; readonly b: number }

export const applyAllylicBromination: RuleFn = (g, card): RuleResult => {
  const hyd = hydrogensOf(g);
  const cands: AllylicCandidate[] = [];
  for (const pi of findAlkenes(g)) {
    for (const [a, b] of [[pi.a, pi.b], [pi.b, pi.a]] as const) {
      for (const c of neighborsOf(g, a)) {
        if (c === b || !sp3(g, c) || (hyd[c] ?? 0) < 1) continue;
        if (!cands.some((x) => x.c === c && x.a === a)) cands.push({ c, a, b });
      }
    }
  }
  cands.sort((p, q) => deg(g, q.c) - deg(g, p.c) || p.c - q.c || p.a - q.a);
  if (cands.length === 0) return noReaction(JUSTIFY.noSubstrate(card));
  const topDeg = deg(g, cands[0]!.c);
  const products: MoleculeGraph[] = [];
  for (const cand of cands.filter((x) => deg(g, x.c) === topDeg)) {
    products.push(attachFragment(g, cand.c, 'Br').graph);
    let shifted = withBondOrder(g, bondBetween(g, cand.a, cand.b)!, 1);
    shifted = withBondOrder(shifted, bondBetween(shifted, cand.c, cand.a)!, 2);
    products.push(attachFragment(shifted, cand.b, 'Br').graph);
  }
  const major = dedupe(products);
  const warnings: string[] = [];
  if (major.length > 1) warnings.push(WARN.allylicMixture);
  let stereo: RuleResult['stereo'] = 'none';
  if (major.length === 1) {
    const p = major[0]!;
    const hp = hydrogensOf(p);
    const brC = neighborsOf(p, p.atoms.length - 1)[0]!;
    stereo = isStereocenter(p, hp, brC) ? 'racemic' : 'none';
  }
  return {
    major, mechanism: 'radical', stereo, warnings, justification: JUSTIFY.ALLYLIC_BROMINATION, mixture: major.length > 1,
  };
};

function classOf(d: number): RadicalClass {
  const k = Math.max(1, Math.min(3, d));
  return k === 1 ? 'primary' : k === 2 ? 'secondary' : 'tertiary';
}

export const applyRadicalHalogenation: RuleFn = (g, card): RuleResult => {
  const X = card.halogen;
  if (X !== 'Cl' && X !== 'Br') throw new Error(`RADICAL_HALOGENATION: card ${card.id} needs halogen Cl or Br`);
  const hyd = hydrogensOf(g);
  const groups: { product: MoleculeGraph; weight: number; carbon: number }[] = [];
  for (let c = 0; c < g.atoms.length; c++) {
    const h = hyd[c] ?? 0;
    if (g.atoms[c]!.el !== 'C' || h < 1) continue;
    const k = Math.max(1, Math.min(3, deg(g, c))) as 1 | 2 | 3;
    const w = h * RADICAL_WEIGHTS[X][k];
    const product = attachFragment(g, c, X).graph;
    const grp = groups.find((x) => sameProduct(x.product, product));
    if (grp) grp.weight += w;
    else groups.push({ product, weight: w, carbon: c });
  }
  if (groups.length === 0) return noReaction(JUSTIFY.noSubstrate(card));
  groups.sort((p, q) => q.weight - p.weight || p.carbon - q.carbon);
  const total = groups.reduce((s, x) => s + x.weight, 0);
  const rows = groups.map((x) => ({ pct: Math.round((100 * x.weight) / total), cls: classOf(deg(g, x.carbon)) }));
  const first = groups[0]!;
  const hp = hydrogensOf(first.product);
  const stereo: RuleResult['stereo'] = isStereocenter(first.product, hp, first.carbon) ? 'racemic' : 'none';
  return {
    major: [first.product], minor: groups.slice(1).map((x) => x.product), mechanism: 'radical', stereo,
    warnings: [WARN.radicalRatio(X, rows)], justification: JUSTIFY.RADICAL_HALOGENATION, mixture: false,
  };
};
