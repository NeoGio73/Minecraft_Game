import { describe, it, expect } from 'vitest';
import { analyze } from '@/chem/analyze';
import { embedOnLattice } from '@/chem/embed';
import { withoutStereoTags } from '@/chem/graph';
import { STEREO_TEXT } from '@/chem/stereo';
import type { MoleculeGraph } from '@/chem/types';
import { Outcome } from '@/lms/types';
import type { ProgressState } from '@/lms/types';
import { World } from '@/world/world';
import { Block } from '@/world/types';
import { entryBySmiles, layoutOf, loadLibrary, parseEntry } from '@/content/library';
import { challengeById, hashOfSmiles } from '@/content/challenges';
import {
  creditDelta, evaluate, evaluateFormulaAndGroups, evaluateIsomerSet, evaluateQuiz, evaluateSelectAtom, kindForVerdict, pointsFor,
} from '@/content/acceptance';
import { FEEDBACK, NO_BOND_HINT, feedbackText } from '@/content/feedback';
import { cardById } from '@/content/reagents';
import type { Challenge, SubmissionContext } from '@/content/types';
import { PAD_ORIGIN, PRODUCT_ORIGIN, build, grid, layoutEmbedding, moleculesOf } from './fixtures/build';
import type { BuildOptions } from './fixtures/build';

loadLibrary();

const ch = (id: string): Challenge => {
  const c = challengeById(id);
  if (!c) throw new Error(`no challenge ${id}`);
  return c;
};

const baseCtx: SubmissionContext = { padMolecules: [], targeted: null, selection: [], isomersDone: new Set(), attempt: 1, diagonalBondsEnabled: false };

function ctx(patch: Partial<SubmissionContext>): SubmissionContext {
  return { ...baseCtx, ...patch };
}

/** Context with `molecules` (already world graphs) on the pad, the first one targeted. */
function padCtx(molecules: readonly MoleculeGraph[], patch: Partial<SubmissionContext> = {}): SubmissionContext {
  return ctx({ padMolecules: molecules, targeted: molecules[0] ?? null, ...patch });
}

/** World graph of a SMILES built from its (stereo-stripped) lattice embedding. */
function flatBuild(smiles: string): MoleculeGraph {
  const g = withoutStereoTags(parseEntry(smiles));
  const b = build(g, embedOnLattice(g)!, PAD_ORIGIN);
  return moleculesOf(b.world, 'pad', b.cells[0]).targeted!;
}

/** World graph of a library entry built from its stereo layout (suppressions applied unless told otherwise). */
function stereoBuild(smiles: string, opts: BuildOptions = {}, zone: 'pad' | 'product' = 'pad'): MoleculeGraph {
  const entry = entryBySmiles(smiles);
  const g = parseEntry(smiles);
  const emb = entry ? layoutOf(entry)! : embedOnLattice(g)!;
  const b = build(g, emb, zone === 'pad' ? PAD_ORIGIN : PRODUCT_ORIGIN, opts);
  return moleculesOf(b.world, zone, b.cells[0]).targeted!;
}

/** World graph from a hand layout placed in the world (positions relative, SMILES atom order). */
function layoutBuild(smiles: string, pos: readonly (readonly [number, number, number])[], hPos: Readonly<Record<number, readonly [number, number, number][]>> = {}, zone: 'pad' | 'product' = 'pad', suppressed: readonly (readonly [number, number])[] = []): MoleculeGraph {
  const g = withoutStereoTags(parseEntry(smiles));
  const b = build(g, layoutEmbedding(pos, hPos, suppressed), zone === 'pad' ? PAD_ORIGIN : PRODUCT_ORIGIN);
  return moleculesOf(b.world, zone, b.cells[0]).targeted!;
}

describe('points and credit', () => {
  it('pointsFor: full for build rules, by attempt for limited rules, half when reduced', () => {
    const quiz = ch('ch1-quiz-hybridization-acetamide-n');
    expect(pointsFor(quiz, 1, false)).toBe(4);
    expect(pointsFor(quiz, 2, false)).toBe(2);
    expect(pointsFor(quiz, 3, false)).toBe(0);
    const buildC = ch('ch5-build-r-3-methylhexane');
    expect(pointsFor(buildC, 5, false)).toBe(8);
    expect(pointsFor(buildC, 1, true)).toBe(4);
    expect(pointsFor(ch('ch1-build-methane'), 1, true)).toBe(1);
  });

  it('creditDelta: new solve, reduced -> full upgrade, otherwise 0', () => {
    const c = ch('ch7-predict-rearrangement-3-methylbut-1-ene-hcl');
    const empty: ProgressState = { version: 2, studentId: 'local', attempted: 0n, solved: 0n, reduced: 0n, exhausted: 0n, earned: 0, reportedRaw: 0, currentChallengeId: c.id, isomersDone: {} };
    const full = { passed: true, kind: 'correct' as const, message: '', attempt: 1, pointsEarned: 8 };
    const half = { passed: true, kind: 'correct-reduced' as const, message: '', attempt: 1, pointsEarned: 4 };
    const i = 30;
    const bit = 1n << BigInt(i);
    expect(creditDelta(c, full, empty, i)).toBe(8);
    expect(creditDelta(c, half, empty, i)).toBe(4);
    const reduced: ProgressState = { ...empty, attempted: bit, solved: bit, reduced: bit, earned: 4 };
    expect(creditDelta(c, full, reduced, i)).toBe(4);
    expect(creditDelta(c, half, reduced, i)).toBe(0);
    const solved: ProgressState = { ...empty, attempted: bit, solved: bit, earned: 8 };
    expect(creditDelta(c, full, solved, i)).toBe(0);
    expect(creditDelta(c, { ...full, passed: false, pointsEarned: 0 }, empty, i)).toBe(0);
    expect(Outcome.SolvedReduced).toBe(2);
  });

  it('kindForVerdict', () => {
    expect(kindForVerdict('DIFFERENT_FORMULA', false)).toBe('wrong-formula');
    expect(kindForVerdict('DIFFERENT_FORMULA', true)).toBe('wrong-charge');
    expect(kindForVerdict('DIFFERENT_CONSTITUTION', true)).toBe('constitutional-isomer');
    expect(kindForVerdict('ENANTIOMER', true)).toBe('enantiomer');
    expect(kindForVerdict('DIASTEREOMER', true)).toBe('diastereomer');
    expect(kindForVerdict('UNSPECIFIED', true)).toBe('unspecified-center');
    expect(kindForVerdict('INVALID_GEOMETRY', true)).toBe('invalid-alkene-geometry');
  });
});

