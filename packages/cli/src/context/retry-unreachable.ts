import { CliFailure } from './cli-failure.ts';
import type { CliHost } from './cli-host.ts';
import { localFailure } from './local-failure.ts';

/** Attempts per request; a network failure is retried. */
const attempts = 3;

/** Whether a failure is the one the link raises when the deployment cannot be reached. */
function isUnreachable(failure: unknown): failure is CliFailure {
  return (
    failure instanceof CliFailure &&
    typeof failure.outcome === 'object' &&
    failure.outcome.code === 'cli.unreachable'
  );
}

/**
 * Runs `attempt` up to three times while it fails with `cli.unreachable`, sleeping between tries;
 * any other failure, and an interrupt, ends it at once. The last unreachable failure is rethrown.
 */
export async function retryUnreachable<Value>(
  host: CliHost,
  signal: AbortSignal | undefined,
  attempt: () => Promise<Value>,
): Promise<Value> {
  let lastFailure: CliFailure | undefined;
  for (let count = 1; count <= attempts; count += 1) {
    try {
      return await attempt();
    } catch (failure) {
      if (signal?.aborted === true) {
        throw new CliFailure('interrupted', 'Interrupted.');
      }
      if (!isUnreachable(failure)) {
        throw failure;
      }
      lastFailure = failure;
      if (count < attempts) {
        await host.sleep(count * 200);
      }
    }
  }
  throw (
    lastFailure ?? localFailure('unavailable', 'cli.unreachable', 'The deployment is unreachable.')
  );
}
