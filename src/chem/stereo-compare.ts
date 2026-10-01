/**
 * Parity comparison under an isomorphism — the public module of 00-contracts
 * §5 / 03 §6: `compareStereo(target, student, mapping)` and `permSign`.
 * PURE MODULE.
 *
 * The implementations live in `stereo.ts` (03 §13 item 10): `analyzeStereo`'s
 * meso test calls `compareStereo` and `parityInOrder` calls `permSign`, so
 * keeping them there avoids a circular import while this module remains the
 * name every consumer (`compare.ts`, the reaction tests) imports from. The
 * import direction is `compare -> stereo-compare -> stereo -> cip`.
 *
 * Semantics (03 §6.2): `mapping[targetId] = studentId` is one isomorphism from
 * `findIsomorphisms(target, student)`. Every target atom with `tet` and every
 * target bond with `ez` is checked against the student's parity (positions
 * when the student is a world graph, tags otherwise); untagged target atoms
 * and bonds are wildcards. Verdicts: SAME (all agree), ENANTIOMER (every
 * centre flipped, every C=C agrees), DIASTEREOMER (anything else),
 * UNSPECIFIED (a target centre maps onto a planar / untagged student atom, or
 * a target C=C onto an alkene with no defined relation), INVALID_GEOMETRY (a
 * target C=C maps onto a collinear / non-planar / twisted student alkene).
 */
export { compareStereo, permSign } from './stereo';
export type { StereoCompareResult } from './stereo';
