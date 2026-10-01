/**
 * Reaction bench helpers: site finders, substrate classes, graph operations,
 * the syn/anti stereo template, the alkyne E/Z writer, substitution and
 * elimination primitives, the WARN / JUSTIFY string tables and the preview
 * fallback layout. PURE MODULE (no three, no DOM).
 * See docs/design/04-reaction-bench.md sections 0-4, 5.9.2-5.9.3 and 7.3.
 *
 * Conventions (04 section 0): hydrogens are implicit (valence arithmetic);
 * builders never mutate; new atoms are appended so existing ids are stable;
 * every builder that removes an atom captures the tags it needs before the
 * removal and restores them with remapped ids.
 */
import type { Atom, BondOrder, EzTag, Mechanism, MoleculeGraph, ReactOptions, ReactionStereo, TetTag, Vec3 } from '../chem/types';
import type { ReagentCard, SubstrateClass } from '../content/types';
import {
  bondBetween, buildGraph, components, neighborsOf, otherEnd, ringsThrough, smallestRings,
  withBond, withBondOrder, withEz, withTet, withoutAtom,
} from '../chem/graph';
import type { BondInput } from '../chem/graph';
import { parseSmiles } from '../chem/smiles';
import { implicitHydrogens } from '../chem/hydrogens';
import { sameMolecule } from '../chem/compare';
import { cipRank } from '../chem/cip';

// ---------------------------------------------------------------------------
// Contract additions (04 section 1)
// ---------------------------------------------------------------------------

export interface PiBond { readonly bond: number; readonly a: number; readonly b: number; readonly order: 2 | 3; }
export interface CXSite { readonly c: number; readonly x: number; readonly bond: number; readonly halogen: 'F' | 'Cl' | 'Br' | 'I'; }
export interface COHSite { readonly c: number; readonly o: number; readonly bond: number; }
export type Cls = 0 | 1 | 2 | 3;
export interface SubstrateInfo {
  readonly c: number; readonly x: number; readonly cls: Cls;
  readonly allylic: boolean; readonly benzylic: boolean; readonly neopentyl: boolean;
  /** C–X carbon is sp2 (vinylic) or aromatic (aryl). */
  readonly sp2: boolean;
  /** Number of beta carbons (sp3, >= 1 H). */
  readonly betaH: number;
  /** A carbonyl carbon is bonded to a beta carbon (E1cB flag, warn only). */
  readonly betaCarbonyl: boolean;
}
/** 'H' = add nothing (implicit H); otherwise a fragment SMILES written from the attaching atom. */
export type Group = 'H' | string;
export type AddMode = 'syn' | 'anti' | 'none';
export type Orientation = 'zaitsev' | 'hofmann';
export interface RuleResult {
  readonly major: MoleculeGraph[]; readonly minor?: MoleculeGraph[];
  readonly mechanism: Mechanism; readonly stereo: ReactionStereo;
  readonly warnings: string[]; readonly justification: string;
  readonly mixture?: boolean; readonly noReaction?: boolean;
  /** true for cleavage rules: `major` is a multiset of fragments and `react` must not dedupe it. */
  readonly fragments?: boolean;
}
export type RuleOpts = Required<Pick<ReactOptions, 'equiv' | 'rearrangement'>> & Pick<ReactOptions, 'rx'>;
export type RuleFn = (substrate: MoleculeGraph, card: ReagentCard, opts: RuleOpts) => RuleResult;

/** A sigma partner of a carbon: a heavy atom id or an implicit hydrogen. */
export type Sigma = number | 'H';

// ---------------------------------------------------------------------------
// Basic predicates (04 section 0 notation)
// ---------------------------------------------------------------------------

/** Total H per atom from valence arithmetic. Bracket `explicitH` counts are ignored: they describe the
 *  reactant as parsed and go stale as soon as a builder changes an atom's bonding (04 section 0). */
export function hydrogensOf(g: MoleculeGraph): number[] {
  return implicitHydrogens(stripExplicitH(g)).hydrogens;
}

/** `explicitH: null` on the listed atoms (the ones whose bonding a builder changed). */
export function clearExplicitH(g: MoleculeGraph, ids: readonly number[]): MoleculeGraph {
  if (ids.every((i) => g.atoms[i]!.explicitH === null)) return g;
  const atoms: Atom[] = g.atoms.map((a) => (ids.includes(a.id) && a.explicitH !== null ? { ...a, explicitH: null } : a));
  return buildGraph(atoms, g.bonds);
}

export function deg(g: MoleculeGraph, i: number): number {
  return g.adj[i]!.length;
}

/** Some bond on `i` has order >= 2. */
export function hasPi(g: MoleculeGraph, i: number): boolean {
  return g.adj[i]!.some((k) => g.bonds[k]!.order >= 2);
}

/** sp3 carbon: element C, not aromatic, no bond of order >= 2. */
export function sp3(g: MoleculeGraph, i: number): boolean {
  const a = g.atoms[i]!;
  return a.el === 'C' && !a.aromatic && !hasPi(g, i);
}

/** carbonylC (02 section 0): neutral non-aromatic C with a C=O to a terminal neutral O. */
export function carbonylC(g: MoleculeGraph, i: number): boolean {
  const a = g.atoms[i]!;
  if (a.el !== 'C' || a.charge !== 0 || a.aromatic) return false;
  return g.adj[i]!.some((k) => {
    const b = g.bonds[k]!;
    if (b.order !== 2) return false;
    const o = g.atoms[otherEnd(g, k, i)]!;
    return o.el === 'O' && o.charge === 0 && deg(g, o.id) === 1;
  });
}

/** `i > removed ? i - 1 : i` (id shift after `withoutAtom`). */
export function remapAfterRemoval(i: number, removed: number): number {
  return i > removed ? i - 1 : i;
}

function remapSigma(s: Sigma, removed: number): Sigma {
  return s === 'H' ? 'H' : remapAfterRemoval(s, removed);
}

/** Every atom with `explicitH: null`, everything else unchanged. */
export function stripExplicitH(g: MoleculeGraph): MoleculeGraph {
  if (g.atoms.every((a) => a.explicitH === null)) return g;
  const atoms: Atom[] = g.atoms.map((a) => (a.explicitH === null ? a : { ...a, explicitH: null }));
  return buildGraph(atoms, g.bonds);
}

