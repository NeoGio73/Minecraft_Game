import { describe, it, expect } from 'vitest';
import { DEFAULT_MAX_ATTEMPTS, POINTS_BY_DIFFICULTY, REAGENT_IDS } from '@/content/types';
import type { Challenge, ChallengeRoster, IsomerSetRule, PredictProductRule } from '@/content/types';
import { GROUP_IDS, hasPositions } from '@/chem/types';
import { parseSmiles } from '@/chem/smiles';
import { implicitHydrogens } from '@/chem/hydrogens';
import { hillFormula } from '@/chem/formula';
import { smallestRings, withoutStereoTags } from '@/chem/graph';
import { sameMolecule } from '@/chem/compare';
import { analyze } from '@/chem/analyze';
import { embedOnLattice } from '@/chem/embed';
import { react } from '@/reactions/react';
import {
  CHAPTER_START, buildReport, validateContent, worldGraphFromEmbedding,
} from '@/content/validate';
import {
  DEFAULT_CONFIG, challengeById, hashOfSmiles, isAttemptLimited, isEnabled, isomerHashes, loadConfig, loadFullRoster, loadRoster,
  loadRosterFile, maxAttemptsOf, rosterInfo, totalPoints,
} from '@/content/challenges';
import { entryBySmiles, loadLibrary, parseEntry } from '@/content/library';
import { cardById, loadReagents } from '@/content/reagents';
import { answerSet } from '@/content/selectors';
import { PKA_MIN_MARGIN } from '@/chem/types';

const library = loadLibrary();
const rosterFile = loadRosterFile();
const full = loadFullRoster();
const reagents = loadReagents();

function mutate(fn: (c: Challenge) => Challenge, id: string): ChallengeRoster {
  return { version: 1, challenges: rosterFile.challenges.map((c) => (c.id === id ? fn(c) : c)) };
}

describe('challenges.json shape and order (R1, R2, R12)', () => {
  it('R1 every record has every field and a known rule type', () => {
    expect(rosterFile.version).toBe(1);
    for (const c of full) {
      for (const f of ['id', 'chapter', 'section', 'topic', 'title', 'instruction', 'objective', 'hint', 'difficulty', 'points', 'rule', 'requiresDiagonalBonds', 'source'] as const) {
        expect(c[f], `${c.id} ${f}`).toBeDefined();
      }
      expect(c.chapter >= 1 && c.chapter <= 11, c.id).toBe(true);
    }
  });

  it('R2 ids unique, chapters non-decreasing, source module numbers match the chapter table', () => {
    const ids = new Set<string>();
    let last = 0;
    for (const c of full) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(c.chapter >= last, c.id).toBe(true);
      last = c.chapter;
      const m = /^MM (\d+)\.(\d+) \(m(\d{5})\)$/.exec(c.source);
      expect(m, c.id).not.toBeNull();
      expect(Number(m![1]), c.id).toBe(c.chapter);
      expect(`${m![1]}.${m![2]}`, c.id).toBe(c.section);
      expect(Number(m![3]), c.id).toBe(CHAPTER_START[c.chapter] + Number(m![2]));
    }
    expect(CHAPTER_START[2] + 8).toBe(25);
    expect(CHAPTER_START[5] + 5).toBe(54);
    expect(CHAPTER_START[7] + 9).toBe(71);
    expect(CHAPTER_START[9] + 7).toBe(109);
    expect(CHAPTER_START[1] + 6).toBe(163);
  });

  it('R12 91 records, none diagonal-only; chapter counts match 05 §4.12', () => {
    expect(full.length).toBe(91);
    for (const c of full) expect(c.requiresDiagonalBonds, c.id).toBe(false);
    const perChapter = new Map<number, number>();
    for (const c of full) perChapter.set(c.chapter, (perChapter.get(c.chapter) ?? 0) + 1);
    expect([...perChapter.entries()].sort((a, b) => a[0] - b[0])).toEqual([[1, 7], [2, 14], [3, 10], [4, 6], [5, 8], [6, 1], [7, 10], [8, 10], [9, 9], [10, 7], [11, 9]]);
    const ids = full.map((c) => c.id);
    expect(ids.indexOf('ch7-build-z-but-2-ene')).toBe(ids.indexOf('ch7-build-e-but-2-ene') + 1);
    expect(ids.indexOf('ch9-predict-br2-1-equiv-but-1-yne')).toBe(ids.indexOf('ch9-predict-hbr-2-equiv-hex-1-yne') + 1);
    expect(ids).toContain('ch7-build-z-2-chlorobut-2-ene');
    expect(ids).toContain('ch9-predict-lindlar-z-hex-3-ene');
    expect(ids).not.toContain('ch7-quiz-ez-2-chlorobut-2-ene');
    expect(ids).not.toContain('ch9-choose-lindlar-z-hex-3-ene');
  });
});

