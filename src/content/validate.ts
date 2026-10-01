/**
 * Content validator: `validateContent(library, roster, reagents)` returns
 * every problem as "<where>: <message>"; `validateContentDetailed` returns
 * the structured list; `buildReport` lists the required "no bond" pairs of
 * every build target and library entry. PURE MODULE.
 * See docs/design/05-content.md section 11 and 09-amendment-no-bond.md section 1.9 / 4.4.
 */
import { GROUP_IDS, PKA_MIN_MARGIN } from '../chem/types';
import type { Analysis, GroupId, MoleculeGraph, ReactOptions, ReactionResult } from '../chem/types';
import { DEFAULT_MAX_ATTEMPTS, POINTS_BY_DIFFICULTY, REAGENT_IDS } from './types';
import type {
  ChallengeRoster, ChallengeRule, Chapter, MoleculeEntry, MoleculeLibrary, ReagentCard, ReagentId, RuleType, Topic,
} from './types';
import { parseSmiles } from '../chem/smiles';
import { implicitHydrogens } from '../chem/hydrogens';
import { hillFormula, ringCount } from '../chem/formula';
import { smallestRings, withoutStereoTags } from '../chem/graph';
import { sameMolecule } from '../chem/compare';
import { analyze } from '../chem/analyze';
import { analyzeStereo, labelTargetStereo } from '../chem/stereo';
import { embedOnLattice } from '../chem/embed';
import type { LatticeEmbedding } from '../chem/embed';
import { hasPositions } from '../chem/types';
import type { WorldAtom, WorldGraph } from '../chem/types';
import { buildGraph } from '../chem/graph';
import { REAGENT_CARDS } from '../reactions/react';
import { react } from '../reactions/react';
import { layoutOf, parseEntry, parseEntryDetailed, suppressedPairsOf } from './library';
import { answerSet } from './selectors';
import { hashOfSmiles } from './challenges';

export interface ContentProblem {
  /** "challenge:<id>" | "library:<id>" | "reagent:<id>" */
  readonly where: string;
  readonly message: string;
}

