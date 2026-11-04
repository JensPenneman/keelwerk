import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { createApplicationRole } from './create-application-role.ts';
import { postgresImage } from './postgres-image.ts';
import type { RunningPostgres } from './running-postgres.ts';

/**
 * Starts one PostgreSQL 18 container with the image's default durability settings and
 * `max_connections` 200, creates the application role, and labels the container `keelwerk-test` so
 * that `docker ps -a --filter label=keelwerk-test` finds leftovers. Clients reach it over TCP
 * through the container runtime's port forwarding.
 */
export async function startPostgres(): Promise<RunningPostgres> {
  const container = await new PostgreSqlContainer(postgresImage)
    .withCommand(['postgres', '-c', 'max_connections=200'])
    .withLabels({ 'keelwerk-test': 'postgres' })
    .start();
  try {
    await createApplicationRole(container);
    const versionResult = await container.exec([
      'psql',
      '-U',
      container.getUsername(),
      '-d',
      container.getDatabase(),
      '-tAc',
      'select version()',
    ]);
    if (versionResult.exitCode !== 0) {
      throw new Error(`reading the server version failed: ${versionResult.output}`);
    }
    const adminUrl = container.getConnectionUri();
    const appUrl = adminUrl.replace(
      `${container.getUsername()}:${container.getPassword()}@`,
      'kw_app:kw_app@',
    );
    return {
      adminUrl,
      appUrl,
      version: versionResult.output.trim(),
      stop: async () => {
        await container.stop();
      },
    };
  } catch (error) {
    await container.stop();
    throw error;
  }
}
