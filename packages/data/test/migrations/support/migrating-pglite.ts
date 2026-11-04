import type { PgliteAdapter } from '../../../src/pglite/index.ts';
import { pgliteAdapter } from '../../../src/pglite/index.ts';
import { migrationDeployment } from './migration-deployment.ts';
import { migrationNamespace } from './migration-namespace.ts';

/** A connected in-memory PGlite whose application role exists and whose namespace root is provisioned empty. */
export async function migratingPglite(): Promise<PgliteAdapter> {
  const adapter = pgliteAdapter({ deploymentId: migrationDeployment });
  await adapter.connect();
  await adapter.asOwner(async (database) => {
    await database.query(
      'create role "kw_app" nosuperuser nobypassrls nocreatedb nocreaterole nologin',
    );
  });
  await adapter.schema.provision(migrationNamespace, []);
  return adapter;
}
