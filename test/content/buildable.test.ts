import { describe, it, expect } from 'vitest';
import { EMBED_NODE_BUDGET } from '@/chem/types';
import type { MoleculeGraph } from '@/chem/types';
import { embedOnLattice } from '@/chem/embed';
import { withoutStereoTags } from '@/chem/graph';
import { entryBySmiles, layoutOf, loadLibrary, parseEntry } from '@/content/library';
import { loadFullRoster, loadRosterFile } from '@/content/challenges';
import { evaluate } from '@/content/acceptance';
import { NO_BOND_HINT } from '@/content/feedback';
import { buildReport } from '@/content/validate';
import type { Challenge, SubmissionContext } from '@/content/types';
import { NEEDS_SUPPRESSION } from './fixtures/suppressions';
import { PAD_ORIGIN, PRODUCT_ORIGIN, build, moleculesOf, placeInWorld } from './fixtures/build';

const library = loadLibrary();
const full = loadFullRoster();

function ctxFor(zone: 'pad' | 'product', world: ReturnType<typeof build>): SubmissionContext {
  const { molecules, targeted } = moleculesOf(world.world, zone, world.cells[0]);
  return { padMolecules: molecules, targeted, selection: [], isomersDone: new Set(), attempt: 1, diagonalBondsEnabled: false };
}

function stereoKept(c: Challenge, field: string): boolean {
  const r = c.rule;
  if (r.type === 'stereo-exact') return true;
  if (r.type === 'predict-product') return field === 'expected' && r.stereoCheck !== 'none';
  return false;
}

describe('B1 every library entry embeds', () => {
  it('the eight no-bond entries need exactly their listed pair; every other entry embeds induced', () => {
    expect(Object.keys(NEEDS_SUPPRESSION).length).toBe(8);
    let induced = 0;
    for (const e of library.entries) {
      const g = parseEntry(e);
      const emb = embedOnLattice(g);
      expect(emb, e.id).not.toBeNull();
      const need = NEEDS_SUPPRESSION[e.id];
      if (need) {
        expect(emb!.suppressedPairs, e.id).toEqual([need]);
        expect(embedOnLattice(g, { allowSuppressedPairs: false }), e.id).toBeNull();
        expect(layoutOf(e)!.suppressedPairs, e.id).toEqual([need]);
      } else {
        expect(emb!.suppressedPairs.length, e.id).toBe(0);
        expect(layoutOf(e)!.suppressedPairs.length, e.id).toBe(0);
        induced++;
      }
    }
    expect(induced).toBe(184);
  });
});

describe('B2 every build target embeds within budget', () => {
  it('buildReport: nodesVisited <= 10000 and at most 2 suppressed pairs per row', () => {
    const rows = buildReport(library, loadRosterFile());
    const lines = rows.filter((r) => r.suppressedPairs.length > 0).map((r) => `${r.where} ${r.smiles} suppressed ${JSON.stringify(r.suppressedPairs)} nodes ${r.nodesVisited}`);
    console.log(['build report (rows needing a no-bond pair):', ...lines].join('\n'));
    for (const r of rows) {
      expect(r.nodesVisited, r.where).toBeGreaterThanOrEqual(0);
      expect(r.nodesVisited, r.where).toBeLessThanOrEqual(10_000);
      expect(r.nodesVisited, r.where).toBeLessThanOrEqual(EMBED_NODE_BUDGET);
      expect(r.suppressedPairs.length, r.where).toBeLessThanOrEqual(2);
    }
    const needing = rows.filter((r) => r.where.startsWith('challenge:') && r.suppressedPairs.length > 0).map((r) => r.where);
    expect(needing).toEqual([
      'challenge:ch7-build-z-but-2-ene:target',
      'challenge:ch7-build-z-2-chlorobut-2-ene:target',
      'challenge:ch9-predict-br2-1-equiv-but-1-yne:expected',
      'challenge:ch9-predict-lindlar-z-hex-3-ene:expected',
    ]);
    expect(rows.filter((r) => r.where.startsWith('library:') && r.suppressedPairs.length > 0).length).toBe(8);
  });

  it('every build SMILES of every rule embeds (stereo kept where it is graded)', () => {
    for (const c of full) {
      const r = c.rule;
      const targets: { field: string; smiles: string }[] = [];
      if (r.type === 'exact-molecule' || r.type === 'name-to-structure') targets.push({ field: 'target', smiles: r.target });
      if (r.type === 'stereo-exact') targets.push({ field: 'target', smiles: r.target }, ...(r.accept ?? []).map((s) => ({ field: 'accept', smiles: s })));
      if (r.type === 'isomer-set') targets.push(...r.isomers.map((s) => ({ field: 'isomers', smiles: s })));
      if (r.type === 'predict-product') targets.push(...r.expected.map((s) => ({ field: 'expected', smiles: s })), ...(r.acceptAlso ?? []).map((a) => ({ field: 'acceptAlso', smiles: a.smiles })));
      if (r.type === 'select-atom') targets.push(...r.molecules.map((s) => ({ field: 'molecules', smiles: s })));
      if (r.type === 'choose-reagent') targets.push({ field: 'product', smiles: r.product });
      if (r.type === 'quiz' && r.display) targets.push({ field: 'display', smiles: r.display.smiles });
      for (const t of targets) {
        const g: MoleculeGraph = stereoKept(c, t.field) ? parseEntry(t.smiles) : withoutStereoTags(parseEntry(t.smiles));
        const emb = embedOnLattice(g);
        expect(emb, `${c.id} ${t.field} ${t.smiles}`).not.toBeNull();
        expect(emb!.nodesVisited, `${c.id} ${t.smiles}`).toBeLessThanOrEqual(10_000);
      }
    }
  });
});