// ---------------------------------------------------------------------------
// Site finders (04 section 3)
// ---------------------------------------------------------------------------

const HALOGENS: ReadonlySet<string> = new Set(['F', 'Cl', 'Br', 'I']);

export function findAlkenes(g: MoleculeGraph): PiBond[] {
  const out: PiBond[] = [];
  g.bonds.forEach((b, k) => {
    if (b.order !== 2 || b.aromatic) return;
    const A = g.atoms[b.a]!;
    const B = g.atoms[b.b]!;
    if (A.el !== 'C' || B.el !== 'C' || A.aromatic || B.aromatic) return;
    out.push({ bond: k, a: b.a, b: b.b, order: 2 });
  });
  return out;
}

export function findAlkynes(g: MoleculeGraph): PiBond[] {
  const out: PiBond[] = [];
  g.bonds.forEach((b, k) => {
    if (b.order !== 3) return;
    if (g.atoms[b.a]!.el !== 'C' || g.atoms[b.b]!.el !== 'C') return;
    out.push({ bond: k, a: b.a, b: b.b, order: 3 });
  });
  return out;
}

export function findCX(g: MoleculeGraph): CXSite[] {
  const out: CXSite[] = [];
  g.bonds.forEach((b, k) => {
    if (b.order !== 1) return;
    const A = g.atoms[b.a]!;
    const B = g.atoms[b.b]!;
    let c: number; let x: Atom;
    if (A.el === 'C' && HALOGENS.has(B.el)) { c = b.a; x = B; }
    else if (B.el === 'C' && HALOGENS.has(A.el)) { c = b.b; x = A; }
    else return;
    if (x.charge !== 0) return;
    out.push({ c, x: x.id, bond: k, halogen: x.el as CXSite['halogen'] });
  });
  return out;
}

export function findCOH(g: MoleculeGraph): COHSite[] {
  const out: COHSite[] = [];
  g.bonds.forEach((b, k) => {
    if (b.order !== 1) return;
    const A = g.atoms[b.a]!;
    const B = g.atoms[b.b]!;
    let c: number; let o: Atom;
    if (A.el === 'C' && B.el === 'O') { c = b.a; o = B; }
    else if (B.el === 'C' && A.el === 'O') { c = b.b; o = A; }
    else return;
    if (o.charge !== 0 || deg(g, o.id) !== 1 || o.aromatic) return;
    out.push({ c, o: o.id, bond: k });
  });
  return out;
}

export function alkylCount(g: MoleculeGraph, c: number, _partner: number): number {
  void _partner;
  return deg(g, c) - 1;
}

export function substrateClass(g: MoleculeGraph, c: number, partner: number): Cls {
  return Math.max(0, Math.min(3, alkylCount(g, c, partner))) as Cls;
}

/** Some neighbour n != partner (a carbon) has a non-aromatic double bond to a third atom m != c. */
export function isAllylic(g: MoleculeGraph, c: number, partner: number): boolean {
  for (const n of neighborsOf(g, c)) {
    if (n === partner) continue;
    if (g.atoms[n]!.el !== 'C') continue;
    for (const k of g.adj[n]!) {
      const b = g.bonds[k]!;
      if (b.order !== 2 || b.aromatic) continue;
      const m = otherEnd(g, k, n);
      if (m !== c) return true;
    }
  }
  return false;
}

export function isBenzylic(g: MoleculeGraph, c: number, partner: number): boolean {
  return neighborsOf(g, c).some((n) => n !== partner && g.atoms[n]!.aromatic);
}

export function isNeopentyl(g: MoleculeGraph, c: number, partner: number): boolean {
  if (substrateClass(g, c, partner) !== 1) return false;
  const n = neighborsOf(g, c).find((x) => x !== partner);
  return n !== undefined && deg(g, n) === 4;
}

export function substrateInfo(g: MoleculeGraph, site: CXSite): SubstrateInfo {
  const hyd = hydrogensOf(g);
  const { c, x } = site;
  const atom = g.atoms[c]!;
  const betas = neighborsOf(g, c).filter((n) => n !== x);
  return {
    c, x,
    cls: substrateClass(g, c, x),
    allylic: isAllylic(g, c, x),
    benzylic: isBenzylic(g, c, x),
    neopentyl: isNeopentyl(g, c, x),
    sp2: atom.aromatic || hasPi(g, c),
    betaH: betas.filter((n) => sp3(g, n) && (hyd[n] ?? 0) >= 1).length,
    betaCarbonyl: betas.some((n) => neighborsOf(g, n).some((m) => m !== c && carbonylC(g, m))),
  };
}

// ---------------------------------------------------------------------------
// Substrate classes (04 section 2.3)
// ---------------------------------------------------------------------------

export function substrateClasses(g: MoleculeGraph): Set<SubstrateClass> {
  const out = new Set<SubstrateClass>();
  const hyd = hydrogensOf(g);
  const H = (i: number) => hyd[i] ?? 0;
  const alkenes = findAlkenes(g);
  const alkynes = findAlkynes(g);
  if (alkenes.length > 0) out.add('alkene');
  if (alkynes.length > 0) out.add('alkyne');
  if (alkynes.some((p) => H(p.a) === 1 || H(p.b) === 1)) out.add('terminal-alkyne');
  for (const p of alkenes) {
    for (const [c, partner] of [[p.a, p.b], [p.b, p.a]] as const) {
      if (neighborsOf(g, c).some((n) => n !== partner && sp3(g, n) && H(n) >= 1)) out.add('allylic-alkene');
    }
  }
  const cx = findCX(g);
  if (cx.some((s) => sp3(g, s.c))) out.add('alkyl-halide');
  let vicinal = false;
  for (const s of cx) {
    if (sp3(g, s.c) && H(s.c) >= 1) {
      for (const t of cx) {
        if (t === s || !sp3(g, t.c) || H(t.c) < 1) continue;
        if (bondBetween(g, s.c, t.c) !== undefined) vicinal = true;
      }
    }
    for (const p of alkenes) {
      if (p.a === s.c && H(p.b) >= 1) vicinal = true;
      if (p.b === s.c && H(p.a) >= 1) vicinal = true;
    }
  }
  if (vicinal) out.add('vicinal-dihalide');
  const coh = findCOH(g);
  if (coh.some((s) => sp3(g, s.c))) out.add('alcohol');
  for (const s of coh) for (const t of coh) {
    if (s !== t && bondBetween(g, s.c, t.c) !== undefined) out.add('diol');
  }
  for (const ring of smallestRings(g, 3)) {
    if (ring.length !== 3) continue;
    const els = ring.map((i) => g.atoms[i]!.el);
    if (els.filter((e) => e === 'C').length === 2 && els.filter((e) => e === 'O').length === 1) out.add('epoxide');
  }
  const allC = g.atoms.length > 0 && g.atoms.every((a) => a.el === 'C' && a.charge === 0 && !a.aromatic);
  if (allC && g.bonds.every((b) => b.order === 1 && !b.aromatic) && g.atoms.some((a) => H(a.id) >= 1)) out.add('alkane');
  return out;
}

