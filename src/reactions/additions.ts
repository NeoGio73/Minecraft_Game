/**
 * Alkene (and HX / X2 / H2 on alkyne) addition rules: HX_ADD, RADICAL_HBR,
 * X2_ADD, HOX_ADD, HYDRATION, OXYMERC, HYDROBORATION, H2, SYN_DIOL, ANTI_DIOL,
 * EPOXIDATION, EPOXIDE_OPEN, CYCLOPROPANATION. PURE MODULE.
 * See docs/design/04-reaction-bench.md section 5.1.
 */
import type { MoleculeGraph, ReactionStereo } from '../chem/types';
import { bondBetween, neighborsOf, ringsThrough, smallestRings, withBond, withBondOrder, withEz, withTet, withoutBond } from '../chem/graph';
import { parityInOrder } from '../chem/stereo';
import {
  JUSTIFY, WARN, addAcross, alkylCount, applyAdditionStereo, attachFragment, ezTag, findAlkenes, findAlkynes,
  hasRetainedCenters, hydrogensOf, isStereocenter, markovnikov, newCenterStereo, noReaction, pushWarning,
  ringContinuation, sameProduct, sigmaPartners, weakestStereo,
} from './helpers';
import type { AddMode, Group, PiBond, RuleFn, RuleResult, Sigma } from './helpers';
import { applyShift, checkShift } from './rearrangement';

interface Built { readonly graph: MoleculeGraph; readonly stereo: ReactionStereo; readonly warnings: string[] }

interface RegioResult {
  readonly major: MoleculeGraph[];
  readonly stereo: ReactionStereo;
  readonly warnings: string[];
  readonly mixture: boolean;
}

function buildOne(g: MoleculeGraph, pi: PiBond, toA: Group, toB: Group, mode: AddMode, reactant: MoleculeGraph): Built {
  const { graph, newA, newB } = addAcross(g, pi, toA, toB);
  const s = applyAdditionStereo(graph, pi, newA, newB, mode, reactant);
  return { graph: s.graph, stereo: s.stereo, warnings: s.warnings };
}

/** Generic Markovnikov addition (04 section 5.1): `nucGroup` goes to the more substituted carbon, `elGroup` to the less (swapped for anti-Markovnikov rules). */
export function addWithRegio(
  g: MoleculeGraph, pi: PiBond, nucGroup: Group, elGroup: Group, mode: AddMode, swap: boolean,
  options: { readonly symmetric?: boolean; readonly rearrange?: boolean; readonly policy?: 'warn' | 'apply' | 'ignore'; readonly reactant?: MoleculeGraph } = {},
): RegioResult {
  const reactant = options.reactant ?? g;
  const warnings: string[] = [];
  if (options.symmetric) {
    const one = buildOne(g, pi, elGroup, nucGroup, mode, reactant);
    for (const w of one.warnings) pushWarning(warnings, w);
    return { major: [one.graph], stereo: one.stereo, warnings, mixture: false };
  }
  let { more, less, tie } = markovnikov(g, pi);
  if (swap) [more, less] = [less, more];
  if (tie) {
    const p1 = buildOne(g, pi, elGroup, nucGroup, mode, reactant);
    const p2 = buildOne(g, pi, nucGroup, elGroup, mode, reactant);
    for (const w of [...p1.warnings, ...p2.warnings]) pushWarning(warnings, w);
    if (sameProduct(p1.graph, p2.graph)) return { major: [p1.graph], stereo: p1.stereo, warnings, mixture: false };
    pushWarning(warnings, WARN.regioMixture);
    return { major: [p1.graph, p2.graph], stereo: weakestStereo(p1.stereo, p2.stereo), warnings, mixture: true };
  }
  const groupFor = (c: number): Group => (c === more ? nucGroup : elGroup);
  const product = buildOne(g, pi, groupFor(pi.a), groupFor(pi.b), mode, reactant);
  for (const w of product.warnings) pushWarning(warnings, w);
  if (!options.rearrange || options.policy === 'ignore') {
    return { major: [product.graph], stereo: product.stereo, warnings, mixture: false };
  }
  let lowered = withBondOrder(g, pi.bond, 1);
  if (lowered.bonds[pi.bond]!.ez) lowered = withEz(lowered, pi.bond, undefined);
  const shift = checkShift(lowered, more);
  if (!shift) return { major: [product.graph], stereo: product.stereo, warnings, mixture: false };
  const rearranged = attachFragment(applyShift(lowered, shift), shift.to, nucGroup).graph;
  const retained = hasRetainedCenters(reactant, [pi.a, pi.b]);
  const stereoR = newCenterStereo(rearranged, [more, shift.to], retained);
  if (options.policy === 'apply') {
    pushWarning(warnings, WARN.rearrangementApplied);
    return { major: [rearranged], stereo: stereoR, warnings, mixture: false };
  }
  pushWarning(warnings, WARN.rearrangement);
  return { major: [product.graph, rearranged], stereo: weakestStereo(product.stereo, stereoR), warnings, mixture: true };
}

