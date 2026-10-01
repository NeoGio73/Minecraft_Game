import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import type { MoleculeGraph, Mechanism } from '@/chem/types';
import type { ReagentId } from '@/content/types';
import { defaultCard } from '@/reactions/react';
import { baseOnly, decide } from '@/reactions/decision';
import type { DecisionRule } from '@/reactions/decision';
import { JUSTIFY, WARN, findCX } from '@/reactions/helpers';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;

function decideOn(smiles: string, id: ReagentId, cX?: number) {
  const g = parse(smiles);
  const c = cX ?? findCX(g)[0]?.c ?? 0;
  return decide(g, c, defaultCard(id));
}

interface Row {
  readonly tag: string;
  readonly smiles: string;
  readonly card: ReagentId;
  readonly mechanisms: readonly Mechanism[];
  readonly rule: DecisionRule;
  readonly justification?: string;
  readonly warnings?: readonly string[];
  readonly orientation?: 'zaitsev' | 'hofmann';
  readonly cX?: number;
}

const ROWS: readonly Row[] = [
  { tag: 'a', smiles: 'CCCC(C)Cl', card: 'SN2_NAOCH3', mechanisms: ['E2', 'SN2'], rule: 'R3', justification: JUSTIFY.R3_sec },
  { tag: 'b', smiles: 'C[C@H](Br)c1ccccc1', card: 'HCOOH_H2O', mechanisms: ['SN1', 'E1'], rule: 'R5', justification: JUSTIFY.R5_sn1 },
  { tag: 'c', smiles: 'CCC(Cl)c1ccccc1', card: 'SN2_NAOAC', mechanisms: ['SN1', 'E1'], rule: 'R4', justification: JUSTIFY.R4_sec_sn1 },
  { tag: 'd', smiles: 'BrCCCc1ccccc1', card: 'SN2_NAOCH3', mechanisms: ['SN2', 'E2'], rule: 'R3', justification: JUSTIFY.R3_prim },
  { tag: 'e', smiles: 'BrC1CCCCC1', card: 'SN2_ACETYLIDE', mechanisms: ['E2'], rule: 'R3', justification: JUSTIFY.R3_sec_baseOnly, warnings: [WARN.ringConformation] },
  { tag: 'e2', smiles: 'CCC(C)Br', card: 'NANH2_BASE', mechanisms: ['E2'], rule: 'R3', justification: JUSTIFY.R3_sec_baseOnly, warnings: [] },
  { tag: 'f', smiles: 'CC(C)(C)Br', card: 'H2O_HEAT', mechanisms: ['SN1', 'E1'], rule: 'R5', justification: JUSTIFY.R5_sn1 },
  { tag: 'g', smiles: 'CC(C)(C)Br', card: 'SN2_NAOH', mechanisms: ['E2'], rule: 'R3', justification: JUSTIFY.R3_tert },
  { tag: 'h', smiles: 'CC(C)(C)Br', card: 'SN2_NAOCH3', mechanisms: ['E2'], rule: 'R3' },
  { tag: 'i', smiles: 'CC(C)(C)Br', card: 'SN2_NAI', mechanisms: [], rule: 'R4', justification: JUSTIFY.R4_tert_aprotic },
  { tag: 'j', smiles: 'CCCCBr', card: 'H2O_HEAT', mechanisms: [], rule: 'R5', justification: JUSTIFY.R5_primary },
  { tag: 'k', smiles: 'CCCCBr', card: 'SN2_NACN', mechanisms: ['SN2'], rule: 'R4', justification: JUSTIFY.R4_prim },
  { tag: 'l', smiles: 'CBr', card: 'TBUOK', mechanisms: ['SN2'], rule: 'R3', justification: JUSTIFY.R3_methyl, orientation: 'hofmann' },
  { tag: 'm', smiles: 'CCC(C)(C)Br', card: 'TBUOK', mechanisms: ['E2'], rule: 'R3', orientation: 'hofmann' },
  { tag: 'n', smiles: 'CC(C)(C)CBr', card: 'SN2_NAOH', mechanisms: [], rule: 'R3', justification: JUSTIFY.noBetaH },
  { tag: 'o', smiles: 'C=CCl', card: 'SN2_NAOH', mechanisms: [], rule: 'R1', justification: JUSTIFY.R1 },
  { tag: 'p', smiles: 'Clc1ccccc1', card: 'SN2_NAOH', mechanisms: [], rule: 'R1', justification: JUSTIFY.R1 },
  { tag: 'q', smiles: 'CCCCF', card: 'SN2_NAI', mechanisms: [], rule: 'R2', justification: JUSTIFY.R2 },
  { tag: 'r', smiles: 'CCCCO', card: 'SN2_NAOH', mechanisms: [], rule: 'R0', justification: JUSTIFY.R0, cX: 3 },
  { tag: 's', smiles: 'C=CCBr', card: 'H2O_HEAT', mechanisms: ['SN1'], rule: 'R5', justification: JUSTIFY.R5_allylic },
  { tag: 't', smiles: 'CCC(C)Br', card: 'SN2_NAI', mechanisms: ['SN2'], rule: 'R4', justification: JUSTIFY.R4_sec_sn2, warnings: [] },
  { tag: 'u', smiles: 'CCC(C)Br', card: 'SN2_NASH', mechanisms: ['SN2'], rule: 'R4', justification: JUSTIFY.R4_sec_sn2, warnings: [WARN.proticSlow] },
  { tag: 'v', smiles: 'CCC(C)Br', card: 'ETOH_HEAT', mechanisms: ['SN1', 'E1'], rule: 'R5', justification: JUSTIFY.R5_sec_slow, warnings: [WARN.slowSolvolysis] },
  { tag: 'w', smiles: 'O=CCCBr', card: 'SN2_NAOH', mechanisms: ['SN2', 'E2'], rule: 'R3', justification: JUSTIFY.R3_prim, warnings: [WARN.e1cb] },
  { tag: 'x', smiles: 'C(Br)(c1ccccc1)(c1ccccc1)c1ccccc1', card: 'SN2_NAOH', mechanisms: ['SN1'], rule: 'R3', justification: JUSTIFY.R3_tert_sn1 },
  { tag: 'y', smiles: 'BrC(c1ccccc1)c1ccccc1', card: 'NANH2_BASE', mechanisms: [], rule: 'R3', justification: JUSTIFY.noBetaH },
];

