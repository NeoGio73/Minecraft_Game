/**
 * Formal charge and the charge-tool valence rules (McMurry 2.3, acids-bases-
 * hybrid 3.3-3.4). PURE MODULE. See docs/design/03-stereo-acidity-
 * hybridization.md section 9 and 00-contracts.md section 8.1.
 *
 * `withCharge` is the only validating charge edit: it refuses hydrogen
 * blocks, unsupported (element, charge) pairs and atoms whose fixed bonds
 * (heavy bonds + explicit H blocks / bracket H) already exceed the target
 * valence of the new charge, then delegates to the unchecked
 * `graph.setCharge`. Implicit hydrogens are never stored; the next
 * `implicitHydrogens` call recomputes them from the new target valence.
 */
import { TARGET_VALENCE, VALENCE_ELECTRONS } from './types';
import type { AtomInfo, Charge, ChemApi, MoleculeGraph } from './types';
import { bondOrderSum, setCharge } from './graph';

/** Student-facing refusal text. `unsupported` and `valence` are byte-identical to
 *  REFUSAL_TEXT.chargeUnsupported / chargeValence in src/world/types.ts (the
 *  chem package must not import the world package; a world test asserts equality). */
export const CHARGE_REFUSAL = {
  hBlock: 'Hydrogen blocks cannot carry a charge.',
  unsupported: (el: string, q: number) => `${el} cannot carry charge ${q > 0 ? '+' : ''}${q} in this game.`,
  valence: (el: string, q: number, max: number) =>
    `Remove a bond first: ${el}${q > 0 ? '+' : q < 0 ? '-' : ''} allows ${max} bonds.`,
} as const;

/**
 * McMurry 2.3: FC = V - (nonbonding electrons + bonding electrons / 2)
 * = V - (2 * lonePairs + heavyBondOrderSum + hydrogens). Equals `info.charge`
 * whenever `valenceError` is undefined, because the lone pairs were derived
 * from the stored charge; it feeds the formal-charge quiz display.
 */
export function formalCharge(info: AtomInfo): number {
  return VALENCE_ELECTRONS[info.el] - (2 * info.lonePairs + info.heavyBondOrderSum + info.hydrogens);
}

/**
 * Whether the charge tool may set atom `atom` of `g` to charge `q`
 * (design 9.3). Throws RangeError when `atom` is not an atom index of `g`.
 */
export function canSetCharge(g: MoleculeGraph, atom: number, q: Charge): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(atom) || atom < 0 || atom >= g.atoms.length) throw new RangeError(`no atom ${atom}`);
  const a = g.atoms[atom]!;
  if (a.el === 'H') return { ok: false, reason: CHARGE_REFUSAL.hBlock };
  const tv = TARGET_VALENCE[a.el][q];
  if (tv === undefined) return { ok: false, reason: CHARGE_REFUSAL.unsupported(a.el, q) };
  // Explicit H blocks (world atoms) and bracket H counts (SMILES atoms) are
  // fixed; implicit hydrogens are free and adjust to the new target valence.
  const fixedH = a.hPos !== undefined ? a.hPos.length : (a.explicitH ?? 0);
  const have = bondOrderSum(g, atom) + fixedH;
  if (have > tv) return { ok: false, reason: CHARGE_REFUSAL.valence(a.el, q, tv) };
  return { ok: true };
}

/**
 * Validating charge edit: `canSetCharge` then `graph.setCharge`. Throws
 * `Error('charge refused: ' + reason)` when the tool must refuse.
 */
export function withCharge(g: MoleculeGraph, atom: number, charge: Charge): MoleculeGraph {
  const verdict = canSetCharge(g, atom, charge);
  if (!verdict.ok) throw new Error('charge refused: ' + verdict.reason);
  return setCharge(g, atom, charge);
}

const _check: Pick<ChemApi, 'formalCharge' | 'canSetCharge'> = { formalCharge, canSetCharge };
void _check;