function heavyNonPartner(g: MoleculeGraph, c: number, partner: number): Sigma {
  const n = neighborsOf(g, c).find((x) => x !== partner);
  return n === undefined ? 'H' : n;
}

function alkeneSites(g: MoleculeGraph, card: Parameters<RuleFn>[1], warnings: string[]): PiBond[] | null {
  const alkenes = findAlkenes(g);
  if (alkenes.length === 0) return null;
  void card;
  if (alkenes.length > 1) warnings.push(WARN.multipleSites(alkenes.length, 'C=C'));
  return alkenes;
}

/** Every site of every order the rule accepts, alkenes first (04 section 3.2). */
function allSites(g: MoleculeGraph, orders: readonly (2 | 3)[]): PiBond[] {
  const out: PiBond[] = [];
  if (orders.includes(2)) out.push(...findAlkenes(g));
  if (orders.includes(3)) out.push(...findAlkynes(g));
  return out;
}

function siteKind(p: PiBond): 'C=C' | 'C≡C' {
  return p.order === 2 ? 'C=C' : 'C≡C';
}

// ---------------------------------------------------------------------------
// HX_ADD
// ---------------------------------------------------------------------------

function hxAlkyne(g: MoleculeGraph, pi: PiBond, X: string, equiv: 1 | 2, warnings: string[]): RuleResult {
  const { more, less, tie } = markovnikov(g, pi);
  const build = (xCarbon: number): MoleculeGraph => {
    const hCarbon = xCarbon === pi.a ? pi.b : pi.a;
    const r = addAcross(g, pi, xCarbon === pi.a ? X : 'H', xCarbon === pi.b ? X : 'H');
    const xAtom = (xCarbon === pi.a ? r.newA : r.newB) as number;
    const refH = heavyNonPartner(r.graph, hCarbon, xCarbon);
    const refOnA: Sigma = xCarbon === pi.a ? xAtom : refH;
    const refOnB: Sigma = xCarbon === pi.b ? xAtom : refH;
    const one = ezTag(r.graph, pi, refOnA, refOnB, true);
    if (equiv === 1) return one;
    const pi2: PiBond = { bond: pi.bond, a: pi.a, b: pi.b, order: 2 };
    return addAcross(one, pi2, xCarbon === pi.a ? X : 'H', xCarbon === pi.b ? X : 'H').graph;
  };
  const justification = equiv === 2 ? JUSTIFY.HX_ADD_2EQ : JUSTIFY.HX_ADD_ALKYNE;
  if (tie) {
    const p1 = build(pi.b);
    const p2 = build(pi.a);
    if (sameProduct(p1, p2)) return { major: [p1], mechanism: 'addition', stereo: 'none', warnings, justification };
    pushWarning(warnings, WARN.regioMixture);
    return { major: [p1, p2], mechanism: 'addition', stereo: 'none', warnings, justification, mixture: true };
  }
  void less;
  return { major: [build(more)], mechanism: 'addition', stereo: 'none', warnings, justification };
}

export const applyHxAdd: RuleFn = (g, card, opts): RuleResult => {
  const X = card.halogen;
  if (!X) throw new Error(`HX_ADD: card ${card.id} has no halogen`);
  const sites = allSites(g, [2, 3]);
  if (sites.length === 0) return noReaction(JUSTIFY.noSubstrate(card));
  const warnings: string[] = [];
  if (sites.length > 1) warnings.push(WARN.multipleSites(sites.length, siteKind(sites[0]!)));
  const pi = sites[0]!;
  if (pi.order === 3) return hxAlkyne(g, pi, X, opts.equiv, warnings);
  if (opts.equiv === 2) return noReaction(JUSTIFY.twoEquivAlkene, warnings);
  const r = addWithRegio(g, pi, X, 'H', 'none', false, { rearrange: true, policy: opts.rearrangement });
  for (const w of r.warnings) pushWarning(warnings, w);
  return { major: r.major, mechanism: 'addition', stereo: r.stereo, warnings, justification: JUSTIFY.HX_ADD, mixture: r.mixture };
};

