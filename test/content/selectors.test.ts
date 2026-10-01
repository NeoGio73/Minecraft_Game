import { describe, it, expect } from 'vitest';
import { analyze } from '@/chem/analyze';
import type { Analysis, MoleculeGraph } from '@/chem/types';
import { loadLibrary, parseEntry } from '@/content/library';
import { challengeById } from '@/content/challenges';
import { answerSet, itemKey, normalizeSelection } from '@/content/selectors';
import type { SelectionItem } from '@/content/selectors';
import type { SelectAtomRule, Selector } from '@/content/types';

loadLibrary();

function prep(smiles: readonly string[]): { graphs: MoleculeGraph[]; analyses: Analysis[] } {
  const graphs = smiles.map(parseEntry);
  return { graphs, analyses: graphs.map((g) => analyze(g)) };
}

function keys(items: readonly SelectionItem[]): string[] {
  return items.map(itemKey).sort();
}

function rosterRule(id: string): SelectAtomRule {
  const c = challengeById(id);
  if (!c || c.rule.type !== 'select-atom') throw new Error(id);
  return c.rule;
}

function rosterAnswer(id: string): string[] {
  const rule = rosterRule(id);
  const { graphs, analyses } = prep(rule.molecules);
  return keys(answerSet(rule.selector, graphs, analyses));
}

describe('answerSet per Selector.kind (05 §8)', () => {
  it('hybridization: the two sp2 carbons of propene', () => {
    expect(rosterAnswer('ch1-select-sp2-propene')).toEqual(['0:0', '0:1']);
    const { graphs, analyses } = prep(['C#CCC']);
    expect(keys(answerSet({ kind: 'hybridization', value: 'sp', el: 'C' }, graphs, analyses))).toEqual(['0:0', '0:1']);
    expect(keys(answerSet({ kind: 'hybridization', value: 'sp3' }, graphs, analyses))).toEqual(['0:2', '0:3']);
    const amide = prep(['CC(N)=O']);
    expect(keys(answerSet({ kind: 'hybridization', value: 'sp2', el: 'N' }, amide.graphs, amide.analyses))).toEqual(['0:2']);
  });

  it('electrophilic-carbon: the carbon bonded to chlorine (and a carbonyl carbon)', () => {
    expect(rosterAnswer('ch2-select-electrophilic-carbon-chloromethane')).toEqual(['0:0']);
    const { graphs, analyses } = prep(['CC(C)=O']);
    expect(keys(answerSet({ kind: 'electrophilic-carbon' }, graphs, analyses))).toEqual(['0:1']);
  });

  it('most-acidic-h: the O-H of ethanol; the global tie class across the scene; both central H of pentane-2,4-dione', () => {
    expect(rosterAnswer('ch2-select-most-acidic-h-ethanol')).toEqual(['0:2:0']);
    expect(rosterAnswer('ch2-select-most-acidic-h-acetic-acid-vs-ethanol')).toEqual(['0:3:0']);
    expect(rosterAnswer('ch2-select-most-acidic-h-2-mercaptoethanol')).toEqual(['0:3:0']);
    expect(rosterAnswer('ch2-select-most-acidic-h-pentane-2-4-dione')).toEqual(['0:3:0', '0:3:1']);
    expect(rosterAnswer('ch2-select-most-acidic-h-2-ammonioethanol')).toEqual(['0:3:0', '0:3:1', '0:3:2']);
    expect(rosterAnswer('ch9-select-most-acidic-h-propyne')).toEqual(['0:0:0']);
    const { graphs, analyses } = prep(['CCO', 'CCO']);
    expect(keys(answerSet({ kind: 'most-acidic-h' }, graphs, analyses))).toEqual(['0:2:0', '1:2:0']);
  });

  it('most-basic-site and most-basic-n', () => {
    expect(rosterAnswer('ch2-select-most-basic-site-2-aminoethanol')).toEqual(['0:3']);
    expect(rosterAnswer('ch2-select-most-basic-n-3-aminopropanamide')).toEqual(['0:0']);
    const { graphs, analyses } = prep(['NCCC(N)=O']);
    // without the N restriction the amine N is still the most basic site
    expect(keys(answerSet({ kind: 'most-basic-site' }, graphs, analyses))).toEqual(['0:0']);
    const ether = prep(['COC']);
    expect(keys(answerSet({ kind: 'most-basic-n' }, ether.graphs, ether.analyses))).toEqual([]);
  });

  it('lone-pair-atom: the ether oxygen; tertiary-carbon: C2 of 2-methylbutane', () => {
    expect(rosterAnswer('ch2-select-lewis-base-dimethyl-ether')).toEqual(['0:1']);
    expect(rosterAnswer('ch3-select-tertiary-carbon-2-methylbutane')).toEqual(['0:2']);
    const { graphs, analyses } = prep(['CC(C)(C)C']);
    expect(keys(answerSet({ kind: 'tertiary-carbon' }, graphs, analyses))).toEqual([]);
    const sp2 = prep(['CC(C)=CC']);
    expect(keys(answerSet({ kind: 'tertiary-carbon' }, sp2.graphs, sp2.analyses))).toEqual([]);
  });

  it('chirality-center: C2 of butan-2-ol; none in propan-2-ol; both centres of 2,3-dibromobutane', () => {
    expect(rosterAnswer('ch5-select-chirality-center-butan-2-ol')).toEqual(['0:2']);
    const { graphs, analyses } = prep(['CC(C)O']);
    expect(keys(answerSet({ kind: 'chirality-center' }, graphs, analyses))).toEqual([]);
    const di = prep(['CC(Br)C(Br)C']);
    expect(keys(answerSet({ kind: 'chirality-center' }, di.graphs, di.analyses))).toEqual(['0:1', '0:3']);
    const tagged = prep(['C[C@@H](Br)CC']);
    expect(keys(answerSet({ kind: 'chirality-center' }, tagged.graphs, tagged.analyses))).toEqual(['0:1']);
  });

  it('more-substituted-alkene-carbon: C2 of 2-methylpropene; nothing for a symmetric alkene', () => {
    expect(rosterAnswer('ch7-select-carbocation-carbon-2-methylpropene')).toEqual(['0:1']);
    const { graphs, analyses } = prep(['C/C=C/C']);
    expect(keys(answerSet({ kind: 'more-substituted-alkene-carbon' }, graphs, analyses))).toEqual([]);
    const two = prep(['C=CC(C)=C']);
    expect(keys(answerSet({ kind: 'more-substituted-alkene-carbon' }, two.graphs, two.analyses))).toEqual(['0:1', '0:2']);
  });

  it('fewest-carbon-substituents-cx: every atom of bromomethane', () => {
    expect(rosterAnswer('ch11-select-fastest-sn2-substrate')).toEqual(['0:0', '0:1']);
    const { graphs, analyses } = prep(['CC(C)Br', 'CCCCBr', 'CC(C)(C)Br']);
    expect(keys(answerSet({ kind: 'fewest-carbon-substituents-cx' }, graphs, analyses))).toEqual(['1:0', '1:1', '1:2', '1:3', '1:4']);
    const none = prep(['CCO']);
    expect(keys(answerSet({ kind: 'fewest-carbon-substituents-cx' }, none.graphs, none.analyses))).toEqual([]);
  });

  it('atom-ids: ids of molecules[0] in parseSmiles order; out-of-range ids are dropped', () => {
    const { graphs, analyses } = prep(['CCO', 'CC']);
    const sel: Selector = { kind: 'atom-ids', ids: [2, 0, 7] };
    expect(keys(answerSet(sel, graphs, analyses))).toEqual(['0:0', '0:2']);
  });

  it('every roster select-atom answer set is non-empty and never every atom for match all', () => {
    for (const id of [
      'ch1-select-sp2-propene', 'ch2-select-electrophilic-carbon-chloromethane', 'ch2-select-lewis-base-dimethyl-ether',
      'ch3-select-tertiary-carbon-2-methylbutane', 'ch5-select-chirality-center-butan-2-ol', 'ch7-select-carbocation-carbon-2-methylpropene',
    ]) {
      const rule = rosterRule(id);
      const { graphs, analyses } = prep(rule.molecules);
      const A = answerSet(rule.selector, graphs, analyses);
      expect(A.length, id).toBeGreaterThan(0);
      expect(A.length, id).toBeLessThan(graphs.reduce((n, g) => n + g.atoms.length, 0));
    }
  });
});

