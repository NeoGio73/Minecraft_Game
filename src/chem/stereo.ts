/**
 * Stereochemistry from grid vectors and from SMILES tags.
 * PURE MODULE. See docs/design/03-stereo-acidity-hybridization.md §2–§7.
 *
 *  - `signedVolume`, `classifyShape`: the octahedral-grid geometry primitives
 *    (stereo-on-grid 1.x; every grid test is exact because cells are integers).
 *  - `assignRS`: R/S of one tetrahedral carbon from CIP priorities (cip.ts)
 *    and the signed volume over the substituent tips; planar centres
 *    (`T` with an implicit H, `square-planar` with four explicit) are
 *    `UNSPECIFIED` with a fix hint and, for `T`, the two cells where an
 *    explicit H block would define the centre.
 *  - `alkeneSides` / `assignEZ`: E/Z from the perpendicular, antiparallel and
 *    coplanar rules of §3.1; ring C=C (size <= RING_EZ_EXEMPT_MAX) are `RING`.
 *  - `ringFace`: cis/trans faces by the Newell normal of a ring.
 *  - `parityInOrder`, `permSign`, `compareStereo`: parity comparison under an
 *    isomorphism (R5: the arbiter of grading; CIP labels are feedback only).
 *  - `tagsFromPositions`, `labelTargetStereo`, `analyzeStereo`, `stereoWarnings`.
 *
 * File layout note (03 §13 item 10): `analyzeStereo`'s meso test needs
 * `compareStereo`, and `parityInOrder` needs `permSign`, so both live here;
 * `stereo-compare.ts` re-exports them under the contract's module name. The
 * import direction stays `compare -> stereo-compare -> stereo -> cip`.
 */
import { hasPositions } from './types';
import type {
  BondLabel, CenterLabel, CenterShape, ChemApi, DoubleBondStereo, EzTag, MoleculeGraph,
  RingFace, StereoAnalysis, StereoCenter, TetTag, Vec3, Warning, WorldAtom, WorldGraph,
} from './types';
import { buildGraph, otherEnd, ringsThrough, smallestRings } from './graph';
import type { BondInput } from './graph';
import { cipRank } from './cip';
import { implicitHydrogens } from './hydrogens';
import { DEFAULT_MAX_STATES, findIsomorphismsDetailed } from './isomorphism';
import { add, cross, dot, neg, scale, sub } from '../util/vec3';

// ---------------------------------------------------------------------------
// Constants and student text
// ---------------------------------------------------------------------------

/** |V| <= EPS is "planar". Lattice coordinates are integers, so every grid test
 *  is exact; EPS matters only for non-integer previews (embedding output). */
export const EPS = 1e-9;

/** Ring size <= this => a ring C=C is reported RING and no geometry check runs. */
export const RING_EZ_EXEMPT_MAX = 7;

export const STEREO_TEXT = {
  notCenter: 'Not a chirality center: two of the groups are the same.',
  cannotAssign: 'Priorities on this carbon depend on advanced CIP rules (3-5) that this course does not cover.',
  flatT: 'This carbon is drawn flat: two of its groups are opposite each other and the hidden H could sit above or below. Bend the chain here (put the three groups at 90 degrees to each other) or place the H block explicitly above or below.',
  flatSquare: 'This carbon is drawn planar; move one substituent up or down to make it a real tetrahedral center.',
  noEz: (n: number) => `No E/Z isomerism: C${n} carries two identical groups (McMurry 7.3).`,
  collinear: (n: number) => `A group on C${n} lies in line with the double bond. An sp2 carbon is trigonal: move the group to the side (up, down, left or right of the carbon).`,
  notPlanar: (n: number) => `The two groups on C${n} are 90 degrees apart. They must be on opposite sides of the double bond, in one plane.`,
  twisted: 'The two ends of the double bond are in perpendicular planes. A pi bond needs both ends in the same plane.',
} as const;

