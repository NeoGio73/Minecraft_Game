import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSmiles } from '@/chem/smiles';
import { buildGraph, withoutStereoTags } from '@/chem/graph';
import { analyze } from '@/chem/analyze';
import { GROUP_IDS } from '@/chem/types';
import type { Analysis, BondLabel, CenterLabel, Mechanism, MoleculeGraph, ReactionStereo, Vec3, Warning, WarningKind, WorldAtom, WorldGraph } from '@/chem/types';
import { manhattan } from '@/util/vec3';
import { KEY_ACTIONS, DEFAULT_KEYS } from '@/input/keymap';
import { BLOCK_ELEMENTS } from '@/world/types';
import { WAND_CYCLE } from '@/world/molecule-index';
import type { WandOrder } from '@/world/molecule-index';
import {
  BENCH, CHAPTER_TITLES, ELEMENT_NAME, ENGINE_TEXT, FEEDBACK, GROUP_LABEL, KEY_ACTION_LABEL, MECHANISM_WORD, MODE_BADGE,
  REACTION_STEREO_TEXT, REFUSAL_TEXT, STEREO_TEXT, STRINGS, ORDER_WORD, REVIEW_BADGE, DEGRADED_BADGE, ENDED_BADGE,
  atomLabel, keyName, signed, spellFormula, warningText, settingValueText, SETTING_LABEL,
} from '@/ui/strings';
import {
  DEFAULT_SETTINGS, SETTING_KEYS, effectiveKeys, keyConflict, loadSettings, parseSettings, saveSettings, wasStored, loadInventory, saveInventory,
} from '@/app/Settings';
import { STORAGE_KEY_INVENTORY, STORAGE_KEY_SETTINGS } from '@/lms/types';

// ---------------------------------------------------------------------------
// Fixtures (world graphs, as test/chem/analyze.test.ts builds them)
// ---------------------------------------------------------------------------

const parse = (s: string): MoleculeGraph => parseSmiles(s).graph;

function grid(smiles: string, pos: readonly Vec3[]): WorldGraph {
  const g = withoutStereoTags(parse(smiles));
  const atoms: WorldAtom[] = g.atoms.map((a, i) => ({ id: a.id, el: a.el, charge: a.charge, explicitH: null, aromatic: a.aromatic, pos: pos[i]!, hPos: [] }));
  return buildGraph(atoms, g.bonds);
}
function carbonCells(cells: readonly Vec3[]): WorldGraph {
  const atoms: WorldAtom[] = cells.map((pos, id) => ({ id, el: 'C', charge: 0, explicitH: null, aromatic: false, pos, hPos: [] }));
  const bonds: { a: number; b: number; order: 1 }[] = [];
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) if (manhattan(cells[i]!, cells[j]!) === 1) bonds.push({ a: i, b: j, order: 1 });
  return buildGraph(atoms, bonds);
}

const T_BUTANOL = grid('CC(O)CC', [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0]]);
const COLLINEAR_BUTENE = grid('CC=CC', [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]]);
const CHAIR: readonly Vec3[] = [[10, 10, 10], [11, 10, 10], [11, 11, 10], [11, 11, 11], [10, 11, 11], [10, 10, 11]];
const CAGE = carbonCells([...CHAIR, [10, 11, 10]]);

const ETHANOL = analyze(parse('CCO'));

function walkStrings(value: unknown, path: string, out: { path: string; value: string }[]): void {
  if (typeof value === 'string') out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walkStrings(v, `${path}.${k}`, out);
}

const WARNING_KINDS: readonly WarningKind[] = ['over-valence', 'h-block-valence', 'charge-unsupported', 'planar-center', 'alkene-geometry', 'cage', 'isomorphism-cap', 'unverified-pka'];
const CENTER_LABELS: readonly CenterLabel[] = ['R', 'S', 'UNSPECIFIED', 'NOT_CENTER', 'CANNOT_ASSIGN'];
const BOND_LABELS: readonly BondLabel[] = ['E', 'Z', 'NO_EZ', 'RING', 'COLLINEAR', 'NOT_PLANAR', 'TWISTED'];
const MECHANISMS: readonly Mechanism[] = ['SN1', 'SN2', 'E1', 'E2', 'addition', 'oxidation', 'reduction', 'radical', 'none'];
const REACTION_STEREOS: readonly ReactionStereo[] = ['none', 'racemic', 'relative', 'absolute'];
const FEEDBACK_KINDS = Object.keys(FEEDBACK);

