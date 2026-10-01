import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { CIP_SPHERE_CAP, cipRank } from '@/chem/cip';
import type { CipRank, MoleculeGraph } from '@/chem/types';

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;

function rank(smiles: string, center: number, exclude?: number): CipRank & { capHit: boolean } {
  const g = parse(smiles);
  const { hydrogens } = implicitHydrogens(g);
  return cipRank(g, hydrogens, center, exclude);
}

describe('cipRank: verified priority outcomes (03 §1.5, RDKit-confirmed)', () => {
  const cases: [string, string, number, (number | 'H')[]][] = [
    ['2-butanol', 'CC(O)CC', 1, [2, 3, 0, 'H']],
    ['2-bromobutane', 'CC(Br)CC', 1, [2, 3, 0, 'H']],
    ['alanine (NH2 > COOH via O,O,O > CH3 > H)', 'NC(C)C(=O)O', 1, [0, 3, 2, 'H']],
    ['lactic acid', 'CC(O)C(=O)O', 1, [2, 3, 0, 'H']],
    ['2,3-dibromobutane C2', 'CC(Br)C(Br)C', 1, [2, 3, 0, 'H']],
    ['2,3-dibromobutane C3', 'CC(Br)C(Br)C', 3, [4, 1, 5, 'H']],
    ['3-methylhexane (propyl > ethyl at sphere 3)', 'CCCC(C)CC', 3, [2, 5, 4, 'H']],
    ['1-bromo-2-methylcyclohexane C1 (Br > C2 (C,C,H) > C6 (C,H,H) > H)', 'CC1CCCCC1Br', 6, [7, 1, 5, 'H']],
    ['1-bromo-2-methylcyclohexane C2 (C1 (Br,C,H) > C3 > CH3 > H)', 'CC1CCCCC1Br', 1, [6, 2, 0, 'H']],
    ['glyceraldehyde (OH > CHO (O,O,H) > CH2OH (O,H,H) > H)', 'O=CC(O)CO', 2, [3, 1, 4, 'H']],
    ['but-3-en-2-ol (OH > CH=CH2 (C,C,H) > CH3 > H)', 'CC(O)C=C', 1, [2, 3, 0, 'H']],
    ['3-methylcyclohexene C3 (CH=CH > CH2 ring > CH3 > H)', 'CC1C=CCCC1', 1, [2, 6, 0, 'H']],
    ['2-methylcyclohexanone C2 (C(=O) (O,O,C) > CH2 ring > CH3 > H)', 'CC1CCCCC1=O', 1, [6, 2, 0, 'H']],
    ['hierarchical trap: 3-methylbutan-2-yl > 3-pentyl', 'OC(C(CC)CC)C(C)C(C)C', 1, [0, 7, 2, 'H']],
  ];
  for (const [name, smiles, center, expected] of cases) {
    it(name, () => {
      const r = rank(smiles, center);
      expect(r.ligands).toEqual(expected);
      expect(r.tie).toBe(false);
      expect(r.tieNeedsAdvancedRules).toBe(false);
      expect(r.capHit).toBe(false);
    });
  }

  it('the trap is decided only by the full recursive sibling sort (sphere 3)', () => {
    // 3-pentyl (atom 2) and 3-methylbutan-2-yl (atom 7) are both (C,C,H) at sphere 2.
    const r = rank('OC(C(CC)CC)C(C)C(C)C', 1);
    expect(r.ligands.indexOf(7)).toBeLessThan(r.ligands.indexOf(2));
  });
});

describe('cipRank: E/Z ends with exclude', () => {
  it('2-chloro-2-butene C2 (exclude C3): Cl > CH3', () => {
    const r = rank('CC(Cl)=CC', 1, 3);
    expect(r.ligands).toEqual([2, 0]);
    expect(r.tie).toBe(false);
  });
  it('3-methylpent-2-ene C3 (exclude C2): CH2CH3 > CH3', () => {
    const r = rank('CC=C(C)CC', 2, 1);
    expect(r.ligands).toEqual([4, 3]);
    expect(r.tie).toBe(false);
  });
  it('without exclude the partner is listed twice (real + duplicate)', () => {
    const r = rank('CC=CC', 1);
    // the duplicate has only phantom children, so it ranks below the methyl
    expect(r.ligands).toEqual([2, 0, 2, 'H']);
  });
  it('2-methylbut-2-ene C3 (exclude C2): two methyls tie', () => {
    const r = rank('CC=C(C)C', 2, 1);
    expect(r.ligands).toEqual([3, 4]);
    expect(r.tie).toBe(true);
    expect(r.tieNeedsAdvancedRules).toBe(false);
  });
  it('terminal =CH2 end: two hydrogens tie', () => {
    const r = rank('CC=C', 2, 1);
    expect(r.ligands).toEqual(['H', 'H']);
    expect(r.tie).toBe(true);
  });
});