// ---------------------------------------------------------------------------
// RADICAL_HBR, HOX_ADD, HYDRATION, OXYMERC, HYDROBORATION
// ---------------------------------------------------------------------------

function regioRule(
  nucGroup: (card: Parameters<RuleFn>[1]) => Group, elGroup: Group, mode: AddMode, swap: boolean, rearrange: boolean,
  mechanism: 'addition' | 'radical', justification: string,
): RuleFn {
  return (g, card, opts): RuleResult => {
    const warnings: string[] = [];
    const alkenes = alkeneSites(g, card, warnings);
    if (!alkenes) return noReaction(JUSTIFY.noSubstrate(card));
    const r = addWithRegio(g, alkenes[0]!, nucGroup(card), elGroup, mode, swap, { rearrange, policy: opts.rearrangement });
    for (const w of r.warnings) pushWarning(warnings, w);
    return { major: r.major, mechanism, stereo: r.stereo, warnings, justification, mixture: r.mixture };
  };
}

function halogenOf(card: Parameters<RuleFn>[1]): Group {
  if (!card.halogen) throw new Error(`${card.rule}: card ${card.id} has no halogen`);
  return card.halogen;
}

export const applyRadicalHbr: RuleFn = regioRule(() => 'Br', 'H', 'none', true, false, 'radical', JUSTIFY.RADICAL_HBR);
export const applyHydration: RuleFn = regioRule(() => 'O', 'H', 'none', false, true, 'addition', JUSTIFY.HYDRATION);
export const applyOxymerc: RuleFn = regioRule(() => 'O', 'H', 'none', false, false, 'addition', JUSTIFY.OXYMERC);
export const applyHydroboration: RuleFn = regioRule(() => 'O', 'H', 'syn', true, false, 'addition', JUSTIFY.HYDROBORATION);

/** Halohydrin: X+ (electrophile-derived, to the less substituted carbon) then OH at the more substituted carbon, anti. */
export const applyHoxAdd: RuleFn = (g, card, opts): RuleResult => {
  const warnings: string[] = [];
  const alkenes = alkeneSites(g, card, warnings);
  if (!alkenes) return noReaction(JUSTIFY.noSubstrate(card));
  const r = addWithRegio(g, alkenes[0]!, 'O', halogenOf(card), 'anti', false, { policy: opts.rearrangement });
  for (const w of r.warnings) pushWarning(warnings, w);
  return { major: r.major, mechanism: 'addition', stereo: r.stereo, warnings, justification: JUSTIFY.HOX_ADD, mixture: r.mixture };
};

// ---------------------------------------------------------------------------
// Symmetric reagents on every site: X2_ADD, H2, SYN_DIOL, ANTI_DIOL
// ---------------------------------------------------------------------------

function everyAlkene(g: MoleculeGraph, group: Group, mode: AddMode): { graph: MoleculeGraph; stereo: ReactionStereo; warnings: string[] } {
  let graph = g;
  let stereo: ReactionStereo = 'absolute';
  const warnings: string[] = [];
  const alkenes = findAlkenes(g);
  for (const pi of alkenes) {
    const r = addWithRegio(graph, pi, group, group, mode, false, { symmetric: true, reactant: g });
    graph = r.major[0]!;
    stereo = weakestStereo(stereo, r.stereo);
    for (const w of r.warnings) pushWarning(warnings, w);
  }
  if (alkenes.length === 0) stereo = 'none';
  return { graph, stereo, warnings };
}

export const applyX2Add: RuleFn = (g, card, opts): RuleResult => {
  const X = halogenOf(card);
  const alkenes = findAlkenes(g);
  const alkynes = findAlkynes(g);
  if (alkenes.length === 0 && alkynes.length === 0) return noReaction(JUSTIFY.noSubstrate(card));
  const warnings: string[] = [];
  if (alkenes.length > 0) {
    if (alkynes.length > 0) warnings.push(WARN.multipleSites(alkenes.length + alkynes.length, 'C=C'));
    const r = everyAlkene(g, X, 'anti');
    for (const w of r.warnings) pushWarning(warnings, w);
    return { major: [r.graph], mechanism: 'addition', stereo: r.stereo, warnings, justification: JUSTIFY.X2_ADD };
  }
  if (alkynes.length > 1) warnings.push(WARN.multipleSites(alkynes.length, 'C≡C'));
  const pi = alkynes[0]!;
  const one = addAcross(g, pi, X, X);
  let graph = ezTag(one.graph, pi, one.newA, one.newB, false);
  if (opts.equiv === 2) {
    const pi2: PiBond = { bond: pi.bond, a: pi.a, b: pi.b, order: 2 };
    graph = addAcross(graph, pi2, X, X).graph;
  }
  return { major: [graph], mechanism: 'addition', stereo: 'none', warnings, justification: JUSTIFY.X2_ADD_ALKYNE };
};

