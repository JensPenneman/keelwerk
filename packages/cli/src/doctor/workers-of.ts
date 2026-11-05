import type { DeploymentDefinition } from '@keelwerk/core';

/** How many named processes of the deployment have the `work` role for `queue` (a slot for it, or the `'*'` slot). */
export function workersOf(definition: DeploymentDefinition, queue: string): number {
  return Object.values(definition.processes ?? {}).filter(
    (process) =>
      process.roles.includes('work') &&
      (process.slots === undefined || queue in process.slots || '*' in process.slots),
  ).length;
}
