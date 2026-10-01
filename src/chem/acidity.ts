/**
 * pKa engine: hydrogen classes, basic sites, most acidic / most basic site
 * and the McMurry 2.9 acid-base prediction. PURE MODULE.
 * See docs/design/03-stereo-acidity-hybridization.md section 10.
 *
 * Every constant lives in one table (`PKA`, `PKA_MOD`, `BASIC`) with a
 * citation and a `verified` flag (00-contracts R12). Unverified values are
 * general-textbook numbers McMurry does not tabulate: the panel shows them
 * with "≈" and the content validator never lets one decide a graded answer.
 */
import { PKA_TIE } from './types';
import type {
  AcidityAnalysis, AtomInfo, BasicSite, ChemApi, Element, HydrogenSite, MoleculeGraph, Vec3, Warning,
} from './types';
import { otherEnd } from './graph';
import { atomInfo } from './hybridization';
import { implicitHydrogens } from './hydrogens';
import { perceiveAromaticity } from './aromatic';

// ---------------------------------------------------------------------------
// Sources and tables
// ---------------------------------------------------------------------------

export const PKA_SOURCES = {
  T2_3: 'MM 2.8 T2.3 (m00025)', S2_10: 'MM 2.10 (m00027)', APP_B: 'MM App B (m00030)',
  T9_1: 'MM 9.7 T9.1 (m00109)', T17_1: 'MM 17.2 T17.1 (m00201)', S18_8: 'MM 18.8 (m00254)',
  T20_3: 'MM 20.2 T20.3 (m00231)', T22_1: 'MM 22.5 T22.1 (m00261)',
  T24_1: 'MM 24.3 T24.1 (m00291)', T24_2: 'MM 24.4 T24.2 (m00292)',
  CHEM2E_H: 'Chem 2e App H (m68866)',
  GENERAL: 'general textbook value, not tabulated by McMurry (unverified)',
} as const;

export interface PkaEntry {
  readonly id: string;
  readonly pKa: number;
  readonly label: string;
  readonly source: string;
  readonly verified: boolean;
}

const S = PKA_SOURCES;

type Row = readonly [id: string, pKa: number, label: string, source: string, verified: boolean];

function table(rows: readonly Row[]): Readonly<Record<string, PkaEntry>> {
  const out: Record<string, PkaEntry> = {};
  for (const [id, pKa, label, source, verified] of rows) {
    if (out[id] !== undefined) throw new Error(`duplicate pKa id ${id}`);
    out[id] = { id, pKa, label, source, verified };
  }
  return out;
}

