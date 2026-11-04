import type { ClientError } from './client-error.ts';
import { clientFailure } from './client-failure.ts';

/** `subscribe`, `waitForEffects` and `waitEffects` need the live module, which M1 does not mount (S-62). */
export function liveUnavailable(what: string): ClientError {
  return clientFailure(
    'core.live_unavailable',
    `${what} needs the live module, which this server does not run.`,
  );
}
