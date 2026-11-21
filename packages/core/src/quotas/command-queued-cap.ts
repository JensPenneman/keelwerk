import { commandQueue } from '../effects/command-queue.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';

/**
 * The queued cap a command job carries: undefined without quotas, for a deployment scope or a
 * `core` action; else `quotas.queueOf(scope, commandQueue).queued`.
 */
export function commandQueuedCap(
  run: Pick<RunCommandInput, 'quotas' | 'scope'>,
  action: Pick<ActionEntry, 'module'>,
): number | undefined {
  if (run.quotas === undefined || run.scope.level === 'deployment' || action.module === 'core') {
    return undefined;
  }
  return run.quotas.queueOf(run.scope, commandQueue).queued;
}
