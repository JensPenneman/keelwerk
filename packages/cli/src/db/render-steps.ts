import type { MigrationStep, NamespaceRef } from '@keelwerk/core';
import { namespaceRootOf } from '@keelwerk/core';
import { postgresSchemaOperations } from '@keelwerk/data';

const unreachable = (): never => {
  throw new TypeError('rendering reads no database');
};

const renderer = postgresSchemaOperations({ transaction: unreachable, exclusive: unreachable });

/** The PostgreSQL statements `db apply` would run for neutral steps, for review (`db plan`); no database is read. */
export function renderSteps(appId: string, steps: readonly MigrationStep[]): readonly string[] {
  const namespace: NamespaceRef = {
    id: `plan/${appId}`,
    placementId: 'plan',
    appId,
    tenantId: null,
    root: namespaceRootOf(appId),
  };
  return renderer.render(namespace, steps);
}