export const applyH2: RuleFn = (g, card): RuleResult => {
  const alkenes = findAlkenes(g);
  const alkynes = findAlkynes(g);
  if (alkenes.length === 0 && alkynes.length === 0) return noReaction(JUSTIFY.noSubstrate(card));
  const warnings: string[] = [];
  let graph = g;
  let stereo: ReactionStereo = 'absolute';
  if (alkenes.length > 0) {
    const r = everyAlkene(g, 'H', 'syn');
    graph = r.graph;
    stereo = weakestStereo(stereo, r.stereo);
    for (const w of r.warnings) pushWarning(warnings, w);
  }
  for (const pi of alkynes) {
    const first = addAcross(graph, pi, 'H', 'H').graph;
    const pi2: PiBond = { bond: pi.bond, a: pi.a, b: pi.b, order: 2 };
    const second = addAcross(first, pi2, 'H', 'H');
    const s = applyAdditionStereo(second.graph, pi2, 'H', 'H', 'syn', g);
    graph = s.graph;
    stereo = weakestStereo(stereo, s.stereo);
    for (const w of s.warnings) pushWarning(warnings, w);
  }
  return {
    major: [graph], mechanism: 'reduction', stereo, warnings,
    justification: alkenes.length > 0 ? JUSTIFY.H2 : JUSTIFY.H2_ALKYNE,
  };
};

function diolRule(mode: 'syn' | 'anti', justification: string): RuleFn {
  return (g, card): RuleResult => {
    if (findAlkenes(g).length === 0) return noReaction(JUSTIFY.noSubstrate(card));
    const r = everyAlkene(g, 'O', mode);
    return { major: [r.graph], mechanism: 'addition', stereo: r.stereo, warnings: r.warnings, justification };
  };
}

export const applySynDiol: RuleFn = diolRule('syn', JUSTIFY.SYN_DIOL);
export const applyAntiDiol: RuleFn = diolRule('anti', JUSTIFY.ANTI_DIOL);

// ---------------------------------------------------------------------------
// Three-membered rings: EPOXIDATION, CYCLOPROPANATION, EPOXIDE_OPEN
// ---------------------------------------------------------------------------

/** Adds a one-atom bridge (fragment atom 0) across `pi` as a 3-ring; the second ring bond is `diagonal`. */
function bridge(g: MoleculeGraph, pi: PiBond, fragment: string, reactant: MoleculeGraph): Built {
  let g1 = withBondOrder(g, pi.bond, 1);
  if (g1.bonds[pi.bond]!.ez) g1 = withEz(g1, pi.bond, undefined);
  const { graph: g2, attached } = attachFragment(g1, pi.a, fragment);
  const g3 = withBond(g2, pi.b, attached, 1, { diagonal: true });
  const s = applyAdditionStereo(g3, pi, attached, attached, 'syn', reactant);
  return { graph: s.graph, stereo: s.stereo, warnings: s.warnings };
}

function ringRule(fragment: (card: Parameters<RuleFn>[1]) => string, justification: string): RuleFn {
  return (g, card): RuleResult => {
    const alkenes = findAlkenes(g);
    if (alkenes.length === 0) return noReaction(JUSTIFY.noSubstrate(card));
    let graph = g;
    let stereo: ReactionStereo = 'absolute';
    const warnings: string[] = [];
    for (const pi of alkenes) {
      const r = bridge(graph, pi, fragment(card), g);
      graph = r.graph;
      stereo = weakestStereo(stereo, r.stereo);
      for (const w of r.warnings) pushWarning(warnings, w);
    }
    return { major: [graph], mechanism: 'addition', stereo, warnings, justification };
  };
}

export const applyEpoxidation: RuleFn = ringRule(() => 'O', JUSTIFY.EPOXIDATION);
export const applyCyclopropanation: RuleFn = ringRule((card) => (card.halogen === 'Cl' ? 'C(Cl)Cl' : 'C'), JUSTIFY.CYCLOPROPANATION);