// ---------------------------------------------------------------------------

describe('STRINGS table (07 §19, §20)', () => {
  it('has no empty string anywhere (STRINGS, BENCH, ENGINE_TEXT, help bodies)', () => {
    const out: { path: string; value: string }[] = [];
    walkStrings(STRINGS, 'STRINGS', out);
    walkStrings(BENCH, 'BENCH', out);
    walkStrings(ENGINE_TEXT, 'ENGINE_TEXT', out);
    expect(out.length).toBeGreaterThan(150);
    for (const { path, value } of out) expect(value.trim(), path).not.toBe('');
  });

  it('uses only the allowed non-ASCII characters', () => {
    // §19 list plus the true minus sign U+2212 and ×, which the design's own examples use (signed(), douText, help bodies)
    const allowed = new Set('–—≈°·∞±⌖≡✓✗⚠○◔◑●→×−');
    const out: { path: string; value: string }[] = [];
    walkStrings(STRINGS, 'STRINGS', out);
    walkStrings(BENCH, 'BENCH', out);
    for (const { path, value } of out) {
      for (const ch of value) {
        if (ch.charCodeAt(0) > 127) expect(allowed.has(ch), `${path}: ${ch} (U+${ch.charCodeAt(0).toString(16)})`).toBe(true);
      }
    }
  });

  it('targetBond is non-empty for every order 0–3 and next 0–3/null (09 §7)', () => {
    const orders: WandOrder[] = [0, 1, 2, 3];
    for (const order of orders) {
      for (const next of [...orders, null]) {
        const t = STRINGS.targetBond('C2', 'O3', order, next);
        expect(t.length).toBeGreaterThan(10);
        expect(t.includes(order === 0 ? 'No bond' : `order ${order}`)).toBe(true);
        if (next === null) expect(t.endsWith('valence full')).toBe(true);
        else if (next === 0) expect(t.endsWith('E: break it (no bond)')).toBe(true);
        else expect(t.endsWith(`E: make it ${ORDER_WORD[next]}`)).toBe(true);
      }
    }
    expect(STRINGS.targetBond('C2', 'O3', 1, 2)).toBe('Bond C2–O3, order 1 — E: make it double');
    expect(STRINGS.targetBond('C1', 'C4', 0, 1)).toBe('No bond C1–C4 (touching) — E: make it single');
    expect(STRINGS.targetBondOtherTool('C1', 'C4', 0)).toBe('No bond C1–C4 (touching) — B: bond wand');
    expect(WAND_CYCLE).toEqual([1, 2, 3, 0]);
  });

  it('bond edit announcements, no-bond row, ghost break text and BENCH.breakHint are non-empty (09 §5.5, §7)', () => {
    expect(STRINGS.bondSet('C2', 'O3', 2)).toBe('Bond C2–O3 is now double.');
    expect(STRINGS.bondBroken('C1', 'C4')).toContain('removed');
    expect(STRINGS.bondRestored('C1', 'C4')).toContain('restored');
    expect(STRINGS.noBondPairs(1)).toBe('1 touching pair not bonded (red x break marker)');
    expect(STRINGS.noBondPairs(2)).toBe('2 touching pairs not bonded (red x break marker)');
    expect(STRINGS.targetGhostBreak('C')).toContain('red x');
    expect(BENCH.breakHint(1).startsWith('One pair of')).toBe(true);
    expect(BENCH.breakHint(2).startsWith('2 pairs of')).toBe(true);
    expect(BENCH.previewOnly).toContain('3-membered ring');
    expect(ORDER_WORD[0]).toBe('no bond');
    expect(STRINGS.bondWand).toContain('no bond');
    expect(STRINGS.help.buildingBody).toContain('red x break marker');
    expect(STRINGS.help.stereoBody).toContain('break the bond between them');
  });

  it('centerLabel and bondLabel cover every union member', () => {
    for (const l of CENTER_LABELS) expect(STRINGS.centerLabel[l].length).toBeGreaterThan(0);
    for (const l of BOND_LABELS) expect(STRINGS.bondLabel[l].length).toBeGreaterThan(0);
  });

  it('every Mechanism, ReactionStereo, AdapterMode, GroupId and FeedbackKind has a string', () => {
    for (const m of MECHANISMS) {
      expect(MECHANISM_WORD[m].length).toBeGreaterThan(0);
      expect(BENCH.mechanism(m)).toContain('Mechanism:');
      expect(BENCH.reacted(m).length).toBeGreaterThan(0);
    }
    for (const s of REACTION_STEREOS) expect(typeof REACTION_STEREO_TEXT[s]).toBe('string');
    expect(REACTION_STEREO_TEXT.none).toBe('');
    expect(REACTION_STEREO_TEXT.racemic).toBe(BENCH.stereoRacemic);
    for (const mode of ['discovering', 'lms', 'standalone'] as const) expect(MODE_BADGE[mode].length).toBeGreaterThan(0);
    for (const g of GROUP_IDS) expect(GROUP_LABEL[g].length, g).toBeGreaterThan(0);
    expect(FEEDBACK_KINDS.length).toBe(24);
    for (const k of FEEDBACK_KINDS) expect(FEEDBACK[k as keyof typeof FEEDBACK]({}).length, k).toBeGreaterThan(0);
    expect(REVIEW_BADGE.length).toBeGreaterThan(0);
    expect(DEGRADED_BADGE.length).toBeGreaterThan(0);
    expect(ENDED_BADGE.length).toBeGreaterThan(0);
    expect(REFUSAL_TEXT.lockedZone.length).toBeGreaterThan(0);
    expect(STEREO_TEXT.twisted.length).toBeGreaterThan(0);
  });

  it('KEY_ACTION_LABEL covers KEY_ACTIONS and CHAPTER_TITLES covers 1..11', () => {
    for (const a of KEY_ACTIONS) expect(KEY_ACTION_LABEL[a].length, a).toBeGreaterThan(0);
    for (let ch = 1; ch <= 11; ch++) expect(CHAPTER_TITLES[ch as keyof typeof CHAPTER_TITLES].length).toBeGreaterThan(0);
    expect(Object.keys(CHAPTER_TITLES).length).toBe(11);
    for (const el of BLOCK_ELEMENTS) expect(ELEMENT_NAME[el].length).toBeGreaterThan(0);
    expect(ELEMENT_NAME.P).toBe('Phosphorus');
    for (const k of SETTING_KEYS) expect(SETTING_LABEL[k]?.length ?? 0, k).toBeGreaterThan(0);
  });

  it('ENGINE_TEXT carries the exact 06 §1 strings and the LOOK_TEXT ones', () => {
    expect(ENGINE_TEXT.noBondHere).toBe('Point at a bond bar or a break marker and press E.');
    expect(ENGINE_TEXT.hover.bond('C1', 'C4', 0)).toBe('No bond C1-C4: the atoms touch but are not bonded (E: bond them)');
    expect(ENGINE_TEXT.hover.bond('C1', 'C2', 2)).toBe('Bond C1-C2, order 2 (E: cycle)');
    expect(ENGINE_TEXT.hover.ore('C')).toBe('C ore - mine for 3 C');
    expect(ENGINE_TEXT.clickToPlay).toBe('Click the world to play. Esc opens the menu, Tab leaves the game area.');
    expect(ENGINE_TEXT.lockedMolecule.length).toBeGreaterThan(0);
  });

  it('helpers: signed, atomLabel, spellFormula, keyName, settingValueText', () => {
    expect(signed(1)).toBe('+1');
    expect(signed(-1)).toBe('−1');
    expect(signed(0)).toBe('0');
    expect(atomLabel('C', 1)).toBe('C2');
    expect(spellFormula('C2H6O')).toBe('C 2 H 6 O');
    expect(spellFormula('C2H3O2-')).toBe('C 2 H 3 O 2 minus');
    expect(spellFormula('CH5N+')).toBe('C H 5 N plus');
    expect(spellFormula('C2O4 2-')).toContain('2 minus');
    expect(spellFormula('ClH')).toBe('Cl H');
    expect(keyName('KeyW')).toBe('W');
    expect(keyName('BracketLeft')).toBe('[');
    expect(keyName('Period')).toBe('.');
    expect(keyName('Digit1')).toBe('1');
    expect(keyName('ShiftLeft')).toBe('Left Shift');
    expect(keyName('ArrowLeft')).toBe('Left arrow');
    expect(keyName('Numpad5')).toBe('Numpad 5');
    expect(settingValueText('lowGraphics', true)).toBe(STRINGS.graphicsLow);
    expect(settingValueText('showHydrogens', false)).toBe(STRINGS.off);
    expect(settingValueText('theme', 'light')).toBe(STRINGS.themeLight);
    expect(settingValueText('uiScale', 1.25)).toBe('125%');
  });

  it('analyzeSummary spells ethanol as the design example', () => {
    const summary = STRINGS.analyzeSummary(ETHANOL, ETHANOL.name);
    expect(summary.startsWith(`${ETHANOL.name ?? 'Unnamed molecule'}, C 2 H 6 O, alcohol (primary), 0 degrees of unsaturation`)).toBe(true);
    expect(summary.endsWith('.')).toBe(true);
    const flat: Analysis = { ...ETHANOL, warnings: [], name: null };
    expect(STRINGS.analyzeSummary(flat, null)).toBe('Unnamed molecule, C 2 H 6 O, alcohol (primary), 0 degrees of unsaturation, no warnings.');
  });
});

