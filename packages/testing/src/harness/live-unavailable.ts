import { KeelwerkError } from '@keelwerk/core';

/** `subscribe` and `waitForEffects` need the live module, which M1 does not mount (S-62). */
export function liveUnavailable(what: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'unavailable',
    code: 'core.live_unavailable',
    message: `${what} needs the live module, which this runtime does not run.`,
  });
}
