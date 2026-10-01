import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { components } from '@/chem/graph';
import { degreesOfUnsaturation, elementCounts, hillFormula, netCharge, piBondCount, ringCount, chargeSuffix } from '@/chem/formula';
import type { MoleculeGraph } from '@/chem/types';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;
function analyse(s: string) {
  const g = parse(s);
  const { hydrogens, warnings } = implicitHydrogens(g);
  const counts = elementCounts(g, hydrogens);
  return {
    g, warnings, counts,
    formula: hillFormula(g, hydrogens),
    dou: degreesOfUnsaturation(counts),
    rings: ringCount(g),
    pi: piBondCount(g),
    components: components(g).length,
  };
}

const LIB_CSV = new URL('../../tools/reference/lib.csv', import.meta.url);
const MOLECULES_JSON = new URL('../../src/content/molecules.json', import.meta.url);

describe('formula.ts', () => {
  it('F1 aspirin', () => {
    const r = analyse('CC(=O)Oc1ccccc1C(=O)O');
    expect(r.formula).toBe('C9H8O4');
    expect(r.dou).toBe(6);
    expect(r.rings).toBe(1);
    expect(r.pi).toBe(5);
  });
  it('F2 urea', () => {
    const r = analyse('NC(N)=O');
    expect([r.formula, r.dou, r.rings, r.pi]).toEqual(['CH4N2O', 1, 0, 1]);
  });
  it('F3 halomethanes', () => {
    expect(analyse('ClC(Cl)Cl').formula).toBe('CHCl3');
    expect(analyse('ClCCl').formula).toBe('CH2Cl2');
    expect(analyse('ClC(Cl)Cl').dou).toBe(0);
    expect(analyse('ClCCl').dou).toBe(0);
  });
  it('F4 no-carbon molecules print H first, then alphabetical', () => {
    expect(analyse('O').formula).toBe('H2O');
    expect(analyse('N').formula).toBe('H3N');
    expect(analyse('Cl').formula).toBe('HCl');
    expect(analyse('Br').formula).toBe('HBr');
    for (const s of ['O', 'N', 'Cl', 'Br']) expect(analyse(s).dou).toBe(0);
  });
  it('F4b H2S, PH3, SO2', () => {
    expect(analyse('S').formula).toBe('H2S');
    expect(analyse('P').formula).toBe('H3P');
    expect(analyse('P').dou).toBe(-0.5);
    const so2 = analyse('O=S=O');
    expect(so2.formula).toBe('O2S');
    expect(so2.dou).toBe(1);
    expect(so2.pi).toBe(2);
    expect(so2.warnings).toEqual([{ kind: 'over-valence', atom: 1, have: 4, max: 2 }]);
  });
  it('F4c simple ions', () => {
    expect(analyse('[OH-]').formula).toBe('HO-');
    expect(analyse('[NH4+]').formula).toBe('H4N+');
    expect(analyse('[Cl-]').formula).toBe('Cl-');
    expect(analyse('[OH-]').dou).toBe(0.5);
    expect(analyse('[NH4+]').dou).toBe(-0.5);
    expect(analyse('[Cl-]').dou).toBe(0.5);
  });
  it('F5 organic ions', () => {
    const cases: [string, string, number, number][] = [
      ['C[O-]', 'CH3O-', 0.5, 0], ['C[NH3+]', 'CH6N+', -0.5, 0], ['CC(=O)[O-]', 'C2H3O2-', 1.5, 1],
      ['C[C+](C)C', 'C4H9+', 0.5, 0], ['[C-]#C', 'C2H-', 2.5, 2],
    ];
    for (const [s, f, dou, pi] of cases) {
      const r = analyse(s);
      expect(r.formula).toBe(f);
      expect(r.dou).toBe(dou);
      expect(r.pi).toBe(pi);
      expect(r.rings).toBe(0);
    }
    expect(netCharge(parse('C[NH3+]'))).toBe(1);
    expect(netCharge(parse('[O-]C(=O)C(=O)[O-]'))).toBe(-2);
    expect(hillFormula(parse('[O-]C(=O)C(=O)[O-]'), implicitHydrogens(parse('[O-]C(=O)C(=O)[O-]')).hydrogens)).toBe('C2O42-');
    expect(chargeSuffix(2)).toBe('2+');
  });
  it('F6-F10 rings, nitro, cage, ibuprofen, components', () => {
    const naph = analyse('c1ccc2ccccc2c1');
    expect([naph.formula, naph.dou, naph.rings, naph.pi]).toEqual(['C10H8', 7, 2, 5]);
    const nitro = analyse('O=[N+]([O-])c1ccccc1');
    expect([nitro.formula, nitro.dou, nitro.rings, nitro.pi]).toEqual(['C6H5NO2', 5, 1, 4]);
    const cage = analyse('C12C3CC1CC2C3');
    expect([cage.formula, cage.dou, cage.rings, cage.pi]).toEqual(['C7H10', 3, 3, 0]);
    const ibu = analyse('CC(C)Cc1ccc(cc1)C(C)C(=O)O');
    expect([ibu.formula, ibu.dou, ibu.rings, ibu.pi]).toEqual(['C13H18O2', 5, 1, 4]);
    const two = analyse('C.C');
    // dou is computed from counts alone: (2*2 + 2 - 8) / 2 = -1 for two methanes (one component assumed by the formula)
    expect([two.formula, two.components, two.dou, two.rings]).toEqual(['C2H8', 2, -1, 0]);
  });
  it('elementCounts has every element key', () => {
    const counts = analyse('C').counts;
    expect(Object.keys(counts).sort()).toEqual(['Br', 'C', 'Cl', 'F', 'H', 'I', 'N', 'O', 'P', 'S']);
    expect(counts.C).toBe(1);
    expect(counts.H).toBe(4);
  });
  it('empty graph', () => {
    const g: MoleculeGraph = { atoms: [], bonds: [], adj: [] };
    expect(hillFormula(g, [])).toBe('');
    expect(ringCount(g)).toBe(0);
    expect(degreesOfUnsaturation(elementCounts(g, []))).toBe(1);
  });
  it('F11 reference library: formula equals RDKit and dou = rings + pi for neutral molecules', () => {
    const rows = readFileSync(LIB_CSV, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => l.split(','));
    expect(rows.length).toBeGreaterThan(100);
    for (const row of rows) {
      const smiles = row[2]!.replace(/\\\\/g, '\\');
      const r = analyse(smiles);
      expect(r.formula, smiles).toBe(row[1]);
      if (netCharge(r.g) === 0) expect(r.dou, smiles).toBe(r.rings + r.pi);
    }
    if (existsSync(MOLECULES_JSON)) {
      type Entry = { id: string; smiles: string; formula: string };
      const parsed = JSON.parse(readFileSync(MOLECULES_JSON, 'utf8')) as Entry[] | { entries: Entry[] };
      const entries = Array.isArray(parsed) ? parsed : parsed.entries;
      for (const e of entries) {
        const r = analyse(e.smiles);
        expect(r.formula, e.id).toBe(e.formula);
        if (netCharge(r.g) === 0) expect(r.dou, e.id).toBe(r.rings + r.pi);
      }
    }
  });
});
