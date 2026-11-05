import type { AdapterCapabilities, DataAdapterFactory, DeploymentDefinition } from '@keelwerk/core';
import { adapterEnvironmentOf } from './adapter-environment-of.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';
import { placementConfigOf } from './placement-config-of.ts';

function isFactory(value: unknown): value is DataAdapterFactory {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'create' in value &&
    typeof value.create === 'function'
  );
}

/** What opening the placements yielded: the capabilities of those that answered, and a finding for each that did not. */
export interface OpenedCapabilities {
  readonly capabilities: ReadonlyMap<string, AdapterCapabilities>;
  readonly findings: readonly DoctorFinding[];
}

/**
 * Finds the `DataAdapterFactory` of the control store and of each placement in the deployment's
 * infrastructure, creates its adapter, connects it without migrating and closes it again, so
 * doctor can list the fallbacks (section 14.3.3). The control store is named `control`.
 */
export async function openCapabilities(
  definition: DeploymentDefinition,
  env: Readonly<Record<string, string | undefined>>,
): Promise<OpenedCapabilities> {
  const capabilities = new Map<string, AdapterCapabilities>();
  const findings: DoctorFinding[] = [];
  const entries = [
    ['control', definition.control] as const,
    ...Object.entries(definition.placements),
  ];
  for (const [name, entry] of entries) {
    const factory = definition.infrastructure
      .filter(isFactory)
      .find((candidate) => candidate.id === entry.adapter);
    const config = placementConfigOf(name, entry, env);
    const problem =
      factory === undefined
        ? `no infrastructure entry provides the ${entry.adapter} adapter`
        : config === undefined
          ? 'its url reads an environment variable that is not set'
          : undefined;
    if (factory === undefined || config === undefined) {
      findings.push(
        findingOf(
          'fallbacks',
          'warning',
          name,
          `the placement could not be opened: ${problem}`,
          'list the adapter factory in the infrastructure and set the variables of the url',
        ),
      );
      continue;
    }
    try {
      const adapter = factory.create(config, adapterEnvironmentOf(env));
      try {
        capabilities.set(name, await adapter.connect());
      } finally {
        await adapter.close(1000);
      }
    } catch (error) {
      findings.push(
        findingOf(
          'fallbacks',
          'warning',
          name,
          `the placement could not be opened: ${error instanceof Error ? error.message : String(error)}`,
          'check the adapter options and that the database is reachable',
        ),
      );
    }
  }
  return { capabilities, findings };
}