// ---------------------------------------------------------------------------
// Markovnikov selector (04 section 3.1)
// ---------------------------------------------------------------------------

export function markovnikov(g: MoleculeGraph, pi: PiBond): { readonly more: number; readonly less: number; readonly tie: boolean } {
  const ka = alkylCount(g, pi.a, pi.b) + (isAllylic(g, pi.a, pi.b) || isBenzylic(g, pi.a, pi.b) ? 1 : 0);
  const kb = alkylCount(g, pi.b, pi.a) + (isAllylic(g, pi.b, pi.a) || isBenzylic(g, pi.b, pi.a) ? 1 : 0);
  if (ka > kb) return { more: pi.a, less: pi.b, tie: false };
  if (ka < kb) return { more: pi.b, less: pi.a, tie: false };
  return { more: pi.a, less: pi.b, tie: true };
}

// ---------------------------------------------------------------------------
// Fragments and atoms (04 section 4.1)
// ---------------------------------------------------------------------------

function shiftTet(t: TetTag | undefined, offset: number): TetTag | undefined {
  if (!t) return undefined;
  return { order: t.order.map((o) => (o === 'H' ? 'H' : o + offset)), sign: t.sign };
}

/** Appends `frag` to `g` (ids `+offset`) and bonds `atom` to `fragAtom + offset`. */
export function graftGraph(
  g: MoleculeGraph, atom: number, frag: MoleculeGraph, fragAtom: number, order: BondOrder = 1,
): { readonly graph: MoleculeGraph; readonly attached: number; readonly offset: number } {
  const offset = g.atoms.length;
  const atoms: Atom[] = [...g.atoms];
  for (const a of frag.atoms) {
    const tet = shiftTet(a.tet, offset);
    const { tet: _old, ...rest } = a;
    void _old;
    atoms.push(tet ? { ...rest, id: a.id + offset, tet } : { ...rest, id: a.id + offset });
  }
  const bonds: BondInput[] = [...g.bonds];
  for (const b of frag.bonds) {
    const ez: EzTag | undefined = b.ez
      ? { refA: b.ez.refA === 'H' ? 'H' : b.ez.refA + offset, refB: b.ez.refB === 'H' ? 'H' : b.ez.refB + offset, cis: b.ez.cis }
      : undefined;
    bonds.push({
      a: b.a + offset, b: b.b + offset, order: b.order, aromatic: b.aromatic,
      ...(b.diagonal === true ? { diagonal: true } : {}),
      ...(ez ? { ez } : {}),
    });
  }
  const joined = clearExplicitH(buildGraph(atoms, bonds), [atom]);
  const attached = fragAtom + offset;
  return { graph: withBond(joined, atom, attached, order), attached, offset };
}

const FRAGMENT_CACHE = new Map<string, MoleculeGraph>();

function fragmentGraph(fragment: string): MoleculeGraph {
  let f = FRAGMENT_CACHE.get(fragment);
  if (!f) {
    f = parseSmiles(fragment).graph;
    FRAGMENT_CACHE.set(fragment, f);
  }
  return f;
}

/** Parses `fragment` and grafts it at `atom`; fragment atom 0 is the attaching atom. */
export function attachFragment(
  g: MoleculeGraph, atom: number, fragment: string, order: BondOrder = 1,
): { readonly graph: MoleculeGraph; readonly attached: number } {
  const { graph, attached } = graftGraph(g, atom, fragmentGraph(fragment), 0, order);
  return { graph, attached };
}

/** One dense graph per connected component, ascending minimum old id; tags and flags preserved. */
export function splitComponents(g: MoleculeGraph): MoleculeGraph[] {
  return components(g).map((comp) => subgraph(g, comp));
}

/** Dense subgraph over `ids` (ascending); tags referencing atoms outside `ids` are dropped. */
export function subgraph(g: MoleculeGraph, ids: readonly number[]): MoleculeGraph {
  const sorted = [...ids].sort((x, y) => x - y);
  const map = new Map<number, number>();
  sorted.forEach((old, i) => map.set(old, i));
  const atoms: Atom[] = sorted.map((old, i) => {
    const a = g.atoms[old]!;
    let tet: TetTag | undefined;
    if (a.tet && a.tet.order.every((o) => o === 'H' || map.has(o))) {
      tet = { order: a.tet.order.map((o) => (o === 'H' ? 'H' : map.get(o)!)), sign: a.tet.sign };
    }
    const { tet: _old, ...rest } = a;
    void _old;
    return tet ? { ...rest, id: i, tet } : { ...rest, id: i };
  });
  const bonds: BondInput[] = [];
  for (const b of g.bonds) {
    if (!map.has(b.a) || !map.has(b.b)) continue;
    let ez: EzTag | undefined;
    if (b.ez && (b.ez.refA === 'H' || map.has(b.ez.refA)) && (b.ez.refB === 'H' || map.has(b.ez.refB))) {
      ez = { refA: b.ez.refA === 'H' ? 'H' : map.get(b.ez.refA)!, refB: b.ez.refB === 'H' ? 'H' : map.get(b.ez.refB)!, cis: b.ez.cis };
    }
    bonds.push({
      a: map.get(b.a)!, b: map.get(b.b)!, order: b.order, aromatic: b.aromatic,
      ...(b.diagonal === true ? { diagonal: true } : {}),
      ...(ez ? { ez } : {}),
    });
  }
  return buildGraph(atoms, bonds);
}