describe('feedback templates', () => {
  it('fill parameters, fall back without them, honour overrides and append NO_BOND_HINT', () => {
    expect(feedbackText('correct', { name: 'ethanol' })).toBe('Correct! That is ethanol.');
    expect(feedbackText('correct')).toBe('Correct!');
    expect(feedbackText('wrong-formula', { yours: 'C4H6', expected: 'C4H8', extraRing: 1 }).endsWith(NO_BOND_HINT)).toBe(true);
    expect(feedbackText('wrong-formula', { yours: 'C4H6', expected: 'C4H8' }).includes(NO_BOND_HINT)).toBe(false);
    // chemistry review minor 10: a generic-lead override still shows the student's actual formula
    expect(feedbackText('wrong-formula', { yours: 'C2H4O2', expected: 'C2H3O2-' }, 'Wrong formula. Target the single-bonded oxygen and press C once.'))
      .toBe('Wrong formula: yours is C2H4O2, the target is C2H3O2-. Target the single-bonded oxygen and press C once.');
    expect(feedbackText('wrong-formula', {}, 'Wrong formula. Target the single-bonded oxygen and press C once.'))
      .toBe('Wrong formula. Target the single-bonded oxygen and press C once.');
    expect(feedbackText('wrong-formula', { yours: 'C2H4O2', expected: 'C2H3O2-' }, 'NBS is a substitution, not an addition.'))
      .toBe('NBS is a substitution, not an addition.');
    expect(feedbackText('constitutional-isomer', { yours: 'C4H10', name: 'butane', extraRing: 1 })).toContain('(you built butane)');
    expect(feedbackText('wrong-ring-count', { yours: 2, expected: 1 }).endsWith(NO_BOND_HINT)).toBe(true);
    expect(feedbackText('wrong-ring-count', { yours: 0, expected: 1 }).includes(NO_BOND_HINT)).toBe(false);
    expect(feedbackText('unspecified-center', { atom: 2, shape: 'T' })).toBe(`C2 has no definite configuration yet. ${STEREO_TEXT.flatT}`);
    expect(feedbackText('unspecified-center', { atom: 2, shape: 'square-planar' })).toContain(STEREO_TEXT.flatSquare);
    expect(feedbackText('wrong-option', {}, 'Nope.')).toBe('Nope.');
    expect(feedbackText('attempts-exhausted', { expected: 'sp2', explanation: 'Because.' })).toBe('No attempts left. The answer was: sp2. Because.');
    for (const kind of Object.keys(FEEDBACK) as (keyof typeof FEEDBACK)[]) {
      const text = FEEDBACK[kind]({});
      expect(text.length, kind).toBeGreaterThan(5);
      expect(/^[\x20-\x7e]+$/.test(text), kind).toBe(true);
    }
  });
});

describe('exact-molecule and name-to-structure', () => {
  it('methane: correct, nothing targeted, targeted not on the pad', () => {
    const c = ch('ch1-build-methane');
    const methane = flatBuild('C');
    const r = evaluate(c, padCtx([methane]));
    expect(r).toMatchObject({ passed: true, kind: 'correct', pointsEarned: 2, attempt: 1 });
    expect(r.message).toBe('Correct! That is methane.');
    expect(evaluate(c, ctx({ padMolecules: [methane], targeted: null })).kind).toBe('nothing-targeted');
    expect(evaluate(c, ctx({ padMolecules: [], targeted: methane })).kind).toBe('nothing-targeted');
    const r2 = evaluate(c, padCtx([flatBuild('CC')]));
    expect(r2).toMatchObject({ passed: false, kind: 'wrong-formula', pointsEarned: 0 });
    expect(r2.message).toContain('yours is C2H6, the target is CH4');
  });

  it('2-methylbutane: pentane is a constitutional isomer; ethene/ethyne bond orders', () => {
    const r = evaluate(ch('ch1-condensed-2-methylbutane'), padCtx([flatBuild('CCCCC')]));
    expect(r.kind).toBe('constitutional-isomer');
    expect(r.message).toContain('(you built pentane)');
    expect(evaluate(ch('ch1-build-ethene'), padCtx([flatBuild('C=C')])).passed).toBe(true);
    expect(evaluate(ch('ch1-build-ethene'), padCtx([flatBuild('CC')])).kind).toBe('wrong-formula');
    expect(evaluate(ch('ch1-build-ethyne'), padCtx([flatBuild('C#C')])).passed).toBe(true);
    expect(evaluate(ch('ch1-build-ethyne'), padCtx([flatBuild('C=C')])).kind).toBe('wrong-formula');
  });

  it('acetate ion: the acetic acid build gets the override text; a different charge placement is a constitutional isomer', () => {
    const c = ch('ch2-build-acetate-ion');
    expect(evaluate(c, padCtx([flatBuild('CC(=O)[O-]')])).passed).toBe(true);
    const r = evaluate(c, padCtx([flatBuild('CC(=O)O')]));
    expect(r.kind).toBe('wrong-formula');
    // the override keeps its hint but opens with the concrete formula sentence (chemistry review minor 10)
    expect(r.message.startsWith('Wrong formula: yours is C2H4O2, the target is C2H3O2')).toBe(true);
    expect(r.message.endsWith(c.feedback!['wrong-formula']!.slice('Wrong formula.'.length))).toBe(true);
    const r2 = evaluate(c, padCtx([flatBuild('[CH2-]C(=O)O')]));
    expect(r2.kind).toBe('constitutional-isomer');
  });

  it('tert-butyl cation: the anion differs only in charge', () => {
    const c = ch('ch2-build-tert-butyl-cation');
    expect(evaluate(c, padCtx([flatBuild('C[C+](C)C')])).passed).toBe(true);
    const r = evaluate(c, padCtx([flatBuild('C[C-](C)C')]));
    expect(r.kind).toBe('wrong-charge');
    expect(r.message).toContain('the net charge is -1, the target has 1');
    const r3 = evaluate(c, padCtx([flatBuild('CC(C)C')]));
    expect(r3.message.startsWith('Wrong formula: yours is C4H10, the target is C4H9')).toBe(true);
    expect(r3.message.endsWith(c.feedback!['wrong-formula']!.slice('Wrong formula.'.length))).toBe(true);
  });

  it('name-to-structure: the name is reported; a T-shaped flat build still passes (constitution only)', () => {
    const c = ch('ch3-name-3-ethyl-2-methylpentane');
    const r = evaluate(c, padCtx([flatBuild('CCC(CC)C(C)C')]));
    expect(r.passed).toBe(true);
    expect(r.message).toBe('Correct! That is 3-ethyl-2-methylpentane.');
    expect(evaluate(c, padCtx([flatBuild('CCCCC(C)CC')])).kind).toBe('constitutional-isomer');
    const r2 = evaluate(ch('ch4-name-methylcyclohexane'), padCtx([flatBuild('CC1CCCCC1')]));
    expect(r2.passed).toBe(true);
  });

  it('valence-error: a carbon with five neighbours', () => {
    const w = new World();
    w.setBlock(60, 10, 60, Block.AtomC);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]] as const) w.setBlock(60 + dx, 10 + dy, 60 + dz, Block.AtomC);
    const { molecules, targeted } = moleculesOf(w, 'pad', '60,10,60');
    const r = evaluate(ch('ch1-build-methane'), ctx({ padMolecules: molecules, targeted }));
    expect(r.kind).toBe('valence-error');
    expect(r.message).toMatch(/^C at position \d has too many bonds/);
  });
});

