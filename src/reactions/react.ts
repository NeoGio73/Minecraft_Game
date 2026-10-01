/**
 * Reaction bench entry point: `react(substrate, card, opts)` dispatches on
 * `card.rule` and post-processes the rule result (04 section 5.9). Also the
 * rule registry (`RULES` / `REACTION_RULES`), the canonical reagent card
 * table (`REAGENT_CARDS`, 04 sections 2.1-2.2, keyed by `ReagentId`; the
 * content package validates `reagents.json` against it), the card -> rule
 * lookup (`CARD_RULE`) and the legacy id map (`LEGACY_REAGENT_IDS`, 2.4).
 * PURE MODULE.
 */
import type { ChemApi, MoleculeGraph, ReactOptions, ReactionResult } from '../chem/types';
import { REAGENT_IDS } from '../content/types';
import type { Nucleophile, ReagentCard, ReagentId, RuleId, Solvent, SubstrateClass } from '../content/types';
import { JUSTIFY, dedupe, findCX, noReaction, sameProduct, stripExplicitH, substrateClasses } from './helpers';
import type { RuleFn, RuleOpts } from './helpers';
import {
  applyAntiDiol, applyCyclopropanation, applyEpoxidation, applyEpoxideOpen, applyH2, applyHoxAdd, applyHxAdd,
  applyHydration, applyHydroboration, applyOxymerc, applyRadicalHbr, applySynDiol, applyX2Add,
} from './additions';
import {
  applyAcetylideAlkylation, applyAlkyneHydrationHg, applyAlkyneHydroboration, applyDissolvingMetal, applyDoubleE2, applyLindlar,
} from './alkynes';
import { applyDiolCleavage, applyKmno4Cleavage, applyOzonolysis } from './oxidation';
import { applyAllylicBromination, applyRadicalHalogenation } from './radical';
import { applyRohToRx } from './alcohols';
import { applySubstElim } from './substitution';
import { applyDehydration } from './elimination';

export { ROH_MECHANISM } from './alcohols';

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

export const RULES: Readonly<Record<RuleId, RuleFn>> = {
  HX_ADD: applyHxAdd,
  RADICAL_HBR: applyRadicalHbr,
  X2_ADD: applyX2Add,
  HOX_ADD: applyHoxAdd,
  HYDRATION: applyHydration,
  OXYMERC: applyOxymerc,
  HYDROBORATION: applyHydroboration,
  H2: applyH2,
  EPOXIDATION: applyEpoxidation,
  EPOXIDE_OPEN: applyEpoxideOpen,
  ANTI_DIOL: applyAntiDiol,
  SYN_DIOL: applySynDiol,
  OZONOLYSIS: applyOzonolysis,
  KMNO4_CLEAVAGE: applyKmno4Cleavage,
  DIOL_CLEAVAGE: applyDiolCleavage,
  CYCLOPROPANATION: applyCyclopropanation,
  ALKYNE_HYDRATION_HG: applyAlkyneHydrationHg,
  ALKYNE_HYDROBORATION: applyAlkyneHydroboration,
  LINDLAR: applyLindlar,
  DISSOLVING_METAL: applyDissolvingMetal,
  ACETYLIDE_ALKYLATION: applyAcetylideAlkylation,
  DOUBLE_E2: applyDoubleE2,
  ALLYLIC_BROMINATION: applyAllylicBromination,
  RADICAL_HALOGENATION: applyRadicalHalogenation,
  ROH_TO_RX: applyRohToRx,
  SUBST_ELIM: applySubstElim,
  DEHYDRATION: applyDehydration,
};

/** Alias: the transformation registry the content package validates `reagents.json` rules against. */
export const REACTION_RULES: Readonly<Record<RuleId, RuleFn>> = RULES;

// ---------------------------------------------------------------------------
// Reagent card table (04 sections 2.1-2.2; `enabledByDefault` per SCOPE.md)
// ---------------------------------------------------------------------------

type CardSpec = Omit<ReagentCard, 'id'>;