export function sameProduct(a: MoleculeGraph, b: MoleculeGraph): boolean {
  return sameMolecule(a, b, { stereo: 'none' }).same;
}

/** Keeps the first of each `sameProduct` class. */
export function dedupe(list: readonly MoleculeGraph[]): MoleculeGraph[] {
  const out: MoleculeGraph[] = [];
  for (const g of list) if (!out.some((p) => sameProduct(p, g))) out.push(g);
  return out;
}

// ---------------------------------------------------------------------------
// addAcross (04 section 4.2)
// ---------------------------------------------------------------------------

export function addAcross(
  g: MoleculeGraph, pi: PiBond, toA: Group, toB: Group,
): { readonly graph: MoleculeGraph; readonly newA: number | 'H'; readonly newB: number | 'H' } {
  let g1 = clearExplicitH(withBondOrder(g, pi.bond, (pi.order - 1) as BondOrder), [pi.a, pi.b]);
  if (g1.bonds[pi.bond]!.ez) g1 = withEz(g1, pi.bond, undefined);
  if (g1.atoms[pi.a]!.tet) g1 = withTet(g1, pi.a, undefined);
  if (g1.atoms[pi.b]!.tet) g1 = withTet(g1, pi.b, undefined);
  let newA: number | 'H' = 'H';
  let newB: number | 'H' = 'H';
  if (toA !== 'H') {
    const r = attachFragment(g1, pi.a, toA);
    g1 = r.graph;
    newA = r.attached;
  }
  if (toB !== 'H') {
    const r = attachFragment(g1, pi.b, toB);
    g1 = r.graph;
    newB = r.attached;
  }
  return { graph: g1, newA, newB };
}

// ---------------------------------------------------------------------------
// Stereocentre test and sigma partners (04 section 4.5 step 5)
// ---------------------------------------------------------------------------

export function isStereocenter(g: MoleculeGraph, hydrogens: readonly number[], atom: number): boolean {
  const a = g.atoms[atom]!;
  const h = hydrogens[atom] ?? 0;
  if (a.el !== 'C' || a.aromatic || h > 1 || deg(g, atom) + h !== 4 || hasPi(g, atom)) return false;
  return cipRank(g, hydrogens, atom).tie === false;
}

/** Sigma partners of `c` (heavy neighbours ascending, then 'H' x hydrogens) minus one instance of each entry of `exclude`. */
export function sigmaPartners(g: MoleculeGraph, hydrogens: readonly number[], c: number, exclude: readonly Sigma[] = []): Sigma[] {
  const list: Sigma[] = [...neighborsOf(g, c)].sort((x, y) => x - y);
  for (let i = 0; i < (hydrogens[c] ?? 0); i++) list.push('H');
  for (const e of exclude) {
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
  }
  return list;
}

const STEREO_RANK: Readonly<Record<ReactionStereo, number>> = { none: 0, racemic: 1, relative: 2, absolute: 3 };

/** The weaker of two `ReactionStereo` values (none < racemic < relative < absolute). */
export function weakestStereo(a: ReactionStereo, b: ReactionStereo): ReactionStereo {
  return STEREO_RANK[a] <= STEREO_RANK[b] ? a : b;
}

/** `retained` (04 section 4.5 step 4): the reactant carries a `tet` on an atom other than those listed. */
export function hasRetainedCenters(reactant: MoleculeGraph, except: readonly number[]): boolean {
  return reactant.atoms.some((a) => a.tet !== undefined && !except.includes(a.id));
}

/** Stereo of a product with no template: none / racemic by the count of new centres among `candidates`; absolute when retained. */
export function newCenterStereo(g: MoleculeGraph, candidates: readonly number[], retained: boolean): ReactionStereo {
  if (retained) return 'absolute';
  const hyd = hydrogensOf(g);
  const n = candidates.filter((c) => isStereocenter(g, hyd, c)).length;
  return n === 1 ? 'racemic' : 'none';
}

/** The ring neighbour of `c` in `ring` other than `partner`. */
export function ringContinuation(ring: readonly number[], c: number, partner: number): number | undefined {
  const i = ring.indexOf(c);
  if (i < 0) return undefined;
  const n = ring.length;
  const prev = ring[(i + n - 1) % n]!;
  const next = ring[(i + 1) % n]!;
  if (prev !== partner) return prev;
  if (next !== partner) return next;
  return undefined;
}

// ---------------------------------------------------------------------------
// Syn/anti stereo template (04 section 4.5)
// ---------------------------------------------------------------------------