/** Hydrogen classes (design 10.2). `verified: false` => shown as "≈", never a graded answer. */
export const PKA: Readonly<Record<string, PkaEntry>> = table([
  ['HX.F', 3.2, 'H–F', S.CHEM2E_H, true],
  ['HX.Cl', -7.0, 'H–Cl', S.T2_3, true],
  ['HX.Br', -9, 'H–Br', S.GENERAL, false],
  ['HX.I', -10, 'H–I', S.GENERAL, false],
  ['OH.carboxylic', 4.8, 'O–H of a carboxylic acid', `${S.APP_B} (T2.3: 4.76)`, true],
  ['OH.peracid', 8.2, 'O–H of a peracid', S.APP_B, true],
  ['OH.enol', 10.0, 'O–H of an enol or phenol', `${S.APP_B} (phenol 9.9); ${S.T17_1} (9.89)`, true],
  ['OH.water', 15.74, 'O–H of water', S.T2_3, true],
  ['OH.gemdiol', 13.3, 'O–H of a gem-diol', S.APP_B, true],
  ['OH.alcohol.methanol', 15.5, 'O–H of methanol', `${S.APP_B} (T17.1: 15.54)`, true],
  ['OH.alcohol.primary', 16.0, 'O–H of a primary alcohol', `${S.APP_B}; ${S.T17_1}`, true],
  ['OH.alcohol.secondary', 17.1, 'O–H of a secondary alcohol', S.APP_B, true],
  ['OH.alcohol.tertiary', 18.0, 'O–H of a tertiary alcohol', `${S.APP_B}; ${S.T17_1}`, true],
  ['OH.oxime', 12.4, 'O–H of an oxime', S.APP_B, true],
  ['OH.hydroperoxide', 11.6, 'O–H of a hydroperoxide', S.GENERAL, false],
  ['OH.oxonium.hydronium', -1.7, 'O–H of H3O⁺', `${S.GENERAL} (consistent with MM 2.8 water 55.4 M)`, false],
  ['OH.oxonium.alcohol', -2.4, 'O–H of a protonated alcohol', S.GENERAL, false],
  ['OH.oxonium.ether', -3.5, 'O–H of a protonated ether', S.GENERAL, false],
  ['OH.oxonium.carbonyl', -7, 'O–H of a protonated aldehyde or ketone', S.GENERAL, false],
  ['OH.oxonium.carboxylic', -6, 'O–H of a protonated carboxylic acid', S.GENERAL, false],
  ['OH.oxonium.amide', -1, 'O–H of a protonated amide', S.GENERAL, false],
  ['NH.ammonium.nh4', 9.26, 'N–H of NH4⁺', S.T24_1, true],
  ['NH.ammonium.primary', 10.6, 'N–H of a primary ammonium ion', `${S.T24_1} (10.64/10.75)`, true],
  ['NH.ammonium.secondary', 11.0, 'N–H of a secondary ammonium ion', `${S.T24_1} (10.98)`, true],
  ['NH.ammonium.tertiary', 10.8, 'N–H of a tertiary ammonium ion', `${S.T24_1} (10.76)`, true],
  ['NH.anilinium', 4.6, 'N–H of an anilinium-type ion (N⁺ on an sp2 carbon)', `${S.T24_1} (4.63)`, true],
  ['NH.amide', 17, 'N–H of an amide', S.GENERAL, false],
  ['NH.imide', 9, 'N–H of an imide', S.GENERAL, false],
  ['NH.sulfonamide', 10, 'N–H of a sulfonamide', S.GENERAL, false],
  ['NH.aniline', 30, 'N–H of an aniline or enamine', S.GENERAL, false],
  ['NH.amine.nh3', 36, 'N–H of ammonia', `${S.APP_B} (MM 9.7 rounds it to 35)`, true],
  ['NH.amine.primary', 36, 'N–H of a primary amine', S.APP_B, true],
  ['NH.amine.secondary', 40, 'N–H of a secondary amine', S.APP_B, true],
  ['NH.amide-ion', 99, 'N–H of an amide ion (not acidic)', S.GENERAL, false],
  ['SH.thiol', 10.3, 'S–H of a thiol', `${S.APP_B}; ${S.T17_1}; ${S.S18_8}`, true],
  ['SH.thiol.benzylic', 9.4, 'S–H of an allylic/benzylic thiol', `${S.APP_B} (benzyl mercaptan)`, true],
  ['SH.thiophenol', 6.6, 'S–H of a thiophenol or enethiol', S.APP_B, true],
  ['SH.h2s', 7.0, 'S–H of H2S', S.GENERAL, false],
  ['SH.sulfonium', -7, 'S–H of a protonated thiol or sulfide', S.GENERAL, false],
  ['CH.hcn', 9.31, 'C–H of HCN', S.T2_3, true],
  ['CH.alkyne', 25, 'C–H of a terminal alkyne', `${S.T9_1}; ${S.APP_B}`, true],
  ['CH.alpha.aldehyde', 17, 'C–H alpha to an aldehyde', S.T22_1, true],
  ['CH.alpha.ketone', 19, 'C–H alpha to a ketone', `${S.T22_1} (acetone 19.3)`, true],
  ['CH.alpha.acid-chloride', 16, 'C–H alpha to an acid chloride', S.T22_1, true],
  ['CH.alpha.thioester', 21, 'C–H alpha to a thioester', S.T22_1, true],
  ['CH.alpha.ester', 25, 'C–H alpha to an ester', S.T22_1, true],
  ['CH.alpha.nitrile', 25, 'C–H alpha to a nitrile', S.T22_1, true],
  ['CH.alpha.amide', 30, 'C–H alpha to an amide', S.T22_1, true],
  ['CH.alpha.carboxylic', 25, 'C–H alpha to a carboxylic acid or carboxylate', `${S.GENERAL} (treated like an ester)`, false],
  ['CH.alpha.nitro.0', 10.3, 'C–H of a nitromethyl group', S.APP_B, true],
  ['CH.alpha.nitro.1', 8.5, 'C–H of a primary nitroalkane CH2', S.APP_B, true],
  ['CH.alpha.nitro.2', 7.7, 'C–H of a secondary nitroalkane CH', S.APP_B, true],
  ['CH.alpha.sulfoxide', 35, 'C–H alpha to a sulfoxide', S.APP_B, true],
  ['CH.alpha.sulfone', 28, 'C–H alpha to a sulfone', `${S.APP_B} (unbuildable in v1)`, true],
  ['CH.alpha.ketone+ketone', 9, 'C–H between two ketones', `${S.T22_1}; ${S.APP_B}`, true],
  ['CH.alpha.ester+ketone', 11, 'C–H between a ketone and an ester', `${S.T22_1} (10.6)`, true],
  ['CH.alpha.ester+ester', 13, 'C–H between two esters', `${S.T22_1} (12.9)`, true],
  ['CH.alpha.nitrile+nitrile', 11.2, 'C–H between two nitriles', S.APP_B, true],
  ['CH.alpha.aldehyde+ketone', 5.8, 'C–H between an aldehyde and a ketone', S.APP_B, true],
  ['CH.alpha.ketone+nitro', 5.1, 'C–H between a ketone and a nitro group', S.APP_B, true],
  ['CH.alpha.ester+nitro', 5.8, 'C–H between an ester and a nitro group', S.APP_B, true],
  ['CH.alpha.ketone+sulfoxide', 10.0, 'C–H between a ketone and a sulfoxide', S.APP_B, true],
  ['CH.alpha.nitro+nitro+nitro', 0.1, 'C–H of trinitromethane', S.APP_B, true],
  ['CH.vinylic', 44, 'vinylic C–H', S.T9_1, true],
  ['CH.allylic.1', 41, 'allylic, propargylic or benzylic C–H', `${S.APP_B} (toluene)`, false],
  ['CH.allylic.2', 34, 'C–H flanked by two pi systems', `${S.APP_B} (Ph2CH2)`, false],
  ['CH.allylic.3', 32, 'C–H flanked by three pi systems', `${S.APP_B} (Ph3CH)`, false],
  ['CH.alkane', 60, 'alkane C–H', `${S.T9_1} (CH4 ≈ 60; older editions 50)`, true],
  ['CH.carbanion', 99, 'C–H on a carbanion (not acidic)', S.GENERAL, false],
  ['CH.carbocation', 99, 'C–H on a carbocation (not modeled)', S.GENERAL, false],
  ['XH.other', 99, 'hydrogen in an environment this course does not tabulate', S.GENERAL, false],
]);

/** Quiz-text constants that are never classified (unbuildable rings, hypervalent S). */
export const PKA_TEXT_ONLY: Readonly<Record<string, PkaEntry>> = table([
  ['TEXT.methanesulfonic', -1.8, 'CH3SO3H', S.APP_B, true],
  ['TEXT.pyridinium', 5.25, 'pyridinium ion', S.T24_1, true],
  ['TEXT.imidazolium', 6.95, 'imidazolium ion', S.T24_1, true],
  ['TEXT.pyrrolium', 0.4, 'pyrrolium ion', S.T24_1, true],
  ['TEXT.pyrimidinium', 1.3, 'pyrimidinium ion', S.T24_1, true],
  ['TEXT.phenol.p-NH2', 10.46, 'p-aminophenol', S.T17_1, true],
  ['TEXT.phenol.p-CH3', 10.17, 'p-methylphenol', S.T17_1, true],
  ['TEXT.phenol.p-Cl', 9.38, 'p-chlorophenol', S.T17_1, true],
  ['TEXT.phenol.p-CHO', 7.9, 'p-hydroxybenzaldehyde', S.T17_1, true],
  ['TEXT.phenol.p-NO2', 7.15, 'p-nitrophenol', S.T17_1, true],
  ['TEXT.anilinium.p-NH2', 6.15, 'p-aminoanilinium ion', S.T24_2, true],
  ['TEXT.anilinium.p-OCH3', 5.34, 'p-methoxyanilinium ion', S.T24_2, true],
  ['TEXT.anilinium.p-CH3', 5.08, 'p-methylanilinium ion', S.T24_2, true],
  ['TEXT.anilinium.p-Cl', 3.98, 'p-chloroanilinium ion', S.T24_2, true],
  ['TEXT.anilinium.p-Br', 3.86, 'p-bromoanilinium ion', S.T24_2, true],
  ['TEXT.anilinium.p-CN', 1.74, 'p-cyanoanilinium ion', S.T24_2, true],
  ['TEXT.anilinium.p-NO2', 1.00, 'p-nitroanilinium ion', S.T24_2, true],
  ['TEXT.cyclopentadiene', 15.0, 'cyclopentadiene', S.APP_B, true],
  ['TEXT.fluorene', 23, 'fluorene', S.APP_B, true],
  ['TEXT.nonafluoro-tert-butanol', 5.4, 'nonafluoro-tert-butyl alcohol', S.T17_1, true],
]);

