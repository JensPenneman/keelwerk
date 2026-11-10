import { env } from 'node:process';
import { loadDefinition } from '../db/load-definition.ts';
import { runProducers } from '../producers/run-producers.ts';
import type { ProbeResult } from './probe-result.ts';
import { reportStep } from './report-step.ts';
import { syncDevDatabase } from './sync-dev-database.ts';

/** What the probe is given. */
export interface ProbeOptions {
  readonly root: string;
  readonly deployment: string;
  /** Epoch milliseconds, from the supervisor's clock. */
  readonly now: number;
  /** After the author confirmed the contract steps: apply only the synchronisation, with them. */
  readonly contract: boolean;
}

/**
 * The probe (section 13.6): in a fresh process, imports the deployment file, which composes every
 * app, asks every producer for its artefacts (written only where the content changed) and then
 * synchronises the development database. The module manifests are not asked for again: the
 * supervisor wrote them just before. The environment is the child's own; nothing secret travels in
 * its arguments. Runs as the child of the supervisor; a process that
 * imported the definitions once cannot import changed ones, so every cycle starts a new one. The
 * import tracker is installed by the child's command (`childCommand`); after the imports, the probe
 * reports a step whenever it finishes one, so the supervisor's limit counts time without progress.
 */
export async function runProbe(options: ProbeOptions): Promise<ProbeResult> {
  await loadDefinition(options.deployment);
  reportStep('loaded the deployment');
  const producers = options.contract
    ? { written: [], notes: [], failures: [] }
    : await runProducers({
        root: options.root,
        check: false,
        only: ['surfaces', 'app', 'openapi', 'cli', 'migrations'],
        progress: reportStep,
      });
  if (producers.failures.length > 0) return { producers, sync: undefined };
  const sync = await syncDevDatabase({
    deployment: options.deployment,
    contract: options.contract,
    now: options.now,
    env,
    progress: reportStep,
  });
  return { producers, sync };
}
