/**
 * Messages between Game.ts and the analysis Web Worker (`analyze.worker.ts`).
 * PURE MODULE (types only). Both sides are plain data: a WorldGraph in, an
 * Analysis out, so structured cloning carries them unchanged.
 * docs/design/10-integration-notes.md, "From engineering fixes".
 */
import type { Analysis, Warning, WorldGraph } from './types';

export interface AnalysisJob {
  /** Monotonic per Game instance; a reply whose job number is not the latest for its component is dropped. */
  readonly job: number;
  readonly component: number;
  readonly graph: WorldGraph;
  readonly warnings: readonly Warning[];
}

export type AnalysisReply =
  | { readonly job: number; readonly component: number; readonly ok: true; readonly analysis: Analysis }
  | { readonly job: number; readonly component: number; readonly ok: false; readonly error: string };
