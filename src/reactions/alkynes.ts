/**
 * Alkyne rules: ALKYNE_HYDRATION_HG, ALKYNE_HYDROBORATION, LINDLAR,
 * DISSOLVING_METAL, ACETYLIDE_ALKYLATION, DOUBLE_E2. PURE MODULE.
 * See docs/design/04-reaction-bench.md section 5.2.
 */
import type { MoleculeGraph } from '../chem/types';
import { bondBetween, neighborsOf, withBondOrder, withTet, withoutAtom } from '../chem/graph';
import {
  JUSTIFY, WARN, addAcross, ezTag, findAlkenes, findAlkynes, findCX, graftGraph, hydrogensOf, markovnikov,
  noReaction, pushWarning, remapAfterRemoval, sameProduct, sp3, substrateInfo, tautomerize,
} from './helpers';
import type { PiBond, RuleFn, RuleResult, Sigma } from './helpers';
import { applyE2 } from './elimination';

function firstAlkyne(g: MoleculeGraph, warnings: string[]): PiBond | null {
  const sites = findAlkynes(g);
  if (sites.length === 0) return null;
  if (sites.length > 1) warnings.push(WARN.multipleSites(sites.length, 'C≡C'));
  return sites[0]!;
}

function heavyNonPartner(g: MoleculeGraph, c: number, partner: number): Sigma {
  const n = neighborsOf(g, c).find((x) => x !== partner);
  return n === undefined ? 'H' : n;
}

/** Enol at `oCarbon` (O) / `hCarbon` (H) then tautomerization to the carbonyl. */
function carbonylVia(g: MoleculeGraph, pi: PiBond, oCarbon: number): MoleculeGraph {
  const hCarbon = oCarbon === pi.a ? pi.b : pi.a;
  const r = addAcross(g, pi, oCarbon === pi.a ? 'O' : 'H', oCarbon === pi.b ? 'O' : 'H');
  const o = (oCarbon === pi.a ? r.newA : r.newB) as number;
  return tautomerize(r.graph, oCarbon, hCarbon, o);
}

function hydrationRule(markovnikovO: boolean, justification: string): RuleFn {
  return (g, card): RuleResult => {
    const warnings: string[] = [];
    const pi = firstAlkyne(g, warnings);
    if (!pi) return noReaction(JUSTIFY.noSubstrate(card));
    const { more, less, tie } = markovnikov(g, pi);
    if (tie) {
      const p1 = carbonylVia(g, pi, pi.b);
      const p2 = carbonylVia(g, pi, pi.a);
      if (sameProduct(p1, p2)) return { major: [p1], mechanism: 'addition', stereo: 'none', warnings, justification };
      pushWarning(warnings, WARN.hydrationMixture);
      return { major: [p1, p2], mechanism: 'addition', stereo: 'none', warnings, justification, mixture: true };
    }
    const product = carbonylVia(g, pi, markovnikovO ? more : less);
    return { major: [product], mechanism: 'addition', stereo: 'none', warnings, justification };
  };
}

export const applyAlkyneHydrationHg: RuleFn = hydrationRule(true, JUSTIFY.ALKYNE_HYDRATION_HG);
export const applyAlkyneHydroboration: RuleFn = hydrationRule(false, JUSTIFY.ALKYNE_HYDROBORATION);

function reductionRule(cis: boolean, justification: string): RuleFn {
  return (g, card): RuleResult => {
    const warnings: string[] = [];
    const pi = firstAlkyne(g, warnings);
    if (!pi) return noReaction(JUSTIFY.noSubstrate(card));
    const r = addAcross(g, pi, 'H', 'H');
    const graph = ezTag(r.graph, pi, heavyNonPartner(g, pi.a, pi.b), heavyNonPartner(g, pi.b, pi.a), cis);
    return { major: [graph], mechanism: 'reduction', stereo: 'none', warnings, justification };
  };
}

export const applyLindlar: RuleFn = reductionRule(true, JUSTIFY.LINDLAR);
export const applyDissolvingMetal: RuleFn = reductionRule(false, JUSTIFY.DISSOLVING_METAL);

