/**
 * Analysis Web Worker: runs `analyze()` off the main thread so a ring-dense
 * build can never stall the frame loop (engineering review, finding 1b).
 * Loaded by Game.ts through `new Worker(new URL('./analyze.worker.ts',
 * import.meta.url), { type: 'module' })`; Vite emits it as its own chunk
 * under assets/ with a relative URL (base './').
 *
 * Imports only pure modules (src/chem and the content library, which
 * registers the name index so `analysis.name` matches the main thread).
 */
import { analyze } from './analyze';
import { loadLibrary } from '../content/library';
import type { AnalysisJob, AnalysisReply } from './analysis-protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent<AnalysisJob>) => void) | null;
  postMessage(reply: AnalysisReply): void;
}

const scope = self as unknown as WorkerScope;

loadLibrary();

scope.onmessage = (e: MessageEvent<AnalysisJob>): void => {
  const { job, component, graph, warnings } = e.data;
  try {
    const analysis = analyze(graph, warnings);
    scope.postMessage({ job, component, ok: true, analysis });
  } catch (err) {
    scope.postMessage({ job, component, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