describe('normalizeSelection and itemKey', () => {
  it('heavy-atom fallback expands to every H slot; an atom without H gives no-hydrogens', () => {
    const { analyses } = prep(['CCO']);
    expect(normalizeSelection([{ molecule: 0, atom: 0 }], 'hydrogens', analyses)).toEqual([
      { molecule: 0, atom: 0, hSlot: 0 }, { molecule: 0, atom: 0, hSlot: 1 }, { molecule: 0, atom: 0, hSlot: 2 },
    ]);
    expect(normalizeSelection([{ molecule: 0, atom: 2 }], 'hydrogens', analyses)).toEqual([{ molecule: 0, atom: 2, hSlot: 0 }]);
    const ether = prep(['COC']);
    expect(normalizeSelection([{ molecule: 0, atom: 1 }], 'hydrogens', ether.analyses)).toBe('no-hydrogens');
    expect(normalizeSelection([{ molecule: 0, atom: 0, hSlot: 1 }, { molecule: 0, atom: 1 }], 'hydrogens', ether.analyses)).toBe('no-hydrogens');
  });

  it("'atoms' drops hSlot and removes duplicates; explicit hSlots are kept", () => {
    const { analyses } = prep(['CCO']);
    expect(normalizeSelection([{ molecule: 0, atom: 2, hSlot: 0 }, { molecule: 0, atom: 2 }], 'atoms', analyses)).toEqual([{ molecule: 0, atom: 2 }]);
    expect(normalizeSelection([{ molecule: 0, atom: 2, hSlot: 0 }, { molecule: 0, atom: 2, hSlot: 0 }], 'hydrogens', analyses)).toEqual([{ molecule: 0, atom: 2, hSlot: 0 }]);
    expect(normalizeSelection([], 'hydrogens', analyses)).toEqual([]);
  });

  it('itemKey', () => {
    expect(itemKey({ molecule: 1, atom: 2 })).toBe('1:2');
    expect(itemKey({ molecule: 1, atom: 2, hSlot: 0 })).toBe('1:2:0');
  });
});