export interface PkaModifier {
  readonly delta?: number;
  readonly override?: number;
  readonly verified: boolean;
  readonly source: string;
}

/** Modifiers added to a class base (design 10.3); every row is a fixed number. */
export const PKA_MOD: Readonly<Record<string, PkaModifier>> = {
  // carboxylic acids (base OH.carboxylic 4.8, clamped to [0.2, 5.2]) and peracids (formic)
  formic: { delta: -1.1, verified: true, source: S.APP_B },
  arylvinyl: { delta: -0.6, verified: true, source: `${S.APP_B}; ${S.T20_3}` },
  aF1: { delta: -2.1, verified: true, source: S.APP_B },
  aCl1: { delta: -2.0, verified: true, source: S.APP_B },
  aBr1: { delta: -1.9, verified: true, source: S.APP_B },
  aI1: { delta: -1.6, verified: true, source: S.APP_B },
  aCl2: { override: 1.3, verified: true, source: S.APP_B },
  aCl3: { override: 0.5, verified: true, source: S.APP_B },
  aF3: { override: 0.5, verified: true, source: `${S.APP_B} (T20.3: 0.23)` },
  aOH: { delta: -1.0, verified: true, source: `${S.T20_3} (glycolic 3.84)` },
  aOR: { delta: -1.2, verified: true, source: S.APP_B },
  aCN: { delta: -2.3, verified: true, source: S.APP_B },
  aNO2: { delta: -3.5, verified: true, source: S.APP_B },
  aCO: { delta: -2.4, verified: true, source: `${S.APP_B} (pyruvic)` },
  aCOOH: { delta: -2.0, verified: true, source: `${S.APP_B} (malonic)` },
  oxalic: { override: 1.2, verified: true, source: S.APP_B },
  bX: { delta: -0.8, verified: true, source: `${S.APP_B} (β-Br)` },
  tert: { delta: 0.2, verified: true, source: S.APP_B },
  // alcohols (base by degree, clamped to [5.0, 18.0])
  bF1: { delta: -1.2, verified: true, source: S.T17_1 },
  bF2: { delta: -2.4, verified: true, source: S.T17_1 },
  bF3: { delta: -3.6, verified: true, source: `${S.T17_1} (CF3CH2OH 12.43)` },
  bCl1: { delta: -1.7, verified: true, source: S.APP_B },
  bCl2: { delta: -3.1, verified: true, source: S.APP_B },
  bCl3: { delta: -3.8, verified: true, source: S.APP_B },
  bBr1: { delta: -1.7, verified: false, source: `${S.GENERAL} (as β-Cl)` },
  bBr2: { delta: -3.1, verified: false, source: `${S.GENERAL} (as β-Cl)` },
  bBr3: { delta: -3.8, verified: false, source: `${S.GENERAL} (as β-Cl)` },
  bI1: { delta: -1.7, verified: false, source: `${S.GENERAL} (as β-Cl)` },
  bI2: { delta: -3.1, verified: false, source: `${S.GENERAL} (as β-Cl)` },
  bI3: { delta: -3.8, verified: false, source: `${S.GENERAL} (as β-Cl)` },
  allylic: { delta: -0.5, verified: true, source: `${S.APP_B} (allyl 15.5, benzyl 15.4, propargyl 15.5)` },
};

const CARBOXYLIC_RANGE: readonly [number, number] = [0.2, 5.2];
const ALCOHOL_RANGE: readonly [number, number] = [5.0, 18.0];

/** Conjugate-acid pKa per basic-site class (design 10.7); `pKa` = pKaH,
 *  `label` = the description after "lone pair on". */
