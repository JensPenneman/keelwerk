import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { assertConnectionsClosed } from './assert-connections-closed.ts';
import { assertDeadlocksDeclared } from './assert-deadlocks-declared.ts';
import { createApplicationRole } from './create-application-role.ts';
import { deadlockCount } from './deadlock-count.ts';
import { declaredDeadlocks } from './declared-deadlocks.ts';
import { postgresImage } from './postgres-image.ts';
import type { RunningPostgres } from './running-postgres.ts';

/**
 * Starts one PostgreSQL 18 container with the image's default durability settings and
 * `max_connections` 200 and its data directory on tmpfs (the image declares `/var/lib/postgresql`
 * as its volume and keeps `PGDATA` below it, so the mount replaces the anonymous volume; the server
 * starts faster too), creates the application role, and labels the container `keelwerk-test` so
 * that `docker ps -a --filter label=keelwerk-test` finds leftovers. Clients reach it over TCP
 * through the container runtime's port forwarding. A test file that starts the container for itself
 * passes `checkDeadlocks`: its `stop` then also fails unless the container's deadlock counter moved
 * by exactly what the file declared (`declareDeadlocks`), the rule of the connection guard
 * (`assertDeadlocksDeclared`); the container goes down first, either way.
 */
export async function startPostgres(
  options: { readonly checkDeadlocks?: boolean } = {},
): Promise<RunningPostgres> {
  const container = await new PostgreSqlContainer(postgresImage)
    .withCommand(['postgres', '-c', 'max_connections=200'])
    .withLabels({ 'keelwerk-test': 'postgres' })
    .withTmpFs({ '/var/lib/postgresql': 'rw' })
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
    const containerId = container.getId();
    const cluster = { containerId, adminUrl };
    const checkDeadlocks = options.checkDeadlocks === true;
    const deadlocksBefore = checkDeadlocks ? await deadlockCount(cluster) : 0;
    const declaredBefore = declaredDeadlocks.count;
    return {
      adminUrl,
      appUrl,
      version: versionResult.output.trim(),
      containerId,
      stop: async () => {
        try {
          await assertConnectionsClosed({ containerId, adminUrl });
        } catch (cause) {
          // Stopping the server under a connection that is still open ends it with an error that
          // nothing handles, so the container stays up and the reaper removes it when this process exits.
          throw new Error(
            `${cause instanceof Error ? cause.message : String(cause)} The container ${containerId} was not stopped; the reaper removes it when this process exits.`,
            { cause },
          );
        }
        const moved = checkDeadlocks ? (await deadlockCount(cluster)) - deadlocksBefore : 0;
        await container.stop();
        if (checkDeadlocks) {
          // What the file declared for this container only; a declaration for another cluster stays.
          const declared = declaredDeadlocks.count - declaredBefore;
          declaredDeadlocks.count = declaredBefore;
          assertDeadlocksDeclared(moved, declared);
        }
      },
    };
  } catch (error) {
    await container.stop();
    throw error;
  }
}
