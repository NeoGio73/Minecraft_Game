import { describe, it, expect } from 'vitest';
import { REAGENT_IDS } from '@/content/types';
import type { ReagentId } from '@/content/types';
import { parseSmiles } from '@/chem/smiles';
import { REAGENT_CARDS } from '@/reactions/react';
import { cardById, enabledReagents, isReagentEnabled, loadReagents } from '@/content/reagents';
import { DEFAULT_CONFIG, loadFullRoster } from '@/content/challenges';
import { loadLibrary } from '@/content/library';
import { validateContent } from '@/content/validate';
import { loadRosterFile } from '@/content/challenges';

const cards = loadReagents();

describe('reagents.json (04 §2.1-2.2, 05 §11)', () => {
  it('every ReagentId has exactly one card, in REAGENT_IDS order', () => {
    expect(cards.map((c) => c.id)).toEqual([...REAGENT_IDS]);
    const seen = new Set<string>();
    for (const c of cards) {
      expect(seen.has(c.id)).toBe(false);
      seen.add(c.id);
    }
    expect(cards.length).toBe(56);
  });

  it('every card equals the canonical REAGENT_CARDS record of the reaction engine', () => {
    for (const c of cards) expect(c, c.id).toEqual(REAGENT_CARDS[c.id]);
  });

  it('SUBST_ELIM cards carry nuc and solvent; every fragment parses from the attaching atom', () => {
    for (const c of cards) {
      if (c.rule === 'SUBST_ELIM') {
        expect(c.nuc, c.id).toBeDefined();
        expect(c.solvent, c.id).toBeDefined();
      }
      if (c.nuc) {
        const g = parseSmiles(c.nuc.fragment).graph;
        expect(g.atoms[0]!.el, c.id).toBe(c.nuc.atom);
      }
    }
    expect(cards.filter((c) => c.nuc).length).toBe(17);
  });

  it('halogen is set on HX/X2/HOX/radical/ROH_TO_RX cards; diagonal cards are off', () => {
    const needs = new Set(['HX_ADD', 'X2_ADD', 'HOX_ADD', 'RADICAL_HBR', 'ALLYLIC_BROMINATION', 'RADICAL_HALOGENATION', 'ROH_TO_RX']);
    for (const c of cards) {
      if (needs.has(c.rule)) expect(c.halogen, c.id).toBeDefined();
      if (c.requiresDiagonalBonds) expect(c.enabledByDefault, c.id).toBe(false);
    }
  });

  it('enabledByDefault follows SCOPE.md', () => {
    const on = (id: ReagentId) => cardById(id).enabledByDefault;
    expect(on('HBR_ROOR')).toBe(true);
    expect(on('TBUOK')).toBe(true);
    for (const id of ['MCPBA', 'EPOXIDE_H3O', 'CH2I2_ZNCU', 'CHCL3_KOH'] as const) {
      expect(on(id), id).toBe(false);
      expect(cardById(id).requiresDiagonalBonds, id).toBe(true);
    }
    for (const id of ['KMNO4_COLD', 'HIO4', 'SN2_NAN3', 'SN2_NASH', 'SN2_NH3', 'SN2_NAOAC', 'ROH_HF_PYR', 'HCOOH_H2O', 'MEOH_HEAT'] as const) {
      expect(on(id), id).toBe(false);
    }
    expect(cardById('HBR_ROOR').notInMcMurry10e).toBe(true);
    expect(cardById('TBUOK').notInMcMurry10e).toBe(true);
    expect(cards.filter((c) => c.enabledByDefault).length).toBe(43);
  });

  it('cardById throws on an unknown id', () => {
    expect(() => cardById('NOPE' as ReagentId)).toThrow(/unknown reagent card/);
  });

  it('isReagentEnabled honours config.enabledReagents and diagonalBonds', () => {
    expect(isReagentEnabled(cardById('HX_HBR'), DEFAULT_CONFIG)).toBe(true);
    expect(isReagentEnabled(cardById('HX_HBR'), { ...DEFAULT_CONFIG, enabledReagents: ['HX_HCL'] })).toBe(false);
    expect(isReagentEnabled(cardById('KMNO4_COLD'), { ...DEFAULT_CONFIG, enabledReagents: ['KMNO4_COLD'] })).toBe(true);
    expect(isReagentEnabled(cardById('MCPBA'), { ...DEFAULT_CONFIG, enabledReagents: ['MCPBA'] })).toBe(false);
    expect(isReagentEnabled(cardById('MCPBA'), { ...DEFAULT_CONFIG, enabledReagents: ['MCPBA'], diagonalBonds: true })).toBe(true);
    expect(enabledReagents(DEFAULT_CONFIG).length).toBe(43);
  });

  it('every reagentId / options value in the roster is enabled by default', () => {
    for (const c of loadFullRoster()) {
      const r = c.rule;
      if (r.type === 'predict-product') expect(cardById(r.reagentId).enabledByDefault, c.id).toBe(true);
      if (r.type === 'choose-reagent') for (const id of r.options) expect(cardById(id).enabledByDefault, `${c.id} ${id}`).toBe(true);
    }
  });

  it('loadReagents returns a fresh array', () => {
    const a = loadReagents();
    const b = loadReagents();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('validateContent flags a card that drifts from REAGENT_CARDS or a missing card', () => {
    const lib = loadLibrary();
    const roster = loadRosterFile();
    const drifted = cards.map((c) => (c.id === 'HX_HBR' ? { ...c, halogen: 'Cl' as const } : c));
    expect(validateContent(lib, roster, drifted)).toContain('reagent:HX_HBR: card differs from REAGENT_CARDS in src/reactions/react.ts');
    const missing = cards.filter((c) => c.id !== 'OSO4');
    expect(validateContent(lib, roster, missing)).toContain('reagent:OSO4: expected exactly one card, found 0');
    const noNuc = cards.map((c) => {
      if (c.id !== 'SN2_NAI') return c;
      const { nuc: _n, ...rest } = c;
      void _n;
      return rest;
    });
    const p = validateContent(lib, roster, noNuc);
    expect(p).toContain('reagent:SN2_NAI: SUBST_ELIM card without nuc');
  });
});