describe('04 section 9.2 decision table', () => {
  for (const row of ROWS) {
    it(`${row.tag}: ${row.smiles} + ${row.card} -> [${row.mechanisms.join(', ')}] ${row.rule}`, () => {
      const d = decideOn(row.smiles, row.card, row.cX);
      expect(d.mechanisms).toEqual(row.mechanisms);
      expect(d.rule).toBe(row.rule);
      if (row.justification !== undefined) expect(d.justification).toBe(row.justification);
      if (row.warnings !== undefined) expect(d.warnings).toEqual(row.warnings);
      if (row.orientation !== undefined) expect(d.orientation).toBe(row.orientation);
    });
  }
  it('R3 bulky primary and neopentyl rows; R4 tertiary protic; R3 secondary bulky', () => {
    expect(decideOn('CCCCBr', 'TBUOK')).toMatchObject({ mechanisms: ['E2'], rule: 'R3', justification: JUSTIFY.R3_bulky, orientation: 'hofmann' });
    const neo = decideOn('CC(C)(C)CBr', 'SN2_NAOH');
    expect(neo.rule).toBe('R3');
    expect(decideOn('CC(C)(C)Br', 'SN2_NAOAC')).toMatchObject({ mechanisms: ['SN1', 'E1'], rule: 'R4', justification: JUSTIFY.R4_tert_protic });
    expect(decideOn('CCC(C)Br', 'TBUOK')).toMatchObject({ mechanisms: ['E2'], rule: 'R3', justification: JUSTIFY.R3_sec_bulky });
    // R3_neopentyl lists [E2], but a neopentyl carbon has no beta hydrogen: the post-filter empties it
    expect(decideOn('CCC(C)(C)CBr', 'SN2_NAOH')).toMatchObject({ mechanisms: [], rule: 'R3', justification: JUSTIFY.noBetaH });
    expect(JUSTIFY.R3_neopentyl).toContain('neopentyl');
  });
  it('baseOnly is exactly amide and acetylide among the cards', () => {
    const ids: ReagentId[] = ['SN2_NAOH', 'SN2_NAOCH3', 'SN2_NAOET', 'SN2_NAI', 'SN2_NACN', 'SN2_NAN3', 'SN2_NASH', 'SN2_NH3', 'SN2_NAOAC', 'SN2_ACETYLIDE', 'TBUOK', 'NANH2_BASE', 'KOH_ETOH', 'H2O_HEAT', 'ETOH_HEAT', 'MEOH_HEAT', 'HCOOH_H2O'];
    const only = ids.filter((id) => baseOnly(defaultCard(id).nuc!));
    expect(only).toEqual(['SN2_ACETYLIDE', 'NANH2_BASE']);
  });
  it('decide on a card without nuc throws (structural misuse); the contract shape is present', () => {
    expect(() => decide(parse('CCBr'), 1, defaultCard('HX_HBR'))).toThrow();
    const d = decideOn('CCBr', 'SN2_NAOH');
    const contract: { mechanisms: Mechanism[]; rule: 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6'; justification: string } = d;
    expect(contract.mechanisms).toEqual(['SN2', 'E2']);
  });
});
