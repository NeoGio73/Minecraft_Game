/**
 * OpenSMILES-subset parser (docs/design/02-chemistry-core.md section 5).
 * PURE MODULE.
 *
 * Grammar: organic subset C N O S P F Cl Br I, aromatic c n o s, bracket
 * atoms with isotope (ignored), @/@@, H count, charge of magnitude 1 and
 * class (ignored); bonds - = # : / \ ; ring closures 0-9 and %nn; branches;
 * '.' for components. Lowercase aromatic input is Kekulized by perfect
 * matching. `@`/`@@` become `tet` tags, `/` `\` around a double bond become
 * `ez` tags (RDKit-verified neighbour order and side table).
 * The parser never checks valence and never sets positions.
 */
import { SmilesError, TARGET_VALENCE } from './types';
import type { Atom, BondOrder, Charge, ChemApi, Element, EzTag, ParsedSmiles, TetTag } from './types';
import { buildGraph } from './graph';
import type { BondInput } from './graph';
import { kekulize } from './kekulize';

export { SmilesError } from './types';

type PendingOrder = BondOrder | 'ar' | null;
type Dir = '/' | '\\';
type OrderEntry = number | 'H' | { readonly ring: number };

interface RingOpen { readonly atom: number; readonly order: PendingOrder; readonly index: number }
interface ChiralRec { readonly sign: 1 | -1; readonly order: OrderEntry[]; readonly index: number }
interface DirEntry { readonly a: number; readonly b: number; readonly ch: Dir; readonly index: number }

const ORGANIC_ONE: Readonly<Record<string, Element>> = { C: 'C', N: 'N', O: 'O', S: 'S', P: 'P', F: 'F', I: 'I' };
const AROMATIC_ONE: Readonly<Record<string, Element>> = { c: 'C', n: 'N', o: 'O', s: 'S' };

