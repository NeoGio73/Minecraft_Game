/**
 * Student feedback sentences: the `FEEDBACK` template table and
 * `feedbackText(kind, params, override)`. PURE MODULE.
 * See docs/design/05-content.md section 9 and 09-amendment-no-bond.md section 1.9.
 *
 * Every template falls back to a generic sentence when a parameter is
 * absent. Strings are ASCII, sentence case, no emojis.
 */
import type { FeedbackKind } from './types';
import { STEREO_TEXT } from '../chem/stereo';

export type FeedbackParams = Readonly<Record<string, string | number | undefined>>;

/** Appended to wrong-formula / constitutional-isomer / wrong-ring-count when the student left a touching pair bonded (09 §1.9). */
export const NO_BOND_HINT =
  'Two touching atoms that should not be bonded have bonded into a ring: point the bond wand (B) at the bar between them and press E until it shows the red x break marker (no bond).';

function has(p: FeedbackParams, key: string): boolean {
  const v = p[key];
  return v !== undefined && v !== '';
}

function ringHint(p: FeedbackParams): string {
  return has(p, 'extraRing') ? ` ${NO_BOND_HINT}` : '';
}

function shapeText(p: FeedbackParams): string {
  return p['shape'] === 'square-planar' ? STEREO_TEXT.flatSquare : STEREO_TEXT.flatT;
}

export const FEEDBACK: Readonly<Record<FeedbackKind, (p: FeedbackParams) => string>> = {
  correct: (p) =>
    `Correct!${has(p, 'name') ? ` That is ${p['name']}.` : ''}${has(p, 'explanation') ? ` ${p['explanation']}` : ''}${has(p, 'expected') ? ` Answer: ${p['expected']}.` : ''}`,
  'correct-reduced': (p) => `Accepted for half credit: ${has(p, 'note') ? p['note'] : 'this is an also-correct product; build the main product for full credit.'}`,
  'wrong-formula': (p) =>
    (has(p, 'yours') && has(p, 'expected')
      ? `Wrong formula: yours is ${p['yours']}, the target is ${p['expected']}. Check the atom count and the number of hydrogens the panel shows.`
      : 'Wrong formula. Check the atom count and the number of hydrogens the panel shows.') + ringHint(p),
  'constitutional-isomer': (p) =>
    `Right formula${has(p, 'yours') ? ` (${p['yours']})` : ''} but the atoms are connected differently: this is a constitutional isomer of the target${has(p, 'name') ? ` (you built ${p['name']})` : ''}.` + ringHint(p),
  enantiomer: (p) =>
    `Right molecule, wrong handedness: your build is the enantiomer (mirror image) of the target. Swap any two groups on C${has(p, 'atom') ? p['atom'] : '?'}.`,
  diastereomer: (p) =>
    `Right atoms and bonds, but the stereochemistry differs from the target at C${has(p, 'atom') ? p['atom'] : '?'}: this is a diastereomer. Check the R/S or cis/trans labels in the panel.`,
  'unspecified-center': (p) => `C${has(p, 'atom') ? p['atom'] : '?'} has no definite configuration yet. ${shapeText(p)}`,
  'invalid-alkene-geometry': (p) =>
    `The C=C double bond${has(p, 'bond') ? ` at bond ${p['bond']}` : ''} is not laid out flat. Put every substituent beside its alkene carbon (never in line with the C=C) and keep all of them in one plane.`,
  'missing-group': (p) =>
    `The molecule needs ${has(p, 'what') ? p['what'] : 'a different functional group'}. The panel lists the functional groups it currently has.`,
  'forbidden-group': (p) => `The molecule must not contain ${has(p, 'what') ? p['what'] : 'that functional group'}.`,
  'wrong-ring-count': (p) => {
    const base = has(p, 'yours') && has(p, 'expected')
      ? `Ring count: yours has ${p['yours']}, the target needs ${p['expected']}.`
      : 'Ring count does not match the target.';
    const yours = Number(p['yours']);
    const expected = Number(p['expected']);
    const more = (Number.isFinite(yours) && Number.isFinite(expected) && yours > expected) || has(p, 'extraRing');
    return base + (more ? ` ${NO_BOND_HINT}` : '');
  },
  'wrong-pi-count': (p) =>
    (has(p, 'yours') && has(p, 'expected')
      ? `Pi bonds: yours has ${p['yours']}, the target needs ${p['expected']}.`
      : 'The number of pi bonds does not match the target.') + ' Use the bond wand to change a bond order.',
  'wrong-charge': (p) =>
    (has(p, 'yours') && has(p, 'expected')
      ? `Right atoms, wrong charge: the net charge is ${p['yours']}, the target has ${p['expected']}.`
      : 'Right atoms, wrong charge.') + ' Use the charge tool (C) on the atom that should carry it.',
  'valence-error': (p) =>
    `${has(p, 'el') ? p['el'] : 'An atom'}${has(p, 'atom') ? ` at position ${p['atom']}` : ''} has too many bonds. Remove a bond or lower a bond order before submitting.`,
  'extra-molecule': (p) =>
    `Extra molecule on the pad${has(p, 'formula') ? `: ${p['formula']}` : ''}. Remove it (or use Clear pad in the menu) and submit again.`,
  'missing-molecule': (p) =>
    `Expected ${has(p, 'expected') ? p['expected'] : 'more'} product molecules, found ${has(p, 'have') ? p['have'] : 'fewer'}. Build the missing one${has(p, 'formula') ? ` (${p['formula']})` : ''} as a separate molecule.`,
  'already-built': (p) => `You already built ${has(p, 'name') ? p['name'] : 'that isomer'}. Build a different isomer.`,
  'not-an-isomer': (p) =>
    `That molecule has the right formula${has(p, 'formula') ? ` (${p['formula']})` : ''} but is not a valid isomer here${has(p, 'name') ? `: ${p['name']}` : ''}. (Stereoisomers count as the same skeleton.)`,
  'wrong-atom': (p) => `Not that one.${has(p, 'picked') ? ` You picked ${p['picked']}.` : ''} Think again and try another selection.`,
  'no-hydrogens': () => 'That atom has no hydrogens. Select a hydrogen (or an atom that carries one).',
  'wrong-reagent': (p) => `That reagent does not give this product.${has(p, 'reason') ? ` ${p['reason']}` : ''}`,
  'wrong-option': () => 'Not correct. Try again.',
  'attempts-exhausted': (p) =>
    `No attempts left. The answer was: ${has(p, 'expected') ? p['expected'] : 'shown in the panel'}.${has(p, 'explanation') ? ` ${p['explanation']}` : ''}${has(p, 'reason') ? ` ${p['reason']}` : ''}`,
  'nothing-targeted': () => 'Nothing is targeted. Look at the molecule you built on the lab pad and press Submit again.',
};

/** `override ?? FEEDBACK[kind](params)`. */
export function feedbackText(kind: FeedbackKind, params: FeedbackParams = {}, override?: string): string {
  if (override !== undefined && override !== '') return override;
  return FEEDBACK[kind](params);
}
