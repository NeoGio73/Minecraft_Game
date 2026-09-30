/**
 * Functional-group detection (McMurry Table 3.1 + ions + alkane fallback).
 * PURE MODULE. See docs/design/02-chemistry-core.md section 11.
 *
 * Rules run in `GROUP_IDS` order on a PERCEIVED graph; each hit claims heavy
 * atoms and a later match that touches a claimed atom is skipped (arene
 * rings may overlap each other only). Within a rule, matches are enumerated
 * by ascending anchor atom id or bond index and deduplicated by claimed set.
 */
import { GROUP_IDS } from './types';
import type { ChemApi, GroupHit, GroupId, GroupSubtype, MoleculeGraph } from './types';
import { neighborsOf, otherEnd } from './graph';
import { aromaticRings } from './aromatic';
import { ringCount } from './formula';

export const GROUP_NAME: Readonly<Record<GroupId, string>> = {
  'carboxylic-acid': 'carboxylic acid', 'acid-anhydride': 'acid anhydride', ester: 'ester', thioester: 'thioester',
  'acyl-halide': 'acid halide', amide: 'amide', nitrile: 'nitrile', aldehyde: 'aldehyde', ketone: 'ketone', imine: 'imine',
  sulfoxide: 'sulfoxide', alcohol: 'alcohol', thiol: 'thiol', disulfide: 'disulfide', ether: 'ether', sulfide: 'sulfide',
  amine: 'amine', halide: 'alkyl halide', arene: 'arene', alkyne: 'alkyne', alkene: 'alkene', phosphate: 'phosphate',
  carboxylate: 'carboxylate', alkoxide: 'alkoxide', thiolate: 'thiolate', ammonium: 'ammonium', oxonium: 'oxonium',
  carbocation: 'carbocation', carbanion: 'carbanion', 'amide-ion': 'amide ion', acetylide: 'acetylide',
  alkane: 'alkane', cycloalkane: 'cycloalkane',
};

const HALOGEN_ACID: Readonly<Record<string, string>> = {
  F: 'acid fluoride', Cl: 'acid chloride', Br: 'acid bromide', I: 'acid iodide',
};

function isHalogen(el: string): boolean {
  return el === 'F' || el === 'Cl' || el === 'Br' || el === 'I';
}

/** Per-atom facts computed once. */
interface Ctx {
  readonly g: MoleculeGraph;
  readonly H: readonly number[];
  readonly nbs: readonly (readonly number[])[];
  readonly pi: readonly number[];
  /** index of the C=O partner oxygen for carbonyl carbons, else -1 */
  readonly carbonylO: readonly number[];
}

function makeCtx(g: MoleculeGraph, hydrogens: readonly number[]): Ctx {
  const n = g.atoms.length;
  const nbs: number[][] = [];
  const pi: number[] = [];
  const carbonylO: number[] = [];
  for (let i = 0; i < n; i++) {
    nbs.push(neighborsOf(g, i));
    let p = 0;
    for (const k of g.adj[i]!) p += g.bonds[k]!.order - 1;
    pi.push(p);
  }
  for (let i = 0; i < n; i++) {
    const a = g.atoms[i]!;
    let o = -1;
    if (a.el === 'C' && a.charge === 0 && !a.aromatic) {
      for (const k of g.adj[i]!) {
        const b = g.bonds[k]!;
        if (b.order !== 2) continue;
        const j = otherEnd(g, k, i);
        const oa = g.atoms[j]!;
        if (oa.el === 'O' && oa.charge === 0 && g.adj[j]!.length === 1) { o = j; break; }
      }
    }
    carbonylO.push(o);
  }
  return { g, H: hydrogens, nbs, pi, carbonylO };
}