describe('warningText (07 §19.3)', () => {
  it('returns non-empty text for every WarningKind on fixture analyses', () => {
    const tBut = analyze(T_BUTANOL);
    const planar = tBut.warnings.find((w) => w.kind === 'planar-center');
    expect(planar).toBeDefined();
    const col = analyze(COLLINEAR_BUTENE);
    const geom = col.warnings.find((w) => w.kind === 'alkene-geometry');
    expect(geom).toBeDefined();
    const cageA = analyze(CAGE);
    const cage = cageA.warnings.find((w) => w.kind === 'cage');
    expect(cage).toBeDefined();
    const samples: Record<WarningKind, { w: Warning; a: Analysis }> = {
      'over-valence': { w: { kind: 'over-valence', atom: 0, have: 5, max: 4 }, a: ETHANOL },
      'h-block-valence': { w: { kind: 'h-block-valence', atom: 0, bonds: 2 }, a: ETHANOL },
      'charge-unsupported': { w: { kind: 'charge-unsupported', atom: 2, charge: 1 }, a: ETHANOL },
      'planar-center': { w: planar as Warning, a: tBut },
      'alkene-geometry': { w: geom as Warning, a: col },
      cage: { w: cage as Warning, a: cageA },
      'isomorphism-cap': { w: { kind: 'isomorphism-cap', states: 200000 }, a: ETHANOL },
      'unverified-pka': { w: { kind: 'unverified-pka', classId: 'CH.allylic.1' }, a: ETHANOL },
    };
    for (const kind of WARNING_KINDS) {
      const { w, a } = samples[kind];
      const t = warningText(w, a);
      expect(t.length, kind).toBeGreaterThan(10);
    }
    expect(warningText(samples['over-valence'].w, ETHANOL)).toBe('C1 has 5 bonds but can have at most 4. Remove a neighbour or lower a bond order.');
    expect(warningText(samples['charge-unsupported'].w, ETHANOL)).toContain('O3 cannot carry charge +1');
    expect(warningText(planar as Warning, tBut)).toBe(`C2: ${STEREO_TEXT.flatT}`);
    expect(warningText(geom as Warning, col).startsWith('Bond C2=C3: ')).toBe(true);
    expect(warningText(cage as Warning, cageA)).toContain('is bonded to three atoms of one ring (a cage)');
    expect(warningText(samples['isomorphism-cap'].w, ETHANOL)).toContain('200000 steps');
    expect(warningText(samples['unverified-pka'].w, ETHANOL)).toContain('CH.allylic.1');
  });
});