describe('formula-and-groups', () => {
  it('alcohol C3H8O: both propanols pass, methoxyethane is forbidden', () => {
    const c = ch('ch3-fg-alcohol-c3h8o');
    expect(evaluate(c, padCtx([flatBuild('CCCO')]))).toMatchObject({ passed: true, kind: 'correct', pointsEarned: 2 });
    expect(evaluate(c, padCtx([flatBuild('CC(C)O')])).message).toBe('Correct! That is propan-2-ol.');
    // 05 §7.3 checks required groups before forbidden ones: methoxyethane has no alcohol
    const r = evaluate(c, padCtx([flatBuild('CCOC')]));
    expect(r.kind).toBe('missing-group');
    expect(r.message).toBe('The molecule needs alcohol. The panel lists the functional groups it currently has.');
    expect(evaluate(c, padCtx([flatBuild('CCCCO')])).kind).toBe('wrong-formula');
    // a forbidden group on a molecule that has every required one
    const both: Challenge = { ...c, rule: { type: 'formula-and-groups', formula: 'C3H8O', required: [], forbidden: ['ether'] } };
    const f = evaluate(both, padCtx([flatBuild('CCOC')]));
    expect(f.kind).toBe('forbidden-group');
    expect(f.message).toBe('The molecule must not contain ether.');
  });

  it('carboxylic acid, ester and amide rules with the 05 §4.3 negatives', () => {
    expect(evaluate(ch('ch3-fg-carboxylic-acid-c2h4o2'), padCtx([flatBuild('CC(=O)O')])).passed).toBe(true);
    const r1 = evaluate(ch('ch3-fg-carboxylic-acid-c2h4o2'), padCtx([flatBuild('O=COC')]));
    expect(r1.kind).toBe('missing-group');
    expect(r1.message).toBe('The molecule needs carboxylic acid. The panel lists the functional groups it currently has.');
    expect(evaluate(ch('ch3-fg-ester-c3h6o2'), padCtx([flatBuild('CC(=O)OC')])).passed).toBe(true);
    expect(evaluate(ch('ch3-fg-ester-c3h6o2'), padCtx([flatBuild('O=COCC')])).passed).toBe(true);
    expect(evaluate(ch('ch3-fg-ester-c3h6o2'), padCtx([flatBuild('CCC(=O)O')])).kind).toBe('missing-group');
    expect(evaluate(ch('ch3-fg-amide-c2h5no'), padCtx([flatBuild('CC(N)=O')])).passed).toBe(true);
    expect(evaluate(ch('ch3-fg-amide-c2h5no'), padCtx([flatBuild('CNC=O')])).passed).toBe(true);
    expect(evaluate(ch('ch3-fg-amide-c2h5no'), padCtx([flatBuild('NCC=O')])).kind).toBe('missing-group');
  });

  it('C4H6 with sp and sp3 carbons: accepted set and atomCounts negatives', () => {
    const c = ch('ch1-build-sp-and-sp3-c4h6');
    for (const s of ['C#CCC', 'CC#CC', 'CC=C=C']) expect(evaluate(c, padCtx([flatBuild(s)])).passed, s).toBe(true);
    const r = evaluate(c, padCtx([flatBuild('C=CC=C')]));
    expect(r.kind).toBe('missing-group');
    expect(r.message).toBe('The molecule needs at least 1 sp carbon. The panel lists the functional groups it currently has.');
    expect(evaluate(c, padCtx([flatBuild('C1=CCC1')])).kind).toBe('missing-group');
    expect(evaluate(c, padCtx([flatBuild('CCCC')])).kind).toBe('wrong-formula');
  });

  it('rings: methylcyclobutane, cyclohexane and the C6H10 unsaturation rule', () => {
    expect(evaluate(ch('ch4-cycloalkane-c5h10'), padCtx([flatBuild('CC1CCC1')])).passed).toBe(true);
    expect(evaluate(ch('ch4-cycloalkane-c5h10'), padCtx([flatBuild('C=CCCC')])).kind).toBe('forbidden-group');
    const six = ch('ch4-build-c6h12-six-membered-ring');
    expect(evaluate(six, padCtx([flatBuild('C1CCCCC1')])).passed).toBe(true);
    const r = evaluate(six, padCtx([flatBuild('CC1CCC1C')]));
    expect(r.kind).toBe('wrong-ring-count');
    expect(r.message).toBe('Ring count: yours has 4, the target needs a 6-membered ring.');
    expect(evaluate(six, padCtx([flatBuild('C=CCCCC')])).kind).toBe('forbidden-group');
    expect(evaluate(six, padCtx([flatBuild('C12CCC1CC2')])).kind).toBe('wrong-formula');
    // too many rings (a touching pair left bonded): the hint names the wand
    const twoRings: Challenge = { ...six, rule: { type: 'formula-and-groups', formula: 'C4H6', required: [], forbidden: [], ringCount: 1 } };
    const r2 = evaluate(twoRings, padCtx([parseEntry('C12CC1C2')]));
    expect(r2.kind).toBe('wrong-ring-count');
    expect(r2.message.startsWith('Ring count: yours has 2, the target needs 1.')).toBe(true);
    expect(r2.message.endsWith(NO_BOND_HINT)).toBe(true);
    const c6 = ch('ch7-unsaturation-c6h10');
    for (const s of ['C1CCC=CC1', 'CCC1=CCC1', 'C=CC1CCC1']) expect(evaluate(c6, padCtx([flatBuild(s)])).passed, s).toBe(true);
    const diene = evaluate(c6, padCtx([flatBuild('C=CC=CCC')]));
    expect(diene.kind).toBe('wrong-ring-count');
    expect(diene.message).toBe('Ring count: yours has 0, the target needs 1.');
    expect(evaluate(c6, padCtx([flatBuild('C1CCCCC1')])).kind).toBe('wrong-formula');
    // hex-1-yne has no alkene, so the required-group check fires first
    expect(evaluate(c6, padCtx([flatBuild('C#CCCCC')])).kind).toBe('missing-group');
    // bicyclo[2.2.0]hexane has no alkene: the required-group check fires before the ring/pi counts
    expect(evaluate(c6, padCtx([flatBuild('C12CCC1CC2')])).kind).toBe('missing-group');
  });

  it('wrong-pi-count and wrong-charge through synthetic rules', () => {
    const base = ch('ch4-cycloalkane-c5h10');
    const pi: Challenge = { ...base, rule: { type: 'formula-and-groups', formula: 'C4H8', required: [], forbidden: [], piBonds: 1 } };
    const r = evaluateFormulaAndGroups(pi.rule as Extract<Challenge['rule'], { type: 'formula-and-groups' }>, padCtx([flatBuild('C1CCC1')]), pi);
    expect(r.kind).toBe('wrong-pi-count');
    expect(r.message).toBe('Pi bonds: yours has 0, the target needs 1. Use the bond wand to change a bond order.');
    const charged: Challenge = { ...base, rule: { type: 'formula-and-groups', formula: 'CH3', required: [], forbidden: [], netCharge: 1 } };
    expect(evaluate(charged, padCtx([flatBuild('[CH3+]')])).passed).toBe(true);
    const r2 = evaluate(charged, padCtx([flatBuild('[CH3-]')]));
    expect(r2.kind).toBe('wrong-charge');
    const counts: Challenge = { ...base, rule: { type: 'formula-and-groups', formula: 'C4H8', required: [], forbidden: [], atomCounts: [{ el: 'C', hyb: 'sp2', min: 2, max: 2 }] } };
    expect(evaluate(counts, padCtx([flatBuild('C=CCC')])).passed).toBe(true);
    expect(evaluate(counts, padCtx([flatBuild('C1CCC1')])).message).toContain('exactly 2 sp2 carbons');
  });
});