const nuc = (atom: Nucleophile['atom'], fragment: string, strength: Nucleophile['strength'], basicity: Nucleophile['basicity'], bulky: boolean, charged: boolean): Nucleophile =>
  ({ atom, fragment, strength, basicity, bulky, charged });

function card(
  label: string, reagentText: string, chapter: number, section: string, substrates: readonly SubstrateClass[], rule: RuleId,
  extra: Partial<Pick<ReagentCard, 'halogen' | 'equiv' | 'solvent' | 'heat' | 'notInMcMurry10e' | 'requiresDiagonalBonds' | 'nuc'>>,
  enabledByDefault: boolean,
): CardSpec {
  return { label, reagentText, chapter, section, substrates, rule, ...extra, enabledByDefault };
}

const protic: Solvent = 'protic';
const aprotic: Solvent = 'aprotic';

const CARD_SPECS: Readonly<Record<ReagentId, CardSpec>> = {
  HX_HCL: card('HCl', 'HCl, ether', 7, '7.7', ['alkene', 'alkyne'], 'HX_ADD', { halogen: 'Cl', equiv: 1 }, true),
  HX_HBR: card('HBr', 'HBr, ether', 7, '7.7', ['alkene', 'alkyne'], 'HX_ADD', { halogen: 'Br', equiv: 1 }, true),
  HX_HI: card('HI', 'HI (KI, H3PO4)', 7, '7.7', ['alkene', 'alkyne'], 'HX_ADD', { halogen: 'I', equiv: 1 }, true),
  HX_2EQ_HBR: card('2 HBr', '2 HBr, ether', 9, '9.3', ['alkyne'], 'HX_ADD', { halogen: 'Br', equiv: 2 }, true),
  HX_2EQ_HCL: card('2 HCl', '2 HCl, ether', 9, '9.3', ['alkyne'], 'HX_ADD', { halogen: 'Cl', equiv: 2 }, true),
  HBR_ROOR: card('HBr, peroxides', 'HBr, ROOR', 8, '8.10 (not in 10e)', ['alkene'], 'RADICAL_HBR', { halogen: 'Br', equiv: 1, notInMcMurry10e: true }, true),
  X2_BR2: card('Br2', 'Br2, CH2Cl2', 8, '8.2 / 9.3', ['alkene', 'alkyne'], 'X2_ADD', { halogen: 'Br', equiv: 1 }, true),
  X2_CL2: card('Cl2', 'Cl2, CH2Cl2', 8, '8.2 / 9.3', ['alkene', 'alkyne'], 'X2_ADD', { halogen: 'Cl', equiv: 1 }, true),
  HOX_BR2_H2O: card('Br2, H2O', 'Br2, H2O (or NBS, H2O/DMSO)', 8, '8.3', ['alkene'], 'HOX_ADD', { halogen: 'Br', equiv: 1 }, true),
  HOX_CL2_H2O: card('Cl2, H2O', 'Cl2, H2O', 8, '8.3', ['alkene'], 'HOX_ADD', { halogen: 'Cl', equiv: 1 }, true),
  H3O_HYDRATION: card('H3O+', 'H2O, H2SO4 (cat.)', 8, '8.4', ['alkene'], 'HYDRATION', { equiv: 1, solvent: protic }, true),
  OXYMERC: card('oxymercuration', '1) Hg(OAc)2, H2O/THF 2) NaBH4', 8, '8.4', ['alkene'], 'OXYMERC', { equiv: 1 }, true),
  HYDROBORATION: card('hydroboration–oxidation', '1) BH3, THF 2) H2O2, NaOH', 8, '8.5', ['alkene'], 'HYDROBORATION', { equiv: 1 }, true),
  H2_PD: card('H2, Pd/C', 'H2, Pd/C (or PtO2)', 8, '8.6 / 9.5', ['alkene', 'alkyne'], 'H2', { equiv: 1 }, true),
  MCPBA: card('epoxidation', 'RCO3H (m-CPBA), CH2Cl2', 8, '8.7', ['alkene'], 'EPOXIDATION', { equiv: 1, requiresDiagonalBonds: true }, false),
  EPOXIDE_H3O: card('epoxide hydrolysis', 'H3O+', 8, '8.7', ['epoxide'], 'EPOXIDE_OPEN', { equiv: 1, solvent: protic, requiresDiagonalBonds: true }, false),
  ANTI_DIHYDROXYLATION: card('1) RCO3H 2) H3O+', '1) m-CPBA 2) H3O+', 8, '8.7', ['alkene'], 'ANTI_DIOL', { equiv: 1 }, true),
  OSO4: card('syn dihydroxylation', '1) OsO4 2) NaHSO3, H2O', 8, '8.7', ['alkene'], 'SYN_DIOL', { equiv: 1 }, true),
  KMNO4_COLD: card('KMnO4, cold, OH−', 'KMnO4, NaOH, 0 °C', 8, '8.7 (not in 10e)', ['alkene'], 'SYN_DIOL', { equiv: 1, notInMcMurry10e: true }, false),
  O3_ZN: card('ozonolysis', '1) O3 2) Zn, H3O+', 8, '8.8', ['alkene'], 'OZONOLYSIS', { equiv: 1 }, true),
  KMNO4_HOT: card('KMnO4, H3O+', 'KMnO4, H3O+, heat', 8, '8.8 / 9.6', ['alkene', 'alkyne'], 'KMNO4_CLEAVAGE', { equiv: 1, heat: true }, true),
  HIO4: card('periodic acid', 'HIO4, H2O', 8, '8.8', ['diol'], 'DIOL_CLEAVAGE', { equiv: 1 }, false),
  CH2I2_ZNCU: card('Simmons–Smith', 'CH2I2, Zn(Cu), ether', 8, '8.9', ['alkene'], 'CYCLOPROPANATION', { equiv: 1, requiresDiagonalBonds: true }, false),
  CHCL3_KOH: card('dichlorocarbene', 'CHCl3, KOH', 8, '8.9', ['alkene'], 'CYCLOPROPANATION', { halogen: 'Cl', equiv: 1, requiresDiagonalBonds: true }, false),
  HGSO4_HYDRATION: card('Hg-catalysed hydration', 'H2O, H2SO4, HgSO4', 9, '9.4', ['alkyne'], 'ALKYNE_HYDRATION_HG', { equiv: 1, solvent: protic }, true),
  HYDROBORATION_ALKYNE: card('alkyne hydroboration–oxidation', '1) BH3 (Sia2BH), THF 2) H2O2, NaOH', 9, '9.4', ['alkyne'], 'ALKYNE_HYDROBORATION', { equiv: 1 }, true),
  H2_LINDLAR: card('Lindlar hydrogenation', 'H2, Lindlar catalyst', 9, '9.5', ['alkyne'], 'LINDLAR', { equiv: 1 }, true),
  LI_NH3: card('Li, NH3', 'Li (or Na), NH3(l)', 9, '9.5', ['alkyne'], 'DISSOLVING_METAL', { equiv: 1 }, true),
  NANH2_THEN_RX: card('1) NaNH2 2) R–Br', '1) NaNH2, NH3 2) R–Br (R = CH3 or primary)', 9, '9.8–9.9', ['terminal-alkyne'], 'ACETYLIDE_ALKYLATION', { equiv: 1 }, true),
  NANH2_2EQ_DIHALIDE: card('2 NaNH2, then H3O+', '2 NaNH2, NH3; then H3O+', 9, '9.2', ['vicinal-dihalide'], 'DOUBLE_E2', { equiv: 2 }, true),
  NBS_HV: card('NBS, hν', 'NBS, hν, CCl4', 10, '10.3', ['allylic-alkene'], 'ALLYLIC_BROMINATION', { halogen: 'Br', equiv: 1 }, true),
  CL2_HV: card('Cl2, hν', 'Cl2, hν', 10, '10.2', ['alkane'], 'RADICAL_HALOGENATION', { halogen: 'Cl', equiv: 1 }, true),
  BR2_HV: card('Br2, hν', 'Br2, hν', 10, '10.2', ['alkane'], 'RADICAL_HALOGENATION', { halogen: 'Br', equiv: 1 }, true),
  ROH_HX_HCL: card('HCl (on alcohols)', 'HCl, ether, 0 °C', 10, '10.5', ['alcohol'], 'ROH_TO_RX', { halogen: 'Cl', equiv: 1, solvent: protic }, true),
  ROH_HX_HBR: card('HBr (on alcohols)', 'HBr, ether, 0 °C', 10, '10.5', ['alcohol'], 'ROH_TO_RX', { halogen: 'Br', equiv: 1, solvent: protic }, true),
  ROH_SOCL2: card('SOCl2', 'SOCl2, pyridine', 10, '10.5', ['alcohol'], 'ROH_TO_RX', { halogen: 'Cl', equiv: 1, solvent: aprotic }, true),
  ROH_PBR3: card('PBr3', 'PBr3, ether', 10, '10.5', ['alcohol'], 'ROH_TO_RX', { halogen: 'Br', equiv: 1, solvent: aprotic }, true),
  ROH_HF_PYR: card('HF–pyridine', 'HF, pyridine', 10, '10.5', ['alcohol'], 'ROH_TO_RX', { halogen: 'F', equiv: 1, solvent: aprotic }, false),
  SN2_NAOH: card('NaOH', 'NaOH, H2O/DMSO', 11, '11.2–11.3', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, nuc: nuc('O', 'O', 'strong', 'strong', false, true) }, true),
  SN2_NAOCH3: card('NaOCH3', 'NaOCH3, CH3OH', 11, '11.3 / 11.7', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, nuc: nuc('O', 'OC', 'strong', 'strong', false, true) }, true),
  SN2_NAOET: card('NaOEt', 'NaOCH2CH3, CH3CH2OH', 11, '11.7', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, nuc: nuc('O', 'OCC', 'strong', 'strong', false, true) }, true),
  SN2_NAI: card('NaI', 'NaI, acetone', 11, '11.3', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: aprotic, nuc: nuc('I', 'I', 'strong', 'weak', false, true) }, true),
  SN2_NACN: card('NaCN', 'NaCN, DMSO', 11, '11.3', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: aprotic, nuc: nuc('C', 'C#N', 'strong', 'weak', false, true) }, true),
  SN2_NAN3: card('NaN3', 'NaN3, DMF', 11, '11.3', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: aprotic, nuc: nuc('N', 'N=[N+]=[N-]', 'strong', 'weak', false, true) }, false),
  SN2_NASH: card('NaSH', 'NaSH, ethanol', 11, '11.3', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, nuc: nuc('S', 'S', 'strong', 'weak', false, true) }, false),
  SN2_NH3: card('NH3', 'NH3 (excess)', 11, '11.3', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, nuc: nuc('N', 'N', 'moderate', 'weak', false, false) }, false),
  SN2_NAOAC: card('NaOAc', 'CH3CO2Na, CH3CO2H/H2O', 11, '11.5', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, nuc: nuc('O', 'OC(C)=O', 'moderate', 'weak', false, true) }, false),
  SN2_ACETYLIDE: card('Na+ −C≡CCH3', 'NaC≡CCH3, NH3', 11, '9.9 / 11.3', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, nuc: nuc('C', 'C#CC', 'strong', 'strong', false, true) }, true),
  TBUOK: card('KOtBu', 'KOC(CH3)3, tBuOH', 11, '11.12', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, notInMcMurry10e: true, nuc: nuc('O', 'OC(C)(C)C', 'strong', 'strong', true, true) }, true),
  NANH2_BASE: card('NaNH2', 'NaNH2, NH3', 11, '11.8', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, nuc: nuc('N', 'N', 'strong', 'strong', false, true) }, true),
  KOH_ETOH: card('KOH, ethanol', 'KOH, CH3CH2OH, heat', 8, '8.1 / 11.7', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, heat: true, nuc: nuc('O', 'O', 'strong', 'strong', false, true) }, true),
  H2O_HEAT: card('H2O, heat', 'H2O, heat', 11, '11.4 / 11.10', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, heat: true, nuc: nuc('O', 'O', 'weak', 'weak', false, false) }, true),
  ETOH_HEAT: card('ethanol, heat', 'CH3CH2OH, heat', 11, '11.5 / 11.10', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, heat: true, nuc: nuc('O', 'OCC', 'weak', 'weak', false, false) }, true),
  MEOH_HEAT: card('methanol, heat', 'CH3OH, heat', 11, '11.5', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, heat: true, nuc: nuc('O', 'OC', 'weak', 'weak', false, false) }, false),
  HCOOH_H2O: card('HCO2H, H2O', 'HCO2H, H2O', 11, '11.12', ['alkyl-halide'], 'SUBST_ELIM', { equiv: 1, solvent: protic, nuc: nuc('O', 'OC=O', 'weak', 'weak', false, false) }, false),
  H2SO4_HEAT_ROH: card('H2SO4, heat (dehydration)', 'H2SO4, H2O/THF, 50 °C', 8, '8.1', ['alcohol'], 'DEHYDRATION', { equiv: 1, solvent: protic, heat: true }, true),
};

