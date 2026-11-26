import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { assertConnectionsClosed } from './assert-connections-closed.ts';
import { assertDeadlocksDeclared } from './assert-deadlocks-declared.ts';
import { createApplicationRole } from './create-application-role.ts';
import { deadlockCount } from './deadlock-count.ts';
import { declaredDeadlocks } from './declared-deadlocks.ts';
import { freeHostPort } from './free-host-port.ts';
import { postgresImage } from './postgres-image.ts';
import { restartControls } from './restart-controls.ts';
import type { RestartablePostgres } from './restartable-postgres.ts';
import type { RunningPostgres } from './running-postgres.ts';
import { serverOptions } from './server-options.ts';
import { supervisorScript } from './supervisor-script.ts';

/**
 * Starts one PostgreSQL 18 container with the image's default durability settings and
 * `max_connections` 200 and its data directory on tmpfs (the image declares `/var/lib/postgresql`
 * as its volume and keeps `PGDATA` below it, so the mount replaces the anonymous volume; the server
 * starts faster too), creates the application role, and labels the container `keelwerk-test` so
 * that `docker ps -a --filter label=keelwerk-test` finds leftovers. Clients reach it over TCP
 * through the container runtime's port forwarding, on a host port this function picks (from 20000
 * to 29999, one that can be listened on at 0.0.0.0, ::, 127.0.0.1 and ::1) instead of one the
 * runtime picks: a runtime's own pick can fall on a port the host cannot listen on. A start that
 * fails names the host port; a runtime that refuses the port fails it at once, Docker Desktop only
 * at the container library's own wait (the port is published on every address: the library takes
 * no host address for it).
 * By default the container's `stop` also fails unless its deadlock counter moved by exactly what
 * the file declared (`declareDeadlocks`), the rule of the connection guard
 * (`assertDeadlocksDeclared`); the container goes down first, either way. A file that declared
 * deadlocks and stops more than one checked container fails: a declaration belongs to the file,
 * so opt one container out with `checkDeadlocks: false` or split the file. Only a caller whose
 * files the connection guard already checks one by one, and a test of this rule, opts out. With
 * `restartable: true` the server runs under a supervising shell and the result has `stopServer`
 * and `startServer` (`RestartablePostgres`); the container stops as any other.
 */
export async function startPostgres(options: {
  readonly checkDeadlocks?: boolean;
  readonly restartable: true;
}): Promise<RestartablePostgres>;
export async function startPostgres(options?: {
  readonly checkDeadlocks?: boolean;
  readonly restartable?: false;
}): Promise<RunningPostgres>;
export async function startPostgres(
  options: { readonly checkDeadlocks?: boolean; readonly restartable?: boolean } = {},
): Promise<RunningPostgres | RestartablePostgres> {
  const hostPort = await freeHostPort();
  const image = new PostgreSqlContainer(postgresImage)
    .withExposedPorts({ container: 5432, host: hostPort })
    .withCommand(['postgres', ...serverOptions])
    .withLabels({ 'keelwerk-test': 'postgres' })
    .withTmpFs({ '/var/lib/postgresql': 'rw' });
  const container = await (options.restartable === true
    ? image.withEntrypoint(['sh', '-c', supervisorScript, 'supervisor'])
    : image
  )
    .start()
    .catch((cause: unknown) => {
      throw new Error(
        `Starting the PostgreSQL container with host port ${hostPort} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    });
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
    const checkDeadlocks = options.checkDeadlocks !== false;
    const deadlocksBefore = checkDeadlocks ? await deadlockCount(cluster) : 0;
    const declaredBefore = declaredDeadlocks.count;
    if (checkDeadlocks) declaredDeadlocks.checked += 1;
    const running: RunningPostgres = {
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
          const total = declaredDeadlocks.count;
          declaredDeadlocks.count = declaredBefore;
          if (total > 0 && declaredDeadlocks.checked > 1) {
            throw new Error(
              'The test file declared deadlocks and starts more than one container with the deadlock check, so a declaration cannot be charged to one container. Opt one container out with checkDeadlocks: false, or split the file.',
            );
          }
          assertDeadlocksDeclared(moved, total - declaredBefore);
        }
      },
    };
    return options.restartable === true ? { ...running, ...restartControls(cluster) } : running;
  } catch (error) {
    await container.stop();
    throw error;
  }
}