/** Same order as `FACE_DIRS` in src/world/types.ts (kept local: chem imports nothing from world). */
const FACE_DIRS: readonly Vec3[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

// ---------------------------------------------------------------------------
// Geometry primitives (§2.1, §2.2)
// ---------------------------------------------------------------------------

/** V = ((v2-v1) x (v3-v1)) . (v4-v1) over four substituent tips (or direction
 *  vectors from the centre: the centre cancels). Tips in CIP order 1..4:
 *  V > EPS => R, V < -EPS => S, |V| <= EPS => planar. */
export function signedVolume(v1: Vec3, v2: Vec3, v3: Vec3, v4: Vec3): number {
  return dot(cross(sub(v2, v1), sub(v3, v1)), sub(v4, v1));
}

function det3(a: Vec3, b: Vec3, c: Vec3): number {
  return dot(a, cross(b, c));
}

function length(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

/**
 * Shape of the EXPLICIT substituent directions of a centre (heavy neighbours
 * plus explicit H blocks). 3 dirs: `octant` when linearly independent (on the
 * face lattice: mutually orthogonal), else `T`. 4 dirs: `seesaw` when the
 * signed volume is non-zero, else `square-planar`.
 */
export function classifyShape(dirs: readonly Vec3[]): CenterShape {
  if (dirs.length === 3) {
    const [d1, d2, d3] = dirs as [Vec3, Vec3, Vec3];
    return Math.abs(det3(d1, d2, d3)) > EPS ? 'octant' : 'T';
  }
  if (dirs.length === 4) {
    const [d1, d2, d3, d4] = dirs as [Vec3, Vec3, Vec3, Vec3];
    return Math.abs(signedVolume(d1, d2, d3, d4)) > EPS ? 'seesaw' : 'square-planar';
  }
  throw new RangeError('classifyShape: 3 or 4 directions');
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

function heavyNeighbours(g: MoleculeGraph, i: number): number[] {
  return g.adj[i]!.map((k) => otherEnd(g, k, i));
}

function piOf(g: MoleculeGraph, i: number): number {
  let pi = 0;
  for (const k of g.adj[i]!) pi += g.bonds[k]!.order - 1;
  return pi;
}

/** A carbon with four sigma partners (heavy + H) and at most one H (§7 step 1). */
function isCentreCandidate(g: MoleculeGraph, hydrogens: readonly number[], i: number): boolean {
  const a = g.atoms[i]!;
  const nH = hydrogens[i] ?? 0;
  return a.el === 'C' && piOf(g, i) === 0 && g.adj[i]!.length + nH === 4 && nH <= 1;
}

function ringExempt(g: MoleculeGraph, a: number, b: number): boolean {
  return ringsThrough(g, a, b).some((r) => r.length <= RING_EZ_EXEMPT_MAX);
}

/** A non-aromatic C=C between non-aromatic carbons (§7 step 2). */
function isPlainAlkene(g: MoleculeGraph, k: number): boolean {
  const bond = g.bonds[k]!;
  if (bond.order !== 2 || bond.aromatic) return false;
  const A = g.atoms[bond.a]!;
  const B = g.atoms[bond.b]!;
  return A.el === 'C' && B.el === 'C' && !A.aromatic && !B.aromatic;
}

function occupiedCells(g: WorldGraph): Set<string> {
  const cells = new Set<string>();
  for (const a of g.atoms) {
    cells.add(a.pos.join(','));
    for (const h of a.hPos) cells.add(h.join(','));
  }
  return cells;
}

// ---------------------------------------------------------------------------
// R/S (§2.3)
// ---------------------------------------------------------------------------

/** For a T trio: the free face cells perpendicular to the T's axis (§2.3). */
function suggestH(g: WorldGraph, center: number, dirs: readonly Vec3[]): Vec3[] {
  const c = g.atoms[center]!.pos;
  const occupied = occupiedCells(g);
  const out: Vec3[] = [];
  for (const d of FACE_DIRS) {
    const nd = neg(d);
    const blocked = dirs.some((e) => (e[0] === d[0] && e[1] === d[1] && e[2] === d[2]) || (e[0] === nd[0] && e[1] === nd[1] && e[2] === nd[2]));
    if (blocked) continue;
    const cell = add(c, d);
    if (occupied.has(cell.join(','))) continue;
    out.push(cell);
  }
  return out;
}

/** R/S of one tetrahedral carbon from CIP priorities and the grid vectors (§2.3). */
export function assignRS(g: WorldGraph, hydrogens: readonly number[], center: number): StereoCenter {
  if (!Number.isInteger(center) || center < 0 || center >= g.atoms.length) throw new RangeError(`no atom ${center}`);
  const a = g.atoms[center]!;
  const heavy = heavyNeighbours(g, center);
  const nH = hydrogens[center] ?? 0;
  if (a.el !== 'C' || piOf(g, center) > 0 || heavy.length + nH !== 4 || nH > 1) {
    return {
      atom: center, label: 'NOT_CENTER', shape: null,
      reason: 'needs four single-bonded groups with at most one hydrogen',
      hint: STEREO_TEXT.notCenter,
    };
  }
  const rank = cipRank(g, hydrogens, center);
  if (rank.capHit) {
    return { atom: center, label: 'CANNOT_ASSIGN', shape: null, priorities: rank.ligands, reason: 'digraph size cap', hint: STEREO_TEXT.cannotAssign };
  }
  if (rank.tie) {
    if (rank.tieNeedsAdvancedRules) {
      return { atom: center, label: 'CANNOT_ASSIGN', shape: null, priorities: rank.ligands, reason: 'tie needs CIP rules 3-5', hint: STEREO_TEXT.cannotAssign };
    }
    return { atom: center, label: 'NOT_CENTER', shape: null, reason: 'two identical groups (Rule 1a tie)', hint: STEREO_TEXT.notCenter };
  }
  const c = a.pos;
  const explicitDirs: Vec3[] = [...heavy.map((n) => sub(g.atoms[n]!.pos, c)), ...a.hPos.map((h) => sub(h, c))];
  const shape = classifyShape(explicitDirs);
  const v: (Vec3 | null)[] = rank.ligands.map((l) => (l === 'H' ? (a.hPos.length === 1 ? sub(a.hPos[0]!, c) : null) : sub(g.atoms[l]!.pos, c)));
  for (let i = 0; i < 3; i++) if (v[i] === null) throw new Error('implicit H not lowest');
  if (v.length !== 4) throw new Error('implicit H not lowest');
  const v0 = v[0]!;
  const v1 = v[1]!;
  const v2 = v[2]!;
  const v3 = v[3] ?? neg(add(add(v0, v1), v2));
  const V = signedVolume(v0, v1, v2, v3);
  if (Math.abs(V) <= EPS) {
    // |V| = 0 happens exactly for a T trio with an implicit H or a square-planar quad (§2.2)
    const planar: 'T' | 'square-planar' = shape === 'square-planar' ? 'square-planar' : 'T';
    return {
      atom: center, label: 'UNSPECIFIED', shape: planar, priorities: rank.ligands,
      reason: 'planar: ' + planar,
      hint: planar === 'T' ? STEREO_TEXT.flatT : STEREO_TEXT.flatSquare,
      ...(planar === 'T' ? { suggestedHPositions: suggestH(g, center, explicitDirs) } : {}),
    };
  }
  return { atom: center, label: V > 0 ? 'R' : 'S', shape, priorities: rank.ligands };
}

// ---------------------------------------------------------------------------
// E/Z (§3)
// ---------------------------------------------------------------------------

export interface AlkeneEnd {
  readonly atom: number;
  /** Explicit substituents: heavy neighbour ids and 'H' for explicit H blocks. */
  readonly subs: readonly (number | 'H')[];
  /** Direction from the carbon to substituent `s`; 'H' on an end with one
   *  explicit substituent and an implicit H is the negative of that substituent;
   *  undefined when the end has no such vector. */
  vec(s: number | 'H'): Vec3 | undefined;
}

export type AlkeneSides =
  | { readonly ok: true; readonly u: Vec3; readonly ends: readonly [AlkeneEnd, AlkeneEnd] }
  | { readonly ok: false; readonly label: 'COLLINEAR' | 'NOT_PLANAR' | 'TWISTED'; readonly atom?: number };

/**
 * Substituent geometry of a C=C on the grid (§3.1): every explicit
 * substituent perpendicular to the axis (else COLLINEAR), two explicit
 * substituents of one end antiparallel (else NOT_PLANAR), the two ends'
 * substituent planes parallel (else TWISTED). Shared by `assignEZ` and
 * `compareStereo`.
 */
export function alkeneSides(g: WorldGraph, hydrogens: readonly number[], bondIndex: number): AlkeneSides {
  if (!Number.isInteger(bondIndex) || bondIndex < 0 || bondIndex >= g.bonds.length) throw new RangeError(`no bond ${bondIndex}`);
  const bond = g.bonds[bondIndex]!;
  const u = sub(g.atoms[bond.b]!.pos, g.atoms[bond.a]!.pos);
  const ends: AlkeneEnd[] = [];
  const refs: (Vec3 | undefined)[] = [];
  for (const [C, P] of [[bond.a, bond.b], [bond.b, bond.a]] as const) {
    const atom = g.atoms[C]!;
    const c = atom.pos;
    const explicit: { readonly id: number | 'H'; readonly v: Vec3 }[] = [];
    for (const n of heavyNeighbours(g, C)) if (n !== P) explicit.push({ id: n, v: sub(g.atoms[n]!.pos, c) });
    for (const h of atom.hPos) explicit.push({ id: 'H', v: sub(h, c) });
    const implicitCount = (hydrogens[C] ?? 0) - atom.hPos.length;
    for (const e of explicit) if (Math.abs(dot(e.v, u)) > EPS) return { ok: false, label: 'COLLINEAR', atom: C };
    if (explicit.length >= 2) {
      if (explicit.length > 2) return { ok: false, label: 'NOT_PLANAR', atom: C };
      const s1 = explicit[0]!.v;
      const s2 = explicit[1]!.v;
      if (Math.abs(dot(s1, s2) + length(s1) * length(s2)) > EPS) return { ok: false, label: 'NOT_PLANAR', atom: C };
    }
    refs.push(explicit[0]?.v);
    const subs = explicit.map((e) => e.id);
    const vec = (s: number | 'H'): Vec3 | undefined => {
      const hit = explicit.find((e) => e.id === s);
      if (hit) return hit.v;
      if (s === 'H' && explicit.length === 1 && implicitCount >= 1) return neg(explicit[0]!.v);
      return undefined;
    };
    ends.push({ atom: C, subs, vec });
  }
  const ra = refs[0];
  const rb = refs[1];
  if (ra !== undefined && rb !== undefined) {
    if (Math.abs(Math.abs(dot(ra, rb)) - length(ra) * length(rb)) > EPS) return { ok: false, label: 'TWISTED' };
  }
  return { ok: true, u, ends: [ends[0]!, ends[1]!] };
}

/** E/Z of bond `bondIndex` (order 2, both C, neither aromatic) from grid vectors (§3.2). */
export function assignEZ(g: WorldGraph, hydrogens: readonly number[], bondIndex: number): DoubleBondStereo {
  if (!Number.isInteger(bondIndex) || bondIndex < 0 || bondIndex >= g.bonds.length) throw new RangeError(`no bond ${bondIndex}`);
  const bond = g.bonds[bondIndex]!;
  const a = bond.a;
  const b = bond.b;
  const base = { bond: bondIndex, a, b };
  if (ringExempt(g, a, b)) return { ...base, label: 'RING' };
  const ra = cipRank(g, hydrogens, a, b);
  const rb = cipRank(g, hydrogens, b, a);
  if (ra.ligands.length !== 2) return { ...base, label: 'NO_EZ', hint: STEREO_TEXT.noEz(a + 1) };
  if (rb.ligands.length !== 2) return { ...base, label: 'NO_EZ', hint: STEREO_TEXT.noEz(b + 1) };
  if (ra.tie) return { ...base, label: 'NO_EZ', hint: STEREO_TEXT.noEz(a + 1) };
  if (rb.tie) return { ...base, label: 'NO_EZ', hint: STEREO_TEXT.noEz(b + 1) };
  const higherA = ra.ligands[0]!;
  const higherB = rb.ligands[0]!;
  const sides = alkeneSides(g, hydrogens, bondIndex);
  if (!sides.ok) {
    const hint = sides.label === 'TWISTED'
      ? STEREO_TEXT.twisted
      : sides.label === 'COLLINEAR' ? STEREO_TEXT.collinear((sides.atom ?? a) + 1) : STEREO_TEXT.notPlanar((sides.atom ?? a) + 1);
    return { ...base, label: sides.label, hint, higherA, higherB };
  }
  const [endA, endB] = sides.ends;
  const pa = endA.vec(higherA);
  const pb = endB.vec(higherB);
  if (pa === undefined) return { ...base, label: 'NO_EZ', hint: STEREO_TEXT.noEz(a + 1), higherA, higherB };
  if (pb === undefined) return { ...base, label: 'NO_EZ', hint: STEREO_TEXT.noEz(b + 1), higherA, higherB };
  const label: BondLabel = dot(pa, pb) > 0 ? 'Z' : 'E';
  const heavyA = endA.subs.filter((s): s is number => s !== 'H');
  const heavyB = endB.subs.filter((s): s is number => s !== 'H');
  let cisTrans: 'cis' | 'trans' | undefined;
  if (heavyA.length === 1 && heavyB.length === 1) {
    const va = endA.vec(heavyA[0]!)!;
    const vb = endB.vec(heavyB[0]!)!;
    cisTrans = dot(va, vb) > 0 ? 'cis' : 'trans';
  }
  return { ...base, label, higherA, higherB, ...(cisTrans ? { cisTrans } : {}) };
}

// ---------------------------------------------------------------------------
// Ring faces (§4)
// ---------------------------------------------------------------------------

function newellNormal(g: WorldGraph, ring: readonly number[]): Vec3 {
  const n = ring.length;
  let centroid: Vec3 = [0, 0, 0];
  for (const r of ring) centroid = add(centroid, g.atoms[r]!.pos);
  centroid = scale(centroid, 1 / n);
  let normal: Vec3 = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const p = sub(g.atoms[ring[k]!]!.pos, centroid);
    const q = sub(g.atoms[ring[(k + 1) % n]!]!.pos, centroid);
    normal = add(normal, cross(p, q));
  }
  return normal;
}

function faceOf(g: WorldGraph, normal: Vec3, atom: number, ringAtom: number): 1 | -1 | 0 {
  const d = dot(sub(g.atoms[atom]!.pos, g.atoms[ringAtom]!.pos), normal);
  return Math.abs(d) <= EPS ? 0 : d > 0 ? 1 : -1;
}

/** Face (+1 / -1 / 0 in-plane) of a non-ring atom bonded to a member of `ring`
 *  (cycle in traversal order) relative to the ring's Newell normal. */
export function ringFace(g: WorldGraph, ring: readonly number[], atom: number): 1 | -1 | 0 {
  const r = ring.find((m) => heavyNeighbours(g, m).includes(atom));
  if (r === undefined) throw new Error(`atom ${atom} is not bonded to the ring`);
  return faceOf(g, newellNormal(g, ring), atom, r);
}

// ---------------------------------------------------------------------------
// Parity primitives (§6.1)
// ---------------------------------------------------------------------------

/** Sign of the permutation taking `from` to `to` (same four distinct entries). */
export function permSign(from: readonly (number | 'H')[], to: readonly (number | 'H')[]): 1 | -1 {
  const idx = to.map((x) => from.indexOf(x));
  let s: 1 | -1 = 1;
  for (let i = 0; i < idx.length; i++) {
    for (let j = i + 1; j < idx.length; j++) if (idx[i]! > idx[j]!) s = s === 1 ? -1 : 1;
  }
  return s;
}

function sameEntrySet(a: readonly (number | 'H')[], b: readonly (number | 'H')[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));
}

/**
 * Parity of `atom` with its four substituents taken in `order` (§6.1):
 * sign of the signed volume from positions (0 when planar, implicit H placed
 * at -(sum of the other three)), or `tet.sign * permSign(tet.order, order)`
 * from a tag; `null` when neither is available or `order` is not the atom's
 * substituent set.
 */
export function parityInOrder(g: MoleculeGraph, hydrogens: readonly number[], atom: number, order: readonly (number | 'H')[]): 1 | -1 | 0 | null {
  if (atom < 0 || atom >= g.atoms.length || order.length !== 4) return null;
  const a = g.atoms[atom]!;
  if (hasPositions(g)) {
    const w = g.atoms[atom]!;
    const c = w.pos;
    const nbs = heavyNeighbours(g, atom);
    const v: (Vec3 | null)[] = [];
    let nulls = 0;
    for (const o of order) {
      if (o === 'H') {
        if ((hydrogens[atom] ?? 0) < 1) return null;
        if (w.hPos.length === 1) v.push(sub(w.hPos[0]!, c));
        else { v.push(null); nulls++; }
      } else {
        if (!nbs.includes(o)) return null;
        v.push(sub(g.atoms[o]!.pos, c));
      }
    }
    if (nulls > 1) return null;
    if (nulls === 1) {
      const others = v.filter((x): x is Vec3 => x !== null);
      const virtual = neg(add(add(others[0]!, others[1]!), others[2]!));
      for (let i = 0; i < 4; i++) if (v[i] === null) v[i] = virtual;
    }
    const V = signedVolume(v[0]!, v[1]!, v[2]!, v[3]!);
    return Math.abs(V) <= EPS ? 0 : V > 0 ? 1 : -1;
  }
  if (a.tet) {
    if (!sameEntrySet(a.tet.order, order)) return null;
    return (a.tet.sign * permSign(a.tet.order, order)) as 1 | -1;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parity comparison under an isomorphism (§6.2)
// ---------------------------------------------------------------------------

export interface StereoCompareResult {
  readonly verdict: 'SAME' | 'ENANTIOMER' | 'DIASTEREOMER' | 'UNSPECIFIED' | 'INVALID_GEOMETRY';
  /** Target atom ids whose configuration disagrees. */
  readonly differingCenters: readonly number[];
  /** Target bond indices whose cis/trans relation disagrees. */
  readonly differingBonds: readonly number[];
  /** Student atom / bond that is undefined or has an invalid geometry. */
  readonly offending?: { readonly atom?: number; readonly bond?: number };
}

function mapRef(ref: number | 'H', mapping: readonly number[]): number | 'H' {
  return ref === 'H' ? 'H' : mapping[ref]!;
}

type CisResult = { readonly kind: 'cis'; readonly cis: boolean } | { readonly kind: 'geometry' } | { readonly kind: 'unspecified' };

function studentBondIndex(student: MoleculeGraph, sa: number, sb: number): number | undefined {
  const lo = Math.min(sa, sb);
  const hi = Math.max(sa, sb);
  for (const k of student.adj[lo]!) {
    const bond = student.bonds[k]!;
    if (bond.a === lo && bond.b === hi) return k;
  }
  return undefined;
}

/** cis relation of a target `ez` bond mapped onto the student (§6.1 `cisInMapping`). */
function cisInMapping(student: MoleculeGraph, hydS: readonly number[], ez: EzTag, a: number, b: number, mapping: readonly number[], sBond: number): CisResult {
  const sa = mapping[a]!;
  const sb = mapping[b]!;
  const refA = mapRef(ez.refA, mapping);
  const refB = mapRef(ez.refB, mapping);
  if (hasPositions(student)) {
    const sides = alkeneSides(student, hydS, sBond);
    if (!sides.ok) return { kind: 'geometry' };
    const endA = sides.ends[0].atom === sa ? sides.ends[0] : sides.ends[1];
    const endB = sides.ends[0].atom === sb ? sides.ends[0] : sides.ends[1];
    const va = endA.vec(refA);
    const vb = endB.vec(refB);
    if (va === undefined || vb === undefined) return { kind: 'unspecified' };
    return { kind: 'cis', cis: dot(va, vb) > 0 };
  }
  const sez = student.bonds[sBond]!.ez;
  if (sez) {
    const sBondRec = student.bonds[sBond]!;
    const refOnA = sBondRec.a === sa ? sez.refA : sez.refB;
    const refOnB = sBondRec.a === sb ? sez.refA : sez.refB;
    const cis = sez.cis !== (refA !== refOnA) !== (refB !== refOnB);
    return { kind: 'cis', cis };
  }
  return { kind: 'unspecified' };
}

/**
 * Compares every `tet` / `ez` tag of `target` with the student's parity under
 * one isomorphism `mapping[targetId] = studentId`. Untagged target atoms and
 * bonds are wildcards; a target without tags is SAME for every mapping.
 */
export function compareStereo(target: MoleculeGraph, student: MoleculeGraph, mapping: readonly number[]): StereoCompareResult {
  const hydS = implicitHydrogens(student).hydrogens;
  const tetra: boolean[] = [];
  const dbl: boolean[] = [];
  const differingCenters: number[] = [];
  const differingBonds: number[] = [];
  for (const t of target.atoms) {
    if (!t.tet) continue;
    const s = mapping[t.id];
    if (s === undefined) return { verdict: 'UNSPECIFIED', differingCenters, differingBonds, offending: {} };
    const order = t.tet.order.map((o) => mapRef(o, mapping));
    const p = parityInOrder(student, hydS, s, order);
    if (p === null || p === 0) return { verdict: 'UNSPECIFIED', differingCenters, differingBonds, offending: { atom: s } };
    const ok = p === t.tet.sign;
    tetra.push(ok);
    if (!ok) differingCenters.push(t.id);
  }
  for (let i = 0; i < target.bonds.length; i++) {
    const bond = target.bonds[i]!;
    if (!bond.ez) continue;
    const sa = mapping[bond.a];
    const sb = mapping[bond.b];
    const sBond = sa === undefined || sb === undefined ? undefined : studentBondIndex(student, sa, sb);
    if (sBond === undefined) return { verdict: 'UNSPECIFIED', differingCenters, differingBonds, offending: {} };
    const r = cisInMapping(student, hydS, bond.ez, bond.a, bond.b, mapping, sBond);
    if (r.kind === 'geometry') return { verdict: 'INVALID_GEOMETRY', differingCenters, differingBonds, offending: { bond: sBond } };
    if (r.kind === 'unspecified') return { verdict: 'UNSPECIFIED', differingCenters, differingBonds, offending: { bond: sBond } };
    const ok = r.cis === bond.ez.cis;
    dbl.push(ok);
    if (!ok) differingBonds.push(i);
  }
  let verdict: StereoCompareResult['verdict'];
  if (tetra.every((x) => x) && dbl.every((x) => x)) verdict = 'SAME';
  else if (tetra.length > 0 && tetra.every((x) => !x) && dbl.every((x) => x)) verdict = 'ENANTIOMER';
  else verdict = 'DIASTEREOMER';
  return { verdict, differingCenters, differingBonds };
}

// ---------------------------------------------------------------------------
// Tags from positions, labels from tags (§5, §7 step 4)
// ---------------------------------------------------------------------------

/**
 * Copy of `g` carrying `tet` on every non-planar tetrahedral carbon (ties
 * included: parity, not CIP, is what grading compares) and `ez` on every
 * non-ring, non-aromatic C=C with a valid geometry and at least one explicit
 * substituent on each end. Positions are kept.
 */
export function tagsFromPositions(g: WorldGraph, hydrogens: readonly number[]): WorldGraph {
  const atoms: WorldAtom[] = g.atoms.map((a) => {
    if (!isCentreCandidate(g, hydrogens, a.id)) return a;
    const order: (number | 'H')[] = [...heavyNeighbours(g, a.id)].sort((x, y) => x - y);
    if ((hydrogens[a.id] ?? 0) === 1) order.push('H');
    const p = parityInOrder(g, hydrogens, a.id, order);
    if (p === null || p === 0) return a;
    const tet: TetTag = { order, sign: p };
    return { ...a, tet };
  });
  const bonds: BondInput[] = g.bonds.map((bond, k) => {
    if (!isPlainAlkene(g, k) || ringExempt(g, bond.a, bond.b)) return bond;
    const sides = alkeneSides(g, hydrogens, k);
    if (!sides.ok) return bond;
    const [endA, endB] = sides.ends;
    if (endA.subs.length === 0 || endB.subs.length === 0) return bond;
    const pick = (end: AlkeneEnd): number | 'H' => {
      const heavy = end.subs.filter((s): s is number => s !== 'H');
      return heavy.length > 0 ? Math.min(...heavy) : 'H';
    };
    const refA = pick(endA);
    const refB = pick(endB);
    const va = endA.vec(refA)!;
    const vb = endB.vec(refB)!;
    const ez: EzTag = { refA, refB, cis: dot(va, vb) > 0 };
    return { ...bond, ez };
  });
  return buildGraph(atoms, bonds);
}

/** R/S and E/Z labels of a tagged target graph (no positions) from its tags (§5). */
export function labelTargetStereo(g: MoleculeGraph, hydrogens: readonly number[]): { centers: Map<number, CenterLabel>; bonds: Map<number, 'E' | 'Z' | 'NO_EZ'> } {
  const centers = new Map<number, CenterLabel>();
  const bonds = new Map<number, 'E' | 'Z' | 'NO_EZ'>();
  for (const a of g.atoms) {
    if (!a.tet) continue;
    const rank = cipRank(g, hydrogens, a.id);
    if (rank.capHit) { centers.set(a.id, 'CANNOT_ASSIGN'); continue; }
    if (rank.tie) { centers.set(a.id, rank.tieNeedsAdvancedRules ? 'CANNOT_ASSIGN' : 'NOT_CENTER'); continue; }
    if (!sameEntrySet(a.tet.order, rank.ligands)) { centers.set(a.id, 'NOT_CENTER'); continue; }
    const s = permSign(a.tet.order, rank.ligands);
    const Vp = a.tet.sign * s;
    centers.set(a.id, Vp > 0 ? 'R' : 'S');
  }
  g.bonds.forEach((bond, k) => {
    if (!bond.ez) return;
    const ra = cipRank(g, hydrogens, bond.a, bond.b);
    const rb = cipRank(g, hydrogens, bond.b, bond.a);
    if (ra.tie || rb.tie || ra.ligands.length !== 2 || rb.ligands.length !== 2) { bonds.set(k, 'NO_EZ'); return; }
    const cisHigh = bond.ez.cis !== (ra.ligands[0] !== bond.ez.refA) !== (rb.ligands[0] !== bond.ez.refB);
    bonds.set(k, cisHigh ? 'Z' : 'E');
  });
  return { centers, bonds };
}

// ---------------------------------------------------------------------------
// analyzeStereo (§7)
// ---------------------------------------------------------------------------

function hasAnyTag(g: MoleculeGraph): boolean {
  return g.atoms.some((a) => a.tet !== undefined) || g.bonds.some((b) => b.ez !== undefined);
}

/** Full stereo record of a world graph: centres, double bonds, ring faces, chiral/meso. */
export function analyzeStereo(g: WorldGraph, hydrogens: readonly number[]): StereoAnalysis {
  const centers: StereoCenter[] = [];
  for (let i = 0; i < g.atoms.length; i++) if (isCentreCandidate(g, hydrogens, i)) centers.push(assignRS(g, hydrogens, i));
  const doubleBonds: DoubleBondStereo[] = [];
  for (let k = 0; k < g.bonds.length; k++) if (isPlainAlkene(g, k)) doubleBonds.push(assignEZ(g, hydrogens, k));
  const ringFaces: RingFace[] = [];
  for (const ring of smallestRings(g, 8)) {
    const raw = newellNormal(g, ring);
    const len = length(raw);
    const normal: Vec3 = len > EPS ? scale(raw, 1 / len) : raw;
    const inRing = new Set(ring);
    const subs: { atom: number; ringAtom: number; face: 1 | -1 | 0 }[] = [];
    for (const r of ring) {
      for (const s of heavyNeighbours(g, r)) {
        if (inRing.has(s)) continue;
        subs.push({ atom: s, ringAtom: r, face: faceOf(g, raw, s, r) });
      }
    }
    ringFaces.push({ ring: [...ring], normal, subs });
  }
  const hasRS = centers.some((c) => c.label === 'R' || c.label === 'S');
  const anyFlat = centers.some((c) => c.label === 'UNSPECIFIED');
  let mirrorSame = false;
  if (hasRS && !anyFlat) {
    const tagged = tagsFromPositions(g, hydrogens);
    const mirrorAtoms: WorldAtom[] = tagged.atoms.map((a) => (a.tet ? { ...a, tet: { order: a.tet.order, sign: a.tet.sign === 1 ? -1 : 1 } } : a));
    const mirror = buildGraph(mirrorAtoms, tagged.bonds);
    if (hasAnyTag(mirror)) {
      const search = findIsomorphismsDetailed(mirror, g, DEFAULT_MAX_STATES);
      mirrorSame = !search.capped && search.mappings.some((m) => compareStereo(mirror, g, m).verdict === 'SAME');
    }
  }
  const meso = hasRS && !anyFlat && mirrorSame;
  const chiral = hasRS && !meso;
  return { centers, doubleBonds, ringFaces, chiral, meso };
}

/** `planar-center` per UNSPECIFIED centre and `alkene-geometry` per bad C=C (called by `analyze`). */
export function stereoWarnings(s: StereoAnalysis): Warning[] {
  const out: Warning[] = [];
  for (const c of s.centers) {
    if (c.label !== 'UNSPECIFIED') continue;
    out.push({ kind: 'planar-center', atom: c.atom, shape: c.shape === 'square-planar' ? 'square-planar' : 'T' });
  }
  for (const d of s.doubleBonds) {
    if (d.label === 'COLLINEAR' || d.label === 'NOT_PLANAR' || d.label === 'TWISTED') {
      out.push({ kind: 'alkene-geometry', bond: d.bond, label: d.label });
    }
  }
  return out;
}

const _check: Pick<ChemApi, 'assignRS' | 'assignEZ' | 'analyzeStereo'> = { assignRS, assignEZ, analyzeStereo };
void _check;