describe('isomer-set', () => {
  const c = ch('ch3-isomers-c4h10');
  const butane = flatBuild('CCCC');
  const isobutane = flatBuild('CC(C)C');

  it('counts up, passes at the goal, reports repeats and non-isomers', () => {
    const first = evaluate(c, padCtx([butane]));
    expect(first).toMatchObject({ passed: false, kind: 'correct', pointsEarned: 0, progress: { done: 1, total: 2 } });
    expect(first.message).toBe('Isomer 1 of 2 accepted: butane. Keep going.');
    const done = new Set([analyze(butane).hash]);
    const second = evaluate(c, padCtx([isobutane, butane], { isomersDone: done }));
    expect(second).toMatchObject({ passed: true, kind: 'correct', pointsEarned: 2, progress: { done: 2, total: 2 } });
    const again = evaluate(c, padCtx([butane], { isomersDone: done }));
    expect(again).toMatchObject({ passed: false, kind: 'already-built', progress: { done: 1, total: 2 } });
    expect(again.message).toBe('You already built butane. Build a different isomer.');
    expect(evaluate(c, padCtx([flatBuild('CCCCC')])).kind).toBe('wrong-formula');
    const extra = evaluate(c, padCtx([butane, flatBuild('CCO')]));
    expect(extra.kind).toBe('extra-molecule');
    expect(extra.message).toContain('C2H6O');
    expect(evaluate(c, ctx({ padMolecules: [butane], targeted: null })).kind).toBe('nothing-targeted');
  });

  it('C4H8: E and Z but-2-ene are one skeleton; methylcyclopropane only counts with diagonal bonds', () => {
    const c4 = ch('ch4-isomers-c4h8');
    const e = stereoBuild('C/C=C/C');
    const z = stereoBuild('C/C=C\\C');
    const first = evaluate(c4, padCtx([e]));
    expect(first).toMatchObject({ passed: false, kind: 'correct', progress: { done: 1, total: 4 } });
    const done = new Set([analyze(e).hash]);
    expect(evaluate(c4, padCtx([z], { isomersDone: done })).kind).toBe('already-built');
    const diag = evaluate(c4, padCtx([z], { isomersDone: done, diagonalBondsEnabled: true }));
    expect(diag.kind).toBe('already-built');
    expect(diag.progress).toEqual({ done: 1, total: 5 });
    // methylcyclopropane cannot be built on the lattice; use a parsed graph with an odd ring as the "pad" molecule
    const mcp = parseEntry('CC1CC1');
    expect(evaluate(c4, padCtx([mcp])).kind).toBe('not-an-isomer');
    const mcpOk = evaluateIsomerSet(c4.rule as Extract<Challenge['rule'], { type: 'isomer-set' }>, padCtx([mcp], { diagonalBondsEnabled: true }), c4);
    expect(mcpOk.kind).toBe('correct');
    expect(mcpOk.progress).toEqual({ done: 1, total: 5 });
    expect(hashOfSmiles('CC1CC1')).toBe(analyze(mcp).hash);
  });
});

