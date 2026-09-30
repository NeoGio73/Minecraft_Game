import { describe, it, expect } from 'vitest';
import { parseSmiles } from '@/chem/smiles';
import { perceiveAromaticity } from '@/chem/aromatic';
import { implicitHydrogens } from '@/chem/hydrogens';
import { functionalGroups, GROUP_NAME } from '@/chem/groups';
import { GROUP_IDS } from '@/chem/types';
import type { GroupHit } from '@/chem/types';

function groups(smiles: string): GroupHit[] {
  const g = perceiveAromaticity(parseSmiles(smiles).graph);
  return functionalGroups(g, implicitHydrogens(g).hydrogens);
}
const labels = (s: string) => groups(s).map((h) => h.label);
const atomsOf = (s: string, i: number) => [...groups(s)[i]!.atoms].sort((a, b) => a - b);

describe('functionalGroups', () => {
  it('FG1 carboxylic acid', () => {
    expect(labels('CC(=O)O')).toEqual(['carboxylic acid']);
    expect(atomsOf('CC(=O)O', 0)).toEqual([1, 2, 3]);
  });
  it('FG2 esters', () => {
    expect(labels('CC(=O)OCC')).toEqual(['ester']);
    expect(atomsOf('CC(=O)OCC', 0)).toEqual([1, 2, 3]);
    expect(labels('COC=O')).toEqual(['ester (formate)']);
    expect(atomsOf('COC=O', 0)).toEqual([1, 2, 3]);
  });
  it('FG3 anhydride', () => {
    expect(labels('CC(=O)OC(C)=O')).toEqual(['acid anhydride']);
    expect(atomsOf('CC(=O)OC(C)=O', 0)).toEqual([1, 2, 3, 4, 6]);
  });
  it('FG4 FG5 thioester and acid chloride', () => {
    expect(labels('CC(=O)SC')).toEqual(['thioester']);
    expect(atomsOf('CC(=O)SC', 0)).toEqual([1, 2, 3]);
    expect(labels('CC(=O)Cl')).toEqual(['acid chloride']);
    expect(atomsOf('CC(=O)Cl', 0)).toEqual([1, 2, 3]);
    expect(labels('CC(=O)Br')).toEqual(['acid bromide']);
  });
  it('FG6 amides', () => {
    expect(labels('CC(N)=O')).toEqual(['amide']);
    expect(atomsOf('CC(N)=O', 0)).toEqual([1, 2, 3]);
    expect(labels('CC(=O)NC')).toEqual(['amide']);
    expect(atomsOf('CC(=O)NC', 0)).toEqual([1, 2, 3]);
    expect(labels('CN(C)C=O')).toEqual(['amide']);
    expect(atomsOf('CN(C)C=O', 0)).toEqual([1, 3, 4]);
  });
  it('FG7 nitriles', () => {
    expect(labels('CC#N')).toEqual(['nitrile']);
    expect(atomsOf('CC#N', 0)).toEqual([1, 2]);
    expect(labels('C#N')).toEqual(['nitrile']);
    expect(atomsOf('C#N', 0)).toEqual([0, 1]);
  });
  it('FG8 aldehydes', () => {
    expect(labels('CC=O')).toEqual(['aldehyde']);
    expect(atomsOf('CC=O', 0)).toEqual([1, 2]);
    expect(labels('C=O')).toEqual(['aldehyde (formaldehyde)']);
    expect(atomsOf('C=O', 0)).toEqual([0, 1]);
  });
  it('FG9 ketones', () => {
    expect(labels('CC(C)=O')).toEqual(['ketone']);
    expect(atomsOf('CC(C)=O', 0)).toEqual([1, 3]);
    expect(labels('CCCC(C)=O')).toEqual(['ketone']);
    expect(atomsOf('CCCC(C)=O', 0)).toEqual([3, 5]);
    expect(labels('O=C1CCCCC1')).toEqual(['ketone']);
    expect(atomsOf('O=C1CCCCC1', 0)).toEqual([0, 1]);
  });
  it('FG10 FG11 imine and sulfoxide', () => {
    expect(labels('CC(C)=N')).toEqual(['imine']);
    expect(atomsOf('CC(C)=N', 0)).toEqual([1, 3]);
    expect(labels('C[S+](C)[O-]')).toEqual(['sulfoxide']);
    expect(atomsOf('C[S+](C)[O-]', 0)).toEqual([1, 3]);
  });
  it('FG12 alcohol subtypes claim only the O', () => {
    const cases: [string, string][] = [
      ['CO', 'alcohol (methanol)'], ['CCO', 'alcohol (primary)'], ['CC(C)O', 'alcohol (secondary)'],
      ['CC(C)(C)O', 'alcohol (tertiary)'], ['OC1CCCCC1', 'alcohol (secondary)'],
    ];
    for (const [s, l] of cases) {
      const hits = groups(s);
      expect(hits.map((h) => h.label), s).toEqual([l]);
      expect(hits[0]!.atoms.length).toBe(1);
      expect(hits[0]!.group).toBe('alcohol');
    }
  });
  it('FG13 FG14 FG15 phenol, enol, diol', () => {
    expect(labels('Oc1ccccc1')).toEqual(['phenol', 'arene']);
    expect(atomsOf('Oc1ccccc1', 0)).toEqual([0]);
    expect(atomsOf('Oc1ccccc1', 1)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(labels('C=CO')).toEqual(['enol', 'alkene']);
    expect(atomsOf('C=CO', 0)).toEqual([2]);
    expect(atomsOf('C=CO', 1)).toEqual([0, 1]);
    expect(labels('OCCO')).toEqual(['alcohol (primary)', 'alcohol (primary)']);
    expect(atomsOf('OCCO', 0)).toEqual([0]);
    expect(atomsOf('OCCO', 1)).toEqual([3]);
  });
  it('FG16 sulfur groups', () => {
    expect(labels('CCS')).toEqual(['thiol']);
    expect(atomsOf('CCS', 0)).toEqual([2]);
    expect(labels('CSC')).toEqual(['sulfide']);
    expect(atomsOf('CSC', 0)).toEqual([1]);
    expect(labels('CSSC')).toEqual(['disulfide']);
    expect(atomsOf('CSSC', 0)).toEqual([1, 2]);
  });
  it('FG17 ethers', () => {
    expect(labels('CCOCC')).toEqual(['ether']);
    expect(atomsOf('CCOCC', 0)).toEqual([2]);
    expect(labels('COc1ccccc1')).toEqual(['ether', 'arene']);
    expect(atomsOf('COc1ccccc1', 0)).toEqual([1]);
  });
  it('FG18 FG19 amines', () => {
    expect(labels('CN')).toEqual(['amine (primary)']);
    expect(labels('CNC')).toEqual(['amine (secondary)']);
    expect(labels('CN(C)C')).toEqual(['amine (tertiary)']);
    expect(labels('CCNC')).toEqual(['amine (secondary)']);
    expect(atomsOf('CCNC', 0)).toEqual([2]);
    expect(labels('Nc1ccccc1')).toEqual(['amine (aryl)', 'arene']);
    expect(atomsOf('Nc1ccccc1', 0)).toEqual([0]);
  });
  it('FG20 FG21 FG22 halides', () => {
    expect(labels('CCl')).toEqual(['alkyl halide (methyl)']);
    expect(labels('CCCl')).toEqual(['alkyl halide (primary)']);
    expect(labels('CC(C)Cl')).toEqual(['alkyl halide (secondary)']);
    expect(labels('CC(C)(C)Br')).toEqual(['alkyl halide (tertiary)']);
    expect(labels('CCC(C)Br')).toEqual(['alkyl halide (secondary)']);
    expect(atomsOf('CCC(C)Br', 0)).toEqual([4]);
    expect(labels('ClC(Cl)Cl')).toEqual(['alkyl halide (methyl) ×3']);
    expect(atomsOf('ClC(Cl)Cl', 0)).toEqual([0, 2, 3]);
    expect(labels('ClCCl')).toEqual(['alkyl halide (methyl) ×2']);
    expect(atomsOf('ClCCl', 0)).toEqual([0, 2]);
    expect(labels('Clc1ccccc1')).toEqual(['aryl halide', 'arene']);
    expect(labels('C=CCl')).toEqual(['vinyl halide', 'alkene']);
    expect(groups('C=CCl')[0]).toMatchObject({ group: 'halide', subtype: 'vinyl' });
    expect(labels('CC(F)(F)F')).toEqual(['alkyl halide (primary) ×3']);
  });
  it('FG23 arenes', () => {
    expect(labels('c1ccccc1')).toEqual(['arene']);
    expect(labels('C1=CC=CC=C1')).toEqual(['arene']);
    expect(labels('c1ccncc1')).toEqual(['arene']);
    expect(labels('c1ccc2ccccc2c1')).toEqual(['arene', 'arene']);
  });
  it('FG24 FG25 FG26 alkynes and alkenes', () => {
    expect(labels('C#C')).toEqual(['alkyne']);
    expect(labels('CC#C')).toEqual(['alkyne']);
    expect(labels('CC#CC')).toEqual(['alkyne']);
    expect(labels('CC=C')).toEqual(['alkene']);
    expect(labels('C=CC=C')).toEqual(['alkene', 'alkene']);
    expect(labels('C1CCC=CC1')).toEqual(['alkene']);
    expect(labels('C=CC=CC=C')).toEqual(['alkene', 'alkene', 'alkene']);
    expect(labels('CC=C=C')).toEqual(['alkene (cumulated)']);
    expect(atomsOf('CC=C=C', 0)).toEqual([1, 2]);
  });
  it('FG27 FG28 mixed pi systems', () => {
    expect(labels('C=Cc1ccccc1')).toEqual(['arene', 'alkene']);
    expect(atomsOf('C=Cc1ccccc1', 1)).toEqual([0, 1]);
    expect(labels('O=C1C=CC(=O)C=C1')).toEqual(['ketone', 'ketone', 'alkene', 'alkene']);
  });
  it('FG29 FG30 aspirin and acetaminophen', () => {
    expect(labels('CC(=O)Oc1ccccc1C(=O)O')).toEqual(['carboxylic acid', 'ester', 'arene']);
    expect(atomsOf('CC(=O)Oc1ccccc1C(=O)O', 0)).toEqual([10, 11, 12]);
    expect(atomsOf('CC(=O)Oc1ccccc1C(=O)O', 1)).toEqual([1, 2, 3]);
    expect(atomsOf('CC(=O)Oc1ccccc1C(=O)O', 2)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(labels('CC(=O)Nc1ccc(O)cc1')).toEqual(['amide', 'phenol', 'arene']);
    expect(atomsOf('CC(=O)Nc1ccc(O)cc1', 0)).toEqual([1, 2, 3]);
    expect(atomsOf('CC(=O)Nc1ccc(O)cc1', 1)).toEqual([8]);
  });
  it('FG31 bifunctional molecules', () => {
    expect(labels('CC(O)C(=O)O')).toEqual(['carboxylic acid', 'alcohol (secondary)']);
    expect(labels('CC(N)C(=O)O')).toEqual(['carboxylic acid', 'amine (primary)']);
    expect(labels('CC(O)CBr')).toEqual(['alcohol (secondary)', 'alkyl halide (primary)']);
  });
  it('FG32 FG33 ions', () => {
    expect(labels('CC(=O)[O-]')).toEqual(['carboxylate']);
    expect(labels('CC[O-]')).toEqual(['alkoxide']);
    expect(labels('CC[S-]')).toEqual(['thiolate']);
    expect(labels('C[NH3+]')).toEqual(['ammonium']);
    expect(labels('C[O+](C)C')).toEqual(['oxonium']);
    expect(labels('C[C+](C)C')).toEqual(['carbocation (tertiary)']);
    expect(labels('CC[C+]C')).toEqual(['carbocation (secondary)']);
    expect(labels('[CH3-]')).toEqual(['carbanion']);
    expect(labels('C[N-]C')).toEqual(['amide ion']);
    expect(labels('[C-]#C')).toEqual(['acetylide']);
    expect(atomsOf('[C-]#C', 0)).toEqual([0, 1]);
    expect(labels('[CH2+]C=C')).toEqual(['alkene', 'carbocation (primary)']);
    expect(labels('C=[C+]C')).toEqual(['carbocation (vinyl)']);
  });
  it('FG34 alkane fallback', () => {
    expect(labels('C')).toEqual(['alkane']);
    expect(labels('CCCCCC')).toEqual(['alkane']);
    expect(labels('C1CCCCC1')).toEqual(['cycloalkane']);
    expect(labels('C12C3CC1CC2C3')).toEqual(['cycloalkane']);
    expect(atomsOf('CCCCCC', 0)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(labels('C.CC')).toEqual(['alkane']);
  });
  it('FG35 molecules with no recognised group', () => {
    expect(labels('NC(N)=O')).toEqual([]);
    expect(labels('O')).toEqual([]);
    expect(labels('N')).toEqual([]);
    expect(labels('Cl')).toEqual([]);
    expect(labels('O=[N+]([O-])c1ccccc1')).toEqual(['arene']);
    expect(labels('COC(=O)OC')).toEqual([]);
    expect(labels('NC(=O)OC')).toEqual([]);
    expect(functionalGroups({ atoms: [], bonds: [], adj: [] }, [])).toEqual([]);
  });
  it('phosphate', () => {
    const hits = groups('COP(=O)([O-])[O-]');
    expect(hits[0]!.group).toBe('phosphate');
    expect([...hits[0]!.atoms].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(hits.length).toBe(1);
  });
  it('FG36 the fg.py 40-molecule set (DMSO written with charges; cyclohexane is a cycloalkane)', () => {
    const expected: [string, string[]][] = [
      ['CC(=O)O', ['carboxylic_acid']], ['CC(=O)OC', ['ester']], ['CC(=O)OCC', ['ester']], ['CC(N)=O', ['amide']],
      ['CC(=O)NC', ['amide']], ['CC(C)=O', ['ketone']], ['CC=O', ['aldehyde']], ['C=O', ['aldehyde']], ['OC=O', ['carboxylic_acid']],
      ['CCO', ['alcohol']], ['COC', ['ether']], ['CN', ['amine']], ['CN(C)C', ['amine']], ['CC#N', ['nitrile']],
      ['CC(O)C(=O)O', ['carboxylic_acid', 'alcohol']], ['CC(N)C(=O)O', ['carboxylic_acid', 'amine']],
      ['CC(O)CBr', ['alcohol', 'halide']], ['CC=C(C)Cl', ['halide', 'alkene']], ['c1ccccc1', ['arene']], ['C1CCC=CC1', ['alkene']],
      ['C#CC', ['alkyne']], ['CCCCCC', ['alkane']], ['C1CCCCC1', ['cycloalkane']], ['BrC1CCCCC1', ['halide']], ['CS', ['thiol']],
      ['CSC', ['sulfide']], ['CC(=O)OC(C)=O', ['acid_anhydride']], ['CC(=O)Cl', ['acid_chloride']], ['CC(C)=N', ['imine']],
      ['C[S+](C)[O-]', ['sulfoxide']], ['CSSC', ['disulfide']], ['CC(=O)SC', ['thioester']], ['O=C1CCCCC1', ['ketone']],
      ['BrC1CCCC=C1', ['halide', 'alkene']], ['C=CCC(=O)O', ['carboxylic_acid', 'alkene']], ['OCCO', ['alcohol', 'alcohol']],
      ['C1CO1', ['ether']], ['CCC(=O)CCC', ['ketone']], ['Oc1ccccc1', ['alcohol', 'arene']], ['CC(O)C=O', ['aldehyde', 'alcohol']],
    ];
    const fgName: Record<string, string> = {
      carboxylic_acid: 'carboxylic-acid', acid_anhydride: 'acid-anhydride', acid_chloride: 'acyl-halide',
    };
    for (const [s, names] of expected) {
      const ids = groups(s).map((h) => h.group);
      expect(ids, s).toEqual(names.map((nm) => fgName[nm] ?? nm));
    }
  });
  it('GROUP_NAME covers every GroupId', () => {
    for (const id of GROUP_IDS) expect(typeof GROUP_NAME[id]).toBe('string');
  });
});