/** Acid-catalysed epoxide opening at the more substituted carbon, anti (04 section 5.1 EPOXIDE_OPEN). */
export const applyEpoxideOpen: RuleFn = (g, card): RuleResult => {
  const ring = smallestRings(g, 3).find((r) => r.length === 3 && r.filter((i) => g.atoms[i]!.el === 'C').length === 2 && r.some((i) => g.atoms[i]!.el === 'O'));
  if (!ring) return noReaction(JUSTIFY.noSubstrate(card));
  const o = ring.find((i) => g.atoms[i]!.el === 'O')!;
  const [ca, cb] = ring.filter((i) => i !== o).sort((p, q) => p - q) as [number, number];
  const ka = alkylCount(g, ca, cb);
  const kb = alkylCount(g, cb, ca);
  const cOpen = kb > ka ? cb : ca;
  const cKeep = cOpen === ca ? cb : ca;
  const hyd = hydrogensOf(g);
  const warnings: string[] = [];
  const retained = hasRetainedCenters(g, [ca, cb]);

  // Reference pairs and cis relation.
  let aKeep: Sigma | undefined;
  let bKeep: Sigma | undefined;
  let aOpen: Sigma | undefined;
  let bOpen: Sigma | undefined;
  let cis: boolean | undefined;
  const keepOthers = sigmaPartners(g, hyd, cKeep, [cOpen, o]);
  const openOthers = sigmaPartners(g, hyd, cOpen, [cKeep, o]);
  const tKeep = g.atoms[cKeep]!.tet;
  const tOpen = g.atoms[cOpen]!.tet;
  if (tKeep && tOpen && keepOthers.length === 2 && openOthers.length === 2) {
    aKeep = keepOthers[0]!;
    bKeep = keepOthers[1]!;
    let pk = parityInOrder(g, hyd, cKeep, [cOpen, aKeep, bKeep, o]);
    if (pk === -1) { [aKeep, bKeep] = [bKeep, aKeep]; pk = 1; }
    aOpen = openOthers[0]!;
    bOpen = openOthers[1]!;
    const po = parityInOrder(g, hyd, cOpen, [cKeep, aOpen, bOpen, o]);
    if (pk === 1 && (po === 1 || po === -1)) cis = po === -1;
  } else {
    const outer = ringsThrough(g, cOpen, cKeep).filter((r) => r.length > 3)[0];
    if (outer && keepOthers.length === 2 && openOthers.length === 2) {
      const rk = ringContinuation(outer, cKeep, cOpen);
      const ro = ringContinuation(outer, cOpen, cKeep);
      if (rk !== undefined && ro !== undefined && keepOthers.includes(rk) && openOthers.includes(ro)) {
        aKeep = rk; bKeep = keepOthers.find((x) => x !== rk)!;
        aOpen = ro; bOpen = openOthers.find((x) => x !== ro)!;
        cis = true;
      }
    }
  }

  const kOpen = bondBetween(g, cOpen, o)!;
  let graph = withoutBond(g, kOpen);
  const att = attachFragment(graph, cOpen, 'O');
  graph = att.graph;
  const oNew = att.attached;
  graph = withTet(graph, cKeep, undefined);
  graph = withTet(graph, cOpen, undefined);
  const hyd2 = hydrogensOf(graph);
  const centers = [cKeep, cOpen].filter((c) => isStereocenter(graph, hyd2, c));
  let stereo: ReactionStereo;
  if (centers.length === 2 && !retained) {
    if (cis === undefined || aKeep === undefined || bKeep === undefined || aOpen === undefined || bOpen === undefined) {
      warnings.push(WARN.geometryUnspecified);
      stereo = 'none';
    } else {
      graph = withTet(graph, cKeep, { order: [cOpen, aKeep, bKeep, o], sign: 1 });
      graph = withTet(graph, cOpen, { order: [cKeep, aOpen, bOpen, oNew], sign: cis ? 1 : -1 });
      stereo = 'relative';
    }
  } else if (retained) {
    if (centers.length === 2) warnings.push(WARN.facialSelectivity);
    stereo = 'absolute';
  } else {
    stereo = centers.length === 1 ? 'racemic' : 'none';
  }
  return { major: [graph], mechanism: 'addition', stereo, warnings, justification: JUSTIFY.EPOXIDE_OPEN };
};