describe('stereo-exact', () => {
  it('(R)-2-bromobutane: R passes, S is the enantiomer, a T centre is unspecified', () => {
    const c = ch('ch5-build-r-2-bromobutane');
    const r = evaluate(c, padCtx([stereoBuild('C[C@@H](Br)CC')]));
    expect(r).toMatchObject({ passed: true, kind: 'correct', pointsEarned: 4 });
    expect(r.message).toBe('Correct! That is (R)-2-bromobutane.');
    const mirrorBuild = stereoBuild('C[C@@H](Br)CC', { mirror: true });
    const s = evaluate(c, padCtx([mirrorBuild]));
    expect(s.kind).toBe('enantiomer');
    // the atom is named in the student's own numbering (ids ascend with cellIndex): the carbon bonded to Br
    const brC = mirrorBuild.bonds.find((b) => mirrorBuild.atoms[b.a]!.el === 'Br' || mirrorBuild.atoms[b.b]!.el === 'Br')!;
    const centre = mirrorBuild.atoms[brC.a]!.el === 'C' ? brC.a : brC.b;
    expect(s.message).toContain(`Swap any two groups on C${centre + 1}.`);
    expect(evaluate(c, padCtx([stereoBuild('C[C@H](Br)CC')])).kind).toBe('enantiomer');
    const t = evaluate(c, padCtx([layoutBuild('CC(Br)CC', [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]])]));
    expect(t.kind).toBe('unspecified-center');
    expect(t.message).toBe(`C2 has no definite configuration yet. ${STEREO_TEXT.flatT}`);
    expect(evaluate(c, padCtx([flatBuild('CCC(C)Cl')])).kind).toBe('wrong-formula');
  });

  it('every stereo-exact target passes and its mirror image is the enantiomer (meso and relative modes pass)', () => {
    for (const c of ['ch5-build-s-alanine', 'ch5-build-r-lactic-acid', 'ch5-build-r-3-methylhexane', 'ch5-build-meso-2-3-dibromobutane', 'ch5-build-2r-3r-dibromobutane', 'ch4-cis-1-2-dimethylcyclohexane', 'ch4-trans-1-2-dimethylcyclohexane', 'ch7-build-e-but-2-ene', 'ch7-build-2e-4e-hexa-2-4-diene'].map(ch)) {
      const rule = c.rule as Extract<Challenge['rule'], { type: 'stereo-exact' }>;
      expect(evaluate(c, padCtx([stereoBuild(rule.target)])).passed, c.id).toBe(true);
      const mirror = evaluate(c, padCtx([stereoBuild(rule.target, { mirror: true })]));
      const meso = entryBySmiles(rule.target)!.meso === true;
      const ez = parseEntry(rule.target).bonds.some((b) => b.ez);
      if (meso || rule.mode === 'relative' || ez) expect(mirror.passed, c.id).toBe(true);
      else expect(mirror.kind, c.id).toBe('enantiomer');
    }
    expect(evaluate(ch('ch5-build-s-alanine'), padCtx([stereoBuild('N[C@H](C)C(=O)O')])).message).toBe(ch('ch5-build-s-alanine').feedback!.enantiomer);
  });

  it('2,3-dibromobutane: meso versus (2R,3R) diastereomer overrides; trans ring accepts either enantiomer', () => {
    const meso = ch('ch5-build-meso-2-3-dibromobutane');
    const rr = ch('ch5-build-2r-3r-dibromobutane');
    const mesoBuild = stereoBuild('C[C@H](Br)[C@H](Br)C');
    const rrBuild = stereoBuild('C[C@@H](Br)[C@H](Br)C');
    const ssBuild = stereoBuild('C[C@H](Br)[C@@H](Br)C');
    expect(evaluate(meso, padCtx([rrBuild])).message).toBe(meso.feedback!.diastereomer);
    expect(evaluate(rr, padCtx([mesoBuild])).message).toBe(rr.feedback!.diastereomer);
    expect(evaluate(rr, padCtx([ssBuild])).message).toBe(rr.feedback!.enantiomer);
    const trans = ch('ch4-trans-1-2-dimethylcyclohexane');
    expect(evaluate(trans, padCtx([stereoBuild('C[C@@H]1CCCC[C@H]1C')])).passed).toBe(true);
    expect(evaluate(trans, padCtx([stereoBuild('C[C@H]1CCCC[C@@H]1C')])).passed).toBe(true);
    const cisBuild = stereoBuild('C[C@H]1CCCC[C@H]1C');
    expect(evaluate(trans, padCtx([cisBuild])).message).toBe(trans.feedback!.diastereomer);
    const cis = ch('ch4-cis-1-2-dimethylcyclohexane');
    expect(evaluate(cis, padCtx([cisBuild])).passed).toBe(true);
    expect(evaluate(cis, padCtx([stereoBuild('C[C@@H]1CCCC[C@H]1C')])).message).toBe(cis.feedback!.diastereomer);
  });

  it('E/Z: Z for the E target is a diastereomer; E for the Z target too; twisted Z is invalid geometry; unsuppressed Z is a ring', () => {
    const e = ch('ch7-build-e-but-2-ene');
    const z = ch('ch7-build-z-but-2-ene');
    const zBuild = stereoBuild('C/C=C\\C');
    const eBuild = stereoBuild('C/C=C/C');
    expect(evaluate(e, padCtx([eBuild])).message).toBe('Correct! That is (E)-but-2-ene.');
    expect(evaluate(e, padCtx([zBuild])).message).toBe(e.feedback!.diastereomer);
    expect(evaluate(z, padCtx([zBuild])).message).toBe('Correct! That is (Z)-but-2-ene.');
    expect(evaluate(z, padCtx([eBuild])).message).toBe(z.feedback!.diastereomer);
    const twisted = layoutBuild('CC=CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]]);
    const t = evaluate(z, padCtx([twisted]));
    expect(t.kind).toBe('invalid-alkene-geometry');
    expect(t.message).toContain('is not laid out flat');
    const ring = evaluate(z, padCtx([stereoBuild('C/C=C\\C', { suppress: false })]));
    expect(ring.kind).toBe('wrong-formula');
    expect(ring.message.endsWith(NO_BOND_HINT)).toBe(true);
    const chloro = ch('ch7-build-z-2-chlorobut-2-ene');
    expect(evaluate(chloro, padCtx([stereoBuild('C/C=C(\\Cl)C')])).passed).toBe(true);
    expect(evaluate(chloro, padCtx([stereoBuild('C/C=C(/Cl)C')])).message).toBe(chloro.feedback!.diastereomer);
  });
});