describe('scoring (R3)', () => {
  it('points equal POINTS_BY_DIFFICULTY and the total is the roster sum', () => {
    let sum = 0;
    const byDiff = { easy: 0, medium: 0, hard: 0 };
    for (const c of full) {
      expect(c.points, c.id).toBe(POINTS_BY_DIFFICULTY[c.difficulty]);
      sum += c.points;
      byDiff[c.difficulty]++;
    }
    const info = rosterInfo(full, DEFAULT_CONFIG);
    expect(totalPoints(info)).toBe(sum);
    expect(byDiff).toEqual({ easy: 25, medium: 50, hard: 16 });
    // cross-check against 05 §2: 91 challenges, 378 points, pass first reached at earned = 263
    expect(sum, 'roster total changed: update 05 §2').toBe(378);
    expect(Math.round((100 * 263) / sum)).toBe(70);
    expect(Math.round((100 * 262) / sum)).toBe(69);
  });

  it('rosterInfo keeps bit positions; disabled challenges drop out of the total', () => {
    const config = { ...DEFAULT_CONFIG, disabledChallenges: ['ch1-build-methane', 'ch5-build-r-3-methylhexane'] };
    const info = rosterInfo(full, config);
    expect(info.ids.length).toBe(91);
    expect(info.enabled[0]).toBe(false);
    expect(info.enabled[1]).toBe(true);
    expect(info.passMark).toBe(70);
    expect(totalPoints(info)).toBe(378 - 2 - 8);
    const enabled = loadRoster(config);
    expect(enabled.length).toBe(89);
    expect(enabled[0]!.id).toBe('ch1-build-ethene');
    expect(isEnabled(full[0]!, config)).toBe(false);
    expect(loadRoster(DEFAULT_CONFIG).length).toBe(91);
    const diag: Challenge = { ...full[1]!, id: 'x-diag', requiresDiagonalBonds: true };
    expect(isEnabled(diag, DEFAULT_CONFIG)).toBe(false);
    expect(isEnabled(diag, { ...DEFAULT_CONFIG, diagonalBonds: true })).toBe(true);
  });

  it('loadConfig reads orgocraft.config.json with defaults', () => {
    const cfg = loadConfig();
    expect(cfg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(cfg.passMark).toBe(70);
    expect(cfg.disabledChallenges).toEqual([]);
    expect(cfg.diagonalBonds).toBe(false);
    expect(DEFAULT_CONFIG.passMark).toBe(70);
  });

  it('isAttemptLimited / maxAttemptsOf', () => {
    for (const c of full) {
      const limited = c.rule.type === 'quiz' || c.rule.type === 'select-atom' || c.rule.type === 'choose-reagent';
      expect(isAttemptLimited(c.rule), c.id).toBe(limited);
      expect(maxAttemptsOf(c.rule), c.id).toBe(limited ? (c.rule as { maxAttempts: number }).maxAttempts : Infinity);
    }
    expect(challengeById('ch1-build-methane')?.title).toBe('One carbon, four hydrogens');
    expect(challengeById('nope')).toBeUndefined();
  });
});

describe('rule-level checks (R4-R11, R13)', () => {
  it('R4 maxAttempts defaults, quiz option ids, shuffle false on the formal-charge scale', () => {
    for (const c of full) {
      const r = c.rule;
      if (r.type === 'quiz') {
        expect(r.maxAttempts, c.id).toBe(DEFAULT_MAX_ATTEMPTS.quiz);
        if (r.kind === 'mc') {
          const ids = r.options.map((o) => o.id);
          expect(new Set(ids).size, c.id).toBe(ids.length);
          for (const id of r.correct) expect(ids, c.id).toContain(id);
        }
      }
      if (r.type === 'select-atom') expect(r.maxAttempts, c.id).toBe(DEFAULT_MAX_ATTEMPTS.selectAtom);
      if (r.type === 'choose-reagent') expect(r.maxAttempts, c.id).toBe(DEFAULT_MAX_ATTEMPTS.chooseReagent);
    }
    const fc = challengeById('ch2-quiz-formal-charge-hydronium')!.rule;
    expect(fc.type === 'quiz' && fc.kind === 'mc' && fc.shuffle).toBe(false);
  });

  it('R5 choose-reagent: options are enabled cards, correct subset, rejections for wrong options, engine agrees', () => {
    for (const c of full) {
      const r = c.rule;
      if (r.type !== 'choose-reagent') continue;
      for (const id of r.options) {
        expect(REAGENT_IDS, c.id).toContain(id);
        expect(cardById(id).enabledByDefault, `${c.id} ${id}`).toBe(true);
      }
      for (const id of r.correct) expect(r.options, c.id).toContain(id);
      for (const id of Object.keys(r.rejections ?? {})) {
        expect(r.options as readonly string[], c.id).toContain(id);
        expect(r.correct as readonly string[], c.id).not.toContain(id);
      }
      const res = react(parseEntry(r.reactant), cardById(r.correct[0]!), { rearrangement: 'warn' });
      expect(res.noReaction, c.id).toBeFalsy();
      expect(res.major.some((m) => sameMolecule(m, parseEntry(r.product), { stereo: 'none' }).same), c.id).toBe(true);
    }
  });

  it('R6 predict-product: the engine yields expected (and acceptAlso) under the stereo policy', () => {
    let count = 0;
    for (const c of full) {
      const r = c.rule;
      if (r.type !== 'predict-product') continue;
      count++;
      const opts = { ...(r.equiv !== undefined ? { equiv: r.equiv } : {}), ...(r.rx !== undefined ? { rx: parseEntry(r.rx) } : {}), rearrangement: 'warn' as const };
      const res = react(parseEntry(r.reactant), cardById(r.reagentId), opts);
      expect(res.noReaction, c.id).toBeFalsy();
      const major = [...res.major];
      const used = new Set<number>();
      for (const e of r.expected) {
        const k = major.findIndex((m, i) => !used.has(i) && sameMolecule(m, parseEntry(e), { stereo: r.stereoCheck }).same);
        expect(k, `${c.id}: ${e} not in major`).toBeGreaterThanOrEqual(0);
        used.add(k);
      }
      const remainder = major.filter((_, i) => !used.has(i));
      const alts = (r.acceptAlso ?? []).map((a) => parseEntry(a.smiles));
      if (!res.mixture) {
        for (const m of remainder) expect(alts.some((a) => sameMolecule(m, a, { stereo: 'none' }).same), `${c.id}: unlisted major product`).toBe(true);
      }
      const pool = [...res.major, ...(res.minor ?? [])];
      for (const a of r.acceptAlso ?? []) {
        expect(pool.some((m) => sameMolecule(m, parseEntry(a.smiles), { stereo: 'none' }).same), `${c.id}: acceptAlso ${a.smiles}`).toBe(true);
      }
      if (r.stereoCheck !== 'none') {
        for (const e of r.expected) {
          const g = parseEntry(e);
          expect(g.atoms.some((a) => a.tet) || g.bonds.some((b) => b.ez), `${c.id}: ${e} has no stereo tag`).toBe(true);
        }
      }
    }
    expect(count).toBe(29);
    const sn2 = challengeById('ch11-predict-sn2-inversion-2-bromobutane')!.rule as PredictProductRule;
    expect(sn2.reagentId).toBe('SN2_NAI');
    const res = react(parseEntry(sn2.reactant), cardById('SN2_NAI'));
    expect(res.major.length).toBe(1);
    expect(res.stereo).toBe('absolute');
  });

  it('R7 select-atom: answer sets non-empty, verified classes, margins >= PKA_MIN_MARGIN', () => {
    for (const c of full) {
      const r = c.rule;
      if (r.type !== 'select-atom') continue;
      const graphs = r.molecules.map(parseEntry);
      const analyses = graphs.map((g) => analyze(g));
      const A = answerSet(r.selector, graphs, analyses);
      expect(A.length, c.id).toBeGreaterThan(0);
      expect(r.answerDescription.length, c.id).toBeGreaterThan(0);
      if (r.target === 'hydrogens') expect(r.selector.kind, c.id).toBe('most-acidic-h');
      if (r.match === 'all') {
        const total = graphs.reduce((n, g) => n + g.atoms.length, 0);
        expect(A.length, c.id).toBeLessThan(total);
      }
      if (r.selector.kind === 'most-acidic-h') {
        const sites = analyses.flatMap((a) => a.acidity.hydrogens);
        const answerIds = new Set(A.map((i) => `${i.molecule}:${i.atom}`));
        for (const [m, a] of analyses.entries()) for (const s of a.acidity.hydrogens) if (answerIds.has(`${m}:${s.parentId}`)) expect(s.verified, `${c.id} ${s.classId}`).toBe(true);
        const distinct = [...new Set(sites.map((s) => s.pKa))].sort((x, y) => x - y);
        expect(distinct[1]! - distinct[0]!, c.id).toBeGreaterThanOrEqual(PKA_MIN_MARGIN);
      }
      if (r.selector.kind === 'most-basic-site' || r.selector.kind === 'most-basic-n') {
        const nOnly = r.selector.kind === 'most-basic-n';
        const sites = analyses.flatMap((a, m) => a.acidity.basicSites.filter((b) => !nOnly || graphs[m]!.atoms[b.atomId]!.el === 'N'));
        const answerIds = new Set(A.map((i) => `${i.molecule}:${i.atom}`));
        for (const s of sites) if (answerIds.has(`${analyses.findIndex((a) => a.acidity.basicSites.includes(s))}:${s.atomId}`)) expect(s.verified, `${c.id} ${s.classId}`).toBe(true);
        const distinct = [...new Set(sites.map((s) => s.pKaH))].sort((x, y) => y - x);
        expect(distinct[0]! - distinct[1]!, c.id).toBeGreaterThanOrEqual(PKA_MIN_MARGIN);
      }
    }
    // the 05 §4.2 validation facts
    const eth = analyze(parseEntry('CCO')).acidity;
    expect(Math.min(...eth.hydrogens.map((s) => s.pKa))).toBe(16);
    expect(eth.mostAcidic.every((s) => s.classId === 'OH.alcohol.primary')).toBe(true);
    const pent = analyze(parseEntry('CC(=O)CC(C)=O')).acidity;
    expect(pent.mostAcidic.every((s) => s.classId === 'CH.alpha.ketone+ketone' && s.pKa === 9)).toBe(true);
    const amino = analyze(parseEntry('OCCN')).acidity;
    expect(amino.mostBasic.every((b) => b.classId === 'B.N.amine.primary' && b.pKaH === 10.6)).toBe(true);
  });

  it('R8 isomer-set: count, formulas, distinct hashes, optional diagonal isomers have odd rings', () => {
    for (const c of full) {
      const r = c.rule;
      if (r.type !== 'isomer-set') continue;
      expect(r.count, c.id).toBe(r.isomers.length);
      const hashes = new Set<string>();
      for (const s of r.isomers) {
        const g = parseSmiles(s).graph;
        expect(hillFormula(g, implicitHydrogens(g).hydrogens), `${c.id} ${s}`).toBe(r.formula);
        const h = hashOfSmiles(s);
        expect(hashes.has(h), `${c.id} ${s}`).toBe(false);
        hashes.add(h);
      }
      const { required, optional } = isomerHashes(r as IsomerSetRule);
      expect(required.size).toBe(r.isomers.length);
      expect(isomerHashes(r as IsomerSetRule).required).toBe(required);
      for (const s of r.optionalDiagonalIsomers ?? []) {
        const g = parseSmiles(s).graph;
        expect(hillFormula(g, implicitHydrogens(g).hydrogens), `${c.id} ${s}`).toBe(r.formula);
        expect(required.has(hashOfSmiles(s)), `${c.id} ${s}`).toBe(false);
        expect(optional.has(hashOfSmiles(s))).toBe(true);
        expect(smallestRings(g).some((ring) => ring.length % 2 === 1), `${c.id} ${s}`).toBe(true);
      }
    }
    expect(hashOfSmiles('CCCC')).toBe(analyze(parseSmiles('CCCC').graph).hash);
    expect(hashOfSmiles('C/C=C/C')).toBe(hashOfSmiles('CC=CC'));
  });

  it('R9 formula-and-groups: required and forbidden disjoint, ids in GROUP_IDS', () => {
    for (const c of full) {
      const r = c.rule;
      if (r.type !== 'formula-and-groups') continue;
      for (const g of [...r.required, ...r.forbidden]) expect(GROUP_IDS, `${c.id} ${g}`).toContain(g);
      for (const g of r.required) expect(r.forbidden, c.id).not.toContain(g);
      expect(/[+-]/.test(r.formula), c.id).toBe(false);
    }
  });

  it('R10 build targets embed (stereo kept for stereo-exact, stripped otherwise) and names list both locant spellings', () => {
    for (const c of full) {
      const r = c.rule;
      if (r.type === 'stereo-exact') {
        for (const s of [r.target, ...(r.accept ?? [])]) expect(embedOnLattice(parseEntry(s)), `${c.id} ${s}`).not.toBeNull();
      }
      if (r.type === 'exact-molecule' || r.type === 'name-to-structure') {
        expect(embedOnLattice(withoutStereoTags(parseEntry(r.target))), c.id).not.toBeNull();
      }
    }
    const names = (id: string): readonly string[] => {
      const r = challengeById(id)!.rule;
      return r.type === 'name-to-structure' ? r.names : [];
    };
    expect(names('ch7-name-2-methylbut-2-ene')).toEqual(['2-methylbut-2-ene', '2-methyl-2-butene']);
    expect(names('ch3-name-2-2-4-trimethylpentane')).toEqual(['2,2,4-trimethylpentane', 'isooctane']);
    expect(names('ch4-name-methylcyclohexane')).toEqual(['methylcyclohexane']);
    expect(names('ch3-name-3-ethyl-2-methylpentane')).toEqual(['3-ethyl-2-methylpentane']);
    expect(names('ch10-name-2-bromo-5-methylhexane')).toEqual(['2-bromo-5-methylhexane']);
  });

  it('L7 every rule SMILES is a library SMILES', () => {
    let n = 0;
    for (const c of full) {
      const r = c.rule;
      const all: string[] = [];
      if (r.type === 'exact-molecule' || r.type === 'name-to-structure') all.push(r.target);
      if (r.type === 'stereo-exact') all.push(r.target, ...(r.accept ?? []));
      if (r.type === 'isomer-set') all.push(...r.isomers);
      if (r.type === 'select-atom') all.push(...r.molecules);
      if (r.type === 'predict-product') all.push(r.reactant, ...r.expected, ...(r.acceptAlso ?? []).map((a) => a.smiles), ...(r.rx !== undefined ? [r.rx] : []));
      if (r.type === 'choose-reagent') all.push(r.reactant, r.product);
      if (r.type === 'quiz' && r.display) all.push(r.display.smiles);
      for (const s of all) {
        n++;
        expect(entryBySmiles(s), `${c.id} ${s}`).toBeDefined();
      }
    }
    expect(n).toBeGreaterThan(120);
  });

  it('R11 texts are non-empty printable ASCII (plus the triple-bond and degree signs) without back-references', () => {
    for (const c of full) {
      for (const f of ['instruction', 'objective', 'hint', 'title'] as const) {
        const t = c[f];
        expect(t.trim().length, `${c.id} ${f}`).toBeGreaterThan(0);
        for (const ch of t) {
          const code = ch.codePointAt(0)!;
          expect(ch === '≡' || ch === '°' || (code >= 0x20 && code <= 0x7e), `${c.id} ${f}: ${ch}`).toBe(true);
        }
        const lower = t.toLowerCase();
        for (const phrase of ['previous', 'you are holding', 'the last molecule']) expect(lower.includes(phrase), `${c.id} ${f}`).toBe(false);
      }
    }
  });

  it('R13 quiz displays embed with stereo (locked placement) and markedAtom is in range', () => {
    let n = 0;
    for (const c of full) {
      const r = c.rule;
      if (r.type !== 'quiz' || !r.display) continue;
      n++;
      const e = entryBySmiles(r.display.smiles)!;
      const emb = embedOnLattice(parseEntry(e));
      expect(emb, c.id).not.toBeNull();
      const wg = worldGraphFromEmbedding(parseEntry(e), emb!);
      expect(hasPositions(wg)).toBe(true);
      if (r.display.markedAtom !== undefined) expect(r.display.markedAtom, c.id).toBeLessThan(parseEntry(e).atoms.length);
    }
    expect(n).toBe(3);
  });
});

describe('validateContent negatives for roster checks', () => {
  const problems = (roster: ChallengeRoster) => validateContent(library, roster, reagents);

  it('the shipped roster has no problems', () => {
    expect(problems(rosterFile)).toEqual([]);
  });

  it('R3 wrong points', () => {
    const r = mutate((c) => ({ ...c, points: 3 }), 'ch1-build-methane');
    expect(problems(r)).toContain('challenge:ch1-build-methane: points 3 but difficulty easy gives 2');
  });

  it('R2 wrong module number and duplicate id', () => {
    const r = mutate((c) => ({ ...c, source: 'MM 1.6 (m00164)' }), 'ch1-build-methane');
    expect(problems(r)).toContain('challenge:ch1-build-methane: module m00164 should be m00163');
    const dup: ChallengeRoster = { version: 1, challenges: [...rosterFile.challenges, rosterFile.challenges[0]!] };
    expect(problems(dup)).toContain('challenge:ch1-build-methane: duplicate id');
  });

  it('R4 wrong maxAttempts and unknown correct option', () => {
    const r = mutate((c) => ({ ...c, rule: { ...(c.rule as { maxAttempts: number }), maxAttempts: 5 } as Challenge['rule'] }), 'ch1-quiz-hybridization-acetamide-n');
    expect(problems(r)).toContain('challenge:ch1-quiz-hybridization-acetamide-n: maxAttempts 5 but quiz default is 2');
    const r2 = mutate((c) => ({ ...c, rule: { ...c.rule, correct: ['z'] } as Challenge['rule'] }), 'ch1-quiz-hybridization-acetamide-n');
    expect(problems(r2)).toContain('challenge:ch1-quiz-hybridization-acetamide-n: correct option z is not an option');
  });

  it('R5 / R6 engine disagreement', () => {
    const r = mutate((c) => ({ ...c, rule: { ...c.rule, expected: ['CCCCl'] } as Challenge['rule'] }), 'ch6-predict-ethene-hbr');
    expect(problems(r)).toContain('challenge:ch6-predict-ethene-hbr: expected CCCCl is not among react(C=C, HX_HBR).major');
    const r2 = mutate((c) => ({ ...c, rule: { ...c.rule, correct: ['OXYMERC'] } as Challenge['rule'] }), 'ch8-choose-anti-markovnikov-hydration');
    expect(problems(r2)).toContain('challenge:ch8-choose-anti-markovnikov-hydration: rejection OXYMERC is not a wrong option');
    expect(problems(r2)).toContain('challenge:ch8-choose-anti-markovnikov-hydration: react(C=C(C)C, OXYMERC) does not give CC(C)CO');
  });

  it('R7 unverified or narrow pKa margins are rejected', () => {
    // propanamide: the amide N-H class is unverified
    const r = mutate((c) => ({ ...c, rule: { ...c.rule, molecules: ['CCC(N)=O'] } as Challenge['rule'] }), 'ch2-select-most-acidic-h-ethanol');
    const p = problems(r);
    expect(p.some((s) => s.startsWith('challenge:ch2-select-most-acidic-h-ethanol:') && /not a library SMILES/.test(s))).toBe(true);
    expect(p.some((s) => s.startsWith('challenge:ch2-select-most-acidic-h-ethanol:') && /(unverified|margin)/.test(s))).toBe(true);
    // methanol (15.5) next to ethanol (16.0): the runner-up class is only 0.5 units away
    const r2 = mutate((c) => ({ ...c, rule: { ...c.rule, molecules: ['CO', 'CCO'] } as Challenge['rule'] }), 'ch2-select-most-acidic-h-ethanol');
    expect(problems(r2).some((s) => /ch2-select-most-acidic-h-ethanol: most-acidic-h margin/.test(s))).toBe(true);
    const r3 = mutate((c) => ({ ...c, rule: { ...c.rule, target: 'hydrogens' } as Challenge['rule'] }), 'ch2-select-most-basic-site-2-aminoethanol');
    expect(problems(r3)).toContain("challenge:ch2-select-most-basic-site-2-aminoethanol: target 'hydrogens' only with most-acidic-h, not most-basic-site");
  });

  it('R8 isomer problems', () => {
    const r = mutate((c) => ({ ...c, rule: { ...c.rule, count: 3 } as Challenge['rule'] }), 'ch3-isomers-c4h10');
    expect(problems(r)).toContain('challenge:ch3-isomers-c4h10: count 3 but 2 isomers listed');
    const r2 = mutate((c) => ({ ...c, rule: { ...c.rule, isomers: ['CCCC', 'CCCC'], count: 2 } as Challenge['rule'] }), 'ch3-isomers-c4h10');
    expect(problems(r2)).toContain("challenge:ch3-isomers-c4h10: isomer CCCC duplicates another isomer's constitution");
  });

  it('R9 group id problems', () => {
    const r = mutate((c) => ({ ...c, rule: { ...c.rule, required: ['alcohol'], forbidden: ['alcohol', 'ether'] } as Challenge['rule'] }), 'ch3-fg-alcohol-c3h8o');
    expect(problems(r)).toContain('challenge:ch3-fg-alcohol-c3h8o: group alcohol is both required and forbidden');
  });

  it('R10 / R13 unbuildable targets and displays', () => {
    const r = mutate((c) => ({ ...c, rule: { ...c.rule, display: { smiles: 'C1CC1' } } as Challenge['rule'] }), 'ch7-quiz-alkene-stability');
    expect(problems(r)).toContain('challenge:ch7-quiz-alkene-stability: display C1CC1 is not buildable');
    const r2 = mutate((c) => ({ ...c, rule: { ...c.rule, target: 'C1CC1' } as Challenge['rule'] }), 'ch1-build-methane');
    expect(problems(r2)).toContain('challenge:ch1-build-methane: target C1CC1 is not buildable on the lattice');
    const r3 = mutate((c) => ({ ...c, rule: { ...c.rule, names: ['2-methylbut-2-ene'] } as Challenge['rule'] }), 'ch7-name-2-methylbut-2-ene');
    expect(problems(r3)).toContain('challenge:ch7-name-2-methylbut-2-ene: names lists 2-methylbut-2-ene but not the other locant spelling 2-methyl-2-butene');
  });

  it('R11 / R12 text and diagonal problems', () => {
    const r = mutate((c) => ({ ...c, hint: 'Look at the previous molecule' }), 'ch1-build-methane');
    expect(problems(r)).toContain('challenge:ch1-build-methane: hint refers to "previous"');
    const r2 = mutate((c) => ({ ...c, title: 'Café' }), 'ch1-build-methane');
    expect(problems(r2)).toContain('challenge:ch1-build-methane: title contains a non-ASCII character');
    const r3 = mutate((c) => ({ ...c, requiresDiagonalBonds: true }), 'ch1-build-methane');
    expect(problems(r3)).toContain('challenge:ch1-build-methane: requiresDiagonalBonds must be false in v1');
  });

  it('buildReport lists every build target and every entry', () => {
    const rows = buildReport(library, rosterFile);
    expect(rows.filter((r) => r.where.startsWith('library:')).length).toBe(192);
    expect(rows.some((r) => r.where === 'challenge:ch7-build-z-but-2-ene:target' && r.suppressedPairs.length === 1)).toBe(true);
    expect(rows.every((r) => r.nodesVisited >= 0)).toBe(true);
  });
});