describe('B3 end-to-end: every build challenge passes when its target is placed in the world', () => {
  const buildRules = full.filter((c) => ['exact-molecule', 'name-to-structure', 'stereo-exact', 'predict-product'].includes(c.rule.type));

  it('covers 52 build challenges (6 exact, 5 name, 12 stereo-exact, 29 predict-product)', () => {
    expect(buildRules.length).toBe(6 + 5 + 12 + 29);
  });

  for (const c of buildRules) {
    it(`${c.id} passes`, () => {
      const r = c.rule;
      const zone = r.type === 'predict-product' ? 'product' : 'pad';
      const origin = zone === 'product' ? PRODUCT_ORIGIN : PAD_ORIGIN;
      const smilesList = r.type === 'predict-product' ? r.expected : [(r as { target: string }).target];
      const stereo = r.type === 'stereo-exact' || (r.type === 'predict-product' && r.stereoCheck !== 'none');
      // several expected molecules (ozonolysis fragments) are laid 4 cells apart along +x by placing each separately
      const world = (() => {
        let w: ReturnType<typeof build> | null = null;
        let x = origin[0];
        for (const s of smilesList) {
          const entry = entryBySmiles(s)!;
          const g = stereo ? parseEntry(entry) : withoutStereoTags(parseEntry(entry));
          const emb = stereo ? layoutOf(entry)! : embedOnLattice(g)!;
          if (w === null) {
            w = build(g, emb, [x, origin[1], origin[2]]);
          } else {
            placeInWorld(w.world, g, emb, [x, origin[1], origin[2]]);
          }
          const width = Math.max(...emb.pos.map((p) => p[0])) - Math.min(...emb.pos.map((p) => p[0])) + 1;
          x += width + 2;
        }
        return w!;
      })();
      const ctx = ctxFor(zone, world);
      expect(ctx.padMolecules.length).toBe(smilesList.length);
      const result = evaluate(c, ctx);
      expect(result.kind, result.message).toBe('correct');
      expect(result.passed).toBe(true);
      expect(result.pointsEarned).toBe(c.points);
    });
  }

  it('every predict-product acceptAlso alternative is accepted for half credit', () => {
    let n = 0;
    for (const c of full) {
      const r = c.rule;
      if (r.type !== 'predict-product' || !r.acceptAlso) continue;
      for (const alt of r.acceptAlso) {
        n++;
        const g = withoutStereoTags(parseEntry(alt.smiles));
        const world = build(g, embedOnLattice(g)!, PRODUCT_ORIGIN);
        const result = evaluate(c, ctxFor('product', world));
        expect(result.kind, `${c.id} ${alt.smiles}`).toBe('correct-reduced');
        expect(result.passed).toBe(true);
        expect(result.pointsEarned, c.id).toBe(Math.floor(c.points / 2));
        expect(result.message).toBe(`Accepted for half credit: ${alt.note}`);
      }
    }
    expect(n).toBe(6);
  });

  it('ch7-build-z-but-2-ene without the suppression is a ring: wrong-formula ending in NO_BOND_HINT', () => {
    const c = full.find((x) => x.id === 'ch7-build-z-but-2-ene')!;
    const entry = entryBySmiles('C/C=C\\C')!;
    const world = build(parseEntry(entry), layoutOf(entry)!, PAD_ORIGIN, { suppress: false });
    const ctx = ctxFor('pad', world);
    expect(ctx.targeted!.bonds.length).toBe(4);
    const result = evaluate(c, ctx);
    expect(result.passed).toBe(false);
    expect(result.kind).toBe('wrong-formula');
    expect(result.message.endsWith(NO_BOND_HINT)).toBe(true);
    expect(result.message).toContain('yours is C4H6, the target is C4H8');
  });
});