/** NANH2_THEN_RX: acetylide formation then SN2 on a methyl / primary halide (E2 on secondary / tertiary). */
export const applyAcetylideAlkylation: RuleFn = (substrate, _card, opts): RuleResult => {
  const hyd = hydrogensOf(substrate);
  const terminal = findAlkynes(substrate)
    .map((p) => {
      const ends = [p.a, p.b].filter((c) => (hyd[c] ?? 0) === 1);
      return ends.length > 0 ? { pi: p, t: Math.min(...ends) } : null;
    })
    .filter((x): x is { pi: PiBond; t: number } => x !== null);
  if (terminal.length === 0) return noReaction(JUSTIFY.internalAlkyne);
  const t = terminal[0]!.t;
  const rx = opts.rx;
  if (!rx) return noReaction(JUSTIFY.rxMissing);
  const rxSite = findCX(rx)[0];
  if (!rxSite) return noReaction(JUSTIFY.rxNotHalide);
  const info = substrateInfo(rx, rxSite);
  if (info.sp2) return noReaction(JUSTIFY.R1);
  const warnings: string[] = [];
  if (info.cls >= 2 || info.neopentyl) {
    const elim = applyE2(rx, rxSite, 'zaitsev');
    if (elim.major.length === 0) return noReaction(JUSTIFY.noBetaH);
    warnings.push(WARN.acetylideElimination);
    for (const w of elim.warnings) pushWarning(warnings, w);
    return {
      major: [elim.major[0]!, substrate], minor: elim.minor, mechanism: 'E2', stereo: 'none', warnings,
      justification: JUSTIFY.acetylideE2, mixture: false,
    };
  }
  if (rxSite.halogen === 'Cl') warnings.push(WARN.chlorideSlower);
  if (rxSite.halogen === 'F') return noReaction(JUSTIFY.R2, warnings);
  const tet0 = rx.atoms[rxSite.c]!.tet;
  const rx1 = withoutAtom(rx, rxSite.x);
  const rc = remapAfterRemoval(rxSite.c, rxSite.x);
  const { graph, attached, offset } = graftGraph(substrate, t, rx1, rc);
  let product = withTet(graph, attached, undefined);
  const retained = substrate.atoms.some((a) => a.tet !== undefined) || rx.atoms.some((a) => a.tet !== undefined && a.id !== rxSite.c);
  let stereo: RuleResult['stereo'] = retained ? 'absolute' : 'none';
  if (tet0 && tet0.order.includes(rxSite.x)) {
    const order = tet0.order.map((o) => (o === rxSite.x ? t : o === 'H' ? 'H' : remapAfterRemoval(o, rxSite.x) + offset));
    product = withTet(product, attached, { order, sign: tet0.sign === 1 ? -1 : 1 });
    stereo = 'absolute';
  }
  return { major: [product], mechanism: 'SN2', stereo, warnings, justification: JUSTIFY.ACETYLIDE_ALKYLATION };
};

/** NANH2_2EQ_DIHALIDE: two E2 steps from a vicinal dihalide (or one from a vinylic halide) to the alkyne. */
export const applyDoubleE2: RuleFn = (g, card): RuleResult => {
  const hyd = hydrogensOf(g);
  const H = (i: number) => hyd[i] ?? 0;
  const cx = findCX(g);
  let product: MoleculeGraph | null = null;
  for (const s of cx) {
    if (!sp3(g, s.c) || H(s.c) < 1) continue;
    for (const t of cx) {
      if (t === s || t.c === s.c || !sp3(g, t.c) || H(t.c) < 1) continue;
      if (bondBetween(g, s.c, t.c) === undefined) continue;
      const [hi, lo] = s.x > t.x ? [s, t] : [t, s];
      let g1 = withoutAtom(g, hi.x);
      g1 = withoutAtom(g1, lo.x);
      const r = (i: number) => remapAfterRemoval(remapAfterRemoval(i, hi.x), lo.x);
      const k = bondBetween(g1, r(s.c), r(t.c))!;
      product = withBondOrder(g1, k, 3);
      break;
    }
    if (product) break;
  }
  if (!product) {
    for (const s of cx) {
      const pi = findAlkenes(g).find((p) => p.a === s.c || p.b === s.c);
      if (!pi) continue;
      const partner = pi.a === s.c ? pi.b : pi.a;
      if (H(partner) < 1) continue;
      const g1 = withoutAtom(g, s.x);
      const k = bondBetween(g1, remapAfterRemoval(s.c, s.x), remapAfterRemoval(partner, s.x))!;
      product = withBondOrder(g1, k, 3);
      break;
    }
  }
  if (!product) return noReaction(JUSTIFY.noSubstrate(card));
  const warnings: string[] = [];
  const hyd2 = hydrogensOf(product);
  if (findAlkynes(product).some((p) => (hyd2[p.a] ?? 0) === 1 || (hyd2[p.b] ?? 0) === 1)) warnings.push(WARN.acetylideWorkup);
  return { major: [product], mechanism: 'E2', stereo: 'none', warnings, justification: JUSTIFY.DOUBLE_E2 };
};