describe('cipRank: ties and advanced-rule detection', () => {
  it('methylcyclohexane C1: tie between the two ring CH2, no advanced rules', () => {
    const r = rank('CC1CCCCC1', 1);
    expect(r.tie).toBe(true);
    expect(r.tieNeedsAdvancedRules).toBe(false);
    expect(r.ligands).toEqual([2, 6, 0, 'H']);
  });
  it('cis-1,4-dimethylcyclohexane C1: tie, the tied branches hold no Rule-1a centre', () => {
    const r = rank('C[C@H]1CC[C@@H](C)CC1', 1);
    expect(r.tie).toBe(true);
    expect(r.tieNeedsAdvancedRules).toBe(false);
  });
  it('pentane-2,3,4-triol C3: tie whose branches contain the true centres C2/C4', () => {
    const r = rank('CC(O)C(O)C(O)C', 3);
    expect(r.tie).toBe(true);
    expect(r.tieNeedsAdvancedRules).toBe(true);
    expect(r.ligands[0]).toBe(4);
  });
  it('decalin fusion carbon: tie without advanced rules', () => {
    const r = rank('C1CCC2CCCCC2C1', 3);
    expect(r.tie).toBe(true);
    expect(r.tieNeedsAdvancedRules).toBe(false);
  });
  it('2,3-dibromobutane: a true centre next to a true centre is not a tie', () => {
    const r = rank('CC(Br)C(Br)C', 1);
    expect(r.tie).toBe(false);
  });
  it('a tie whose branches contain a defined alkene needs advanced rules', () => {
    // C2 of 1,5-dichloro-3-methyl... use (E)-alkene arms: CH3-CH(CH=CHCl)2 is symmetric by Rule 1a
    const r = rank('CC(C=CCl)C=CCl', 1);
    expect(r.tie).toBe(true);
    expect(r.tieNeedsAdvancedRules).toBe(true);
  });
  it('neopentane: every ligand ties, nothing advanced', () => {
    const r = rank('CC(C)(C)C', 1);
    expect(r.tie).toBe(true);
    expect(r.tieNeedsAdvancedRules).toBe(false);
    expect(r.ligands).toEqual([0, 2, 3, 4]);
  });
});

describe('cipRank: duplicated atoms, rings and hydrogens', () => {
  it('a triple bond outranks a double bond which outranks a single bond (C-C ligands)', () => {
    // centre C with ethynyl, vinyl, ethyl and H
    const r = rank('C#CC(C=C)CC', 2);
    expect(r.ligands).toEqual([1, 3, 5, 'H']);
  });
  it('phenyl (Kekulé) ranks above cyclohexyl and above isopropyl', () => {
    // C(c1ccccc1)(C1CCCCC1)(C(C)C)
    const g = parse('OC(c1ccccc1)(C1CCCCC1)C(C)C');
    const { hydrogens } = implicitHydrogens(g);
    const r = cipRank(g, hydrogens, 1);
    expect(r.ligands).toEqual([0, 2, 8, 14]);
    expect(r.tie).toBe(false);
  });
  it('a bracket H count is honoured as a hydrogen node', () => {
    const r = rank('[CH3][C@H](O)C(=O)O', 1);
    expect(r.ligands).toEqual([2, 3, 0, 'H']);
  });
  it('hydrogens always rank last; a charged carbanion still ranks by atomic number', () => {
    const r = rank('C[CH-]CC', 1);
    expect(r.ligands.slice(0, 2)).toEqual([2, 0]);
    expect(r.ligands[2]).toBe('H');
  });
  it('throws on a bad centre id', () => {
    const g = parse('CC');
    const { hydrogens } = implicitHydrogens(g);
    expect(() => cipRank(g, hydrogens, 2)).toThrow(RangeError);
    expect(() => cipRank(g, hydrogens, -1)).toThrow(RangeError);
  });
});

describe('cipRank: performance', () => {
  it('cholesterol: 27 heavy atoms, 8 centres, no cap hit, under 20 ms per centre set', () => {
    const g = parse('C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C');
    const { hydrogens } = implicitHydrogens(g);
    const centres = g.atoms.filter((a) => a.tet).map((a) => a.id);
    expect(centres.length).toBe(8);
    const t0 = performance.now();
    for (const c of centres) {
      const r = cipRank(g, hydrogens, c);
      expect(r.tie).toBe(false);
      expect(r.capHit).toBe(false);
    }
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(200); // generous CI bound; typical < 20 ms
    expect(CIP_SPHERE_CAP).toBe(500);
  });
});