describe('select-atom', () => {
  it('sp2 carbons of propene: all required, attempts and half credit', () => {
    const c = ch('ch1-select-sp2-propene');
    const ok = evaluate(c, ctx({ selection: [{ molecule: 0, atom: 0 }, { molecule: 0, atom: 1 }] }));
    expect(ok).toMatchObject({ passed: true, kind: 'correct', pointsEarned: 4 });
    expect(ok.message).toBe('Correct! Answer: the two carbons of the C=C double bond (C1 and C2).');
    const partial = evaluate(c, ctx({ selection: [{ molecule: 0, atom: 0 }] }));
    expect(partial).toMatchObject({ passed: false, kind: 'wrong-atom', pointsEarned: 0 });
    expect(partial.message).toBe('Not that one. You picked C1. Think again and try another selection.');
    expect(evaluate(c, ctx({ selection: [{ molecule: 0, atom: 0 }, { molecule: 0, atom: 1 }, { molecule: 0, atom: 2 }] })).kind).toBe('wrong-atom');
    expect(evaluate(c, ctx({ selection: [] })).kind).toBe('nothing-selected');
    // an empty selection never exhausts the challenge, whatever the attempt number
    expect(evaluate(c, ctx({ selection: [], attempt: 3 })).kind).toBe('nothing-selected');
    expect(evaluate(c, ctx({ selection: [{ molecule: 0, atom: 0 }, { molecule: 0, atom: 1 }], attempt: 2 })).pointsEarned).toBe(2);
    const out = evaluate(c, ctx({ selection: [{ molecule: 0, atom: 2 }], attempt: 3 }));
    expect(out).toMatchObject({ passed: false, kind: 'attempts-exhausted', pointsEarned: 0, attempt: 3 });
    expect(out.message).toBe('No attempts left. The answer was: the two carbons of the C=C double bond (C1 and C2).');
    expect(evaluate(c, ctx({ selection: [{ molecule: 0, atom: 0 }, { molecule: 0, atom: 1 }], attempt: 3 })).pointsEarned).toBe(0);
  });

  it('most acidic hydrogen of ethanol: H pick, heavy-atom fallback, wrong carbon, no hydrogens on an oxygen', () => {
    const c = ch('ch2-select-most-acidic-h-ethanol');
    expect(evaluate(c, ctx({ selection: [{ molecule: 0, atom: 2, hSlot: 0 }] })).passed).toBe(true);
    expect(evaluate(c, ctx({ selection: [{ molecule: 0, atom: 2 }] })).passed).toBe(true);
    const r = evaluate(c, ctx({ selection: [{ molecule: 0, atom: 0 }] }));
    expect(r.kind).toBe('wrong-atom');
    expect(r.message).toContain('You picked a hydrogen on C1.');
    expect(evaluate(c, ctx({ selection: [{ molecule: 0, atom: 1, hSlot: 0 }, { molecule: 0, atom: 2, hSlot: 0 }] })).kind).toBe('wrong-atom');
    const ether: Challenge = { ...c, rule: { ...(c.rule as Extract<Challenge['rule'], { type: 'select-atom' }>), molecules: ['COC'] } };
    const none = evaluateSelectAtom(ether.rule as Extract<Challenge['rule'], { type: 'select-atom' }>, ctx({ selection: [{ molecule: 0, atom: 1 }] }), ether);
    expect(none.kind).toBe('no-hydrogens');
    expect(none.message).toBe(FEEDBACK['no-hydrogens']({}));
  });

  it('two molecules on the pad: the acetic acid O-H wins; any member of a tie class counts', () => {
    const c = ch('ch2-select-most-acidic-h-acetic-acid-vs-ethanol');
    expect(evaluate(c, ctx({ selection: [{ molecule: 0, atom: 3, hSlot: 0 }] })).passed).toBe(true);
    const r = evaluate(c, ctx({ selection: [{ molecule: 1, atom: 2, hSlot: 0 }] }));
    expect(r.kind).toBe('wrong-atom');
    expect(r.message).toContain('of molecule 2');
    const dione = ch('ch2-select-most-acidic-h-pentane-2-4-dione');
    expect(evaluate(dione, ctx({ selection: [{ molecule: 0, atom: 3, hSlot: 1 }] })).passed).toBe(true);
    expect(evaluate(dione, ctx({ selection: [{ molecule: 0, atom: 0, hSlot: 0 }] })).kind).toBe('wrong-atom');
    const sn2 = ch('ch11-select-fastest-sn2-substrate');
    expect(evaluate(sn2, ctx({ selection: [{ molecule: 0, atom: 1 }] })).passed).toBe(true);
    expect(evaluate(sn2, ctx({ selection: [{ molecule: 2, atom: 1 }] })).kind).toBe('wrong-atom');
    const basic = ch('ch2-select-most-basic-site-2-aminoethanol');
    expect(evaluate(basic, ctx({ selection: [{ molecule: 0, atom: 3 }] })).passed).toBe(true);
    expect(evaluate(basic, ctx({ selection: [{ molecule: 0, atom: 0 }] })).kind).toBe('wrong-atom');
  });
});

