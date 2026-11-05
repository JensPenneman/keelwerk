import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import { deploymentIdentityTrack } from './deployment-identity-track.ts';

/**
 * The deployment id recorded in the control root, or undefined when none is: the earliest record
 * of the identity track (concurrent first boots keep the earliest id). Reads only; nothing is written.
 */
export async function recordedDeploymentId(
  adapter: Pick<DataAdapter, 'schema'>,
  namespace: NamespaceRef,
): Promise<string | undefined> {
  return (await adapter.schema.history(namespace))
    .filter((row) => row.track === deploymentIdentityTrack)
    .map((row) => row.id)
    .sort()[0];
}
