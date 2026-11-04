import { errors } from '../errors/errors.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { Registry } from '../registry/registry.ts';
import type { SchemaPlanner } from '../runtime/schema-planner.ts';
import type { AdapterEnvironment } from '../storage/adapter-environment.ts';
import type { DataAdapterFactory } from '../storage/data-adapter-factory.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { PlacementConfig } from '../storage/placement-config.ts';
import { provisionNamespace } from './provision-namespaces.ts';

/** The migration track whose single record in the control root holds the deployment id (S-09). */
const identityTrack = 'keelwerk.deployment';

/** The id the probe connection scopes its (unused) deployment-scope units to. */
const probeId = '00000000-0000-7000-8000-000000000000';

/**
 * The id of the deployment, minted once as a UUIDv7 at the first `connect` and recorded in the
 * `kw__control` root as the one record of the `keelwerk.deployment` track; every later boot reads
 * it back. It is never derived from the url, so rotating a password or moving the host keeps the
 * control store visible. The adapter needs the id when it is created, so a short probe connection
 * reads or records it first and closes again. Concurrent first boots keep the earliest id.
 */
export async function resolveDeploymentId(input: {
  readonly factory: DataAdapterFactory;
  readonly config: PlacementConfig;
  readonly environment: Omit<AdapterEnvironment, 'deploymentId' | 'keyWrapper'>;
  readonly namespace: NamespaceRef;
  readonly planner: SchemaPlanner | undefined;
  readonly registry: Registry;
  readonly adapterName: string;
}): Promise<string> {
  const probe = input.factory.create(input.config, { ...input.environment, deploymentId: probeId });
  try {
    const capabilities = await probe.connect();
    if (input.planner === undefined) {
      if (capabilities.dialect !== 'memory') {
        throw errors.validation(
          `The control adapter "${input.adapterName}" needs the schema planner in the deployment's infrastructure to create the control namespace.`,
        );
      }
      return newUuidV7();
    }
    await provisionNamespace({
      adapter: probe,
      namespace: input.namespace,
      planner: input.planner,
      registry: input.registry,
      level: 'control',
      jobGroups: [],
    });
    const recorded = async (): Promise<string | undefined> =>
      (await probe.schema.history(input.namespace))
        .filter((row) => row.track === identityTrack)
        .map((row) => row.id)
        .sort()[0];
    const known = await recorded();
    if (known !== undefined) return known;
    await probe.schema.apply(input.namespace, { id: newUuidV7(), track: identityTrack, steps: [] });
    const chosen = await recorded();
    if (chosen === undefined) throw errors.internal('The deployment id was not recorded.');
    return chosen;
  } finally {
    await probe.close(0);
  }
}
