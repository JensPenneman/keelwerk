import { runProducersIsolated } from '../producers/run-producers-isolated.ts';
import type { ArtefactRun } from './artefact-run.ts';

/** Runs the producers of `keelwerk generate` in check mode over the workspace at `root`; a producer that throws is a failed run, never a rejection. */
export async function runArtefactCheck(root: string): Promise<ArtefactRun> {
  try {
    const result = await runProducersIsolated({ root, check: true });
    return { code: result.failures.length === 0 ? 0 : 1, output: result.failures.join('\n') };
  } catch (error) {
    return { code: 1, output: error instanceof Error ? error.message : String(error) };
  }
}