/** Canonical cards keyed by id (the data `src/content/reagents.json` must agree with). */
export const REAGENT_CARDS: Readonly<Record<ReagentId, ReagentCard>> = Object.fromEntries(
  REAGENT_IDS.map((id) => [id, { id, ...CARD_SPECS[id] }]),
) as Record<ReagentId, ReagentCard>;

/** Rule lookup keyed by card id. */
export const CARD_RULE: Readonly<Record<ReagentId, RuleId>> = Object.fromEntries(
  REAGENT_IDS.map((id) => [id, CARD_SPECS[id].rule]),
) as Record<ReagentId, RuleId>;

/** The canonical card for `id` (a fresh copy). Throws on an unknown id. */
export function defaultCard(id: ReagentId): ReagentCard {
  const c = REAGENT_CARDS[id];
  if (!c) throw new Error(`unknown reagent id ${String(id)}`);
  return { ...c };
}

// ---------------------------------------------------------------------------
// Legacy ids (04 section 2.4)
// ---------------------------------------------------------------------------

export const LEGACY_REAGENT_IDS: Readonly<Record<string, ReagentId>> = {
  hbr: 'HX_HBR', hcl: 'HX_HCL', hi: 'HX_HI', hbr_2equiv: 'HX_2EQ_HBR',
  'hx_ether(hcl)': 'ROH_HX_HCL', 'hx_ether(hbr)': 'ROH_HX_HBR',
  br2_ch2cl2: 'X2_BR2', cl2_ch2cl2: 'X2_CL2', br2_h2o: 'HOX_BR2_H2O', nbs_h2o: 'HOX_BR2_H2O',
  hg_oac2_then_nabh4: 'OXYMERC', bh3_then_h2o2: 'HYDROBORATION',
  h2so4_h2o: 'H3O_HYDRATION', h2so4_h2o_alcohol: 'H2SO4_HEAT_ROH',
  h2_pd: 'H2_PD', h2_pt: 'H2_PD', h2_lindlar: 'H2_LINDLAR', li_nh3: 'LI_NH3',
  mcpba: 'MCPBA', mcpba_then_h3o: 'ANTI_DIHYDROXYLATION', oso4_nmo: 'OSO4', o3_then_zn: 'O3_ZN', kmno4_h3o: 'KMNO4_HOT',
  koh_etoh: 'KOH_ETOH', naoet_etoh: 'SN2_NAOET', kotbu: 'TBUOK', naoh: 'SN2_NAOH', nacn_dmso: 'SN2_NACN', nai_acetone: 'SN2_NAI',
  h2o_heat: 'H2O_HEAT', etoh_heat: 'ETOH_HEAT', hgso4_h2so4_h2o: 'HGSO4_HYDRATION', sia2bh_then_h2o2: 'HYDROBORATION_ALKYNE',
  nanh2_nh3: 'NANH2_BASE', nbs_hv: 'NBS_HV', cl2_hv: 'CL2_HV', br2_hv: 'BR2_HV',
  socl2_pyridine: 'ROH_SOCL2', pbr3: 'ROH_PBR3', hf_pyridine: 'ROH_HF_PYR',
};