export const BASIC: Readonly<Record<string, PkaEntry>> = table([
  ['B.C.acetylide', 25, 'an acetylide carbanion', S.T9_1, true],
  ['B.C.vinyl', 44, 'a vinyl carbanion', S.T9_1, true],
  ['B.C.enolate', 19, 'the carbanion of an enolate', S.T22_1, true],
  ['B.C.alkyl', 60, 'an alkyl carbanion', S.T9_1, true],
  ['B.N.amide-ion.primary', 36, 'an amide ion (NH2⁻ or RNH⁻)', S.APP_B, true],
  ['B.N.amide-ion.secondary', 40, 'a dialkylamide ion (R2N⁻, e.g. LDA)', S.APP_B, true],
  ['B.N.amide', -1, 'an amide nitrogen', `${S.GENERAL} (MM 24.3: "nonbasic")`, false],
  ['B.N.nitrile', -10, 'a nitrile nitrogen', S.GENERAL, false],
  ['B.N.imine', 7, 'an imine nitrogen', S.GENERAL, false],
  ['B.N.conjugated', 4.6, 'an aniline- or enamine-type nitrogen', `${S.T24_1} (anilinium)`, true],
  ['B.N.amine.nh3', 9.26, 'ammonia', S.T24_1, true],
  ['B.N.amine.primary', 10.6, 'a primary amine nitrogen', S.T24_1, true],
  ['B.N.amine.secondary', 11.0, 'a secondary amine nitrogen', S.T24_1, true],
  ['B.N.amine.tertiary', 10.8, 'a tertiary amine nitrogen', S.T24_1, true],
  ['B.O.hydroxide', 15.74, 'hydroxide ion', S.T2_3, true],
  ['B.O.carboxylate', 4.8, 'a carboxylate oxygen', S.APP_B, true],
  ['B.O.phenoxide', 10, 'a phenoxide oxygen', `${S.APP_B} (phenol)`, true],
  ['B.O.enolate', 19, 'the oxygen of an enolate', `${S.T22_1} (same ion as the carbanion form)`, true],
  ['B.O.alkoxide.methoxide', 15.5, 'methoxide ion', `${S.APP_B}; ${S.T17_1}`, true],
  ['B.O.alkoxide.primary', 16.0, 'a primary alkoxide oxygen', `${S.APP_B}; ${S.T17_1}`, true],
  ['B.O.alkoxide.secondary', 17.1, 'a secondary alkoxide oxygen', S.APP_B, true],
  ['B.O.alkoxide.tertiary', 18.0, 'a tertiary alkoxide oxygen', `${S.APP_B}; ${S.T17_1}`, true],
  ['B.O.amide', -1, 'an amide carbonyl oxygen', S.GENERAL, false],
  ['B.O.ester', -6.5, 'an ester oxygen', S.GENERAL, false],
  ['B.O.acid', -6, 'a carboxylic acid oxygen', S.GENERAL, false],
  ['B.O.carbonyl', -7, 'an aldehyde or ketone oxygen', S.GENERAL, false],
  ['B.O.water', -1.7, 'water', S.GENERAL, false],
  ['B.O.alcohol', -2.4, 'an alcohol oxygen', S.GENERAL, false],
  ['B.O.ether', -3.5, 'an ether oxygen', S.GENERAL, false],
  ['B.S.thiolate', 10.3, 'a thiolate sulfur', S.APP_B, true],
  ['B.S.thiol', -7, 'a thiol or sulfide sulfur', S.GENERAL, false],
  ['B.X.halide.F', 3.2, 'fluoride ion', S.CHEM2E_H, true],
  ['B.X.halide.Cl', -7, 'chloride ion', S.T2_3, true],
  ['B.X.halide.Br', -9, 'bromide ion', S.GENERAL, false],
  ['B.X.halide.I', -10, 'iodide ion', S.GENERAL, false],
  ['B.X.bound', -10, 'a halogen bonded to carbon', S.GENERAL, false],
  ['B.other', -10, 'an atom this course does not treat as a base', S.GENERAL, false],
]);

// ---------------------------------------------------------------------------
// Site predicates (design 10.4)
// ---------------------------------------------------------------------------

type CarbonylKind = 'acid-chloride' | 'thioester' | 'amide' | 'ester' | 'carboxylic' | 'aldehyde' | 'ketone';
type ActivatingKind = CarbonylKind | 'nitrile' | 'nitro' | 'sulfoxide';

interface Ctx {
  readonly g: MoleculeGraph;
  readonly info: readonly AtomInfo[];
}

interface Link { readonly nb: number; readonly order: number }

function isHalogen(el: Element): boolean {
  return el === 'F' || el === 'Cl' || el === 'Br' || el === 'I';
}

function elOf(ctx: Ctx, i: number): Element {
  return ctx.g.atoms[i]!.el;
}

function chargeOf(ctx: Ctx, i: number): number {
  return ctx.g.atoms[i]!.charge;
}

function hOf(ctx: Ctx, i: number): number {
  return ctx.info[i]?.hydrogens ?? 0;
}

function links(ctx: Ctx, i: number): Link[] {
  return ctx.g.adj[i]!.map((k) => ({ nb: otherEnd(ctx.g, k, i), order: ctx.g.bonds[k]!.order }));
}

function neighbours(ctx: Ctx, i: number): number[] {
  return ctx.g.adj[i]!.map((k) => otherEnd(ctx.g, k, i));
}

function orderBetween(ctx: Ctx, a: number, b: number): number {
  for (const l of links(ctx, a)) if (l.nb === b) return l.order;
  return 0;
}

/** The =O atom of a carbonyl carbon (any charge on O), or -1. */
function carbonylOf(ctx: Ctx, c: number): number {
  if (elOf(ctx, c) !== 'C') return -1;
  for (const l of links(ctx, c)) if (l.order === 2 && elOf(ctx, l.nb) === 'O') return l.nb;
  return -1;
}

/** Design 10.4 carbonylKind: first match in the listed order over the
 *  neighbours of `c` other than its =O. */
function carbonylKind(ctx: Ctx, c: number): CarbonylKind {
  const o = carbonylOf(ctx, c);
  const others = links(ctx, c).filter((l) => l.nb !== o);
  if (others.some((l) => isHalogen(elOf(ctx, l.nb)))) return 'acid-chloride';
  if (others.some((l) => elOf(ctx, l.nb) === 'S')) return 'thioester';
  if (others.some((l) => elOf(ctx, l.nb) === 'N')) return 'amide';
  const singleO = others.filter((l) => l.order === 1 && elOf(ctx, l.nb) === 'O');
  if (singleO.some((l) => neighbours(ctx, l.nb).some((x) => x !== c))) return 'ester';
  if (singleO.some((l) => hOf(ctx, l.nb) >= 1 || chargeOf(ctx, l.nb) === -1)) return 'carboxylic';
  return hOf(ctx, c) >= 1 ? 'aldehyde' : 'ketone';
}

function nitrileC(ctx: Ctx, c: number): boolean {
  return elOf(ctx, c) === 'C' && links(ctx, c).some((l) => l.order === 3 && elOf(ctx, l.nb) === 'N');
}

function nitroN(ctx: Ctx, n: number): boolean {
  if (elOf(ctx, n) !== 'N' || chargeOf(ctx, n) !== 1) return false;
  const ls = links(ctx, n);
  return ls.some((l) => l.order === 2 && elOf(ctx, l.nb) === 'O')
    && ls.some((l) => l.order === 1 && elOf(ctx, l.nb) === 'O' && chargeOf(ctx, l.nb) === -1);
}

function sulfinylS(ctx: Ctx, s: number): boolean {
  return elOf(ctx, s) === 'S' && chargeOf(ctx, s) === 1
    && links(ctx, s).some((l) => l.order === 1 && elOf(ctx, l.nb) === 'O' && chargeOf(ctx, l.nb) === -1);
}

/** Carbon with a bond of order >= 2 to another carbon. */
function hasCCpi(ctx: Ctx, c: number): boolean {
  return elOf(ctx, c) === 'C' && links(ctx, c).some((l) => l.order >= 2 && elOf(ctx, l.nb) === 'C');
}

