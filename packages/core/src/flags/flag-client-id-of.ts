import type { Carrier } from '../invoker/carrier.ts';

const visibleAscii = /^[\x21-\x7e]{1,200}$/;

/**
 * `Keelwerk-Client-Id` (16.8.2): the anonymous targeting key; null when absent, or not 1 to 200
 * visible ASCII characters. The caller chooses it, so an anonymous caller can pick its side of a
 * split: a flag is not an access rule, and nothing may rely on the key being honest. It is used
 * only when there is no principal id, and it is never logged or put into telemetry.
 */
export function flagClientIdOf(carrier: Carrier): string | null {
  const id = carrier.headers?.['keelwerk-client-id'];
  return id !== undefined && visibleAscii.test(id) ? id : null;
}