describe('predict-product', () => {
  it('ethene + HBr: bromoethane passes; chloroethane, empty zone and an extra molecule fail', () => {
    const c = ch('ch6-predict-ethene-hbr');
    const ok = evaluate(c, padCtx([stereoBuild('CCBr', {}, 'product')]));
    expect(ok).toMatchObject({ passed: true, kind: 'correct', pointsEarned: 2 });
    expect(ok.message).toBe('Correct! That is bromoethane.');
    const wrong = evaluate(c, padCtx([stereoBuild('CCCl', {}, 'product')]));
    expect(wrong.kind).toBe('wrong-formula');
    expect(wrong.message).toContain('yours is C2H5Cl, the target is C2H5Br');
    const empty = evaluate(c, ctx({ padMolecules: [] }));
    expect(empty.kind).toBe('missing-molecule');
    expect(empty.message).toBe('Expected 1 product molecules, found 0. Build the missing one (C2H5Br) as a separate molecule.');
    const extra = evaluate(c, padCtx([stereoBuild('CCBr', {}, 'product'), stereoBuild('C', {}, 'product')]));
    expect(extra.kind).toBe('extra-molecule');
    expect(extra.message).toContain('CH4');
    expect(evaluate(c, padCtx([stereoBuild('CCCBr', {}, 'product')])).kind).toBe('wrong-formula');
  });

  it('ozonolysis: both fragments in any order; one fragment is missing-molecule; a wrong fragment is a constitutional isomer', () => {
    const c = ch('ch8-predict-ozonolysis-2-methylbut-2-ene');
    const acetone = stereoBuild('CC(C)=O', {}, 'product');
    const ethanal = stereoBuild('CC=O', {}, 'product');
    expect(evaluate(c, padCtx([ethanal, acetone])).passed).toBe(true);
    expect(evaluate(c, padCtx([acetone, ethanal])).message).toBe('Correct! That is propan-2-one and ethanal.');
    const one = evaluate(c, padCtx([acetone]));
    expect(one.kind).toBe('missing-molecule');
    expect(one.message).toBe('Expected 2 product molecules, found 1. Build the missing one (C2H4O) as a separate molecule.');
    const wrongFrag = evaluate(c, padCtx([acetone, stereoBuild('CCC=O', {}, 'product')]));
    expect(wrongFrag.kind).toBe('wrong-formula');
    const iso = evaluate(ch('ch8-predict-kmno4-2-methylbut-2-ene'), padCtx([acetone, stereoBuild('O=COC', {}, 'product')]));
    expect(iso.kind).toBe('constitutional-isomer');
    expect(iso.message).toBe(ch('ch8-predict-kmno4-2-methylbut-2-ene').feedback!['constitutional-isomer']);
    expect(evaluate(c, padCtx([acetone, ethanal, stereoBuild('C', {}, 'product')])).kind).toBe('extra-molecule');
  });

  it('acceptAny: either chloride of the ~1:1 rearrangement mixture earns full credit; acceptAlso (E2 minor) still earns half', () => {
    const c = ch('ch7-predict-rearrangement-3-methylbut-1-ene-hcl');
    const rule = c.rule;
    if (rule.type !== 'predict-product') throw new Error('unreachable');
    expect(rule.acceptAny).toBe(true);
    expect(rule.expected).toEqual(['CCC(C)(C)Cl', 'CC(C)C(C)Cl']);
    expect(rule.acceptAlso).toBeUndefined();
    const rearranged = evaluate(c, padCtx([stereoBuild('CCC(C)(C)Cl', {}, 'product')]));
    expect(rearranged).toMatchObject({ passed: true, kind: 'correct', pointsEarned: 8 });
    expect(rearranged.message).toBe('Correct! That is 2-chloro-2-methylbutane.');
    const unrearranged = evaluate(c, padCtx([stereoBuild('CC(C)C(C)Cl', {}, 'product')]));
    expect(unrearranged).toMatchObject({ passed: true, kind: 'correct', pointsEarned: 8 });
    expect(unrearranged.message).toBe('Correct! That is 2-chloro-3-methylbutane.');
    // one product only: a second molecule (even the other chloride) is an extra molecule
    expect(evaluate(c, padCtx([stereoBuild('CC(C)C(C)Cl', {}, 'product'), stereoBuild('C', {}, 'product')])).kind).toBe('extra-molecule');
    expect(evaluate(c, padCtx([stereoBuild('CCC(C)(C)Cl', {}, 'product'), stereoBuild('CC(C)C(C)Cl', {}, 'product')])).kind).toBe('extra-molecule');
    // diagnostics compare against the best-matching expected product
    const wrong = evaluate(c, padCtx([stereoBuild('CC(C)C(C)Br', {}, 'product')]));
    expect(wrong.passed).toBe(false);
    expect(wrong.kind).toBe('wrong-formula');
    expect(evaluate(c, padCtx([stereoBuild('CCCC(C)Cl', {}, 'product')])).kind).toBe('constitutional-isomer');
    const e2 = ch('ch11-predict-e2-2-bromobutane');
    expect(evaluate(e2, padCtx([stereoBuild('C/C=C\\C', {}, 'product')])).passed).toBe(true);
    expect(evaluate(e2, padCtx([stereoBuild('C=CCC', {}, 'product')])).kind).toBe('correct-reduced');
  });

  it('SN2 inversion: (R)-2-iodobutane passes, (S) is the enantiomer with the override', () => {
    const c = ch('ch11-predict-sn2-inversion-2-bromobutane');
    expect(evaluate(c, padCtx([stereoBuild('C[C@@H](I)CC', {}, 'product')])).passed).toBe(true);
    const s = evaluate(c, padCtx([stereoBuild('C[C@H](I)CC', {}, 'product')]));
    expect(s.kind).toBe('enantiomer');
    expect(s.message).toBe(c.feedback!.enantiomer);
    const flat = evaluate(c, padCtx([layoutBuild('CC(I)CC', [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]], {}, 'product')]));
    expect(flat.kind).toBe('unspecified-center');
  });

  it('relative stereo: trans-1,2-dibromocyclohexane either enantiomer; cis is a diastereomer', () => {
    const c = ch('ch8-predict-br2-cyclohexene-trans');
    expect(evaluate(c, padCtx([stereoBuild('Br[C@@H]1CCCC[C@H]1Br', {}, 'product')])).passed).toBe(true);
    expect(evaluate(c, padCtx([stereoBuild('Br[C@H]1CCCC[C@@H]1Br', {}, 'product')])).passed).toBe(true);
    const cis = evaluate(c, padCtx([stereoBuild('Br[C@H]1CCCC[C@H]1Br', {}, 'product')]));
    expect(cis.message).toBe(c.feedback!.diastereomer);
    const meso = ch('ch8-predict-br2-e-but-2-ene-meso');
    expect(evaluate(meso, padCtx([stereoBuild('C[C@H](Br)[C@H](Br)C', {}, 'product')])).passed).toBe(true);
    expect(evaluate(meso, padCtx([stereoBuild('C[C@@H](Br)[C@H](Br)C', {}, 'product')])).message).toBe(meso.feedback!.diastereomer);
    const oso4 = ch('ch8-predict-oso4-cyclohexene-cis-diol');
    expect(evaluate(oso4, padCtx([stereoBuild('O[C@H]1CCCC[C@H]1O', {}, 'product')])).passed).toBe(true);
    expect(evaluate(oso4, padCtx([stereoBuild('O[C@@H]1CCCC[C@H]1O', {}, 'product')])).message).toBe(oso4.feedback!.diastereomer);
  });

  it('ez policy: Lindlar Z product; the E alkene is a diastereomer; a twisted build is invalid geometry', () => {
    const c = ch('ch9-predict-lindlar-z-hex-3-ene');
    expect(evaluate(c, padCtx([stereoBuild('CC/C=C\\CC', {}, 'product')])).passed).toBe(true);
    const e = evaluate(c, padCtx([stereoBuild('CC/C=C/CC', {}, 'product')]));
    expect(e.kind).toBe('diastereomer');
    expect(e.message).toBe(c.feedback!.diastereomer);
    const twisted = evaluate(c, padCtx([layoutBuild('CCC=CCC', [[-1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1], [2, 0, 1]], {}, 'product')]));
    expect(twisted.kind).toBe('invalid-alkene-geometry');
    expect(twisted.message).toBe(c.feedback!['invalid-alkene-geometry']);
    const ring = evaluate(c, padCtx([stereoBuild('CC/C=C\\CC', { suppress: false }, 'product')]));
    expect(ring.kind).toBe('wrong-formula');
    expect(ring.message.endsWith(NO_BOND_HINT)).toBe(true);
    const li = ch('ch9-predict-li-nh3-hex-3-yne');
    expect(evaluate(li, padCtx([stereoBuild('CC/C=C/CC', {}, 'product')])).passed).toBe(true);
    expect(evaluate(li, padCtx([stereoBuild('CC/C=C\\CC', {}, 'product')])).message).toBe(li.feedback!.diastereomer);
    const br2 = ch('ch9-predict-br2-1-equiv-but-1-yne');
    expect(evaluate(br2, padCtx([stereoBuild('Br/C=C(/Br)CC', {}, 'product')])).passed).toBe(true);
    const zBuild = layoutBuild('BrC=C(Br)CC', [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, -1, 0], [2, -1, 0]], {}, 'product', [[0, 3]]);
    expect(evaluate(br2, padCtx([zBuild])).message).toBe(br2.feedback!.diastereomer);
  });

  it('a product with a valence error is reported before anything else', () => {
    const w = new World();
    w.setBlock(70, 10, 40, Block.AtomC);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]] as const) w.setBlock(70 + dx, 10 + dy, 40 + dz, Block.AtomC);
    const { molecules } = moleculesOf(w, 'product');
    expect(evaluate(ch('ch6-predict-ethene-hbr'), ctx({ padMolecules: molecules })).kind).toBe('valence-error');
  });
});

