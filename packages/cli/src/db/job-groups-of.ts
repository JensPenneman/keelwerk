import type { DeploymentDefinition, JobGroup } from '@keelwerk/core';

/** The namespace-wide job groups of the deployment's queues (`queues.<q>.running`, section 9.5.5), the rule of the runtime's migrate phase. */
export function jobGroupsOf(definition: DeploymentDefinition): readonly JobGroup[] {
  return Object.entries(definition.queues ?? {}).flatMap(([queue, limits]) =>
    limits.running === undefined
      ? []
      : [{ id: `queue:${queue}`, concurrency: limits.running, scope: 'namespace' as const }],
  );
}