function isDigit(ch: string | undefined): ch is string {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

interface BracketAtom {
  readonly el: Element;
  readonly aromatic: boolean;
  readonly h: number;
  readonly charge: Charge;
  readonly chiral: 1 | -1 | null;
}

/** Parses the text between '[' and ']'; `base` is the offset of '['. */
function parseBracket(tok: string, base: number, smiles: string): BracketAtom {
  const err = (msg: string, off: number) => new SmilesError(msg, smiles, base + 1 + off);
  let p = 0;
  while (isDigit(tok[p])) p++; // isotope, ignored
  const symStart = p;
  let el: Element | undefined;
  let aromatic = false;
  const two = tok.slice(p, p + 2);
  if (two === 'Cl' || two === 'Br') {
    el = two;
    p += 2;
  } else {
    const one = tok[p];
    if (one === 'H') throw err('explicit hydrogen atoms are not supported; use a bracket H count such as [CH3]', symStart);
    if (one !== undefined && ORGANIC_ONE[one] !== undefined) {
      el = ORGANIC_ONE[one];
      p += 1;
    } else if (one !== undefined && AROMATIC_ONE[one] !== undefined) {
      el = AROMATIC_ONE[one];
      aromatic = true;
      p += 1;
    } else {
      const m = /^[A-Za-z]+/.exec(tok.slice(p));
      const sym = m ? m[0] : (one ?? '');
      throw err(`unknown element '${sym}'`, symStart);
    }
  }
  let chiral: 1 | -1 | null = null;
  if (tok[p] === '@') {
    if (tok[p + 1] === '@') {
      chiral = 1;
      p += 2;
    } else {
      chiral = -1;
      p += 1;
    }
    const next = tok[p];
    if (next !== undefined && ((next >= 'A' && next <= 'Z' && next !== 'H') || next === '@')) {
      throw err('unsupported chirality token; use @ or @@', p);
    }
  }
  let h = 0;
  if (tok[p] === 'H') {
    p += 1;
    if (isDigit(tok[p])) {
      h = Number(tok[p]);
      p += 1;
    } else {
      h = 1;
    }
  }
  let charge: Charge = 0;
  if (tok[p] === '+' || tok[p] === '-') {
    const sign = tok[p] === '+' ? 1 : -1;
    const chargeStart = p;
    p += 1;
    let magnitude: number;
    if (isDigit(tok[p])) {
      magnitude = Number(tok[p]);
      p += 1;
    } else {
      magnitude = 1;
      while (tok[p] === (sign === 1 ? '+' : '-')) {
        magnitude += 1;
        p += 1;
      }
    }
    if (magnitude !== 1) throw err('charge magnitude greater than 1 is not supported', chargeStart);
    charge = sign === 1 ? 1 : -1;
  }
  if (tok[p] === ':') {
    p += 1;
    if (!isDigit(tok[p])) throw err('unexpected text in bracket atom', p);
    while (isDigit(tok[p])) p++;
  }
  if (p !== tok.length) throw err('unexpected text in bracket atom', p);
  if (TARGET_VALENCE[el][charge] === undefined) throw err(`${el} cannot carry charge ${charge}`, symStart);
  return { el, aromatic, h, charge, chiral };
}

export function parseSmiles(smiles: string): ParsedSmiles {
  const n = smiles.length;
  const err = (msg: string, index: number) => new SmilesError(msg, smiles, index);
  if (n === 0) throw err('empty SMILES', 0);

  const atoms: Atom[] = [];
  const bonds: BondInput[] = [];
  const atomPos: number[] = [];
  const bondKeys = new Set<string>();
  let prev: number | null = null;
  let pending: PendingOrder = null;
  let pendingDir: Dir | null = null;
  const stack: (number | null)[] = [];
  const ring = new Map<number, RingOpen>();
  const chiral = new Map<number, ChiralRec>();
  const dirs: DirEntry[] = [];

  function addBond(a: number, b: number, order: PendingOrder, index: number): void {
    const key = `${Math.min(a, b)},${Math.max(a, b)}`;
    if (bondKeys.has(key)) throw err('duplicate bond', index);
    bondKeys.add(key);
    let resolved: PendingOrder = order;
    if (resolved === null) resolved = atoms[a]!.aromatic && atoms[b]!.aromatic ? 'ar' : 1;
    if (resolved === 'ar') bonds.push({ a, b, order: 1, aromatic: true });
    else bonds.push({ a, b, order: resolved, aromatic: false });
  }

  function newAtom(start: number, el: Element, aromatic: boolean, explicitH: number | null, charge: Charge, chiralSign: 1 | -1 | null, h: number): void {
    const id = atoms.length;
    atoms.push({ id, el, charge, explicitH, aromatic });
    atomPos[id] = start;
    if (chiralSign !== null) {
      if (h > 1) throw err('a chiral atom may carry at most one hydrogen', start);
      chiral.set(id, { sign: chiralSign, order: [], index: start });
    }
    if (prev !== null) {
      addBond(prev, id, pending, start);
      if (pendingDir !== null) dirs.push({ a: prev, b: id, ch: pendingDir, index: start });
      const cp = chiral.get(prev);
      if (cp) cp.order.push(id);
    }
    const ci = chiral.get(id);
    if (ci) {
      if (prev !== null) ci.order.push(prev);
      if (h === 1) ci.order.push('H');
    }
    prev = id;
    pending = null;
    pendingDir = null;
  }

  let i = 0;
  while (i < n) {
    const ch = smiles[i]!;
    if (ch === '(') {
      if (prev === null) throw err('branch has no preceding atom', i);
      stack.push(prev);
      i++;
      continue;
    }
    if (ch === ')') {
      if (stack.length === 0) throw err('unbalanced parenthesis', i);
      prev = stack.pop()!;
      pending = null;
      pendingDir = null;
      i++;
      continue;
    }
    if (ch === '-' || ch === '=' || ch === '#' || ch === ':') {
      if (pending !== null) throw err('two bond symbols in a row', i);
      pending = ch === '-' ? 1 : ch === '=' ? 2 : ch === '#' ? 3 : 'ar';
      i++;
      continue;
    }
    if (ch === '/' || ch === '\\') {
      if (pending !== null) throw err('two bond symbols in a row', i);
      pending = 1;
      pendingDir = ch;
      i++;
      continue;
    }
    if (ch === '.') {
      prev = null;
      pending = null;
      pendingDir = null;
      i++;
      continue;
    }
    if (ch === '%' || isDigit(ch)) {
      if (prev === null) throw err('ring-closure digit has no preceding atom', i);
      let num: number;
      let next: number;
      if (ch === '%') {
        const d1 = smiles[i + 1];
        const d2 = smiles[i + 2];
        if (!isDigit(d1) || !isDigit(d2)) throw err("'%' must be followed by two digits", i);
        num = Number(d1 + d2);
        next = i + 3;
      } else {
        num = Number(ch);
        next = i + 1;
      }
      if (pendingDir !== null) throw err('directional bond on a ring closure is not supported', i);
      const open = ring.get(num);
      if (open) {
        const a = open.atom;
        if (a === prev) throw err('ring closure to the same atom', i);
        if (open.order !== null && pending !== null && open.order !== pending) throw err('ring-closure bond orders disagree', i);
        const order: PendingOrder = pending ?? open.order ?? null;
        addBond(a, prev, order, i);
        const ca = chiral.get(a);
        if (ca) {
          const slot = ca.order.findIndex((o) => typeof o === 'object' && o.ring === num);
          if (slot >= 0) ca.order[slot] = prev;
        }
        const cp = chiral.get(prev);
        if (cp) cp.order.push(a);
        ring.delete(num);
      } else {
        ring.set(num, { atom: prev, order: pending, index: i });
        const cp = chiral.get(prev);
        if (cp) cp.order.push({ ring: num });
      }
      pending = null;
      i = next;
      continue;
    }
    if (ch === '[') {
      const j = smiles.indexOf(']', i);
      if (j === -1) throw err('unterminated bracket atom', i);
      const br = parseBracket(smiles.slice(i + 1, j), i, smiles);
      newAtom(i, br.el, br.aromatic, br.h, br.charge, br.chiral, br.h);
      i = j + 1;
      continue;
    }
    const two = smiles.slice(i, i + 2);
    if (two === 'Cl' || two === 'Br') {
      newAtom(i, two, false, null, 0, null, 0);
      i += 2;
      continue;
    }
    if (ORGANIC_ONE[ch] !== undefined) {
      newAtom(i, ORGANIC_ONE[ch]!, false, null, 0, null, 0);
      i += 1;
      continue;
    }
    if (AROMATIC_ONE[ch] !== undefined) {
      newAtom(i, AROMATIC_ONE[ch]!, true, null, 0, null, 0);
      i += 1;
      continue;
    }
    throw err(`unexpected character '${ch}'`, i);
  }

  if (stack.length > 0) throw err('unbalanced parenthesis', n);
  if (ring.size > 0) {
    let lowest = -1;
    for (const num of ring.keys()) if (lowest === -1 || num < lowest) lowest = num;
    throw err(`unclosed ring bond ${lowest}`, ring.get(lowest)!.index);
  }
  if (pending !== null) throw err('bond symbol at end of input', n);

  // ---- post-processing -----------------------------------------------------
  let g = buildGraph(atoms, bonds);
  if (atoms.some((a) => a.aromatic)) {
    try {
      g = kekulize(g);
    } catch (e) {
      if (e instanceof SmilesError) throw err(e.message, atomPos[e.index] ?? 0);
      throw e;
    }
  }

  // tetrahedral tags
  const tetra: { atom: number; order: (number | 'H')[]; sign: 1 | -1 }[] = [];
  const tetByAtom = new Map<number, TetTag>();
  for (const [id, rec] of [...chiral.entries()].sort((x, y) => x[0] - y[0])) {
    const order: (number | 'H')[] = [];
    for (const o of rec.order) {
      if (typeof o === 'object') throw err(`unclosed ring bond ${o.ring}`, rec.index);
      order.push(o);
    }
    if (order.length !== 4) throw err('chiral atom must have exactly four neighbours (including H)', rec.index);
    tetByAtom.set(id, { order, sign: rec.sign });
    tetra.push({ atom: id, order, sign: rec.sign });
  }

  // double-bond tags
  type Side = 'UP' | 'DOWN';
  const dbl: { bond: number; refA: number | 'H'; refB: number | 'H'; cis: boolean }[] = [];
  const ezByBond = new Map<number, EzTag>();
  const isAlkeneAtom = (id: number): boolean => {
    const a = g.atoms[id]!;
    return (a.el === 'C' || a.el === 'N') && !a.aromatic;
  };
  const entriesOn = (c: number, partner: number): { sub: number; side: Side; index: number }[] => {
    const out: { sub: number; side: Side; index: number }[] = [];
    for (const d of dirs) {
      if (d.a !== c && d.b !== c) continue;
      const sub = d.a === c ? d.b : d.a;
      if (sub === partner) continue;
      let side: Side;
      if (d.b === c) side = d.ch === '/' ? 'DOWN' : 'UP'; // substituent written before c
      else side = d.ch === '/' ? 'UP' : 'DOWN'; // substituent written after c
      out.push({ sub, side, index: d.index });
    }
    out.sort((x, y) => x.index - y.index);
    for (let p = 0; p < out.length; p++) {
      for (let q = p + 1; q < out.length; q++) {
        if (out[p]!.side === out[q]!.side) throw err('conflicting double-bond directions', atomPos[c] ?? 0);
      }
    }
    return out;
  };
  g.bonds.forEach((bond, k) => {
    if (bond.order !== 2 || bond.aromatic) return;
    if (!isAlkeneAtom(bond.a) || !isAlkeneAtom(bond.b)) return;
    const ea = entriesOn(bond.a, bond.b);
    const eb = entriesOn(bond.b, bond.a);
    if (ea.length === 0 || eb.length === 0) return;
    const refA = ea[0]!.sub;
    const refB = eb[0]!.sub;
    const cis = ea[0]!.side === eb[0]!.side;
    ezByBond.set(k, { refA, refB, cis });
    dbl.push({ bond: k, refA, refB, cis });
  });

  if (tetByAtom.size > 0 || ezByBond.size > 0) {
    const taggedAtoms: Atom[] = g.atoms.map((a) => {
      const tet = tetByAtom.get(a.id);
      return tet ? { ...a, tet } : a;
    });
    const taggedBonds: BondInput[] = g.bonds.map((b, k) => {
      const ez = ezByBond.get(k);
      return ez ? { ...b, ez } : b;
    });
    g = buildGraph(taggedAtoms, taggedBonds);
  }
  return { graph: g, tetra, dbl };
}

const _check: Pick<ChemApi, 'parseSmiles'> = { parseSmiles };
void _check;