export function functionalGroups(g: MoleculeGraph, hydrogens: readonly number[]): GroupHit[] {
  const n = g.atoms.length;
  const c = makeCtx(g, hydrogens);
  const claimed = new Array<boolean>(n).fill(false);
  const hits: GroupHit[] = [];
  const emitted = new Set<string>();

  const el = (i: number) => g.atoms[i]!.el;
  const q = (i: number) => g.atoms[i]!.charge;
  const arom = (i: number) => g.atoms[i]!.aromatic;
  const deg = (i: number) => g.adj[i]!.length;
  const H = (i: number) => c.H[i] ?? 0;
  const X = (i: number) => deg(i) + H(i);
  const isC = (i: number) => el(i) === 'C';
  const carbonyl = (i: number) => c.carbonylO[i]! >= 0;
  const orderBetween = (i: number, j: number): number => {
    for (const k of g.adj[i]!) if (otherEnd(g, k, i) === j) return g.bonds[k]!.order;
    return 0;
  };
  const hasBondOfOrder = (i: number, order: number): boolean => g.adj[i]!.some((k) => g.bonds[k]!.order === order);
  const carbonNeighbours = (i: number): number[] => c.nbs[i]!.filter((j) => isC(j));

  function label(group: GroupId, subtype: GroupSubtype | undefined, extra?: { halogen?: string; count?: number }): string {
    if (group === 'acyl-halide' && extra?.halogen) return HALOGEN_ACID[extra.halogen] ?? GROUP_NAME[group];
    if (group === 'halide' && subtype === 'aryl') return 'aryl halide' + (extra?.count && extra.count > 1 ? ` ×${extra.count}` : '');
    if (group === 'halide' && subtype === 'vinyl') return 'vinyl halide' + (extra?.count && extra.count > 1 ? ` ×${extra.count}` : '');
    if (group === 'alcohol' && subtype === 'phenol') return 'phenol';
    if (group === 'alcohol' && subtype === 'enol') return 'enol';
    const base = subtype ? `${GROUP_NAME[group]} (${subtype})` : GROUP_NAME[group];
    return extra?.count && extra.count > 1 ? `${base} ×${extra.count}` : base;
  }

  function emit(group: GroupId, atoms: number[], subtype?: GroupSubtype, extra?: { halogen?: string; count?: number }, allowAreneOverlap = false): void {
    const key = group + ':' + [...atoms].sort((x, y) => x - y).join(',');
    if (emitted.has(key)) return;
    for (const a of atoms) {
      if (claimed[a]) {
        if (allowAreneOverlap && claimedByArene[a]) continue;
        return;
      }
    }
    emitted.add(key);
    for (const a of atoms) claimed[a] = true;
    if (allowAreneOverlap) for (const a of atoms) claimedByArene[a] = true;
    const hit: GroupHit = subtype
      ? { group, subtype, atoms: [...atoms], label: label(group, subtype, extra) }
      : { group, atoms: [...atoms], label: label(group, undefined, extra) };
    hits.push(hit);
  }
  const claimedByArene = new Array<boolean>(n).fill(false);

  /** Single-bonded neighbours of carbonyl carbon `i` other than its =O. */
  const carbonylSubs = (i: number): number[] => c.nbs[i]!.filter((j) => j !== c.carbonylO[i]);
  /** The "third substituent" rule: carbonyl carbon `i` bonded to `x` has, apart from =O and x, a carbon or H. */
  const thirdIsCarbonOrH = (i: number, x: number): boolean => {
    const others = carbonylSubs(i).filter((j) => j !== x);
    if (others.length === 0) return H(i) >= 1;
    return others.length === 1 && isC(others[0]!);
  };

  const alcoholSubtype = (cp: number): GroupSubtype => {
    if (arom(cp)) return 'phenol';
    if (c.nbs[cp]!.some((j) => isC(j) && orderBetween(cp, j) === 2)) return 'enol';
    const nC = carbonNeighbours(cp).length;
    if (nC === 0 && H(cp) === 3) return 'methanol';
    if (nC <= 1) return 'primary';
    if (nC === 2) return 'secondary';
    return 'tertiary';
  };
  const carbonSubtype = (cp: number): GroupSubtype => {
    if (arom(cp)) return 'aryl';
    if (c.nbs[cp]!.some((j) => isC(j) && orderBetween(cp, j) >= 2)) return 'vinyl';
    const nC = carbonNeighbours(cp).length;
    return nC === 0 ? 'methyl' : nC === 1 ? 'primary' : nC === 2 ? 'secondary' : 'tertiary';
  };

  for (const group of GROUP_IDS) {
    switch (group) {
      case 'carboxylic-acid':
        for (let i = 0; i < n; i++) {
          if (!carbonyl(i)) continue;
          for (const j of carbonylSubs(i)) {
            if (el(j) === 'O' && q(j) === 0 && deg(j) === 1 && H(j) === 1 && orderBetween(i, j) === 1) {
              emit(group, [i, c.carbonylO[i]!, j]);
              break;
            }
          }
        }
        break;
      case 'acid-anhydride':
        for (let o = 0; o < n; o++) {
          if (el(o) !== 'O' || q(o) !== 0 || deg(o) !== 2 || H(o) !== 0) continue;
          const [c1, c2] = c.nbs[o]! as [number, number];
          if (carbonyl(c1) && carbonyl(c2) && orderBetween(o, c1) === 1 && orderBetween(o, c2) === 1) {
            emit(group, [c1, c.carbonylO[c1]!, o, c2, c.carbonylO[c2]!]);
          }
        }
        break;
      case 'ester':
      case 'thioester': {
        const bridge = group === 'ester' ? 'O' : 'S';
        for (let i = 0; i < n; i++) {
          if (!carbonyl(i)) continue;
          for (const j of carbonylSubs(i)) {
            if (el(j) !== bridge || q(j) !== 0 || deg(j) !== 2 || H(j) !== 0 || arom(j) || orderBetween(i, j) !== 1) continue;
            const cp = c.nbs[j]!.find((x) => x !== i)!;
            if (!isC(cp) || carbonyl(cp)) continue;
            if (!thirdIsCarbonOrH(i, j)) continue;
            emit(group, [i, c.carbonylO[i]!, j], group === 'ester' && H(i) === 1 ? 'formate' : undefined);
            break;
          }
        }
        break;
      }
      case 'acyl-halide':
        for (let i = 0; i < n; i++) {
          if (!carbonyl(i)) continue;
          for (const j of carbonylSubs(i)) {
            if (isHalogen(el(j)) && q(j) === 0 && deg(j) === 1) {
              emit(group, [i, c.carbonylO[i]!, j], undefined, { halogen: el(j) });
              break;
            }
          }
        }
        break;
      case 'amide':
        for (let i = 0; i < n; i++) {
          if (!carbonyl(i)) continue;
          for (const j of carbonylSubs(i)) {
            if (el(j) !== 'N' || q(j) !== 0 || arom(j) || c.pi[j] !== 0 || X(j) !== 3 || orderBetween(i, j) !== 1) continue;
            if (!thirdIsCarbonOrH(i, j)) continue;
            emit(group, [i, c.carbonylO[i]!, j]);
            break;
          }
        }
        break;
      case 'nitrile':
        for (let i = 0; i < n; i++) {
          if (!isC(i) || q(i) !== 0 || X(i) !== 2) continue;
          for (const k of g.adj[i]!) {
            const b = g.bonds[k]!;
            if (b.order !== 3) continue;
            const j = otherEnd(g, k, i);
            if (el(j) === 'N' && q(j) === 0 && deg(j) === 1 && H(j) === 0) emit(group, [i, j]);
          }
        }
        break;
      case 'aldehyde':
        for (let i = 0; i < n; i++) {
          if (carbonyl(i) && H(i) >= 1) emit(group, [i, c.carbonylO[i]!], H(i) === 2 ? 'formaldehyde' : undefined);
        }
        break;
      case 'ketone':
        for (let i = 0; i < n; i++) {
          if (!carbonyl(i) || deg(i) !== 3 || H(i) !== 0) continue;
          if (carbonylSubs(i).every((j) => isC(j))) emit(group, [i, c.carbonylO[i]!]);
        }
        break;
      case 'imine':
        for (let i = 0; i < n; i++) {
          if (!isC(i) || arom(i)) continue;
          for (const k of g.adj[i]!) {
            const b = g.bonds[k]!;
            if (b.order !== 2) continue;
            const j = otherEnd(g, k, i);
            if (el(j) === 'N' && q(j) === 0 && X(j) === 2) emit(group, [i, j]);
          }
        }
        break;
      case 'sulfoxide':
        for (let s = 0; s < n; s++) {
          if (el(s) !== 'S' || q(s) !== 1 || deg(s) !== 3 || H(s) !== 0) continue;
          const o = c.nbs[s]!.find((j) => el(j) === 'O' && q(j) === -1 && deg(j) === 1 && orderBetween(s, j) === 1);
          if (o === undefined) continue;
          if (c.nbs[s]!.filter((j) => j !== o).every((j) => isC(j))) emit(group, [s, o]);
        }
        break;
      case 'alcohol':
        for (let o = 0; o < n; o++) {
          if (el(o) !== 'O' || q(o) !== 0 || deg(o) !== 1 || H(o) !== 1) continue;
          const cp = c.nbs[o]![0]!;
          if (!isC(cp) || carbonyl(cp)) continue;
          emit(group, [o], alcoholSubtype(cp));
        }
        break;
      case 'thiol':
        for (let s = 0; s < n; s++) {
          if (el(s) === 'S' && q(s) === 0 && deg(s) === 1 && H(s) === 1 && isC(c.nbs[s]![0]!)) emit(group, [s]);
        }
        break;
      case 'disulfide':
        for (let s = 0; s < n; s++) {
          if (el(s) !== 'S' || q(s) !== 0 || deg(s) !== 2 || H(s) !== 0) continue;
          for (const t of c.nbs[s]!) {
            if (t <= s || el(t) !== 'S' || q(t) !== 0 || deg(t) !== 2 || H(t) !== 0) continue;
            const cs = c.nbs[s]!.find((j) => j !== t)!;
            const ct = c.nbs[t]!.find((j) => j !== s)!;
            if (isC(cs) && isC(ct)) emit(group, [s, t]);
          }
        }
        break;
      case 'ether':
        for (let o = 0; o < n; o++) {
          if (el(o) !== 'O' || q(o) !== 0 || deg(o) !== 2 || H(o) !== 0 || arom(o)) continue;
          if (c.nbs[o]!.every((j) => isC(j) && !carbonyl(j))) emit(group, [o]);
        }
        break;
      case 'sulfide':
        for (let s = 0; s < n; s++) {
          if (el(s) !== 'S' || q(s) !== 0 || deg(s) !== 2 || H(s) !== 0) continue;
          if (c.nbs[s]!.every((j) => isC(j))) emit(group, [s]);
        }
        break;
      case 'amine':
        for (let i = 0; i < n; i++) {
          if (el(i) !== 'N' || q(i) !== 0 || arom(i) || c.pi[i] !== 0 || X(i) !== 3) continue;
          const cs = carbonNeighbours(i);
          if (cs.length === 0 || cs.some((j) => carbonyl(j))) continue;
          const subtype: GroupSubtype = cs.some((j) => arom(j)) ? 'aryl' : deg(i) === 1 ? 'primary' : deg(i) === 2 ? 'secondary' : 'tertiary';
          emit(group, [i], subtype);
        }
        break;
      case 'halide': {
        const byCarbon = new Map<number, number[]>();
        const carbonOrder: number[] = [];
        for (let x = 0; x < n; x++) {
          if (!isHalogen(el(x)) || q(x) !== 0 || deg(x) !== 1) continue;
          const cp = c.nbs[x]![0]!;
          if (!isC(cp) || carbonyl(cp)) continue;
          if (!byCarbon.has(cp)) { byCarbon.set(cp, []); carbonOrder.push(cp); }
          byCarbon.get(cp)!.push(x);
        }
        for (const cp of carbonOrder) {
          const xs = byCarbon.get(cp)!;
          emit(group, xs, carbonSubtype(cp), { count: xs.length });
        }
        break;
      }
      case 'arene':
        for (const ring of aromaticRings(g)) emit(group, ring, undefined, undefined, true);
        break;
      case 'alkyne':
        g.bonds.forEach((b) => {
          if (b.order === 3 && isC(b.a) && isC(b.b) && q(b.a) === 0 && q(b.b) === 0) emit(group, [b.a, b.b]);
        });
        break;
      case 'alkene':
        g.bonds.forEach((b) => {
          if (b.order !== 2 || !isC(b.a) || !isC(b.b) || q(b.a) !== 0 || q(b.b) !== 0 || arom(b.a) || arom(b.b)) return;
          const cumulated = [b.a, b.b].some((i) => g.adj[i]!.filter((k) => g.bonds[k]!.order === 2).length >= 2);
          emit(group, [b.a, b.b], cumulated ? 'cumulated' : undefined);
        });
        break;
      case 'phosphate':
        for (let p = 0; p < n; p++) {
          if (el(p) !== 'P') continue;
          const os = c.nbs[p]!.filter((j) => el(j) === 'O');
          if (os.length < 3) continue;
          if (!os.some((o) => c.nbs[o]!.some((j) => j !== p && isC(j)))) continue;
          emit(group, [p, ...os]);
        }
        break;
      case 'carboxylate':
        for (let i = 0; i < n; i++) {
          if (!carbonyl(i)) continue;
          for (const j of carbonylSubs(i)) {
            if (el(j) === 'O' && q(j) === -1 && deg(j) === 1 && orderBetween(i, j) === 1) {
              emit(group, [i, c.carbonylO[i]!, j]);
              break;
            }
          }
        }
        break;
      case 'alkoxide':
        for (let o = 0; o < n; o++) {
          if (el(o) !== 'O' || q(o) !== -1 || deg(o) !== 1) continue;
          const cp = c.nbs[o]![0]!;
          if (isC(cp) && !carbonyl(cp)) emit(group, [o]);
        }
        break;
      case 'thiolate':
        for (let s = 0; s < n; s++) {
          if (el(s) === 'S' && q(s) === -1 && deg(s) === 1 && isC(c.nbs[s]![0]!)) emit(group, [s]);
        }
        break;
      case 'ammonium':
        for (let i = 0; i < n; i++) {
          if (el(i) === 'N' && q(i) === 1 && c.pi[i] === 0 && X(i) === 4) emit(group, [i]);
        }
        break;
      case 'oxonium':
        for (let i = 0; i < n; i++) {
          if (el(i) === 'O' && q(i) === 1 && c.pi[i] === 0 && X(i) === 3) emit(group, [i]);
        }
        break;
      case 'carbocation':
        for (let i = 0; i < n; i++) {
          if (!isC(i) || q(i) !== 1) continue;
          let subtype: GroupSubtype;
          if (arom(i)) subtype = 'aryl';
          else if (hasBondOfOrder(i, 2)) subtype = 'vinyl';
          else {
            const nC = carbonNeighbours(i).length;
            subtype = nC === 0 ? 'methyl' : nC === 1 ? 'primary' : nC === 2 ? 'secondary' : 'tertiary';
          }
          emit(group, [i], subtype);
        }
        break;
      case 'carbanion':
        for (let i = 0; i < n; i++) {
          if (isC(i) && q(i) === -1 && !hasBondOfOrder(i, 3)) emit(group, [i]);
        }
        break;
      case 'amide-ion':
        for (let i = 0; i < n; i++) {
          if (el(i) === 'N' && q(i) === -1 && X(i) === 2) emit(group, [i]);
        }
        break;
      case 'acetylide':
        for (let i = 0; i < n; i++) {
          if (!isC(i) || q(i) !== -1) continue;
          for (const k of g.adj[i]!) {
            const b = g.bonds[k]!;
            if (b.order === 3 && isC(otherEnd(g, k, i))) emit(group, [i, otherEnd(g, k, i)]);
          }
        }
        break;
      case 'alkane':
      case 'cycloalkane': {
        if (hits.length > 0 || n === 0) break;
        if (!g.atoms.every((a) => a.el === 'C' && a.charge === 0)) break;
        const cyclic = ringCount(g) > 0;
        if ((group === 'cycloalkane') !== cyclic) break;
        emit(group, [...Array(n).keys()]);
        break;
      }
      default: {
        const _exhaustive: never = group;
        void _exhaustive;
      }
    }
  }
  return hits;
}

const _check: Pick<ChemApi, 'functionalGroups'> = { functionalGroups };
void _check;
