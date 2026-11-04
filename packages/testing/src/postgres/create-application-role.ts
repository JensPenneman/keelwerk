import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Creates the login role the adapter runs as, without superuser and without BYPASSRLS. The password
 * is fixed because the container is throwaway. The statement runs through `psql` inside the
 * container, so no client library is needed here.
 */
export async function createApplicationRole(container: StartedPostgreSqlContainer): Promise<void> {
  const result = await container.exec([
    'psql',
    '-U',
    container.getUsername(),
    '-d',
    container.getDatabase(),
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `create role kw_app login password 'kw_app' nosuperuser nobypassrls`,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`creating the application role failed: ${result.output}`);
  }
}
