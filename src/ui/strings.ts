/**
 * Every student-facing string that is not in `REFUSAL_TEXT` (src/world/types.ts)
 * or `FEEDBACK` (src/content/feedback.ts). docs/design/07-ui.md §19,
 * 04-reaction-bench.md §8.7 (`BENCH`), 06-engine.md §1 (`ENGINE_TEXT`),
 * 09-amendment-no-bond.md §5.5–§5.7.
 *
 * Pure (no three, no DOM): node tests import it directly. Strings owned by
 * other modules (`STEREO_TEXT`, `MODE_BADGE`, the adapter badges, `LOOK_TEXT`)
 * are re-exported, never retyped. ASCII except – — ≈ ° · ∞ ± ⌖ ≡ ✓ ✗ ⚠ ○◔◑● →.
 */
import type { Analysis, BondLabel, BondOrder, CenterLabel, Element, GroupId, Hybridization, Mechanism, ReactionStereo, Warning } from '../chem/types';
import type { Chapter } from '../content/types';
import { ORE_YIELD } from '../world/types';
import type { BlockElement } from '../world/types';
import type { WandOrder } from '../world/molecule-index';
import { ELEMENT_NAMES } from '../world/blocks';
import { STEREO_TEXT } from '../chem/stereo';
import { LOOK_TEXT } from '../input/look-modes';
import type { KeyAction } from '../input/keymap';
import { KEY_ACTIONS } from '../input/keymap';
import { MODE_BADGE } from '../lms/types';
import type { AdapterMode } from '../lms/types';

// ---------------------------------------------------------------------------
// Re-exports (§19.1; 08 U4)
// ---------------------------------------------------------------------------

export { REFUSAL_TEXT } from '../world/types';
export { FEEDBACK, feedbackText, NO_BOND_HINT } from '../content/feedback';
export { STEREO_TEXT } from '../chem/stereo';
export { MODE_BADGE } from '../lms/types';
export { REVIEW_BADGE, DEGRADED_BADGE, ENDED_BADGE } from '../lms/ScormAdapter';
export { LOOK_TEXT } from '../input/look-modes';

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const CHAPTER_TITLES: Readonly<Record<Chapter, string>> = {
  1: 'Structure and Bonding',
  2: 'Polar Covalent Bonds; Acids and Bases',
  3: 'Organic Compounds: Alkanes and Their Stereochemistry',
  4: 'Organic Compounds: Cycloalkanes and Their Stereochemistry',
  5: 'Stereochemistry at Tetrahedral Centers',
  6: 'An Overview of Organic Reactions',
  7: 'Alkenes: Structure and Reactivity',
  8: 'Alkenes: Reactions and Synthesis',
  9: 'Alkynes: An Introduction to Organic Synthesis',
  10: 'Organohalides',
  11: 'Reactions of Alkyl Halides: Nucleophilic Substitutions and Eliminations',
};

/** Element names (the block names of src/world/blocks.ts plus the parser-only P). */
export const ELEMENT_NAME: Readonly<Record<Element, string>> = { ...ELEMENT_NAMES, P: 'Phosphorus' };

export const KEY_ACTION_LABEL: Readonly<Record<KeyAction, string>> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump', sprint: 'Sprint (hold)',
  lookLeft: 'Look left', lookRight: 'Look right', lookUp: 'Look up', lookDown: 'Look down',
  mine: 'Mine / remove block', place: 'Place atom / use tool',
  slot1: 'Hotbar 1: Carbon', slot2: 'Hotbar 2: Nitrogen', slot3: 'Hotbar 3: Oxygen', slot4: 'Hotbar 4: Sulfur', slot5: 'Hotbar 5: Fluorine',
  slot6: 'Hotbar 6: Chlorine', slot7: 'Hotbar 7: Bromine', slot8: 'Hotbar 8: Iodine', slot9: 'Hotbar 9: Hydrogen',
  bondWand: 'Bond wand', chargeTool: 'Charge tool', selectTool: 'Select tool', slotPrev: 'Previous hotbar slot / previous candidate', slotNext: 'Next hotbar slot / next candidate',
  analyze: 'Analyze the targeted molecule', submit: 'Submit', nextChallenge: 'Next challenge', prevChallenge: 'Previous challenge', hint: 'Show hint', roster: 'Challenge list',
  help: 'Help', bench: 'Reaction bench', toggleHydrogens: 'Show hydrogens', clearSelection: 'Clear selection',
};

