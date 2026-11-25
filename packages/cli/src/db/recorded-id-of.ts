import type { DataAdapter } from '@keelwerk/core';
import { recordedDeploymentId } from '@keelwerk/core';
import { controlRootNamespace } from './control-root-namespace.ts';

/**
 * The deployment id recorded in the control root: undefined only where the root has no tables (a database
 * nothing started on). A read that fails throws, so an unknown id is never taken for none.
 */
export async function recordedIdOf(
  adapter: Pick<DataAdapter, 'schema'>,
): Promise<string | undefined> {
  const { tables } = await adapter.schema.introspect({ namespace: controlRootNamespace });
  return tables.length === 0 ? undefined : recordedDeploymentId(adapter, controlRootNamespace);
}