export interface BuildReportRow {
  readonly where: string;
  readonly smiles: string;
  readonly nodesVisited: number;
  readonly suppressedPairs: readonly (readonly [number, number])[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const RULE_TYPES: readonly RuleType[] = [
  'exact-molecule', 'formula-and-groups', 'isomer-set', 'name-to-structure', 'stereo-exact', 'select-atom',
  'predict-product', 'choose-reagent', 'quiz',
];

const TOPICS: readonly Topic[] = [
  'hybridization', 'structures', 'polarity', 'formal-charge', 'acids-bases', 'functional-groups', 'isomers', 'nomenclature',
  'alkyl-groups', 'cycloalkanes', 'cis-trans', 'chirality', 'R/S', 'meso', 'unsaturation', 'E/Z', 'alkene-stability',
  'carbocations', 'addition', 'rearrangement', 'elimination', 'anti-addition', 'hydration', 'hydroxylation', 'reduction',
  'cleavage', 'alkyne-addition', 'alkyne-hydration', 'acetylide', 'organohalides', 'substitution', 'radical',
];

/** OpenStax module number = chapterStart + sectionNumber (05 §1). */
export const CHAPTER_START: Readonly<Record<Chapter, number>> = {
  1: 157, 2: 17, 3: 31, 4: 39, 5: 49, 6: 76, 7: 62, 8: 88, 9: 102, 10: 112, 11: 121,
};

const HALOGEN_RULES = new Set(['HX_ADD', 'X2_ADD', 'HOX_ADD', 'RADICAL_HBR', 'ALLYLIC_BROMINATION', 'RADICAL_HALOGENATION', 'ROH_TO_RX']);

const FORBIDDEN_PHRASES = ['previous', 'you are holding', 'the last molecule'];

/**
 * The McMurry spelling of a current-IUPAC name with an infix locant
 * (`2-methylbut-2-ene` -> `2-methyl-2-butene`), or null when the name has no
 * infix locant (`methylcyclohexane`, `2,2,4-trimethylpentane`).
 */
export function mcmurrySpelling(name: string): string | null {
  const m = /^(.*)-(\d+(?:,\d+)*)-([a-z]+)$/.exec(name);
  if (!m) return null;
  const left = m[1]!;
  const locants = m[2]!;
  const suffix = m[3]!;
  const stem = /((?:cyclo)?(?:meth|eth|prop|but|pent|hex|hept|oct|non|dec)a?)$/.exec(left);
  if (!stem) return null;
  const prefix = left.slice(0, left.length - stem[1]!.length);
  return `${prefix === '' ? '' : `${prefix}-`}${locants}-${stem[1]}${suffix}`;
}

function isAsciiPrintable(s: string): boolean {
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '≡' || ch === '°') continue; // ≡ and °
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

function tryParse(smiles: string): { graph: MoleculeGraph; hydrogens: readonly number[] } | string {
  try {
    const p = parseEntryDetailed(smiles);
    return { graph: p.graph, hydrogens: p.hydrogens };
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function hasTags(g: MoleculeGraph): boolean {
  return g.atoms.some((a) => a.tet !== undefined) || g.bonds.some((b) => b.ez !== undefined);
}

/** World graph from an embedding of a tagged graph: tags stripped, positions and H cells set. */
export function worldGraphFromEmbedding(g: MoleculeGraph, e: LatticeEmbedding): WorldGraph {
  const flat = withoutStereoTags(g);
  const atoms: WorldAtom[] = flat.atoms.map((a, i) => ({
    id: a.id, el: a.el, charge: a.charge, explicitH: null, aromatic: a.aromatic, pos: e.pos[i]!, hPos: e.hPos.get(i) ?? [],
  }));
  return buildGraph(atoms, flat.bonds);
}

/** Every SMILES a rule references, with the field it came from. */
export function ruleSmiles(rule: ChallengeRule): { readonly field: string; readonly smiles: string }[] {
  const out: { field: string; smiles: string }[] = [];
  switch (rule.type) {
    case 'exact-molecule':
    case 'name-to-structure':
      out.push({ field: 'target', smiles: rule.target });
      break;
    case 'stereo-exact':
      out.push({ field: 'target', smiles: rule.target });
      for (const s of rule.accept ?? []) out.push({ field: 'accept', smiles: s });
      break;
    case 'isomer-set':
      for (const s of rule.isomers) out.push({ field: 'isomers', smiles: s });
      break;
    case 'select-atom':
      for (const s of rule.molecules) out.push({ field: 'molecules', smiles: s });
      break;
    case 'predict-product':
      out.push({ field: 'reactant', smiles: rule.reactant });
      if (rule.rx !== undefined) out.push({ field: 'rx', smiles: rule.rx });
      for (const s of rule.expected) out.push({ field: 'expected', smiles: s });
      for (const a of rule.acceptAlso ?? []) out.push({ field: 'acceptAlso', smiles: a.smiles });
      break;
    case 'choose-reagent':
      out.push({ field: 'reactant', smiles: rule.reactant });
      out.push({ field: 'product', smiles: rule.product });
      break;
    case 'quiz':
      if (rule.display) out.push({ field: 'display', smiles: rule.display.smiles });
      break;
    case 'formula-and-groups':
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Library checks (L1-L6, L8)
// ---------------------------------------------------------------------------

function validateLibrary(library: MoleculeLibrary, out: ContentProblem[]): Map<string, MoleculeEntry> {
  const byId = new Map<string, MoleculeEntry>();
  const bySmiles = new Map<string, MoleculeEntry>();
  const parsedById = new Map<string, { graph: MoleculeGraph; hydrogens: readonly number[] }>();
  if (library.version !== 1) out.push({ where: 'library', message: `version must be 1, got ${String(library.version)}` });
  for (const e of library.entries) {
    const where = `library:${e.id}`;
    const problem = (message: string): void => { out.push({ where, message }); };
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) problem('id is not kebab-case ASCII');
    if (byId.has(e.id)) problem('duplicate id');
    byId.set(e.id, e);
    if (bySmiles.has(e.smiles)) problem(`duplicate smiles ${e.smiles} (also ${bySmiles.get(e.smiles)!.id})`);
    bySmiles.set(e.smiles, e);
    if ('stereoBuildable' in (e as object)) problem('obsolete field stereoBuildable');
    if (e.requiresDiagonalBonds) problem('requiresDiagonalBonds must be false (no odd rings in v1)');
    if (!e.name) problem('empty name');
    if (/[cnosp]/.test(e.smiles)) problem('smiles must be Kekulé (no lowercase aromatic atoms)');
    // L1
    const p = tryParse(e.smiles);
    if (typeof p === 'string') { problem(`smiles does not parse: ${p}`); continue; }
    parsedById.set(e.id, p);
    const { graph, hydrogens } = p;
    // L2
    const f = hillFormula(graph, hydrogens);
    if (f !== e.formula) problem(`formula ${e.formula} but the engine computes ${f}`);
    // L3
    const labels = labelTargetStereo(graph, hydrogens);
    const expected = e.labels ?? {};
    for (const [key, label] of Object.entries(expected)) {
      if (key.includes('=')) {
        const [i, j] = key.split('=').map((s) => Number(s) - 1);
        const k = graph.bonds.findIndex((b) => (b.a === i && b.b === j) || (b.a === j && b.b === i));
        const got = k >= 0 ? labels.bonds.get(k) : undefined;
        if (got !== label) problem(`label ${key}:${label} but the engine gives ${got ?? 'none'}`);
      } else {
        const atom = Number(key) - 1;
        const got = labels.centers.get(atom);
        const lower = label === label.toLowerCase();
        if (lower) {
          if (got !== 'NOT_CENTER' && got !== undefined) problem(`pseudo-asymmetric label ${key}:${label} but the engine gives ${got}`);
        } else if (got !== label) problem(`label ${key}:${label} but the engine gives ${got ?? 'none'}`);
      }
    }
    for (const [atom, got] of labels.centers) {
      if ((got === 'R' || got === 'S') && expected[String(atom + 1)] === undefined) problem(`engine labels atom ${atom + 1} ${got} but the entry lists no label`);
    }
    for (const [k, got] of labels.bonds) {
      const b = graph.bonds[k]!;
      if ((got === 'E' || got === 'Z') && expected[`${b.a + 1}=${b.b + 1}`] === undefined) problem(`engine labels bond ${b.a + 1}=${b.b + 1} ${got} but the entry lists no label`);
    }
    // L6
    for (const ring of smallestRings(graph)) if (ring.length % 2 === 1) problem(`odd ring of size ${ring.length}`);
    // L8
    if (e.layout !== undefined) {
      if (e.layout.length !== graph.atoms.length) {
        problem(`layout has ${e.layout.length} cells for ${graph.atoms.length} heavy atoms`);
      } else {
        const pos = e.layout;
        for (const b of graph.bonds) {
          const pa = pos[b.a]!;
          const pb = pos[b.b]!;
          const d = Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]);
          if (d !== 1) problem(`layout: bonded atoms ${b.a + 1} and ${b.b + 1} are not face-adjacent`);
        }
        const seen = new Set<string>();
        for (const q of pos) {
          const k = q.join(',');
          if (seen.has(k)) problem(`layout: two atoms share the cell ${k}`);
          seen.add(k);
        }
        const lay = layoutOf(e);
        const sup = suppressedPairsOf(graph, pos.map((q) => [q[0], q[1], q[2]] as const));
        if (!lay || JSON.stringify(lay.suppressedPairs) !== JSON.stringify(sup)) problem('layoutOf does not report the layout\'s touching unbonded pairs');
        if (lay && hasTags(graph)) {
          const wg = worldGraphFromEmbedding(graph, lay);
          const r = sameMolecule(wg, graph, { stereo: 'absolute' });
          if (r.verdict !== 'SAME') problem(`layout does not realise the entry stereo (${r.verdict})`);
        }
      }
    }
    // L4
    if (hasTags(graph)) {
      const lay = layoutOf(e);
      if (!lay) problem('entry does not embed on the lattice');
      else {
        const wg = worldGraphFromEmbedding(graph, lay);
        if (hasPositions(wg)) {
          const st = analyzeStereo(wg, implicitHydrogens(wg).hydrogens);
          if (st.meso !== (e.meso === true)) problem(`meso flag ${e.meso === true} but the engine reports ${st.meso}`);
        }
      }
    } else if (e.meso === true) problem('meso flag on an entry without stereo tags');
  }
  // L5: no two entries SAME under stereo:'absolute' (hash buckets first)
  const buckets = new Map<string, MoleculeEntry[]>();
  for (const e of library.entries) {
    if (!parsedById.has(e.id)) continue;
    const h = hashOfSmiles(e.smiles);
    const list = buckets.get(h);
    if (list) list.push(e);
    else buckets.set(h, [e]);
  }
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        // SAME in both directions: an untagged target is a wildcard, so a flat entry may coexist with its stereo isomers
        const ga = parsedById.get(a.id)!.graph;
        const gb = parsedById.get(b.id)!.graph;
        if (sameMolecule(ga, gb, { stereo: 'absolute' }).verdict === 'SAME' && sameMolecule(gb, ga, { stereo: 'absolute' }).verdict === 'SAME') {
          out.push({ where: `library:${b.id}`, message: `same molecule as ${a.id} under stereo:'absolute'` });
        }
      }
    }
  }
  return bySmiles;
}