/**
 * Resolves a legacy id: `nanh2_then_<rx>` maps to NANH2_THEN_RX (the suffix
 * is the `rx` name); `h2so4_h2o` picks H2SO4_HEAT_ROH when the substrate is an
 * alcohol and H3O_HYDRATION otherwise. Returns null for unknown ids.
 */
export function legacyReagentId(id: string, substrate?: MoleculeGraph): { readonly id: ReagentId; readonly rx?: string } | null {
  if (id.startsWith('nanh2_then_')) return { id: 'NANH2_THEN_RX', rx: id.slice('nanh2_then_'.length) };
  if (id === 'h2so4_h2o' && substrate) {
    const classes = substrateClasses(substrate);
    return { id: classes.has('alcohol') && !classes.has('alkene') ? 'H2SO4_HEAT_ROH' : 'H3O_HYDRATION' };
  }
  const mapped = LEGACY_REAGENT_IDS[id];
  return mapped ? { id: mapped } : null;
}

// ---------------------------------------------------------------------------
// react (04 section 5.9)
// ---------------------------------------------------------------------------

export function react(substrate: MoleculeGraph, card: ReagentCard, opts: ReactOptions = {}): ReactionResult {
  const rule = RULES[card.rule];
  if (!rule) throw new Error(`react: unknown rule ${String(card.rule)} on card ${card.id}`);
  const o: RuleOpts = {
    equiv: opts.equiv ?? card.equiv ?? 1,
    rearrangement: opts.rearrangement ?? 'warn',
    ...(opts.rx ? { rx: stripExplicitH(opts.rx) } : {}),
  };
  const g = stripExplicitH(substrate);
  const classes = substrateClasses(g);
  if (!card.substrates.some((s) => classes.has(s))) {
    // 04 section 9.1 row 8: a 2-equivalent HX card on an alkene explains the equivalents, not the substrate.
    if (card.rule === 'HX_ADD' && o.equiv === 2 && classes.has('alkene')) {
      return { ...noReaction(JUSTIFY.twoEquivAlkene), reagentId: card.id };
    }
    // 04 section 9.1 rows 96-97: a vinylic / aryl C–X reaches the decision table so the student reads R1.
    if (!(card.rule === 'SUBST_ELIM' && findCX(g).length > 0)) {
      return { ...noReaction(JUSTIFY.noSubstrate(card)), reagentId: card.id };
    }
  }
  const r = rule(g, card, o);
  if (r.noReaction) {
    return {
      major: [], mechanism: 'none', stereo: 'none', warnings: r.warnings, noReaction: true,
      justification: r.justification, reagentId: card.id,
    };
  }
  const stripped = r.major.map(stripExplicitH);
  const major = r.fragments ? stripped : dedupe(stripped);
  const minor = r.minor ? dedupe(r.minor.map(stripExplicitH)).filter((m) => !major.some((p) => sameProduct(p, m))) : undefined;
  return {
    major,
    ...(minor ? { minor } : {}),
    mechanism: r.mechanism,
    stereo: r.stereo,
    warnings: r.warnings,
    ...(r.noReaction ? { noReaction: true } : {}),
    justification: r.justification,
    ...(r.mixture !== undefined ? { mixture: r.mixture } : {}),
    reagentId: card.id,
  };
}

const _check: Pick<ChemApi, 'react'> = { react };
void _check;
