import type { Caller } from './call.ts';
import type { TransportTarget } from './transport-target.ts';

/** The origin the request is sent to: the caller's host, else its tenant's domain. */
export function originOf(target: TransportTarget, caller: Caller): string {
  const name = caller.tenant ?? Object.keys(target.tenants)[0];
  const domain = caller.host ?? (name === undefined ? undefined : target.tenants[name]?.domain);
  if (domain === undefined) {
    throw new Error(`The target has no tenant '${name ?? ''}'.`);
  }
  return `https://${domain}`;
}