describe('Settings.ts (07 §1.2)', () => {
  const store = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('keyConflict rejects Escape, Tab, F3 and duplicates and accepts a free key', () => {
    expect(keyConflict(DEFAULT_KEYS, 'help', 'Escape')).toBe('reserved');
    expect(keyConflict(DEFAULT_KEYS, 'help', 'Tab')).toBe('reserved');
    expect(keyConflict(DEFAULT_KEYS, 'help', 'F3')).toBe('reserved');
    expect(keyConflict(DEFAULT_KEYS, 'help', 'KeyW')).toBe('forward');
    expect(keyConflict(DEFAULT_KEYS, 'help', 'KeyZ')).toBe(null);
    expect(keyConflict(DEFAULT_KEYS, 'help', 'KeyH')).toBe(null);
  });

  it('loadSettings returns defaults on garbage and on a missing record', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    store.set(STORAGE_KEY_SETTINGS, '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(wasStored('lowGraphics')).toBe(false);
    store.set(STORAGE_KEY_SETTINGS, JSON.stringify({ lowGraphics: 'yes', theme: 'blue', sensitivity: 99, uiScale: 2, keys: { forward: 'Escape', help: 'KeyZ', bogus: 'KeyX' }, reducedMotion: 'on' }));
    const s = loadSettings();
    expect(s.lowGraphics).toBe(false);
    expect(s.theme).toBe('auto');
    expect(s.sensitivity).toBe(DEFAULT_SETTINGS.sensitivity);
    expect(s.uiScale).toBe(1);
    expect(s.reducedMotion).toBe('on');
    expect(s.keys).toEqual({ help: 'KeyZ' });
    expect(wasStored('reducedMotion')).toBe(true);
    expect(wasStored('lowGraphics')).toBe(false);
    expect(parseSettings(null).settings).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[]').settings).toEqual(DEFAULT_SETTINGS);
  });

  it('saveSettings round-trips and marks every key stored', () => {
    saveSettings({ ...DEFAULT_SETTINGS, lowGraphics: true, keys: { forward: 'KeyZ' } });
    expect(wasStored('lowGraphics')).toBe(true);
    const s = loadSettings();
    expect(s.lowGraphics).toBe(true);
    expect(s.keys).toEqual({ forward: 'KeyZ' });
    expect(s.stereoOverlay).toBe(true);
  });

  it('effectiveKeys applies overrides over DEFAULT_KEYS', () => {
    const keys = effectiveKeys({ ...DEFAULT_SETTINGS, keys: { forward: 'KeyZ', hint: 'Escape' } });
    expect(keys.forward).toBe('KeyZ');
    expect(keys.hint).toBe(DEFAULT_KEYS.hint);   // reserved override ignored
    expect(keys.back).toBe('KeyS');
    expect(effectiveKeys(DEFAULT_SETTINGS)).toEqual(DEFAULT_KEYS);
  });

  it('inventory persistence omits H and ignores garbage', () => {
    saveInventory({ C: 12, O: 3, H: Infinity, N: 0 });
    const raw = JSON.parse(store.get(STORAGE_KEY_INVENTORY) ?? '{}') as Record<string, unknown>;
    expect(raw['H']).toBeUndefined();
    expect(loadInventory()).toEqual({ C: 12, O: 3, N: 0 });
    store.set(STORAGE_KEY_INVENTORY, 'nope');
    expect(loadInventory()).toBe(null);
  });
});

describe('styles.css (07 §20)', () => {
  it('has a #canvas:focus-visible block with a negative outline-offset', () => {
    const css = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');
    const m = /#canvas:focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(m).not.toBeNull();
    const block = m?.[1] ?? '';
    const off = /outline-offset:\s*(-?\d+(?:\.\d+)?)px/.exec(block);
    expect(off).not.toBeNull();
    expect(Number(off?.[1])).toBeLessThan(0);
    expect(block).toContain('outline: 3px solid var(--focus)');
    expect(css).toContain('#stage[data-framed="true"]  { height: 100vh; }');
    expect(css).not.toContain('aspect-ratio');
    expect(css).toContain('@media (max-height: 639px)');
  });
});