/** Plain names of the functional-group ids (the panel shows `GroupHit.label`, which carries the subtype). */
export const GROUP_LABEL: Readonly<Record<GroupId, string>> = {
  'carboxylic-acid': 'carboxylic acid', 'acid-anhydride': 'acid anhydride', ester: 'ester', thioester: 'thioester',
  'acyl-halide': 'acyl halide', amide: 'amide', nitrile: 'nitrile', aldehyde: 'aldehyde', ketone: 'ketone', imine: 'imine',
  sulfoxide: 'sulfoxide', alcohol: 'alcohol', thiol: 'thiol', disulfide: 'disulfide', ether: 'ether', sulfide: 'sulfide',
  amine: 'amine', halide: 'alkyl halide', arene: 'arene', alkyne: 'alkyne', alkene: 'alkene', phosphate: 'phosphate',
  carboxylate: 'carboxylate ion', alkoxide: 'alkoxide ion', thiolate: 'thiolate ion', ammonium: 'ammonium ion', oxonium: 'oxonium ion',
  carbocation: 'carbocation', carbanion: 'carbanion', 'amide-ion': 'amide ion', acetylide: 'acetylide ion', alkane: 'alkane', cycloalkane: 'cycloalkane',
};

export const HYBRIDIZATION_WORD: Readonly<Record<Hybridization, string>> = { sp3: 'sp3', sp2: 'sp2', sp: 'sp', none: '—' };

export const MECHANISM_WORD: Readonly<Record<Mechanism, string>> = {
  SN1: 'SN1', SN2: 'SN2', E1: 'E1', E2: 'E2', addition: 'addition', oxidation: 'oxidation', reduction: 'reduction', radical: 'radical', none: 'none',
};

/** 0 = suppressed pair (09 §5.5). */
export const ORDER_WORD: Readonly<Record<number, string>> = { 0: 'no bond', 1: 'single', 2: 'double', 3: 'triple' };

/** Eight compass sectors from the player's yaw (north = −z, yaw increases towards west). */
export const COMPASS: readonly string[] = ['north', 'northwest', 'west', 'southwest', 'south', 'southeast', 'east', 'northeast'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function signed(q: number): string {
  return q > 0 ? `+${q}` : q < 0 ? `−${-q}` : '0';
}

/** `${el}${id + 1}` — the atom label used everywhere (extraction order; 03's n = id + 1). */
export function atomLabel(el: Element, id: number): string {
  return `${el}${id + 1}`;
}

/** "C2H6O" -> "C 2 H 6 O"; charge suffix -> " minus" / " plus" / " 2 minus". */
export function spellFormula(f: string): string {
  const m = /^(.*?)(\d*)([+-])$/.exec(f);
  const body = m ? m[1] ?? '' : f;
  const parts: string[] = [];
  const re = /([A-Z][a-z]?)(\d*)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(body)) !== null) {
    if (t[0] === '') break;
    parts.push(t[1] ?? '');
    if (t[2]) parts.push(t[2]);
  }
  let out = parts.join(' ');
  if (m) {
    const mag = m[2] ?? '';
    const sign = m[3] === '-' ? 'minus' : 'plus';
    out += `${mag ? ` ${mag}` : ''} ${sign}`;
  }
  return out.trim();
}

