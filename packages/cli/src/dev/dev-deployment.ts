import { join } from 'node:path';
import type { DeploymentDefinition } from '@keelwerk/core';
import { ledgerFile } from '@keelwerk/core/ledger';
import { schemaPlanner } from '@keelwerk/data';
import type { DevPaths } from './dev-paths.ts';
import { devPgliteFactory } from './dev-pglite-factory.ts';

function has(entry: unknown, member: string): boolean {
  return typeof entry === 'object' && entry !== null && member in entry;
}

/** Entries that development replaces: data adapter factories, ledger sinks and the schema planner. */
function isReplaced(entry: unknown): boolean {
  return (
    (has(entry, 'id') && has(entry, 'create') && has(entry, 'dialect')) ||
    (has(entry, 'id') && has(entry, 'append') && has(entry, 'read')) ||
    (has(entry, 'kind') && Reflect.get(entry as object, 'kind') === 'schemaPlanner')
  );
}

/**
 * The deployment as `keelwerk dev` runs it (section 13.6, S-47): the control store and every
 * placement on PGlite below `.keelwerk/dev-db`, the ledger in `.keelwerk/ledger.log`, the operator
 * socket at `.keelwerk/dev.sock`. Everything else the file declares (the apps, the HTTP host,
 * tenant resolution, keys, queues) stays as written.
 */
export function devDeployment(
  definition: DeploymentDefinition,
  paths: DevPaths,
): DeploymentDefinition {
  const placements = Object.fromEntries(
    Object.entries(definition.placements).map(([name, entry]) => [
      name,
      {
        adapter: 'pglite',
        strategy: 'shared-tables',
        url: join(paths.database, name),
        ...(Array.isArray(entry.apps) ? { apps: entry.apps as readonly string[] } : {}),
      },
    ]),
  );
  return {
    ...definition,
    infrastructure: [
      ...definition.infrastructure.filter((entry) => !isReplaced(entry)),
      devPgliteFactory(),
      schemaPlanner(),
      ledgerFile({ path: paths.ledger }),
    ],
    control: { adapter: 'pglite', strategy: 'shared-tables', url: join(paths.database, 'control') },
    placements,
    operator: { ...definition.operator, socket: paths.socket },
  };
}
