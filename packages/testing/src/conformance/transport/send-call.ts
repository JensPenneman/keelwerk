import type { Call } from './call.ts';
import type { Sent } from './sent.ts';
import type { TransportTarget } from './transport-target.ts';

/** Sends a call through the target's codec. */
export function sendCall(target: TransportTarget, call: Call): Promise<Sent> {
  return target.codec.send(target, call);
}
