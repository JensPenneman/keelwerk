import { applyDeployment } from '../db/apply-deployment.ts';
import { openDeployment } from '../db/open-deployment.ts';
import { stopLeftoverProcesses } from './stop-leftover-processes.ts';
import type { SyncResult } from './sync-result.ts';

/** What one synchronisation is asked for. */
export interface SyncOptions {
  /** The generated deployment file (`dev-deployment.ts`). */
  readonly deployment: string;
  /** Apply the contract and rebuild steps too: only after the author confirmed them. */
  readonly contract: boolean;
  readonly now: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Called with what was just finished, so the supervisor can see the synchronisation advance. */
  readonly progress?: (done: string) => void;
}

/**
 * Brings the development database up to the committed migration files with the internals of
 * `keelwerk db apply` (S-47): expand steps at once; contract and rebuild steps are reported as
 * deferred unless `contract` says the author confirmed them. Run it in a fresh child, because it
 * imports the apps.
 */
export async function syncDevDatabase(options: SyncOptions): Promise<SyncResult> {
  const progress = options.progress ?? (() => undefined);
  const opened = await openDeployment(options.deployment, options.env, progress);
  try {
    await stopLeftoverProcesses(opened);
    progress('stopped the left-over processes');
    const outcomes = await applyDeployment(opened, {
      contract: options.contract,
      now: options.now,
      progress,
    });
    const named = (placement: string, app: string, files: readonly string[]): string[] =>
      files.map((file) => `${placement}/${app}: ${file}`);
    return {
      applied: outcomes.flatMap((outcome) =>
        named(outcome.placement, outcome.app, outcome.applied),
      ),
      deferred: outcomes.flatMap((outcome) =>
        named(outcome.placement, outcome.app, outcome.deferred),
      ),
      warnings: outcomes.flatMap((outcome) => outcome.warnings),
    };
  } finally {
    await opened.close();
  }
}
