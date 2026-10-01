/**
 * Chemistry facade: `analyze(g)` composes every per-molecule derivation into
 * the `Analysis` record the molecule panel renders.
 * PURE MODULE. See docs/design/02-chemistry-core.md section 15.
 *
 * Pipeline: implicit hydrogens -> aromaticity perception -> counts / formula
 * / DoU / rings / components -> functional groups -> WL hash -> per-atom
 * AtomInfo -> stereo (only for a world graph with positions) -> acidity ->
 * library name -> warnings (extra, valence, cage, stereo, unverified pKa),
 * deduplicated. Every input graph is treated as Kekulé (the parser and the
 * world both produce Kekulé orders); chemistry never throws here.
 */
import { hasPositions } from './types';
import type { Analysis, ChemApi, MoleculeGraph, StereoAnalysis, Warning } from './types';
import { components, neighborsOf, smallestRings, withoutAtom } from './graph';
import { implicitHydrogens } from './hydrogens';
import { perceiveAromaticity } from './aromatic';
import { degreesOfUnsaturation, elementCounts, hillFormula, netCharge, ringCount } from './formula';
import { functionalGroups } from './groups';
import { wlHash } from './wlhash';
import { atomInfo } from './hybridization';
import { analyzeStereo, stereoWarnings } from './stereo';
import { acidity, unverifiedWarnings } from './acidity';
import { nameOf } from './naming';

/**
 * Static form of the placement cage rule (02 §12.2, critic 4.5): one `cage`
 * warning per atom that is bonded to three or more atoms of a single ring of
 * the molecule without it (the chair hexagon plus an inner-vertex carbon).
 * `ringAtoms` are ids of `g`.
 */
export function cageWarnings(g: MoleculeGraph): Warning[] {
  const out: Warning[] = [];
  if (ringCount(g) === 0) return out;
  for (let i = 0; i < g.atoms.length; i++) {
    if (g.adj[i]!.length < 3) continue;
    const reduced = withoutAtom(g, i);
    const neighbours = new Set(neighborsOf(g, i).map((n) => (n > i ? n - 1 : n)));
    for (const ring of smallestRings(reduced)) {
      let inRing = 0;
      for (const a of ring) if (neighbours.has(a)) inRing++;
      if (inRing >= 3) {
        out.push({ kind: 'cage', atom: i, ringAtoms: ring.map((a) => (a >= i ? a + 1 : a)) });
        break;
      }
    }
  }
  return out;
}

function warningKey(w: Warning): string {
  switch (w.kind) {
    case 'over-valence':
    case 'h-block-valence':
    case 'charge-unsupported':
    case 'planar-center':
    case 'cage':
      return `${w.kind}|${w.atom}`;
    case 'alkene-geometry':
      return `${w.kind}|${w.bond}`;
    case 'unverified-pka':
      return `${w.kind}|${w.classId}`;
    case 'isomorphism-cap':
      return `${w.kind}|${w.states}`;
    default: {
      const _exhaustive: never = w;
      void _exhaustive;
      return '';
    }
  }
}

/** Keeps the first occurrence of each `kind | atom-or-bond-or-classId-or-states` key, in order. */
export function dedupeWarnings(ws: readonly Warning[]): Warning[] {
  const seen = new Set<string>();
  const out: Warning[] = [];
  for (const w of ws) {
    const key = warningKey(w);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/**
 * The full panel record. `extraWarnings` (extraction warnings such as
 * `h-block-valence`, `charge-unsupported`) come first in `warnings`; the
 * ChemApi form `analyze(g)` is the same call without them.
 */
export function analyze(g: MoleculeGraph, extraWarnings: readonly Warning[] = []): Analysis {
  const { hydrogens, warnings: valenceWarnings } = implicitHydrogens(g);
  const gp = perceiveAromaticity(g);
  const n = gp.atoms.length;
  const counts = elementCounts(gp, hydrogens);
  const formula = hillFormula(gp, hydrogens);
  const charge = netCharge(gp);
  const dou = n === 0 ? 0 : degreesOfUnsaturation(counts);
  const componentCount = components(gp).length;
  const rings = ringCount(gp);
  const groups = functionalGroups(gp, hydrogens);
  const hash = wlHash(gp, hydrogens).hash;
  const atoms = atomInfo(gp, hydrogens);
  const stereo: StereoAnalysis | null = n > 0 && hasPositions(gp) ? analyzeStereo(gp, hydrogens) : null;
  const acid = acidity(gp, atoms);
  const name = nameOf(gp);
  const warnings = dedupeWarnings([
    ...extraWarnings,
    ...valenceWarnings,
    ...cageWarnings(gp),
    ...(stereo ? stereoWarnings(stereo) : []),
    ...unverifiedWarnings(acid),
  ]);
  return {
    formula,
    counts,
    hydrogens,
    netCharge: charge,
    dou,
    ringCount: rings,
    components: componentCount,
    groups,
    warnings,
    name,
    hash,
    atoms,
    stereo,
    acidity: acid,
  };
}

const _check: Pick<ChemApi, 'analyze'> = { analyze };
void _check;