describe('choose-reagent', () => {
  it('hydroboration for anti-Markovnikov hydration; rejections, attempts, half credit', () => {
    const c = ch('ch8-choose-anti-markovnikov-hydration');
    const ok = evaluate(c, ctx({ chosenReagent: 'HYDROBORATION' }));
    expect(ok).toMatchObject({ passed: true, kind: 'correct', pointsEarned: 4 });
    expect(ok.message).toBe(`Correct! Answer: ${cardById('HYDROBORATION').label}.`);
    const wrong = evaluate(c, ctx({ chosenReagent: 'OXYMERC' }));
    expect(wrong).toMatchObject({ passed: false, kind: 'wrong-reagent', pointsEarned: 0 });
    expect(wrong.message).toBe(`That reagent does not give this product. ${(c.rule as Extract<Challenge['rule'], { type: 'choose-reagent' }>).rejections!.OXYMERC}`);
    const out = evaluate(c, ctx({ chosenReagent: 'H2_PD', attempt: 2 }));
    expect(out.kind).toBe('attempts-exhausted');
    expect(out.message.startsWith(`No attempts left. The answer was: ${cardById('HYDROBORATION').label}.`)).toBe(true);
    expect(evaluate(c, ctx({ chosenReagent: 'HYDROBORATION', attempt: 2 })).pointsEarned).toBe(2);
    const none = evaluate(c, ctx({}));
    expect(none.kind).toBe('wrong-reagent');
    expect(none.message).toBe('That reagent does not give this product. Pick a reagent card first.');
    const noRej: Challenge = { ...c, rule: { ...(c.rule as Extract<Challenge['rule'], { type: 'choose-reagent' }>), rejections: undefined } };
    expect(evaluate(noRej, ctx({ chosenReagent: 'OXYMERC' })).message).toBe('That reagent does not give this product.');
  });
});

describe('quiz', () => {
  it('multiple choice: correct option, wrong option, exhausted with the answer revealed, half credit on attempt 2', () => {
    const c = ch('ch1-quiz-hybridization-acetamide-n');
    const ok = evaluate(c, ctx({ quizAnswer: 'b' }));
    expect(ok).toMatchObject({ passed: true, kind: 'correct', pointsEarned: 4 });
    expect(ok.message.startsWith('Correct! The nitrogen lone pair')).toBe(true);
    const wrong = evaluate(c, ctx({ quizAnswer: 'a' }));
    expect(wrong).toMatchObject({ passed: false, kind: 'wrong-option', pointsEarned: 0 });
    expect(wrong.message).toBe('Not correct. Try again.');
    const out = evaluate(c, ctx({ quizAnswer: 'c', attempt: 2 }));
    expect(out.kind).toBe('attempts-exhausted');
    expect(out.message.startsWith('No attempts left. The answer was: sp2. The nitrogen lone pair')).toBe(true);
    expect(evaluate(c, ctx({ quizAnswer: 'b', attempt: 2 })).pointsEarned).toBe(2);
    expect(evaluate(c, ctx({ quizAnswer: true })).kind).toBe('wrong-option');
  });

  it('yes/no', () => {
    const yes = ch('ch2-quiz-acetic-acid-plus-hydroxide');
    expect(evaluate(yes, ctx({ quizAnswer: true }))).toMatchObject({ passed: true, pointsEarned: 2 });
    expect(evaluate(yes, ctx({ quizAnswer: false })).kind).toBe('wrong-option');
    expect(evaluate(yes, ctx({ quizAnswer: true, attempt: 2 })).pointsEarned).toBe(1);
    const no = ch('ch2-quiz-acetylene-plus-hydroxide');
    expect(evaluate(no, ctx({ quizAnswer: false })).passed).toBe(true);
    const out = evaluate(no, ctx({ quizAnswer: true, attempt: 2 }));
    expect(out.kind).toBe('attempts-exhausted');
    expect(out.message.startsWith('No attempts left. The answer was: No.')).toBe(true);
    expect(evaluate(no, ctx({ quizAnswer: 'no' })).kind).toBe('wrong-option');
    const r = evaluateQuiz(no.rule as Extract<Challenge['rule'], { type: 'quiz' }>, ctx({ quizAnswer: false, attempt: 3 }), no);
    expect(r.passed).toBe(true);
    expect(r.pointsEarned).toBe(0);
  });
});

describe('grid helper sanity', () => {
  it('a hand grid graph analyses like the world build', () => {
    const g = grid(parseEntry('CCBr'), [[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
    expect(analyze(g).formula).toBe('C2H5Br');
    expect(evaluate(ch('ch6-predict-ethene-hbr'), padCtx([g])).passed).toBe(true);
  });
});