export function applyAdditionStereo(
  g: MoleculeGraph, pi: PiBond, newA: number | 'H', newB: number | 'H', mode: AddMode, reactant: MoleculeGraph,
): { readonly graph: MoleculeGraph; readonly stereo: ReactionStereo; readonly warnings: string[] } {
  const c1 = pi.a;
  const c2 = pi.b;
  const hyd = hydrogensOf(g);
  const warnings: string[] = [];
  const centers = [c1, c2].filter((c) => isStereocenter(g, hyd, c));
  const retained = hasRetainedCenters(reactant, [c1, c2]);
  let graph = g;
  // Any tag left on c1 / c2 by an earlier step is dropped first (defensive).
  if (graph.atoms[c1]!.tet) graph = withTet(graph, c1, undefined);
  if (graph.atoms[c2]!.tet) graph = withTet(graph, c2, undefined);

  if (mode === 'none') {
    if (centers.length === 2) warnings.push(WARN.diastereomerMixture);
    if (retained) return { graph, stereo: 'absolute', warnings };
    return { graph, stereo: centers.length === 1 ? 'racemic' : 'none', warnings };
  }

  if (centers.length < 2) {
    if (retained) return { graph, stereo: 'absolute', warnings };
    return { graph, stereo: centers.length === 1 ? 'racemic' : 'none', warnings };
  }
  if (retained) {
    warnings.push(WARN.facialSelectivity);
    return { graph, stereo: 'absolute', warnings };
  }

  // Reference pair and relation.
  const others1 = sigmaPartners(g, hyd, c1, [c2, newA]);
  const others2 = sigmaPartners(g, hyd, c2, [c1, newB]);
  let a1: Sigma | undefined;
  let a2: Sigma | undefined;
  let cis: boolean | undefined;
  const rings = ringsThrough(reactant, c1, c2);
  const rbond = reactant.bonds[pi.bond];
  if (rings.length > 0) {
    a1 = ringContinuation(rings[0]!, c1, c2);
    a2 = ringContinuation(rings[0]!, c2, c1);
    cis = true;
  } else if (rbond && rbond.ez && rbond.a === c1 && rbond.b === c2) {
    a1 = rbond.ez.refA;
    a2 = rbond.ez.refB;
    cis = rbond.ez.cis;
  }
  if (cis === undefined || a1 === undefined || a2 === undefined || !others1.includes(a1) || !others2.includes(a2)) {
    warnings.push(WARN.geometryUnspecified);
    return { graph, stereo: 'none', warnings };
  }
  const b1 = others1.filter((_, i) => i !== others1.indexOf(a1!))[0]!;
  const b2 = others2.filter((_, i) => i !== others2.indexOf(a2!))[0]!;
  const sign2 = ((cis ? 1 : -1) * (mode === 'anti' ? 1 : -1)) as 1 | -1;
  graph = withTet(graph, c1, { order: [c2, a1, b1, newA], sign: 1 });
  graph = withTet(graph, c2, { order: [c1, a2, b2, newB], sign: sign2 });
  return { graph, stereo: 'relative', warnings };
}

// ---------------------------------------------------------------------------
// Alkyne E/Z tags (04 section 4.6)
// ---------------------------------------------------------------------------

/**
 * Writes `ez` on `pi.bond` (now order 2) when each end has two different
 * sigma partners besides its partner; heavy refs are preferred ('H' refs are
 * swapped for the heavy non-partner neighbour with `cis` negated).
 */
export function ezTag(g: MoleculeGraph, pi: PiBond, refA: Sigma, refB: Sigma, cis: boolean): MoleculeGraph {
  const hyd = hydrogensOf(g);
  const H = (c: number) => hyd[c] ?? 0;
  for (const c of [pi.a, pi.b]) {
    if (deg(g, c) + H(c) !== 3 || H(c) === 2) return g;
  }
  let flip = false;
  const fix = (ref: Sigma, c: number, partner: number): Sigma => {
    if (ref !== 'H') return ref;
    const n = neighborsOf(g, c).find((x) => x !== partner);
    if (n === undefined) return ref;
    flip = !flip;
    return n;
  };
  const ra = fix(refA, pi.a, pi.b);
  const rb = fix(refB, pi.b, pi.a);
  if (ra !== 'H' && !neighborsOf(g, pi.a).includes(ra)) return g;
  if (rb !== 'H' && !neighborsOf(g, pi.b).includes(rb)) return g;
  return withEz(g, pi.bond, { refA: ra, refB: rb, cis: flip ? !cis : cis });
}

// ---------------------------------------------------------------------------
// Tautomerization, substitution and elimination primitives (04 sections 4.3-4.4)
// ---------------------------------------------------------------------------

/** Enol `partnerC=enolC–O–H` -> ketone/aldehyde (keto form always). */
export function tautomerize(g: MoleculeGraph, enolC: number, partnerC: number, o: number): MoleculeGraph {
  const kcc = bondBetween(g, enolC, partnerC);
  const kco = bondBetween(g, enolC, o);
  if (kcc === undefined || kco === undefined) throw new Error('tautomerize: not an enol');
  let g1 = clearExplicitH(withBondOrder(g, kcc, 1), [enolC, partnerC, o]);
  if (g1.bonds[kcc]!.ez) g1 = withEz(g1, kcc, undefined);
  return withBondOrder(g1, kco, 2);
}

/**
 * Removes `removeAtom`, attaches `fragment` at `attachAt` (ids after the
 * removal) and returns the remap. The tag on `attachAt` is dropped unless the
 * caller restores it.
 */
export function substituteAt(
  g: MoleculeGraph, removeAtom: number, attachAt: number, fragment: string,
): { readonly graph: MoleculeGraph; readonly attached: number; readonly at: number } {
  const g1 = withoutAtom(g, removeAtom);
  const at = remapAfterRemoval(attachAt, removeAtom);
  const oldC = neighborsOf(g, removeAtom).map((i) => remapAfterRemoval(i, removeAtom));
  const { graph, attached } = attachFragment(clearExplicitH(g1, [at, ...oldC]), at, fragment);
  return { graph: withTet(graph, at, undefined), attached, at };
}

/** SN2: X replaced by the fragment with inversion (same slot, flipped sign). */
export function substituteInvert(g: MoleculeGraph, site: CXSite, fragment: string): MoleculeGraph {
  const tet0 = g.atoms[site.c]!.tet;
  const { graph, attached, at } = substituteAt(g, site.x, site.c, fragment);
  if (!tet0 || !tet0.order.includes(site.x)) return graph;
  const order = tet0.order.map((o) => (o === site.x ? attached : remapSigma(o, site.x)));
  return withTet(graph, at, { order, sign: tet0.sign === 1 ? -1 : 1 });
}

/** SN1: X replaced by the fragment; the tag is not restored. */
export function substituteRacemize(g: MoleculeGraph, site: CXSite, fragment: string): MoleculeGraph {
  return substituteAt(g, site.x, site.c, fragment).graph;
}