function hasTripleBond(ctx: Ctx, i: number): boolean {
  return links(ctx, i).some((l) => l.order === 3);
}

function activating(ctx: Ctx, n: number): ActivatingKind | null {
  if (carbonylOf(ctx, n) >= 0) return carbonylKind(ctx, n);
  if (nitrileC(ctx, n)) return 'nitrile';
  if (nitroN(ctx, n)) return 'nitro';
  if (sulfinylS(ctx, n)) return 'sulfoxide';
  return null;
}

function carbonDegree(ctx: Ctx, c: number): number {
  return neighbours(ctx, c).filter((x) => elOf(ctx, x) === 'C').length;
}

const DEGREE_NAME = ['methanol', 'primary', 'secondary', 'tertiary'] as const;

// ---------------------------------------------------------------------------
// Hydrogen environments
// ---------------------------------------------------------------------------

interface Env {
  readonly classId: string;
  readonly modifiers: readonly string[];
  readonly pKa: number;
  readonly label: string;
  readonly source: string;
  readonly verified: boolean;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function clamp(x: number, range: readonly [number, number]): number {
  return Math.min(range[1], Math.max(range[0], x));
}

function plain(entry: PkaEntry): Env {
  return { classId: entry.id, modifiers: [], pKa: entry.pKa, label: entry.label, source: entry.source, verified: entry.verified };
}

function pka(id: string): PkaEntry {
  const e = PKA[id];
  if (e === undefined) throw new Error(`unknown pKa class ${id}`);
  return e;
}

/** Modifier lookup with the computed fallbacks of design 10.3 for unlisted keys. */
function modifier(key: string): PkaModifier {
  const listed = PKA_MOD[key];
  if (listed !== undefined) return listed;
  const m = /^([ab])(F|Cl|Br|I)(\d+)$/.exec(key);
  if (m) {
    const pos = m[1]!;
    const hal = m[2]!;
    const n = Number(m[3]);
    if (pos === 'a') {
      // other multi-halogen count: sum of single deltas, unverified
      const single = PKA_MOD[`a${hal}1`]!.delta!;
      return { delta: round2(single * n), verified: false, source: `${S.GENERAL} (${n} × ${hal} single-substituent value)` };
    }
    if (hal === 'F') return { delta: round2(-1.2 * n), verified: false, source: `${S.GENERAL} (−1.2 per β-F)` };
    return { delta: PKA_MOD.bCl3!.delta!, verified: false, source: `${S.GENERAL} (as three β-Cl)` };
  }
  throw new Error(`unknown pKa modifier ${key}`);
}

/** Applies modifiers to a base entry (override wins; otherwise sum of deltas). */
function applyModifiers(base: PkaEntry, mods: readonly string[], range: readonly [number, number], extraUnverified: boolean): Env {
  const modifiers = [...new Set(mods)].sort();
  let verified = base.verified && !extraUnverified;
  const sources = [base.source];
  let override: number | undefined;
  let delta = 0;
  for (const key of modifiers) {
    const m = modifier(key);
    if (!m.verified) verified = false;
    if (!sources.includes(m.source)) sources.push(m.source);
    if (m.override !== undefined) override = m.override;
    else delta += m.delta ?? 0;
  }
  const value = override !== undefined ? override : clamp(round2(base.pKa + delta), range);
  return { classId: base.id, modifiers, pKa: round2(value), label: base.label, source: sources.join('; '), verified };
}

function halogenKeys(prefix: 'a' | 'b', atoms: readonly number[], ctx: Ctx): string[] {
  const counts = new Map<Element, number>();
  for (const x of atoms) {
    const e = elOf(ctx, x);
    if (isHalogen(e)) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  const keys: string[] = [];
  for (const e of ['F', 'Cl', 'Br', 'I'] as const) {
    const n = counts.get(e);
    if (n !== undefined && n > 0) keys.push(`${prefix}${e}${n}`);
  }
  return keys;
}

const NON_HALOGEN_CARBOXYLIC_MODS = new Set(['formic', 'arylvinyl', 'aOH', 'aOR', 'aCN', 'aNO2', 'aCO', 'aCOOH', 'bX', 'tert']);

/** O–H of a carboxylic acid (or peracid) with the substituent modifiers of design 10.3. */
function carboxylicEnv(ctx: Ctx, carboxylC: number, oh: number, base: PkaEntry): Env {
  const o = carbonylOf(ctx, carboxylC);
  const others = neighbours(ctx, carboxylC).filter((x) => x !== o && x !== oh);
  const mods: string[] = [];
  if (others.length === 0 && hOf(ctx, carboxylC) >= 1) mods.push('formic');
  const cAlpha = others.find((x) => elOf(ctx, x) === 'C');
  if (base.id === 'OH.peracid') {
    return applyModifiers(base, mods, [0.2, 12], false);
  }
  if (cAlpha !== undefined) {
    if (carbonylOf(ctx, cAlpha) >= 0 && carbonylKind(ctx, cAlpha) === 'carboxylic') {
      return applyModifiers(base, ['oxalic'], CARBOXYLIC_RANGE, false);
    }
    if (hasCCpi(ctx, cAlpha)) mods.push('arylvinyl');
    const subs = neighbours(ctx, cAlpha).filter((x) => x !== carboxylC);
    const halKeys = halogenKeys('a', subs, ctx);
    mods.push(...halKeys);
    for (const s of subs) {
      const e = elOf(ctx, s);
      if (e === 'O') {
        if (orderBetween(ctx, cAlpha, s) !== 1) continue;
        if (hOf(ctx, s) >= 1) mods.push('aOH');
        else if (neighbours(ctx, s).some((x) => x !== cAlpha && elOf(ctx, x) === 'C')) mods.push('aOR');
      } else if (e === 'C') {
        if (nitrileC(ctx, s)) mods.push('aCN');
        else if (carbonylOf(ctx, s) >= 0) {
          const kind = carbonylKind(ctx, s);
          if (kind === 'aldehyde' || kind === 'ketone') mods.push('aCO');
          else if (kind === 'carboxylic') mods.push('aCOOH');
        }
      } else if (e === 'N' && nitroN(ctx, s)) {
        mods.push('aNO2');
      }
    }
    if (carbonylOf(ctx, cAlpha) >= 0) {
      const kind = carbonylKind(ctx, cAlpha);
      if (kind === 'aldehyde' || kind === 'ketone') mods.push('aCO');
    }
    if (subs.some((s) => elOf(ctx, s) === 'C' && neighbours(ctx, s).some((t) => t !== cAlpha && isHalogen(elOf(ctx, t))))) {
      mods.push('bX');
    }
    if (subs.filter((s) => elOf(ctx, s) === 'C').length === 3) mods.push('tert');
    const unique = new Set(mods);
    const nonHalogen = [...unique].filter((k) => NON_HALOGEN_CARBOXYLIC_MODS.has(k)).length;
    const mixedHalogens = halKeys.length > 1;
    return applyModifiers(base, [...unique], CARBOXYLIC_RANGE, nonHalogen > 1 || mixedHalogens);
  }
  return applyModifiers(base, mods, CARBOXYLIC_RANGE, false);
}

/** O–H of an alcohol: class by degree, β-halogen and allylic modifiers. */
function alcoholEnv(ctx: Ctx, carbinolC: number): Env {
  const degree = Math.min(carbonDegree(ctx, carbinolC), 3);
  const base = pka(`OH.alcohol.${DEGREE_NAME[degree]}`);
  const betaCarbons = neighbours(ctx, carbinolC).filter((x) => elOf(ctx, x) === 'C');
  const betaSubs: number[] = [];
  for (const c of betaCarbons) for (const x of neighbours(ctx, c)) if (x !== carbinolC) betaSubs.push(x);
  const mods = halogenKeys('b', betaSubs, ctx);
  if (betaCarbons.some((c) => hasCCpi(ctx, c))) mods.push('allylic');
  return applyModifiers(base, mods, ALCOHOL_RANGE, false);
}

function singleAlphaId(ctx: Ctx, x: number, kind: ActivatingKind): string {
  if (kind === 'nitro') return `CH.alpha.nitro.${Math.min(carbonDegree(ctx, x), 2)}`;
  return `CH.alpha.${kind}`;
}

function alphaEnv(ctx: Ctx, x: number, kinds: readonly ActivatingKind[]): Env {
  const sorted = [...kinds].sort();
  const singles = sorted.map((k) => pka(singleAlphaId(ctx, x, k)));
  if (sorted.length === 1) return plain(singles[0]!);
  const id = `CH.alpha.${sorted.join('+')}`;
  const listed = PKA[id];
  if (listed !== undefined) return plain(listed);
  const minSingle = Math.min(...singles.map((e) => e.pKa));
  const drop = sorted.length === 2 ? 8 : 12;
  const desc = sorted.map((k) => k === 'nitro' ? 'a nitro group' : k === 'acid-chloride' ? 'an acid chloride' : `a${/^[aeiou]/.test(k) ? 'n' : ''} ${k}`);
  return {
    classId: id,
    modifiers: [],
    pKa: round2(minSingle - drop),
    label: `C–H between ${desc.join(' and ')}`,
    source: `${S.GENERAL} (estimated from the single-group values)`,
    verified: false,
  };
}

function classifyO(ctx: Ctx, x: number): Env {
  const ls = links(ctx, x);
  const heavy = ls.map((l) => l.nb);
  if (chargeOf(ctx, x) === 1) {
    if (heavy.length === 0) return plain(pka('OH.oxonium.hydronium'));
    const dbl = ls.find((l) => l.order === 2 && elOf(ctx, l.nb) === 'C');
    if (dbl !== undefined) {
      const cNbs = neighbours(ctx, dbl.nb).filter((y) => y !== x);
      if (cNbs.some((y) => elOf(ctx, y) === 'N')) return plain(pka('OH.oxonium.amide'));
      if (cNbs.some((y) => elOf(ctx, y) === 'O')) return plain(pka('OH.oxonium.carboxylic'));
      return plain(pka('OH.oxonium.carbonyl'));
    }
    if (heavy.length === 1) return plain(pka('OH.oxonium.alcohol'));
    return plain(pka('OH.oxonium.ether'));
  }
  // 2. carboxylic acid O–H
  for (const l of ls) {
    if (l.order === 1 && carbonylOf(ctx, l.nb) >= 0 && carbonylKind(ctx, l.nb) === 'carboxylic') {
      return carboxylicEnv(ctx, l.nb, x, pka('OH.carboxylic'));
    }
  }
  // 3. peracid / hydroperoxide
  const oNb = heavy.find((y) => elOf(ctx, y) === 'O');
  if (oNb !== undefined) {
    const carbonylC = neighbours(ctx, oNb).find((y) => y !== x && carbonylOf(ctx, y) >= 0);
    if (carbonylC !== undefined) return carboxylicEnv(ctx, carbonylC, oNb, pka('OH.peracid'));
    return plain(pka('OH.hydroperoxide'));
  }
  // 4. oxime
  if (heavy.some((y) => elOf(ctx, y) === 'N' && links(ctx, y).some((l) => l.order === 2 && elOf(ctx, l.nb) === 'C'))) {
    return plain(pka('OH.oxime'));
  }
  // 5. enol / phenol
  if (heavy.some((y) => hasCCpi(ctx, y))) return plain(pka('OH.enol'));
  // 6. water
  if (heavy.length === 0) return plain(pka('OH.water'));
  const cNb = heavy.find((y) => elOf(ctx, y) === 'C');
  if (cNb === undefined) return plain(pka('XH.other'));
  // 7. gem-diol
  const secondOH = neighbours(ctx, cNb).some((y) => y !== x && elOf(ctx, y) === 'O' && orderBetween(ctx, cNb, y) === 1 && hOf(ctx, y) >= 1);
  if (secondOH) return plain(pka('OH.gemdiol'));
  // 8. alcohol
  return alcoholEnv(ctx, cNb);
}

function classifyN(ctx: Ctx, x: number): Env {
  const heavy = neighbours(ctx, x);
  const deg = carbonDegree(ctx, x);
  if (chargeOf(ctx, x) === 1) {
    if (heavy.some((y) => hasCCpi(ctx, y))) return plain(pka('NH.anilinium'));
    return plain(pka(`NH.ammonium.${['nh4', 'primary', 'secondary', 'tertiary'][Math.min(deg, 3)]}`));
  }
  if (chargeOf(ctx, x) === -1) return plain(pka('NH.amide-ion'));
  const carbonyls = heavy.filter((y) => carbonylOf(ctx, y) >= 0).length;
  if (carbonyls >= 2) return plain(pka('NH.imide'));
  if (carbonyls === 1) return plain(pka('NH.amide'));
  if (heavy.some((y) => elOf(ctx, y) === 'S'
    && (sulfinylS(ctx, y) || links(ctx, y).some((l) => l.order === 2 && elOf(ctx, l.nb) === 'O')))) {
    return plain(pka('NH.sulfonamide'));
  }
  if (heavy.some((y) => hasCCpi(ctx, y))) return plain(pka('NH.aniline'));
  if (deg === 0) return plain(pka('NH.amine.nh3'));
  if (deg === 1) return plain(pka('NH.amine.primary'));
  return plain(pka('NH.amine.secondary'));
}

function classifyS(ctx: Ctx, x: number): Env {
  const heavy = neighbours(ctx, x);
  if (chargeOf(ctx, x) === 1) return plain(pka('SH.sulfonium'));
  if (heavy.length === 0) return plain(pka('SH.h2s'));
  if (heavy.some((y) => hasCCpi(ctx, y))) return plain(pka('SH.thiophenol'));
  if (heavy.some((y) => elOf(ctx, y) === 'C' && neighbours(ctx, y).some((z) => z !== x && hasCCpi(ctx, z)))) {
    return plain(pka('SH.thiol.benzylic'));
  }
  return plain(pka('SH.thiol'));
}

function classifyC(ctx: Ctx, x: number): Env {
  const q = chargeOf(ctx, x);
  if (q === -1) return plain(pka('CH.carbanion'));
  if (q === 1) return plain(pka('CH.carbocation'));
  if (nitrileC(ctx, x) && hOf(ctx, x) === 1) return plain(pka('CH.hcn'));
  if (links(ctx, x).some((l) => l.order === 3 && elOf(ctx, l.nb) === 'C')) return plain(pka('CH.alkyne'));
  // 4. vinylic before alpha on purpose: only sp3 C–H can be an alpha hydrogen (McMurry 22.1)
  if ((ctx.info[x]?.pi ?? 0) >= 1) return plain(pka('CH.vinylic'));
  const kinds: ActivatingKind[] = [];
  for (const y of neighbours(ctx, x)) {
    const k = activating(ctx, y);
    if (k !== null) kinds.push(k);
  }
  if (kinds.length >= 1) {
    if (kinds.length >= 3 && kinds.every((k) => k === 'nitro')) return plain(pka('CH.alpha.nitro+nitro+nitro'));
    return alphaEnv(ctx, x, kinds);
  }
  const n = neighbours(ctx, x).filter((y) => elOf(ctx, y) === 'C' && (hasCCpi(ctx, y) || hasTripleBond(ctx, y))).length;
  if (n >= 1) return plain(pka(`CH.allylic.${Math.min(n, 3)}`));
  return plain(pka('CH.alkane'));
}

/** Design 10.5 `classify(X)`: the pKa environment of every hydrogen on atom X. */
function classify(ctx: Ctx, x: number): Env {
  const el = elOf(ctx, x);
  switch (el) {
    case 'F': case 'Cl': case 'Br': case 'I':
      return plain(pka(`HX.${el}`));
    case 'O':
      return classifyO(ctx, x);
    case 'N':
      return classifyN(ctx, x);
    case 'S':
      return classifyS(ctx, x);
    case 'C':
      return classifyC(ctx, x);
    default:
      return plain(pka('XH.other'));
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** One site per hydrogen (explicit blocks first), all hydrogens of one parent sharing a classKey. */
export function hydrogenSites(g: MoleculeGraph, info: readonly AtomInfo[]): HydrogenSite[] {
  const ctx: Ctx = { g, info };
  const out: HydrogenSite[] = [];
  for (let x = 0; x < g.atoms.length; x++) {
    const h = info[x]?.hydrogens ?? 0;
    if (h <= 0) continue;
    const env = classify(ctx, x);
    const classKey = `${env.classId}|${[...env.modifiers].sort().join(',')}`;
    const hPos: readonly Vec3[] = g.atoms[x]!.hPos ?? [];
    for (let slot = 0; slot < h; slot++) {
      const explicitPos = hPos[slot];
      out.push({
        parentId: x,
        slot,
        ...(explicitPos !== undefined ? { explicitPos } : {}),
        pKa: env.pKa,
        classId: env.classId,
        classKey,
        label: env.label,
        source: env.source,
        verified: env.verified,
      });
    }
  }
  return out;
}

function basicEntry(ctx: Ctx, x: number): PkaEntry {
  const el = elOf(ctx, x);
  const q = chargeOf(ctx, x);
  const ls = links(ctx, x);
  const heavy = ls.map((l) => l.nb);
  const b = (id: string): PkaEntry => {
    const e = BASIC[id];
    if (e === undefined) throw new Error(`unknown basic class ${id}`);
    return e;
  };
  switch (el) {
    case 'C': {
      if (q !== -1) return b('B.other');
      if (ls.some((l) => l.order === 3)) return b('B.C.acetylide');
      if ((ctx.info[x]?.pi ?? 0) >= 1) return b('B.C.vinyl');
      if (heavy.some((y) => carbonylOf(ctx, y) >= 0)) return b('B.C.enolate');
      return b('B.C.alkyl');
    }
    case 'N': {
      const deg = carbonDegree(ctx, x);
      if (q === -1) return b(deg <= 1 ? 'B.N.amide-ion.primary' : 'B.N.amide-ion.secondary');
      if (heavy.some((y) => carbonylOf(ctx, y) >= 0)) return b('B.N.amide');
      if (ls.some((l) => l.order === 3)) return b('B.N.nitrile');
      if (ls.some((l) => l.order === 2)) return b('B.N.imine');
      if (heavy.some((y) => hasCCpi(ctx, y))) return b('B.N.conjugated');
      return b(`B.N.amine.${['nh3', 'primary', 'secondary', 'tertiary'][Math.min(deg, 3)]}`);
    }
    case 'O': {
      if (q === -1) {
        if (heavy.length === 0) return b('B.O.hydroxide');
        const c = heavy[0]!;
        if (elOf(ctx, c) !== 'C') return b('B.other');
        if (carbonylOf(ctx, c) >= 0 && carbonylKind(ctx, c) === 'carboxylic') return b('B.O.carboxylate');
        if (ctx.g.atoms[c]!.aromatic) return b('B.O.phenoxide');
        if (hasCCpi(ctx, c)) return b('B.O.enolate');
        return b(`B.O.alkoxide.${DEGREE_NAME[Math.min(carbonDegree(ctx, c), 3)]}`);
      }
      if (heavy.length === 0) return b('B.O.water');
      for (const l of ls) {
        const c = l.nb;
        if (carbonylOf(ctx, c) < 0) continue;
        const kind = carbonylKind(ctx, c);
        const hasOminus = neighbours(ctx, c).some((y) => elOf(ctx, y) === 'O' && chargeOf(ctx, y) === -1);
        if (kind === 'carboxylic' && hasOminus) return b('B.O.carboxylate');
        if (kind === 'amide') { if (l.order === 2) return b('B.O.amide'); continue; }
        if (kind === 'ester') return b('B.O.ester');
        if (kind === 'carboxylic') return b('B.O.acid');
        if (l.order === 2) return b('B.O.carbonyl');
      }
      if (heavy.length === 1) return b('B.O.alcohol');
      return b('B.O.ether');
    }
    case 'S':
      return b(q === -1 ? 'B.S.thiolate' : 'B.S.thiol');
    case 'F': case 'Cl': case 'Br': case 'I':
      if (heavy.length === 0 && q === -1) return b(`B.X.halide.${el}`);
      if (heavy.length > 0) return b('B.X.bound');
      return b('B.other');
    default:
      return b('B.other');
  }
}

/** Lone-pair (or carbanion) sites with the pKa of their conjugate acid (design 10.7). */
export function basicSites(g: MoleculeGraph, info: readonly AtomInfo[]): BasicSite[] {
  const ctx: Ctx = { g, info };
  const out: BasicSite[] = [];
  for (let x = 0; x < g.atoms.length; x++) {
    const a = g.atoms[x]!;
    const lp = info[x]?.lonePairs ?? 0;
    const candidate = (lp > 0 && a.charge !== 1) || a.charge === -1;
    if (!candidate) continue;
    const e = basicEntry(ctx, x);
    out.push({
      atomId: x,
      pKaH: e.pKa,
      classId: e.id,
      classKey: `${e.id}|`,
      label: `lone pair on ${e.label}`,
      source: e.source,
      verified: e.verified,
    });
  }
  return out;
}

/** Sites plus the tie classes of the most acidic hydrogen and most basic site. */
export function acidity(g: MoleculeGraph, info: readonly AtomInfo[]): AcidityAnalysis {
  const hydrogens = hydrogenSites(g, info);
  const bases = basicSites(g, info);
  let mostAcidic: HydrogenSite[] = [];
  if (hydrogens.length > 0) {
    const min = Math.min(...hydrogens.map((s) => s.pKa));
    mostAcidic = hydrogens.filter((s) => s.pKa <= min + PKA_TIE);
  }
  let mostBasic: BasicSite[] = [];
  if (bases.length > 0) {
    const max = Math.max(...bases.map((s) => s.pKaH));
    mostBasic = bases.filter((s) => s.pKaH >= max - PKA_TIE);
  }
  return { hydrogens, basicSites: bases, mostAcidic, mostBasic };
}

/** One `unverified-pka` warning per distinct unverified class among mostAcidic ∪ mostBasic. */
export function unverifiedWarnings(a: AcidityAnalysis): Warning[] {
  const seen = new Set<string>();
  const out: Warning[] = [];
  const push = (classId: string, verified: boolean): void => {
    if (verified || seen.has(classId)) return;
    seen.add(classId);
    out.push({ kind: 'unverified-pka', classId });
  };
  for (const s of a.mostAcidic) push(s.classId, s.verified);
  for (const s of a.mostBasic) push(s.classId, s.verified);
  return out;
}

/** At most two decimals, no trailing zeros, ASCII minus. */
function fmt(x: number): string {
  const r = round2(x);
  return (Object.is(r, -0) ? 0 : r).toString();
}

/**
 * McMurry 2.9: the proton goes from the stronger acid to the stronger base,
 * so the equilibrium favors products iff the product conjugate acid is the
 * weaker acid (higher pKa). Throws when the acid has no hydrogen or the base
 * has no basic site.
 */
export function predictAcidBase(acid: MoleculeGraph, base: MoleculeGraph): {
  pKaAcid: number; pKaConjugate: number; delta: number; favorsProducts: boolean; text: string;
} {
  const ga = perceiveAromaticity(acid);
  const gb = perceiveAromaticity(base);
  const hA = implicitHydrogens(ga).hydrogens;
  const hB = implicitHydrogens(gb).hydrogens;
  const sA = hydrogenSites(ga, atomInfo(ga, hA));
  if (sA.length === 0) throw new Error('acid has no hydrogens');
  const sB = basicSites(gb, atomInfo(gb, hB));
  if (sB.length === 0) throw new Error('base has no basic site');
  let siteA = sA[0]!;
  for (const s of sA) if (s.pKa < siteA.pKa) siteA = s;
  let siteB = sB[0]!;
  for (const s of sB) if (s.pKaH > siteB.pKaH) siteB = s;
  const a = siteA.pKa;
  const b = siteB.pKaH;
  const delta = round2(b - a);
  const favorsProducts = delta > 0;
  const approx = (!siteA.verified || !siteB.verified) ? '≈' : '';
  const text =
    `Reactant acid pKa ${approx}${fmt(a)} (${siteA.label}) → product conjugate acid pKa ${approx}${fmt(b)} (${siteB.label}). `
    + `Equilibrium favors the weaker acid (higher pKa), so the reaction ${favorsProducts ? 'favors products' : 'favors reactants'} (Keq ≈ 10^${fmt(delta)}).`;
  return { pKaAcid: a, pKaConjugate: b, delta, favorsProducts, text };
}

const _check: Pick<ChemApi, 'hydrogenSites' | 'basicSites' | 'acidity' | 'predictAcidBase'> = {
  hydrogenSites, basicSites, acidity, predictAcidBase,
};
void _check;
