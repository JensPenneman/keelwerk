import type { OpenedDeployment } from '../db/opened-deployment.ts';

/** The part of a PGlite database the cleanup uses. */
interface OwnerDatabase {
  query(sql: string, params?: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

/** The member of the PGlite adapter that hands out the database as its owner. */
interface OwnerAccess {
  asOwner<T>(fn: (database: OwnerDatabase) => Promise<T>): Promise<T>;
}

function hasOwnerAccess(adapter: object): adapter is OwnerAccess {
  return 'asOwner' in adapter && typeof adapter.asOwner === 'function';
}

function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Marks the `core.process` rows of the development database that are not stopped as stopped. PGlite
 * runs in one process, so a registration that an app which had to be killed left behind would make
 * the next start refuse. The probe runs while no app is alive, so no row it finds can be live.
 */
export async function stopLeftoverProcesses(opened: OpenedDeployment): Promise<void> {
  const adapter = opened.control.adapter;
  if (!hasOwnerAccess(adapter)) return;
  const entity = opened.apps
    .map((app) => app.registry.entities.get('core.process')?.descriptor)
    .find((descriptor) => descriptor !== undefined);
  const column = entity?.fields.state?.column;
  if (entity === undefined || column === undefined) return;
  const table = `${quoted(opened.control.namespace.root)}.${quoted(entity.table)}`;
  await adapter.asOwner(async (database) => {
    const found = await database.query('select to_regclass($1) as name', [table]);
    if (found.rows.length === 0 || (found.rows[0] as { name: unknown }).name === null) return;
    await database.query(
      `update ${table} set ${quoted(column)} = 'stopped' where ${quoted(column)} <> 'stopped'`,
    );
  });
}