// ---------------------------------------------------------------------------
// Reagent checks
// ---------------------------------------------------------------------------

function validateReagents(reagents: readonly ReagentCard[], out: ContentProblem[]): void {
  const count = new Map<string, number>();
  for (const c of reagents) count.set(c.id, (count.get(c.id) ?? 0) + 1);
  for (const id of REAGENT_IDS) {
    const n = count.get(id) ?? 0;
    if (n !== 1) out.push({ where: `reagent:${id}`, message: `expected exactly one card, found ${n}` });
  }
  for (const c of reagents) {
    const where = `reagent:${c.id}`;
    const problem = (message: string): void => { out.push({ where, message }); };
    if (!(REAGENT_IDS as readonly string[]).includes(c.id)) { problem('unknown reagent id'); continue; }
    const canonical = REAGENT_CARDS[c.id];
    if (JSON.stringify(canonical) !== JSON.stringify(c)) problem('card differs from REAGENT_CARDS in src/reactions/react.ts');
    if (c.rule === 'SUBST_ELIM') {
      if (!c.nuc) problem('SUBST_ELIM card without nuc');
      if (!c.solvent) problem('SUBST_ELIM card without solvent');
    }
    if (c.nuc) {
      try {
        const g = parseSmiles(c.nuc.fragment).graph;
        if (g.atoms[0]?.el !== c.nuc.atom) problem(`nuc.fragment ${c.nuc.fragment} does not start with ${c.nuc.atom}`);
      } catch (e) {
        problem(`nuc.fragment does not parse: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (HALOGEN_RULES.has(c.rule) && c.rule !== 'ROH_TO_RX' && !c.halogen) problem(`rule ${c.rule} needs halogen`);
    if (c.rule === 'ROH_TO_RX' && !c.halogen) problem('ROH_TO_RX card needs halogen');
    if (c.requiresDiagonalBonds === true && c.enabledByDefault) problem('requiresDiagonalBonds card must not be enabled by default');
    if (!c.label || !c.reagentText) problem('empty label or reagentText');
  }
}

// ---------------------------------------------------------------------------
// Roster checks (R1-R13, S1, L7)
// ---------------------------------------------------------------------------

/** `react` never throws for chemistry reasons, but a malformed card (no nuc) does: report instead of crashing the validator. */
function safeReact(substrate: MoleculeGraph, card: ReagentCard, opts: ReactOptions): ReactionResult | string {
  try {
    return react(substrate, card, opts);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function cardOf(id: ReagentId, reagents: readonly ReagentCard[]): ReagentCard | undefined {
  return reagents.find((c) => c.id === id) ?? REAGENT_CARDS[id];
}

function validateRoster(roster: ChallengeRoster, bySmiles: ReadonlyMap<string, MoleculeEntry>, reagents: readonly ReagentCard[], out: ContentProblem[]): void {
  if (roster.version !== 1) out.push({ where: 'roster', message: `version must be 1, got ${String(roster.version)}` });
  const ids = new Set<string>();
  let lastChapter = 0;
  for (const c of roster.challenges) {
    const where = `challenge:${c.id}`;
    const problem = (message: string): void => { out.push({ where, message }); };
    // R1 / R2
    if (!/^ch\d+-[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) problem('id is not ch<N>-<verb>-<subject> kebab-case');
    if (ids.has(c.id)) problem('duplicate id');
    ids.add(c.id);
    if (!(Number.isInteger(c.chapter) && c.chapter >= 1 && c.chapter <= 11)) problem(`chapter ${String(c.chapter)} out of 1..11`);
    if (c.chapter < lastChapter) problem('file order must be non-decreasing in chapter');
    lastChapter = Math.max(lastChapter, c.chapter);
    if (!TOPICS.includes(c.topic)) problem(`unknown topic ${String(c.topic)}`);
    if (!RULE_TYPES.includes(c.rule?.type)) problem(`unknown rule type ${String(c.rule?.type)}`);
    if (!['easy', 'medium', 'hard'].includes(c.difficulty)) problem(`unknown difficulty ${String(c.difficulty)}`);
    if (typeof c.requiresDiagonalBonds !== 'boolean') problem('requiresDiagonalBonds must be present');
    if (c.requiresDiagonalBonds === true) problem('requiresDiagonalBonds must be false in v1');
    const m = /^MM (\d+)\.(\d+) \(m(\d{5})\)$/.exec(c.source ?? '');
    if (!m) problem(`source "${c.source}" does not match "MM <ch>.<sec> (m000NN)"`);
    else {
      const ch = Number(m[1]) as Chapter;
      const sec = Number(m[2]);
      const start = CHAPTER_START[ch];
      if (ch !== c.chapter) problem(`source chapter ${ch} differs from chapter ${c.chapter}`);
      if (c.section !== `${m[1]}.${m[2]}`) problem(`source section ${m[1]}.${m[2]} differs from section ${c.section}`);
      if (start !== undefined && Number(m[3]) !== start + sec) problem(`module m${m[3]} should be m${String(start + sec).padStart(5, '0')}`);
    }
    // R3
    if (c.points !== POINTS_BY_DIFFICULTY[c.difficulty]) problem(`points ${c.points} but difficulty ${c.difficulty} gives ${POINTS_BY_DIFFICULTY[c.difficulty]}`);
    // R11
    for (const field of ['instruction', 'objective', 'hint', 'title'] as const) {
      const text = c[field];
      if (typeof text !== 'string' || text.trim() === '') { problem(`${field} is empty`); continue; }
      if (!isAsciiPrintable(text)) problem(`${field} contains a non-ASCII character`);
      const lower = text.toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) if (lower.includes(phrase)) problem(`${field} refers to "${phrase}"`);
    }
    if (c.feedback) {
      for (const [k, v] of Object.entries(c.feedback)) {
        if (typeof v !== 'string' || v.trim() === '') problem(`feedback override ${k} is empty`);
        else if (!isAsciiPrintable(v)) problem(`feedback override ${k} contains a non-ASCII character`);
      }
    }
    // L7
    const rule = c.rule;
    if (!rule) continue;
    const parsedOf = new Map<string, MoleculeGraph>();
    for (const { field, smiles } of ruleSmiles(rule)) {
      if (!bySmiles.has(smiles)) problem(`${field} ${smiles} is not a library SMILES`);
      const p = tryParse(smiles);
      if (typeof p === 'string') problem(`${field} ${smiles} does not parse: ${p}`);
      else parsedOf.set(smiles, p.graph);
    }
    const graphOf = (smiles: string): MoleculeGraph | undefined => parsedOf.get(smiles);
    switch (rule.type) {
      case 'quiz': {
        // R4
        if (rule.maxAttempts !== DEFAULT_MAX_ATTEMPTS.quiz) problem(`maxAttempts ${rule.maxAttempts} but quiz default is ${DEFAULT_MAX_ATTEMPTS.quiz}`);
        if (rule.kind === 'mc') {
          const optIds = new Set<string>();
          for (const o of rule.options) {
            if (optIds.has(o.id)) problem(`duplicate option id ${o.id}`);
            optIds.add(o.id);
          }
          for (const id of rule.correct) if (!optIds.has(id)) problem(`correct option ${id} is not an option`);
          if (rule.correct.length === 0) problem('no correct option');
        }
        if (!rule.explanation) problem('empty explanation');
        if (!rule.prompt) problem('empty prompt');
        // R13
        if (rule.display) {
          const entry = bySmiles.get(rule.display.smiles);
          const g = graphOf(rule.display.smiles);
          const emb = entry ? layoutOf(entry) : g ? embedOnLattice(g) : null;
          if (!emb) problem(`display ${rule.display.smiles} is not buildable`);
          if (rule.display.markedAtom !== undefined && g && rule.display.markedAtom >= g.atoms.length) problem(`display.markedAtom ${rule.display.markedAtom} is out of range`);
        }
        break;
      }
      case 'choose-reagent': {
        if (rule.maxAttempts !== DEFAULT_MAX_ATTEMPTS.chooseReagent) problem(`maxAttempts ${rule.maxAttempts} but choose-reagent default is ${DEFAULT_MAX_ATTEMPTS.chooseReagent}`);
        for (const id of rule.options) if (!(REAGENT_IDS as readonly string[]).includes(id)) problem(`option ${id} is not a reagent id`);
        for (const id of rule.correct) if (!rule.options.includes(id)) problem(`correct ${id} is not among the options`);
        if (rule.correct.length === 0) problem('no correct reagent');
        for (const id of Object.keys(rule.rejections ?? {})) {
          if (!rule.options.includes(id as ReagentId) || rule.correct.includes(id as ReagentId)) problem(`rejection ${id} is not a wrong option`);
        }
        for (const id of rule.options) {
          const card = cardOf(id, reagents);
          if (card && !card.enabledByDefault) problem(`option ${id} is not enabled by default`);
        }
        const reactant = graphOf(rule.reactant);
        const product = graphOf(rule.product);
        const card = rule.correct[0] !== undefined ? cardOf(rule.correct[0], reagents) : undefined;
        if (reactant && product && card) {
          const res = safeReact(reactant, card, { rearrangement: 'warn' });
          if (typeof res === 'string') problem(`react(${rule.reactant}, ${card.id}) threw: ${res}`);
          else if (res.noReaction) problem(`react(${rule.reactant}, ${card.id}) gives no reaction: ${res.justification}`);
          else if (!res.major.some((m) => sameMolecule(m, product, { stereo: 'none' }).same)) problem(`react(${rule.reactant}, ${card.id}) does not give ${rule.product}`);
        }
        break;
      }
      case 'select-atom': {
        if (rule.maxAttempts !== DEFAULT_MAX_ATTEMPTS.selectAtom) problem(`maxAttempts ${rule.maxAttempts} but select-atom default is ${DEFAULT_MAX_ATTEMPTS.selectAtom}`);
        if (!rule.answerDescription) problem('empty answerDescription');
        if (rule.target === 'hydrogens' && rule.selector.kind !== 'most-acidic-h') problem(`target 'hydrogens' only with most-acidic-h, not ${rule.selector.kind}`);
        const graphs = rule.molecules.map(graphOf).filter((g): g is MoleculeGraph => g !== undefined);
        if (graphs.length !== rule.molecules.length) break;
        const analyses: Analysis[] = graphs.map((g) => analyze(g));
        const A = answerSet(rule.selector, graphs, analyses);
        if (A.length === 0) problem('answer set is empty');
        if (rule.match === 'all') {
          const total = rule.target === 'hydrogens'
            ? analyses.reduce((n, a) => n + a.acidity.hydrogens.length, 0)
            : graphs.reduce((n, g) => n + g.atoms.length, 0);
          if (A.length >= total) problem('answer set contains every atom of every molecule');
        }
        for (const m of rule.molecules) {
          const entry = bySmiles.get(m);
          if (entry && !layoutOf(entry)) problem(`molecule ${m} is not buildable`);
        }
        const kind = rule.selector.kind;
        if (kind === 'most-acidic-h') {
          const sites = analyses.flatMap((a) => a.acidity.hydrogens);
          const answerIds = new Set(A.map((i) => `${i.molecule}:${i.atom}`));
          const answerSites = analyses.flatMap((a, m) => a.acidity.hydrogens.filter((s) => answerIds.has(`${m}:${s.parentId}`)));
          if (answerSites.some((s) => !s.verified)) problem('most-acidic-h answer class is unverified');
          const distinct = [...new Set(sites.map((s) => s.pKa))].sort((x, y) => x - y);
          if (distinct.length >= 2 && distinct[1]! - distinct[0]! < PKA_MIN_MARGIN) problem(`most-acidic-h margin ${distinct[1]! - distinct[0]!} < ${PKA_MIN_MARGIN}`);
        } else if (kind === 'most-basic-site' || kind === 'most-basic-n') {
          const sites = analyses.flatMap((a, m) => a.acidity.basicSites.filter((b) => kind === 'most-basic-site' || graphs[m]!.atoms[b.atomId]!.el === 'N'));
          const answerIds = new Set(A.map((i) => `${i.molecule}:${i.atom}`));
          const answerSites = analyses.flatMap((a, m) => a.acidity.basicSites.filter((b) => answerIds.has(`${m}:${b.atomId}`)));
          if (answerSites.some((s) => !s.verified)) problem(`${kind} answer class is unverified`);
          const distinct = [...new Set(sites.map((s) => s.pKaH))].sort((x, y) => y - x);
          if (distinct.length >= 2 && distinct[0]! - distinct[1]! < PKA_MIN_MARGIN) problem(`${kind} margin ${distinct[0]! - distinct[1]!} < ${PKA_MIN_MARGIN}`);
        }
        break;
      }
      case 'isomer-set': {
        if (rule.count !== rule.isomers.length) problem(`count ${rule.count} but ${rule.isomers.length} isomers listed`);
        const hashes = new Set<string>();
        for (const s of rule.isomers) {
          const g = graphOf(s);
          if (!g) continue;
          const f = hillFormula(g, implicitHydrogens(g).hydrogens);
          if (f !== rule.formula) problem(`isomer ${s} has formula ${f}, rule says ${rule.formula}`);
          const h = hashOfSmiles(s);
          if (hashes.has(h)) problem(`isomer ${s} duplicates another isomer's constitution`);
          hashes.add(h);
          if (!embedOnLattice(withoutStereoTags(g))) problem(`isomer ${s} is not buildable`);
        }
        for (const s of rule.optionalDiagonalIsomers ?? []) {
          const p = tryParse(s);
          if (typeof p === 'string') { problem(`optional isomer ${s} does not parse`); continue; }
          const f = hillFormula(p.graph, p.hydrogens);
          if (f !== rule.formula) problem(`optional isomer ${s} has formula ${f}`);
          const h = hashOfSmiles(s);
          if (hashes.has(h)) problem(`optional isomer ${s} duplicates another isomer`);
          hashes.add(h);
          if (!smallestRings(p.graph).some((r) => r.length % 2 === 1)) problem(`optional isomer ${s} has no odd ring`);
        }
        break;
      }
      case 'formula-and-groups': {
        const ids = GROUP_IDS as readonly string[];
        for (const gid of [...rule.required, ...rule.forbidden]) if (!ids.includes(gid)) problem(`unknown group id ${gid}`);
        for (const gid of rule.required) if (rule.forbidden.includes(gid as GroupId)) problem(`group ${gid} is both required and forbidden`);
        if (!/^(C\d*)?(H\d*)?([A-Z][a-z]?\d*)*$/.test(rule.formula) || /[+-]/.test(rule.formula)) problem(`formula ${rule.formula} is not a neutral Hill formula`);
        break;
      }
      case 'exact-molecule':
      case 'name-to-structure': {
        const g = graphOf(rule.target);
        if (g && !embedOnLattice(withoutStereoTags(g))) problem(`target ${rule.target} is not buildable on the lattice`);
        if (rule.type === 'name-to-structure') {
          if (rule.names.length === 0) problem('names is empty');
          for (const n of rule.names) {
            const alt = mcmurrySpelling(n);
            if (alt !== null && !rule.names.includes(alt)) problem(`names lists ${n} but not the other locant spelling ${alt}`);
          }
        }
        break;
      }
      case 'stereo-exact': {
        if (rule.mode !== 'absolute' && rule.mode !== 'relative') problem(`unknown mode ${String(rule.mode)}`);
        for (const s of [rule.target, ...(rule.accept ?? [])]) {
          const g = graphOf(s);
          if (!g) continue;
          if (!hasTags(g)) problem(`${s} carries no stereo tag`);
          if (!embedOnLattice(g)) problem(`target ${s} is not buildable on the lattice`);
        }
        break;
      }
      case 'predict-product': {
        if (!(REAGENT_IDS as readonly string[]).includes(rule.reagentId)) { problem(`unknown reagentId ${rule.reagentId}`); break; }
        const card = cardOf(rule.reagentId, reagents);
        if (card && !card.enabledByDefault) problem(`reagent ${rule.reagentId} is not enabled by default`);
        if (rule.expected.length === 0) problem('expected is empty');
        const reactant = graphOf(rule.reactant);
        const expected = rule.expected.map(graphOf);
        const rx = rule.rx !== undefined ? graphOf(rule.rx) : undefined;
        if (rule.stereoCheck !== 'none') {
          for (const [i, g] of expected.entries()) if (g && !hasTags(g)) problem(`stereoCheck ${rule.stereoCheck} but expected ${rule.expected[i]} carries no stereo tag`);
          for (const [i, g] of expected.entries()) if (g && !embedOnLattice(g)) problem(`expected ${rule.expected[i]} is not buildable on the lattice`);
        } else {
          for (const [i, g] of expected.entries()) if (g && !embedOnLattice(withoutStereoTags(g))) problem(`expected ${rule.expected[i]} is not buildable on the lattice`);
        }
        for (const alt of rule.acceptAlso ?? []) {
          const g = graphOf(alt.smiles);
          if (g && !embedOnLattice(withoutStereoTags(g))) problem(`acceptAlso ${alt.smiles} is not buildable on the lattice`);
          if (!alt.note) problem(`acceptAlso ${alt.smiles} has no note`);
        }
        if (reactant && !embedOnLattice(reactant)) problem(`reactant ${rule.reactant} is not buildable on the lattice`);
        if (rx && !embedOnLattice(rx)) problem(`rx ${rule.rx} is not buildable on the lattice`);
        if (reactant && card && expected.every((g): g is MoleculeGraph => g !== undefined)) {
          const res = safeReact(reactant, card, { ...(rule.equiv !== undefined ? { equiv: rule.equiv } : {}), ...(rx ? { rx } : {}), rearrangement: 'warn' });
          if (typeof res === 'string') { problem(`react(${rule.reactant}, ${card.id}) threw: ${res}`); break; }
          if (res.noReaction) { problem(`react(${rule.reactant}, ${card.id}) gives no reaction: ${res.justification}`); break; }
          const major = [...res.major];
          const used = new Set<number>();
          for (const [i, e] of expected.entries()) {
            const k = major.findIndex((m, idx) => !used.has(idx) && sameMolecule(m, e, { stereo: rule.stereoCheck }).same);
            if (k < 0) problem(`expected ${rule.expected[i]} is not among react(${rule.reactant}, ${card.id}).major`);
            else used.add(k);
          }
          const remainder = major.filter((_, idx) => !used.has(idx));
          if (remainder.length > 0 && !rule.acceptAny) {
            const alts = (rule.acceptAlso ?? []).map((a) => graphOf(a.smiles)).filter((g): g is MoleculeGraph => g !== undefined);
            const covered = remainder.every((m) => alts.some((a) => sameMolecule(m, a, { stereo: 'none' }).same));
            if (!covered && !res.mixture) problem(`react(${rule.reactant}, ${card.id}).major has products that neither expected nor acceptAlso lists`);
          }
          const pool = [...res.major, ...(res.minor ?? [])];
          for (const alt of rule.acceptAlso ?? []) {
            const g = graphOf(alt.smiles);
            if (g && !pool.some((m) => sameMolecule(m, g, { stereo: 'none' }).same)) problem(`acceptAlso ${alt.smiles} is not among react(${rule.reactant}, ${card.id}).major or minor`);
          }
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function validateContentDetailed(library: MoleculeLibrary, roster: ChallengeRoster, reagents: readonly ReagentCard[]): ContentProblem[] {
  const out: ContentProblem[] = [];
  const bySmiles = validateLibrary(library, out);
  validateReagents(reagents, out);
  validateRoster(roster, bySmiles, reagents, out);
  return out;
}

/** Every problem as "<where>: <message>"; `[]` for the shipped files. */
export function validateContent(library: MoleculeLibrary, roster: ChallengeRoster, reagents: readonly ReagentCard[]): string[] {
  return validateContentDetailed(library, roster, reagents).map((p) => `${p.where}: ${p.message}`);
}

function rowFor(where: string, smiles: string, emb: LatticeEmbedding | null): BuildReportRow {
  return { where, smiles, nodesVisited: emb?.nodesVisited ?? -1, suppressedPairs: emb?.suppressedPairs ?? [] };
}

/**
 * One row per build target (exact-molecule, name-to-structure, stereo-exact target and accept[], isomer-set member,
 * predict-product expected[] and acceptAlso[], quiz display, select-atom molecule, choose-reagent product) and per
 * library entry. Stereo-graded targets embed with their tags; constitution-only targets embed stereo-stripped.
 * `nodesVisited` is -1 when the target does not embed (reported as a problem by `validateContent`).
 */
export function buildReport(library: MoleculeLibrary, roster: ChallengeRoster): BuildReportRow[] {
  const rows: BuildReportRow[] = [];
  const bySmiles = new Map<string, MoleculeEntry>();
  for (const e of library.entries) bySmiles.set(e.smiles, e);
  const embed = (smiles: string, stereo: boolean): LatticeEmbedding | null => {
    const p = tryParse(smiles);
    if (typeof p === 'string') return null;
    const g = stereo ? p.graph : withoutStereoTags(p.graph);
    return embedOnLattice(g);
  };
  const viaLayout = (smiles: string): LatticeEmbedding | null => {
    const e = bySmiles.get(smiles);
    return e ? layoutOf(e) : embed(smiles, true);
  };
  for (const c of roster.challenges) {
    const rule = c.rule;
    const where = `challenge:${c.id}`;
    switch (rule.type) {
      case 'exact-molecule':
      case 'name-to-structure':
        rows.push(rowFor(`${where}:target`, rule.target, embed(rule.target, false)));
        break;
      case 'stereo-exact':
        rows.push(rowFor(`${where}:target`, rule.target, embed(rule.target, true)));
        for (const s of rule.accept ?? []) rows.push(rowFor(`${where}:accept`, s, embed(s, true)));
        break;
      case 'isomer-set':
        for (const s of rule.isomers) rows.push(rowFor(`${where}:isomers`, s, embed(s, false)));
        break;
      case 'predict-product':
        for (const s of rule.expected) rows.push(rowFor(`${where}:expected`, s, embed(s, rule.stereoCheck !== 'none')));
        for (const a of rule.acceptAlso ?? []) rows.push(rowFor(`${where}:acceptAlso`, a.smiles, embed(a.smiles, false)));
        break;
      case 'quiz':
        if (rule.display) rows.push(rowFor(`${where}:display`, rule.display.smiles, viaLayout(rule.display.smiles)));
        break;
      case 'select-atom':
        for (const s of rule.molecules) rows.push(rowFor(`${where}:molecules`, s, viaLayout(s)));
        break;
      case 'choose-reagent':
        rows.push(rowFor(`${where}:product`, rule.product, embed(rule.product, false)));
        break;
      case 'formula-and-groups':
        break;
    }
  }
  for (const e of library.entries) rows.push(rowFor(`library:${e.id}`, e.smiles, layoutOf(e)));
  return rows;
}

/** Convenience for tests: the ring count of a parsed entry. */
export function entryRingCount(entry: MoleculeEntry): number {
  return ringCount(parseEntry(entry));
}