/** Readable KeyboardEvent.code: KeyW -> W, BracketLeft -> [, Period -> ., Digit1 -> 1, ArrowLeft -> Left arrow. */
export function keyName(code: string): string {
  const fixed: Record<string, string> = {
    BracketLeft: '[', BracketRight: ']', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", Backquote: '`', Slash: '/', Backslash: '\\',
    Minus: '-', Equal: '=', Space: 'Space', Enter: 'Enter', NumpadEnter: 'Numpad Enter', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab',
    Escape: 'Escape', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left Meta', MetaRight: 'Right Meta', CapsLock: 'Caps Lock',
    ArrowLeft: 'Left arrow', ArrowRight: 'Right arrow', ArrowUp: 'Up arrow', ArrowDown: 'Down arrow',
    PageUp: 'Page Up', PageDown: 'Page Down', Home: 'Home', End: 'End', Insert: 'Insert',
  };
  const f = fixed[code];
  if (f !== undefined) return f;
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1] ?? code;
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1] ?? code;
  m = /^Numpad(.+)$/.exec(code);
  if (m) return `Numpad ${m[1] ?? ''}`.trim();
  m = /^F(\d{1,2})$/.exec(code);
  if (m) return code;
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function stereoSummary(a: Analysis): string {
  const st = a.stereo;
  if (!st) return '';
  const parts: string[] = [];
  for (const c of st.centers) {
    const at = a.atoms[c.atom];
    if (!at) continue;
    if (c.label === 'R' || c.label === 'S') parts.push(`${atomLabel(at.el, c.atom)} is ${c.label}`);
    else if (c.label === 'UNSPECIFIED') parts.push(`${atomLabel(at.el, c.atom)} is unspecified`);
  }
  for (const d of st.doubleBonds) {
    const aa = a.atoms[d.a];
    const bb = a.atoms[d.b];
    if (!aa || !bb) continue;
    if (d.label === 'E' || d.label === 'Z') parts.push(`${d.label} double bond ${atomLabel(aa.el, d.a)}=${atomLabel(bb.el, d.b)}`);
  }
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// BENCH (04 §8.7) and ENGINE_TEXT (06 §1)
// ---------------------------------------------------------------------------

export const BENCH = {
  reactantLocked: 'Reactant (locked)',
  buildHere: 'Build the product here',
  react: 'React',
  showAnswer: 'Show answer',
  clearZone: 'Clear product zone',
  equiv: (n: number) => `${n} equivalent${n === 2 ? 's' : ''}`,
  withRx: (name: string) => `then ${name}`,
  previewOnly: 'This product cannot be built on the grid (it needs a 3-membered ring); preview only.',
  breakHint: (n: number) =>
    `${n === 1 ? 'One pair of' : `${n} pairs of`} ghost atoms touch but are not bonded (red x marker): after placing the blocks, point the bond wand at the bar between them and press E until the marker appears.`,
  mixture: (n: number, any: boolean) => `Textbook mixture — ${n} products; ${any ? 'build either one' : 'this challenge names the one to build'}.`,
  fragments: (n: number) => `Build all ${n} products.`,
  minor: (name: string) => `Minor product: ${name}`,
  mechanism: (m: Mechanism) => `Mechanism: ${MECHANISM_WORD[m]}`,
  reacted: (m: Mechanism) => `Reaction computed: ${MECHANISM_WORD[m]}. See the bench panel.`,
  noReaction: 'No reaction.',
  oneReactant: 'Put exactly one molecule in the reactant zone.',
  wrongReagentGeneric: (label: string, r: string) => `${label} would give ${r} here. Try another reagent.`,
  stereoRacemic: 'Racemic: either enantiomer is accepted.',
  stereoRelative: 'Either enantiomer of this diastereomer is accepted.',
  stereoAbsolute: 'Exactly this configuration is required.',
  placeH: (atom: number) => `Place an explicit H on carbon ${atom} so its configuration is defined.`,
} as const;

/** Stereo line of the bench result by `ReactionResult.stereo` ('' for none). */
export const REACTION_STEREO_TEXT: Readonly<Record<ReactionStereo, string>> = {
  none: '',
  racemic: BENCH.stereoRacemic,
  relative: BENCH.stereoRelative,
  absolute: BENCH.stereoAbsolute,
};

export const ENGINE_TEXT = {
  lockedMolecule: 'This molecule is part of the challenge and cannot be changed.',
  bondWandPrimary: 'Use E or the right mouse button to change the bond order.',
  noBondHere: 'Point at a bond bar or a break marker and press E.',
  noAtomHere: 'Point at an atom block.',
  notPlaceable: 'Only atoms from the hotbar can be placed.',
  mineNoYield: 'Removed.',
  mined: (el: string, n: number) => `+${n} ${el}`,
  clickToPlay: LOOK_TEXT.clickToPlay,
  dragToLook: LOOK_TEXT.dragToLook,
  keysToLook: LOOK_TEXT.keysToLook,
  lockedHint: LOOK_TEXT.lockedHint,
  contextLost: 'Graphics paused while the browser restores WebGL. Nothing is lost.',
  contextRestored: 'Graphics restored.',
  selectNoHydrogens: 'This atom has no hydrogens.',
  /** Student atoms removed from a reserved slot box when a challenge places its molecule (finding 2). */
  reservedCleared: (n: number) =>
    `${n} of your atom${n === 1 ? '' : 's'} near the challenge molecule ${n === 1 ? 'was' : 'were'} returned to your inventory.`,
  /** A large molecule (no analysis worker) is not re-analysed after every edit (finding 1b, heavy guard). */
  analysisDeferred: 'Large molecule: the panel updates when you press F to analyze it or when you submit.',
  hover: {
    ore: (el: string) => `${el} ore - mine for ${ORE_YIELD} ${el}`,
    atom: (el: string, bonds: number, h: number, q: number) => `${el} atom${q ? (q > 0 ? ' (+1)' : ' (-1)') : ''} - ${bonds} bond${bonds === 1 ? '' : 's'}, ${h} H`,
    hydrogen: (explicit: boolean) => (explicit ? 'Hydrogen block' : 'Hydrogen'),
    bond: (a: string, b: string, order: WandOrder) =>
      order === 0 ? `No bond ${a}-${b}: the atoms touch but are not bonded (E: bond them)` : `Bond ${a}-${b}, order ${order} (E: cycle)`,
    bench: 'Reaction bench (E: open)',
    block: (name: string) => name,
  },
} as const;

// ---------------------------------------------------------------------------
// STRINGS (§19.2)
// ---------------------------------------------------------------------------

export const STRINGS = {
  // shell
  title: 'OrgoCraft',
  skipToGame: 'Skip to the game',
  canvasLabel: 'OrgoCraft 3D world. Press H for controls, Escape to open the menu, Tab to leave the world. Arrow keys look, W A S D move.',
  noWebgl: 'OrgoCraft needs WebGL, which this browser has turned off. Try another browser, or update your graphics driver.',
  contextLost: 'The 3D view was reset by the browser. Your molecules and progress are intact.',
  dragToLook: 'Drag to look (the mouse could not be captured).',
  clickToLook: 'Click the world to look with the mouse. Escape releases it.',
  lookMode: (m: 'locked' | 'drag' | 'keys') =>
    m === 'locked' ? 'Mouse captured. Press Escape to release it.' : m === 'drag' ? 'Drag to look.' : 'Use the arrow keys to look.',
  fullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen', fullscreenFailed: 'Fullscreen was refused by the browser. Use Open in new tab instead.',
  openInNewTab: 'Open in new tab', helpLabel: 'Help', settings: 'Settings', save: 'Save', saveAndExit: 'Save & Exit',
  toolbarLabel: 'Game toolbar', hotbarLabel: 'Hotbar',
  savedLocally: 'Progress saved on this device.',
  savedToGradebook: (raw: number | null) => (raw === null ? 'Progress saved to the course.' : `Progress saved to the course gradebook: score ${raw}.`),
  finishedTitle: 'Progress saved', finishedBody: 'You can close this window, or go back to the course.',
  confirmSaveExit: 'Save your progress to the gradebook and end this session? You can come back later and continue where you left off.',
  confirmClearPad: 'Return every atom you placed on the lab pad to your inventory? Molecules placed by a challenge stay.',
  confirmTitle: 'Please confirm',
  cancel: 'Cancel', ok: 'OK', close: 'Close', resume: 'Resume', paused: 'Paused',
  pauseKeys: 'Escape or Resume returns to the game. Tab leaves the game area.',
  collapse: 'Collapse', expand: 'Expand', show: 'Show',
  tabs: { label: 'Panels', challenge: 'Challenge', molecule: 'Molecule', bench: 'Bench' },
  touch: { move: 'Move', forward: 'Forward', back: 'Back', left: 'Left', right: 'Right', jump: 'Jump', mine: 'Mine', place: 'Place' },
  analyzing: 'analyzing',
  analysisDeferredNote: 'This molecule is large, so it is not re-analyzed after every change. Press F (Analyze) or submit to update this panel.',
  // hotbar and target info
  slotLabel: (el: BlockElement, count: number | null, n: number) =>
    `${ELEMENT_NAME[el]}, ${count === null ? 'unlimited' : count === 0 ? 'empty' : `${count} left`}, slot ${n}`,
  bondWand: 'Bond wand: cycle bond order single, double, triple, no bond; key B',
  chargeTool: 'Charge tool: cycle charge 0, plus 1, minus 1, key C',
  selectTool: 'Select tool, key V',
  slotSelected: (label: string) => `${label} selected.`,
  targetOre: (el: BlockElement) => `${ELEMENT_NAME[el]} ore — mine for ${ORE_YIELD} ${el}`,
  targetTerrain: {
    stone: 'Stone', dirt: 'Dirt', grass: 'Grass', sand: 'Sand', glass: 'Glass', lab: 'Lab pad', bench: 'Reaction bench — E: open',
    reactant: 'Reactant zone (locked)', product: 'Product zone — build the product here',
  },
  targetAtom: (el: Element, label: string, bonds: number, h: number, q: number, hyb: string) =>
    `${ELEMENT_NAME[el]} atom ${label} — ${bonds} bond${bonds === 1 ? '' : 's'}, ${h} H, charge ${signed(q)}, ${hyb}`,
  targetAtomCharge: (next: number) => ` — E: set charge ${signed(next)}`,
  targetAtomSelect: (label: string, selected: boolean) => `${label} — E: ${selected ? 'deselect' : 'select'}`,
  targetHBlock: (parent: string) => `Hydrogen block on ${parent}`,
  targetBond: (a: string, b: string, order: WandOrder, next: WandOrder | null) =>
    `${order === 0 ? `No bond ${a}–${b} (touching)` : `Bond ${a}–${b}, order ${order}`} — ${next === null ? 'valence full' : next === 0 ? 'E: break it (no bond)' : `E: make it ${ORDER_WORD[next]}`}`,
  targetBondOtherTool: (a: string, b: string, order: WandOrder) =>
    `${order === 0 ? `No bond ${a}–${b} (touching)` : `Bond ${a}–${b}, order ${order}`} — B: bond wand`,
  targetGhost: (el: BlockElement) => `Ghost: place ${ELEMENT_NAME[el]} here`,
  targetGhostBreak: (el: BlockElement) => `Ghost: place ${ELEMENT_NAME[el]} here — it touches a neighbour it must not bond to (red x)`,
  bondSet: (a: string, b: string, order: BondOrder) => `Bond ${a}–${b} is now ${ORDER_WORD[order]}.`,
  bondBroken: (a: string, b: string) => `Bond ${a}–${b} removed: the atoms touch but are not bonded.`,
  bondRestored: (a: string, b: string) => `Bond ${a}–${b} restored (single).`,
  noBondPairs: (n: number) => `${n} touching pair${n === 1 ? '' : 's'} not bonded (red x break marker)`,
  targetHCandidate: (parent: string, selected: boolean) => `Hydrogen on ${parent} — E: ${selected ? 'deselect' : 'select'}`,
  targetHeavyFallback: (label: string, n: number) =>
    n === 0 ? `${label} — no hydrogens` : `${label} — E: select all ${n} hydrogen${n === 1 ? '' : 's'} on this atom`,
  chargeChanged: (label: string, q: number) => `${label} charge set to ${signed(q)}.`,
  // molecule panel
  panelTitle: 'Targeted molecule', panelTitleLocked: 'Targeted molecule (locked by the challenge)',
  noTarget: 'No molecule targeted. Look at an atom block within 6 blocks, or press F to analyze.',
  unnamed: 'Unnamed molecule',
  formula: 'Formula', netCharge: 'Net charge', dou: 'Degrees of unsaturation', size: 'Size', noBondRow: 'No-bond pairs',
  douText: (dou: number, c: number, n: number, h: number, x: number) => `${dou} = (2·${c} + 2 + ${n} − ${h} − ${x}) / 2`,
  sizeText: (heavy: number, h: number, rings: number, comps: number) =>
    `${heavy} heavy atom${heavy === 1 ? '' : 's'}, ${h} hydrogen${h === 1 ? '' : 's'}, ${rings} ring${rings === 1 ? '' : 's'}, ${comps} fragment${comps === 1 ? '' : 's'}`,
  groups: 'Functional groups', noGroups: 'None', highlight: 'Highlight',
  highlightLabel: (group: string, atoms: string) => `Highlight ${group}: atoms ${atoms}`,
  stereo: 'Stereochemistry', noStereo: 'No stereocenters or double bonds.',
  chiralLine: (chiral: boolean, meso: boolean, n: number) =>
    `${chiral ? 'Chiral' : meso ? 'Achiral (meso)' : 'Achiral'} · ${n} chirality center${n === 1 ? '' : 's'}`,
  centerLabel: { R: 'R', S: 'S', UNSPECIFIED: 'unspecified', NOT_CENTER: 'not a center', CANNOT_ASSIGN: 'cannot assign' } as Readonly<Record<CenterLabel, string>>,
  priorities: 'priorities',
  bondLabel: {
    E: 'E', Z: 'Z', NO_EZ: 'no E/Z', RING: 'ring (no E/Z)', COLLINEAR: 'collinear', NOT_PLANAR: 'not planar', TWISTED: 'twisted',
  } as Readonly<Record<BondLabel, string>>,
  cisTrans: { cis: 'cis', trans: 'trans' } as Readonly<Record<'cis' | 'trans', string>>,
  ringFaces: (k: number, a: string, b: string, cis: boolean) =>
    `Ring ${k}: substituents on ${a} and ${b} are ${cis ? 'cis (same face)' : 'trans (opposite faces)'}`,
  acidity: 'Acidity', allHydrogens: 'All hydrogens',
  acidityColumns: ['Atom', 'Count', 'Class', 'pKa', 'Source'],
  notInMcMurrySource: 'general value, not in McMurry',
  mostAcidic: (label: string, pKa: number, verified: boolean, source: string, atom: string) =>
    `Most acidic H: ${label}, pKa ${verified ? '' : '≈'}${pKa} (${verified ? source : 'general value, not in McMurry'}) — on ${atom}`,
  mostBasic: (atom: string, label: string, pKaH: number, verified: boolean) =>
    `Most basic site: ${atom} (${label}; conjugate acid pKa ${verified ? '' : '≈'}${pKaH})`,
  noHydrogensInMolecule: 'This molecule has no hydrogens.',
  atoms: 'Atoms', perAtomTable: 'Per-atom table',
  angleCaption: 'Hybridization and geometry (ideal values, McMurry 1.6–1.10; the 90° block angles are a lattice artifact)',
  atomColumns: ['#', 'Element', 'Bonds', 'H', 'Lone pairs', 'Charge', 'Hybridization', 'Geometry', 'Ideal angle', 'Note'],
  targetedAtom: (label: string, hyb: string, geom: string, angle: number | null) =>
    `Targeted: ${label} — ${hyb}, ${geom}${angle === null ? '' : `, ideal ${angle}°`}`,
  warnings: 'Warnings', noWarnings: 'No warnings.', warningPrefix: 'Warning:',
  hidden: 'hidden',
  // challenge panel
  challenges: 'Challenges', challengeList: 'Challenge list',
  challengeN: (n: number, total: number) => `Challenge ${n} of ${total}`,
  chapterHeading: (ch: number, solved: number, count: number, earned: number, points: number) =>
    `Chapter ${ch} — ${CHAPTER_TITLES[ch as Chapter]} (${solved} of ${count} solved, ${earned} of ${points} points)`,
  meta: (ch: number, section: string, difficulty: string, points: number) =>
    `Chapter ${ch} · Section ${section} · ${difficulty} · ${points} point${points === 1 ? '' : 's'}`,
  points: (p: number) => `${p} pts`,
  status: { notStarted: 'Not started', attempted: 'Attempted', exhausted: 'No attempts left — answer shown', reduced: 'Solved (half credit)', solved: 'Solved' },
  statusSr: { notStarted: 'Not started.', attempted: 'Attempted.', exhausted: 'No attempts left.', reduced: 'Solved for half credit.', solved: 'Solved.' },
  statusGlyph: { notStarted: '○', attempted: '◔', exhausted: '◔', reduced: '◑', solved: '●' },
  attemptsLeft: (left: number, max: number) => (left <= 0 ? 'No attempts left' : `Attempts left: ${left} of ${max}`),
  isomersDone: (done: number, total: number) => `Isomers accepted: ${done} of ${total}`,
  submitMolecule: 'Submit molecule', submitSelection: 'Submit selection', submitProduct: 'Submit product', answer: 'Answer', openBench: 'Open bench',
  hint: 'Hint', hintPrefix: 'Hint:', previous: 'Previous', next: 'Next',
  feedbackPrefix: { ok: 'Correct:', reduced: 'Half credit:', info: 'Accepted:', first: 'First:', warn: 'Answer shown:', err: 'Not yet:' },
  feedbackGlyph: { ok: '✓', info: '→', warn: '!', err: '✗' },
  alreadySolvedSuffix: ' (Already solved: no additional points.)',
  passed: (title: string, points: number) => (points > 0 ? `Solved: ${title}. +${points} point${points === 1 ? '' : 's'}.` : `Solved again: ${title}.`),
  scoreLine: (earned: number, total: number, raw: number, solved: number, count: number, passMark: number) =>
    `Score ${earned} / ${total} (${raw}%) — ${solved} of ${count} solved — pass mark ${passMark}%`,
  scoreProgressLabel: (raw: number, passMark: number) => `Score ${raw} percent, pass mark ${passMark} percent`,
  passMarkReached: (passMark: number) => `You reached the pass mark of ${passMark}%. Keep going for a higher score.`,
  challengeAnnounce: (n: number, total: number, title: string) => `Challenge ${n} of ${total}: ${title}.`,
  clearPad: 'Clear pad',
  selection: (text: string) => `Selected: ${text}`, nothingSelected: 'Nothing selected',
  selectedH: (parent: string) => `H on ${parent}`,
  selectedAllH: (label: string, n: number) => `${label} (all ${n} hydrogen${n === 1 ? '' : 's'})`,
  candidate: (i: number, n: number, desc: string) => `Candidate ${i} of ${n}: ${desc}`,
  candidateH: (parent: string) => `Hydrogen on ${parent}`,
  pickedSite: (label: string, pKa: number, verified: boolean, source: string) => `You picked: ${label}, pKa ${verified ? '' : '≈'}${pKa} (${source}).`,
  answerSite: (label: string, pKa: number, verified: boolean, source: string) => `Answer: ${label}, pKa ${verified ? '' : '≈'}${pKa} (${source}).`,
  // quiz
  quizTitle: (ch: number, section: string) => `Question — Chapter ${ch} · ${section}`,
  quizTitleMarked: (ch: number, section: string, atom: string) => `Question about ${atom} — Chapter ${ch} · ${section}`,
  quizDisplay: 'The molecule is shown on the lab pad; the marked atom has an orange outline and a question mark.',
  quizLonePairs: 'Lone pairs are shown as dots on the atoms; charges are hidden.',
  answers: 'Answers', yes: 'Yes', no: 'No', submitAnswer: 'Submit answer (Enter)', closeQuiz: 'Close (Esc)', nextChallenge: 'Next challenge',
  correctAnswerSr: 'Correct answer.',
  // bench (labels not in BENCH)
  bench: 'Reaction bench',
  benchMode: { idle: 'No reaction set up', predict: 'Predict the product', choose: 'Choose the reagent', free: 'Free play' },
  reagentCards: 'Reagent cards', equivalents: 'Equivalents', rxLabel: 'Alkyl halide (for acetylide alkylation)',
  chooseReagent: 'Choose this reagent', clearBothZones: 'Clear both zones', notIn10e: '(not in McMurry 10e)',
  previewHidden: 'Build the product in the product zone, then Submit product. The answer stays hidden until you solve it.',
  previewGhost: 'Preview: ghost blocks in the product zone show the answer. Fill them with real blocks.',
  zoneCleared: 'Product zone cleared; the atoms are back in your inventory.',
  benchIdleBody: 'Walk to the bench south of the pad: put a molecule in the reactant zone, pick a reagent card and press React to preview the product.',
  // settings
  settingsTitle: 'Settings',
  graphics: 'Graphics', graphicsStandard: 'Standard', graphicsLow: 'Low',
  theme: 'Theme', themeAuto: 'Match system', themeDark: 'Dark', themeLight: 'Light',
  reducedMotion: 'Reduced motion', motionAuto: 'Match system', on: 'On', off: 'Off',
  showHydrogens: 'Show hydrogens as blocks', stereoOverlay: 'Show R/S and E/Z labels in the world',
  invertY: 'Invert look up/down', sensitivity: 'Mouse sensitivity', turnRate: 'Keyboard turn rate', uiScale: 'Interface size',
  keys: 'Keys', keyColumns: ['Action', 'Key', 'Remap'], change: 'Change', pressAKey: 'Press a key... (Escape cancels)', resetKeys: 'Reset all keys',
  keyReserved: (key: string) => `${key} is reserved by the browser or the game and cannot be assigned.`,
  keyConflict: (action: string) => `That key is already used for "${action}". Choose another key.`,
  settingChanged: (label: string, value: string) => `${label}: ${value}.`,
  uiScaleLabel: (scale: number) => `${Math.round(scale * 100)}%`,
  // live region
  nothingTargeted: 'Nothing targeted. Look at a molecule and press F.',
  analyzeSummary: (a: Analysis, name: string | null) =>
    [
      name ?? 'Unnamed molecule',
      spellFormula(a.formula),
      a.groups.length ? a.groups.map((g) => g.label).join(', ') : 'no functional groups',
      `${a.dou} degree${a.dou === 1 ? '' : 's'} of unsaturation`,
      a.netCharge !== 0 ? `net charge ${signed(a.netCharge)}` : '',
      stereoSummary(a),
      a.warnings.length ? `${a.warnings.length} warning${a.warnings.length === 1 ? '' : 's'}: ${warningText(a.warnings[0] as Warning, a)}` : 'no warnings',
    ].filter(Boolean).join(', ') + '.',
  // scene mirror (§16.3)
  mirror: {
    title: 'Scene',
    position: (x: number, y: number, z: number, facing: string) => `You are on the lab pad at ${x}, ${y}, ${z} facing ${facing}.`,
    offPad: (x: number, y: number, z: number, facing: string) => `You are at ${x}, ${y}, ${z} facing ${facing}.`,
    lookMode: (m: 'locked' | 'drag' | 'keys') => `Look mode: ${m === 'locked' ? 'mouse captured' : m === 'drag' ? 'drag to look' : 'arrow keys'}.`,
    molecules: (n: number) => `Molecules on the pad (${n})`,
    targetedSuffix: ' — targeted', lockedSuffix: ' (locked)',
    targeted: 'Targeted molecule', none: 'None.',
    selection: 'Selection', candidates: 'Candidates:', selected: 'Selected:',
    bench: 'Bench', reactant: 'Reactant:', reagent: 'Reagent:', productZone: 'Product zone:', empty: 'empty',
    challenge: 'Challenge',
    challengeLine: (n: number, total: number, title: string, status: string, earned: number, totalPoints: number) =>
      `${n} of ${total}: ${title}. ${status}. Score ${earned} of ${totalPoints}.`,
  },
  // help (section bodies)
  help: {
    title: 'Help', controls: 'Controls', exitKeys: 'Press Tab to leave the game area at any time. Escape opens this menu and releases the mouse.',
    controlColumns: ['Action', 'Key'],
    fixedRows: [['Pause menu / release the mouse', 'Escape'], ['Leave the game area', 'Tab'], ['Debug overlay', 'F3']],
    mouseRows: [['Look', 'Mouse (click the world to capture it) or arrow keys'], ['Mine / remove block', 'Left mouse button'], ['Place atom / use tool', 'Right mouse button'], ['Hotbar cycle', 'Mouse wheel']],
    looking: 'Looking around',
    lookingBody: 'Click the world to capture the mouse; press Escape to release it. If the mouse cannot be captured, drag to look. The arrow keys always turn the view.',
    building: 'Building',
    buildingBody: 'Atoms bond to every atom block they touch face to face. Hydrogens fill the remaining bonds automatically; press T to show them or place H blocks yourself. C makes 4 bonds, N 3, O and S 2, halogens 1. The bond wand (B) cycles a bond through single, double, triple and no bond; the charge tool (C) cycles an atom through 0, +1 and −1. Touching atom blocks bond automatically. To keep two touching atoms apart, point the bond wand at the bar between them and press E until it becomes a red x break marker: the atoms then touch but are not bonded, and they do not count toward each other\'s bonds. Removing either block clears the marker; placing a block there again bonds it.',
    rings: 'Rings on this grid',
    ringsBody: 'A six-membered ring is the six corners of a cube that form a chair — never a flat 2×3 rectangle (it would have an extra bond across it). Build rings one block above the pad floor. Bend chains at sp3 carbons; keep both sides of a C=C in one plane (zigzag).',
    ringsSvgLabel: 'A cube with six of its eight corners joined into a chair-shaped six-membered ring.',
    stereo: 'Stereochemistry',
    stereoBody: 'A carbon with four different groups is a chirality center. Put its three heavy groups on three faces at right angles (an octant) and the hidden H is defined; if two groups are opposite each other the center is flat — bend it or place the H block. The panel shows R or S. For E/Z, put the substituents of both alkene carbons beside their carbons, all in one plane: opposite sides for E (trans), the same side for Z (cis). Two groups on the same side touch — break the bond between them with the wand so they stay separate.',
    bench: 'Reaction bench',
    benchBody: 'Walk to the bench south of the pad or press R. The reactant is locked on the left; build the product on the right, then Submit product.',
    legend: 'Elements', legendColumns: ['Symbol', 'Name', 'Colour', 'Bonds', 'Where to find it'],
    ore: (el: BlockElement) =>
      el === 'H' ? 'No ore needed: unlimited in the hotbar' : `${ELEMENT_NAME[el]} ore blocks in the hills around the pad; each gives ${ORE_YIELD} atoms`,
    bonds: (n: number) => `${n}`,
    scoring: 'Scoring',
    scoringLms: 'Build challenges can be retried without penalty. Quizzes, atom selections and reagent choices earn full points on the first try, half on the second, none after that. Your score is saved to the course gradebook when a challenge is solved.',
    scoringLocal: 'Build challenges can be retried without penalty. Quizzes, atom selections and reagent choices earn full points on the first try, half on the second, none after that. Your progress is saved on this device.',
  },
  // debug
  debug: (fps: number, x: number, y: number, z: number, chunks: number, mode: string) =>
    `${fps} fps  xyz ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}  chunks ${chunks}  look ${mode}`,
} as const;

/** Student-facing labels of every settings field (announcements and the help table). */
export const SETTING_LABEL: Readonly<Record<string, string>> = {
  lowGraphics: STRINGS.graphics, showHydrogens: STRINGS.showHydrogens, reducedMotion: STRINGS.reducedMotion, theme: STRINGS.theme,
  invertY: STRINGS.invertY, sensitivity: STRINGS.sensitivity, turnRate: STRINGS.turnRate, uiScale: STRINGS.uiScale,
  stereoOverlay: STRINGS.stereoOverlay, keys: STRINGS.keys,
};

/** Spoken value of a settings field. */
export function settingValueText(key: string, value: unknown): string {
  if (typeof value === 'boolean') {
    if (key === 'lowGraphics') return value ? STRINGS.graphicsLow : STRINGS.graphicsStandard;
    return value ? STRINGS.on : STRINGS.off;
  }
  if (key === 'theme') return value === 'dark' ? STRINGS.themeDark : value === 'light' ? STRINGS.themeLight : STRINGS.themeAuto;
  if (key === 'reducedMotion') return value === 'on' ? STRINGS.on : value === 'off' ? STRINGS.off : STRINGS.motionAuto;
  if (key === 'uiScale' && typeof value === 'number') return STRINGS.uiScaleLabel(value);
  if (key === 'keys') return 'updated';
  if (typeof value === 'number') return String(value);
  return String(value);
}

/** Badge text per adapter mode (the adapter sends the string in `lms:status`; this is the fallback table). */
export const MODE_TEXT: Readonly<Record<AdapterMode, string>> = MODE_BADGE;

// ---------------------------------------------------------------------------
// warningText (§19.3)
// ---------------------------------------------------------------------------

function elN(a: Analysis, atom: number): string {
  const at = a.atoms[atom];
  return at ? atomLabel(at.el, atom) : `atom ${atom + 1}`;
}

export function warningText(w: Warning, a: Analysis): string {
  switch (w.kind) {
    case 'over-valence':
      return `${elN(a, w.atom)} has ${w.have} bonds but can have at most ${w.max}. Remove a neighbour or lower a bond order.`;
    case 'h-block-valence':
      return `A hydrogen block touches ${w.bonds} heavy atoms; it must touch exactly one.`;
    case 'charge-unsupported':
      return `${elN(a, w.atom)} cannot carry charge ${signed(w.charge)} in this game. Reset the charge.`;
    case 'planar-center':
      return `C${w.atom + 1}: ${w.shape === 'square-planar' ? STEREO_TEXT.flatSquare : STEREO_TEXT.flatT}`;
    case 'alkene-geometry': {
      const d = a.stereo?.doubleBonds.find((x) => x.bond === w.bond);
      if (d) {
        const hint = d.hint ?? (w.label === 'COLLINEAR' ? STEREO_TEXT.collinear(d.a + 1) : w.label === 'NOT_PLANAR' ? STEREO_TEXT.notPlanar(d.a + 1) : STEREO_TEXT.twisted);
        return `Bond C${d.a + 1}=C${d.b + 1}: ${hint}`;
      }
      const generic = w.label === 'TWISTED' ? STEREO_TEXT.twisted : w.label === 'COLLINEAR'
        ? 'A group lies in line with the double bond. An sp2 carbon is trigonal: move the group to the side of the carbon.'
        : 'The two groups on one alkene carbon are 90 degrees apart. They must be on opposite sides of the double bond, in one plane.';
      return `Double bond ${w.bond + 1}: ${generic}`;
    }
    case 'cage':
      return `${elN(a, w.atom)} is bonded to three atoms of one ring (a cage). Build rings one block above the floor and keep substituents outside the ring.`;
    case 'isomorphism-cap':
      return `Comparison stopped after ${w.states} steps because the molecule is too symmetric or too large. Simplify it.`;
    case 'unverified-pka':
      return `The pKa for ${w.classId} is a general textbook value not tabulated in McMurry; it is shown as ≈ and never decides a graded answer.`;
    default:
      return 'Warning.';
  }
}

/** Every remappable action in schema order (re-exported for the help and settings tables). */
export const KEY_ACTION_ORDER: readonly KeyAction[] = KEY_ACTIONS;
