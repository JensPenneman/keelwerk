import type { KeyService, Scope, StreamRef } from '@keelwerk/core';
import { jobKeyInfo, processStreamRef } from '@keelwerk/core';

/**
 * The state stream of a process instance as the dispatcher derives it: `processStreamRef` takes
 * the digest of the instance key under the scope's job key secret, bound to the process (WP-130).
 */
export async function processInstanceStream(
  keys: KeyService,
  scope: Scope,
  processId: string,
  instanceKey: string,
): Promise<StreamRef> {
  const secret = await keys.derive(scope, jobKeyInfo, 32);
  return processStreamRef(scope, processId, instanceKey, secret);
}