/** Removes the leaving atom `x` and makes `cX=beta` a double bond; tags on both carbons are dropped. */
export function eliminate(
  g: MoleculeGraph, cX: number, beta: number, x: number,
): { readonly graph: MoleculeGraph; readonly a: number; readonly b: number; readonly bond: number } {
  const g1 = withoutAtom(g, x);
  const a = Math.min(remapAfterRemoval(cX, x), remapAfterRemoval(beta, x));
  const b = Math.max(remapAfterRemoval(cX, x), remapAfterRemoval(beta, x));
  const k = bondBetween(g1, a, b);
  if (k === undefined) throw new Error('eliminate: carbons are not bonded');
  let g2 = clearExplicitH(withBondOrder(g1, k, 2), [a, b]);
  g2 = withTet(g2, a, undefined);
  g2 = withTet(g2, b, undefined);
  return { graph: g2, a, b, bond: k };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export function noReaction(justification: string, warnings: string[] = []): RuleResult {
  return { major: [], mechanism: 'none', stereo: 'none', warnings, justification, noReaction: true };
}

/** Appends `w` unless it is already present (student-facing warnings are not repeated). */
export function pushWarning(list: string[], w: string): void {
  if (!list.includes(w)) list.push(w);
}

// ---------------------------------------------------------------------------
// WARN (04 section 5.9.2)
// ---------------------------------------------------------------------------

export type SiteKind = 'C=C' | 'C≡C' | 'C–X' | 'C–OH';
export type RadicalClass = 'primary' | 'secondary' | 'tertiary';

export const WARN = {
  multipleSites: (n: number, kind: SiteKind): string => `This molecule has ${n} ${kind} sites; the bench reacts only the first one.`,
  regioMixture: `Both alkene carbons carry the same number of alkyl groups, so Markovnikov's rule cannot choose: a mixture of regioisomers forms (McMurry 7.8). Both are shown.`,
  geometryUnspecified: `The reactant alkene has no defined geometry, so the product's stereochemistry is not defined.`,
  diastereomerMixture: `Two new chirality centers form with no syn/anti control: a mixture of diastereomers results, so no configuration is shown.`,
  facialSelectivity: `The reactant already has a chirality center; which face reacts is not modeled, so the new centers are shown without configuration.`,
  rearrangement: `A carbocation rearrangement (1,2-hydride or 1,2-methyl shift) is likely here: McMurry 7.11 reports about a 1:1 mixture of the unrearranged and rearranged products. Both are shown.`,
  rearrangementApplied: `The carbocation rearranged by a 1,2-shift to a more stable cation before the nucleophile attacked.`,
  hydrationMixture: `Unsymmetrical internal alkyne: both ketones form (McMurry 9.4). Both are shown.`,
  acetylideElimination: `An acetylide is a strong base: with a secondary or tertiary halide it causes E2 elimination instead of SN2 (McMurry 9.9). The alkyne is recovered unchanged.`,
  acetylideWorkup: `The terminal alkyne is deprotonated by the excess NaNH2; the H3O+ workup gives it back.`,
  chlorideSlower: `McMurry alkylates acetylides with alkyl bromides and iodides; a chloride reacts more slowly.`,
  allylicMixture: `The allylic radical is delocalized, so bromine can end up at either end of the allyl system (McMurry 10.3). All products are shown.`,
  radicalRatio: (X: 'Cl' | 'Br', rows: readonly { readonly pct: number; readonly cls: RadicalClass }[]): string =>
    `${X}2/hν selectivity: ` + rows.map((r) => `${r.pct}% at a ${r.cls} C–H`).join(', ') + ` (McMurry 10.2).`,
  rohSlow: `Primary and secondary alcohols react slowly with HX; SOCl2 (for Cl) or PBr3 (for Br) are preferred (McMurry 10.5).`,
  co2Lost: `A =CH2 (or ≡CH) carbon is oxidized all the way to CO2, which escapes and is not built.`,
  zaitsevTie: `Two different alkenes have the same degree of substitution; Zaitsev's rule cannot choose between them. Both are shown.`,
  ezAssumedTrans: `The new double bond is drawn as E (trans); McMurry does not state a geometry preference here, so the geometry is not graded.`,
  proticSlow: `A protic solvent slows SN2 (McMurry 11.3); the reaction still goes.`,
  slowSolvolysis: `A simple secondary halide ionizes slowly, so this solvolysis is slow (McMurry 11.5).`,
  slowDehydration: `Secondary alcohols dehydrate more slowly than tertiary ones (McMurry 8.1).`,
  e1cb: `A carbonyl group lies two carbons from the leaving group: E1cB elimination is possible but not modeled (McMurry 11.10).`,
  ringConformation: `In a cyclohexane ring, E2 needs the H and the leaving group trans-diaxial (McMurry 11.9); this requirement is not modeled.`,
  sn1Racemic: `SN1 goes through a planar carbocation: the product is racemic (McMurry 11.5 notes a slight excess of inversion).`,
} as const;

// ---------------------------------------------------------------------------
// JUSTIFY (04 section 5.9.3)
// ---------------------------------------------------------------------------

const SUBSTRATE_WORDS: Readonly<Record<SubstrateClass, string>> = {
  alkene: 'a C=C',
  alkyne: 'a C≡C',
  'terminal-alkyne': 'a terminal C≡C–H',
  'alkyl-halide': 'a C–X bond (X = Cl, Br, I)',
  alcohol: 'a C–OH',
  epoxide: 'an epoxide ring',
  diol: 'a 1,2-diol',
  'vicinal-dihalide': 'a 1,2-dihalide',
  alkane: 'only C–C and C–H bonds',
  'allylic-alkene': 'a C=C with an allylic C–H',
};

export const JUSTIFY = {
  noSubstrate: (card: Pick<ReagentCard, 'label' | 'substrates'>): string =>
    `${card.label} needs ${card.substrates.map((s) => SUBSTRATE_WORDS[s]).join(' or ')}; this molecule has none.`,
  HX_ADD: `Markovnikov: H adds to the alkene carbon with fewer alkyl groups, X to the one with more (McMurry 7.8).`,
  HX_ADD_ALKYNE: `HX adds to an alkyne with Markovnikov regiochemistry and H, X trans (McMurry 9.3).`,
  HX_ADD_2EQ: `A second HX adds to the vinylic halide with X going to the carbon that already bears X: a geminal dihalide (McMurry 9.3).`,
  twoEquivAlkene: `Two equivalents of HX only matter for alkynes; an alkene consumes one.`,
  RADICAL_HBR: `With peroxides HBr adds by a radical chain: Br ends on the less substituted carbon (not in McMurry 10e).`,
  X2_ADD: `Br2/Cl2 add anti through a cyclic halonium ion (McMurry 8.2).`,
  X2_ADD_ALKYNE: `X2 adds once to an alkyne with trans stereochemistry; a second equivalent gives the tetrahalide (McMurry 9.3).`,
  HOX_ADD: `Halohydrin formation: X+ adds first, water opens the halonium ion at the more substituted carbon, anti (McMurry 8.3).`,
  HYDRATION: `Acid-catalysed hydration is Markovnikov through a carbocation (McMurry 8.4).`,
  OXYMERC: `Oxymercuration–demercuration is Markovnikov without a carbocation, so no rearrangement (McMurry 8.4).`,
  HYDROBORATION: `Hydroboration–oxidation is non-Markovnikov and syn: H and OH add to the same face (McMurry 8.5).`,
  H2: `Catalytic hydrogenation adds both H to the same face (syn) (McMurry 8.6).`,
  H2_ALKYNE: `H2 over Pd/C reduces an alkyne all the way to the alkane (McMurry 9.5).`,
  EPOXIDATION: `A peroxyacid transfers one O to the alkene, syn (McMurry 8.7).`,
  EPOXIDE_OPEN: `Acid opens the epoxide at the more substituted carbon, anti: a trans-1,2-diol (McMurry 8.7).`,
  ANTI_DIOL: `Epoxidation then acidic hydrolysis gives the trans (anti) 1,2-diol (McMurry 8.7).`,
  SYN_DIOL: `OsO4 adds both OH to the same face: a cis (syn) 1,2-diol (McMurry 8.7).`,
  CYCLOPROPANATION: `The carbene adds to the alkene in one step, syn and stereospecific (McMurry 8.9).`,
  OZONOLYSIS: `Ozonolysis cleaves the C=C; each carbon becomes a C=O (McMurry 8.8).`,
  KMNO4_CLEAVAGE: `Hot acidic KMnO4 cleaves the C=C: R2C= gives a ketone, RCH= a carboxylic acid, H2C= CO2 (McMurry 8.8).`,
  KMNO4_ALKYNE: `Alkynes are cleaved by KMnO4 to carboxylic acids; a terminal ≡CH gives CO2 (McMurry 9.6).`,
  DIOL_CLEAVAGE: `HIO4 cleaves the C–C bond of a 1,2-diol to two carbonyls (McMurry 8.8).`,
  ALKYNE_HYDRATION_HG: `Hg(II)-catalysed hydration is Markovnikov; the enol tautomerizes to the ketone (McMurry 9.4).`,
  ALKYNE_HYDROBORATION: `Hydroboration–oxidation of an alkyne is non-Markovnikov; the enol tautomerizes to the aldehyde or ketone (McMurry 9.4).`,
  LINDLAR: `Lindlar's poisoned catalyst stops at the cis (Z) alkene by syn addition of H2 (McMurry 9.5).`,
  DISSOLVING_METAL: `Li in liquid NH3 reduces an alkyne to the trans (E) alkene (McMurry 9.5).`,
  internalAlkyne: `Only terminal alkynes are acidic enough (pKa ≈ 25) to be deprotonated by NaNH2 (pKa NH3 ≈ 35); an internal alkyne has no C≡C–H (McMurry 9.7).`,
  rxMissing: `Choose the alkyl halide for the second step.`,
  rxNotHalide: `The second reagent must be an alkyl halide (R–Br or R–I).`,
  ACETYLIDE_ALKYLATION: `The acetylide anion displaces X from a methyl or primary halide by SN2 (McMurry 9.8).`,
  acetylideE2: `Acetylide anions are strong bases: secondary and tertiary halides eliminate (E2) instead (McMurry 9.9).`,
  DOUBLE_E2: `Two successive E2 dehydrohalogenations of a 1,2-dihalide give the alkyne (McMurry 9.2).`,
  doubleE2SmallRing: `A ring smaller than eight carbons cannot hold a linear C≡C; vicinal dihalides on small rings do not give cycloalkynes.`,
  ALLYLIC_BROMINATION: `NBS with light substitutes Br at the allylic position through the resonance-stabilized allylic radical (McMurry 10.3).`,
  RADICAL_HALOGENATION: `Radical halogenation replaces a C–H by C–X; reactivity 3° > 2° > 1° C–H (McMurry 10.2).`,
  rohSn1: `Tertiary (and allylic/benzylic) alcohols react with HX by SN1 through a carbocation (McMurry 10.5).`,
  rohSlow: `Primary and secondary alcohols react with HX only slowly: slow, low-yield; McMurry uses SOCl2 (for Cl) or PBr3 (for Br) instead (McMurry 10.5).`,
  rohSn2: `SOCl2 and PBr3 convert primary and secondary alcohols to halides by an SN2 process (McMurry 10.5, 11.3).`,
  rohTertiary: `SOCl2 and PBr3 are used for primary and secondary alcohols; tertiary alcohols use HX (McMurry 10.5).`,
  rohSp2: `An OH on a double-bond or ring carbon is not an alcohol for these reagents.`,
  R0: `There is no C–X bond: OH−, RO−, NH2− and F− are poor leaving groups (McMurry 11.3).`,
  R1: `Vinylic and aryl halides do not undergo SN2 or SN1 (McMurry 11.3).`,
  R2: `Fluoride is too poor a leaving group (McMurry 11.3).`,
  R3_tert_sn1: `No hydrogen on a neighbouring carbon, so E2 is impossible; this tertiary allylic/benzylic halide ionizes readily to a resonance-stabilized carbocation, so substitution goes by SN1 (McMurry 11.5).`,
  R3_tert: `Tertiary halide + strong base: E2 only; SN2 is impossible at a tertiary carbon (McMurry 11.12).`,
  R3_sec_baseOnly: `Amide and acetylide anions are strong bases: with a secondary halide they give E2 elimination instead of SN2 (McMurry 9.9, 11.12).`,
  R3_sec: `Secondary halide + strong base: E2 predominates, with some SN2 (McMurry 11.12).`,
  R3_sec_bulky: `Secondary halide + bulky base: E2, less substituted alkene (Hofmann) (McMurry 11.12; Hofmann orientation not in 10e).`,
  R3_bulky: `Primary halide + strong, sterically hindered base: E2 rather than SN2 (McMurry 11.12).`,
  R3_neopentyl: `Branching one carbon away blocks backside attack (neopentyl); E2 instead (McMurry 11.3).`,
  R3_neopentyl_noBetaH: `Branching one carbon away blocks backside attack (neopentyl, McMurry 11.3), and there is no β-hydrogen for E2: no reaction.`,
  R3_prim: `Primary halide + good nucleophile: SN2 with inversion; a little E2 (McMurry 11.12).`,
  R3_prim_baseOnly: `NaNH2 is a strong base, not a nucleophile: a primary halide gives E2 elimination (McMurry 9.2, 11.12); the amine is not formed.`,
  R3_prim_heat: `KOH/ethanol at reflux favors E2 (McMurry 8.1); some substitution.`,
  R3_methyl: `Methyl halide: SN2 only (no β-hydrogens) (McMurry 11.3).`,
  R3_methyl_baseOnly: `A methyl halide has no β-hydrogen to eliminate, and NaNH2 is not used as a nucleophile in McMurry: no reaction.`,
  R4_prim: `Methyl/primary halide + good, weakly basic nucleophile: SN2 (McMurry 11.12).`,
  R4_sec_sn1: `Secondary allylic/benzylic halide in a protic solvent with a weakly basic nucleophile: SN1 (some E1) (McMurry 11.12).`,
  R4_sec_sn2: `Secondary halide + weakly basic nucleophile: SN2, best in a polar aprotic solvent (McMurry 11.12).`,
  R4_tert_protic: `Tertiary halide, weakly basic nucleophile, protic solvent: SN1 with E1 alongside (McMurry 11.12).`,
  R4_tert_aprotic: `Tertiary halides do not react by SN2, and without a protic solvent SN1 is not favored (McMurry 11.3, 11.5).`,
  R5_sn1: `Solvolysis: the solvent is the nucleophile; tertiary/allylic/benzylic halides ionize to a carbocation: SN1 major, E1 minor (McMurry 11.5, 11.10).`,
  R5_sec_slow: `A simple secondary halide ionizes slowly: SN1/E1 but slow (McMurry 11.5).`,
  R5_allylic: `A primary allylic/benzylic cation is as stable as a secondary alkyl cation: SN1 (McMurry 11.5).`,
  R5_primary: `Primary carbocations do not form, and water/alcohols are too weak for SN2: no reaction (McMurry 11.5).`,
  noBetaH: `Elimination needs a hydrogen on a carbon next to the C–X; there is none.`,
  dehydration: `Acid-catalysed dehydration is E1: the more substituted alkene forms (Zaitsev) (McMurry 8.1).`,
  dehydrationPrimary: `Primary alcohols need harsher conditions to dehydrate; not covered in McMurry 8.1.`,
} as const;

export type JustifyKey = keyof typeof JUSTIFY;

/** McMurry 10.2 per-H reactivities (Br from mcmurry-orgo1 section 7.2). */
export const RADICAL_WEIGHTS: Readonly<Record<'Cl' | 'Br', Readonly<Record<1 | 2 | 3, number>>>> = {
  Cl: { 1: 1, 2: 3.5, 3: 5 },
  Br: { 1: 1, 2: 82, 3: 1640 },
};

// ---------------------------------------------------------------------------
// Preview fallback layout (04 section 7.3)
// ---------------------------------------------------------------------------

const FACE_DIRS: readonly Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function keyOf(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

/**
 * BFS layout from the max-degree atom: each atom goes to the first free face
 * cell of its BFS parent (straight continuation first, then FACE_DIRS), or to
 * the first free cell of a growing cubic shell. No bond-length or stereo
 * check; always succeeds. Components are laid out 4 empty cells apart along +x.
 */
export function relaxedLayout(g: MoleculeGraph): Vec3[] {
  const n = g.atoms.length;
  const pos: (Vec3 | null)[] = new Array<Vec3 | null>(n).fill(null);
  const occupied = new Set<string>();
  let nextX = 0;
  for (const comp of components(g)) {
    let start = comp[0]!;
    for (const i of comp) if (deg(g, i) > deg(g, start)) start = i;
    const origin: Vec3 = [nextX, 0, 0];
    pos[start] = origin;
    occupied.add(keyOf(origin));
    const parent = new Map<number, number>();
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++]!;
      const pu = pos[u]!;
      for (const v of [...neighborsOf(g, u)].sort((x, y) => x - y)) {
        if (pos[v] !== null) continue;
        const candidates: Vec3[] = [];
        const gp = parent.get(u);
        if (gp !== undefined) {
          const pg = pos[gp]!;
          candidates.push([pu[0] - pg[0], pu[1] - pg[1], pu[2] - pg[2]]);
        }
        candidates.push(...FACE_DIRS);
        let placed: Vec3 | null = null;
        for (const d of candidates) {
          const p: Vec3 = [pu[0] + d[0], pu[1] + d[1], pu[2] + d[2]];
          if (!occupied.has(keyOf(p))) { placed = p; break; }
        }
        for (let r = 1; placed === null; r++) {
          for (let dx = -r; dx <= r && placed === null; dx++) {
            for (let dy = -r; dy <= r && placed === null; dy++) {
              for (let dz = -r; dz <= r && placed === null; dz++) {
                if (dx === 0 && dy === 0 && dz === 0) continue;
                const p: Vec3 = [pu[0] + dx, pu[1] + dy, pu[2] + dz];
                if (!occupied.has(keyOf(p))) placed = p;
              }
            }
          }
        }
        pos[v] = placed;
        occupied.add(keyOf(placed));
        parent.set(v, u);
        queue.push(v);
      }
    }
    let maxX = nextX;
    for (const i of comp) maxX = Math.max(maxX, pos[i]![0]);
    nextX = maxX + 5;
  }
  return pos.map((p) => p ?? [0, 0, 0]);
}
