/**
 * Cleavage rules: OZONOLYSIS, KMNO4_CLEAVAGE, DIOL_CLEAVAGE. PURE MODULE.
 * See docs/design/04-reaction-bench.md section 5.3. Every result has
 * `fragments: true`: `major` is a multiset of fragments that `react` keeps.
 */
import type { MoleculeGraph } from '../chem/types';
import { bondBetween, components, withBondOrder, withoutBond } from '../chem/graph';
import { JUSTIFY, WARN, attachFragment, findAlkenes, findAlkynes, findCOH, hydrogensOf, noReaction, sp3, subgraph } from './helpers';
import type { RuleFn, RuleResult } from './helpers';

/** Cleaves every alkene to two carbonyls; returns the uncut graph and the former pi carbons. */
function cleaveAlkenes(g: MoleculeGraph): { graph: MoleculeGraph; piCarbons: number[] } {
  let graph = g;
  const piCarbons: number[] = [];
  const alkenes = findAlkenes(g).sort((p, q) => q.bond - p.bond);
  for (const pi of alkenes) {
    graph = withoutBond(graph, pi.bond);
    graph = attachFragment(graph, pi.a, 'O', 2).graph;
    graph = attachFragment(graph, pi.b, 'O', 2).graph;
    piCarbons.push(pi.a, pi.b);
  }
  return { graph, piCarbons };
}

export const applyOzonolysis: RuleFn = (g, card): RuleResult => {
  if (findAlkenes(g).length === 0) return noReaction(JUSTIFY.noSubstrate(card));
  const { graph } = cleaveAlkenes(g);
  const major = components(graph).map((c) => subgraph(graph, c));
  return { major, mechanism: 'oxidation', stereo: 'none', warnings: [], justification: JUSTIFY.OZONOLYSIS, mixture: false, fragments: true };
};

export const applyKmno4Cleavage: RuleFn = (g, card): RuleResult => {
  const hasAlkene = findAlkenes(g).length > 0;
  const hasAlkyne = findAlkynes(g).length > 0;
  if (!hasAlkene && !hasAlkyne) return noReaction(JUSTIFY.noSubstrate(card));
  const warnings: string[] = [];
  let { graph, piCarbons } = cleaveAlkenes(g);
  const alkyneCarbons: number[] = [];
  const alkynes = findAlkynes(graph).sort((p, q) => q.bond - p.bond);
  for (const pi of alkynes) {
    graph = withoutBond(graph, pi.bond);
    for (const c of [pi.a, pi.b]) {
      graph = attachFragment(graph, c, 'O', 2).graph;
      graph = attachFragment(graph, c, 'O', 1).graph;
      alkyneCarbons.push(c);
    }
  }
  const hyd = hydrogensOf(graph);
  const H = (i: number) => hyd[i] ?? 0;
  const drop = new Set<number>();
  for (const c of piCarbons) {
    if (H(c) === 1) graph = attachFragment(graph, c, 'O', 1).graph;
    else if (H(c) === 2) drop.add(c);
  }
  for (const c of alkyneCarbons) if (H(c) === 1) drop.add(c);
  const major: MoleculeGraph[] = [];
  let lost = false;
  for (const comp of components(graph)) {
    if (comp.some((i) => drop.has(i))) { lost = true; continue; }
    major.push(subgraph(graph, comp));
  }
  if (lost) warnings.push(WARN.co2Lost);
  void piCarbons;
  return {
    major, mechanism: 'oxidation', stereo: 'none', warnings,
    justification: hasAlkene ? JUSTIFY.KMNO4_CLEAVAGE : JUSTIFY.KMNO4_ALKYNE, mixture: false, fragments: true,
  };
};

export const applyDiolCleavage: RuleFn = (g, card): RuleResult => {
  const coh = findCOH(g).filter((s) => sp3(g, s.c));
  let pair: [typeof coh[number], typeof coh[number]] | null = null;
  for (const s of coh) {
    for (const t of coh) {
      if (s.c < t.c && bondBetween(g, s.c, t.c) !== undefined) { pair = [s, t]; break; }
    }
    if (pair) break;
  }
  if (!pair) return noReaction(JUSTIFY.noSubstrate(card));
  const [s, t] = pair;
  let graph = withoutBond(g, bondBetween(g, s.c, t.c)!);
  graph = withBondOrder(graph, bondBetween(graph, s.c, s.o)!, 2);
  graph = withBondOrder(graph, bondBetween(graph, t.c, t.o)!, 2);
  const major = components(graph).map((c) => subgraph(graph, c));
  return { major, mechanism: 'oxidation', stereo: 'none', warnings: [], justification: JUSTIFY.DIOL_CLEAVAGE, mixture: false, fragments: true };
};
