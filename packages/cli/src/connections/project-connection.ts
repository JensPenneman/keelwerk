import type { Runtime } from '@keelwerk/core';
import { startRuntime } from '@keelwerk/core';
import { CliFailure } from '../context/cli-failure.ts';
import type { CliHost } from '../context/cli-host.ts';
import { projectRootOf } from '../context/project-root-of.ts';
import type { ResolvedProfile } from '../context/resolved-profile.ts';
import { usageFailure } from '../context/usage-failure.ts';
import { loadDefinition } from '../db/load-definition.ts';
import { inProcessLink } from './in-process-link.ts';
import type { OpenedConnection } from './opened-connection.ts';
import { socketConnection } from './socket-connection.ts';

/**
 * Where the dev app of the project listens: the path `keelwerk dev` recorded (a long project path
 * moves the socket to a short fallback), else `.keelwerk/dev.sock`.
 */
async function devSocketOf(host: CliHost, root: string): Promise<string> {
  const recorded = (await host.files.readText(`${root}/.keelwerk/dev-socket`))?.trim();
  return recorded !== undefined && recorded !== '' ? recorded : `${root}/.keelwerk/dev.sock`;
}

/** Whether a process listens on the socket: a stale file refuses the connection. */
async function answers(host: CliHost, socketPath: string): Promise<boolean> {
  try {
    await host.fetchSocket(socketPath, '/_keelwerk/v1/capabilities', {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The app `--backend` belongs to (section 16.9.2) and the backend's id; with one app and no tenant
 * marker to send, or no backend named, the first app. The id goes into the tenant marker's
 * `x-keelwerk-backend` header, which carries ids only (16.8.2).
 */
async function appIdOf(
  runtime: Runtime,
  apps: readonly { readonly id: string }[],
  firstId: string,
  backend: string | undefined,
  tenant: string | undefined,
): Promise<{ readonly app: string; readonly id?: string }> {
  if (backend === undefined || (apps.length === 1 && tenant === undefined)) {
    return { app: firstId };
  }
  const answer = await inProcessLink(runtime, firstId).invoke({
    action: 'core.backend.query',
    input: { filter: backend.startsWith('bknd_') ? { id: backend } : { name: backend }, first: 1 },
  });
  if (!answer.ok) throw new CliFailure(answer.error, answer.error.message);
  const rows = (
    answer.value as {
      readonly items?: readonly { readonly app?: unknown; readonly id?: unknown }[];
    }
  ).items;
  const app = rows?.[0]?.app;
  const id = rows?.[0]?.id;
  if (typeof app !== 'string') throw usageFailure(`No backend is named "${backend}".`);
  return typeof id === 'string' ? { app, id } : { app };
}

/**
 * The project connection (section 16.9.1): the dev socket `.keelwerk/dev.sock` while
 * `keelwerk dev` runs, otherwise an in-process runtime of the project's deployment, connected
 * without listening (`startRuntime` with `listen: false`) and answering as the operator. The
 * runtime has the `serve` role: a command of the CLI never takes jobs, which belong to the
 * processes that work (a worker here would lose its leases when the command ends, section 21.1).
 * The runtime stops when the connection closes.
 */
export async function projectConnection(
  host: CliHost,
  profile: ResolvedProfile,
): Promise<OpenedConnection> {
  const { configPath } = profile;
  if (configPath === undefined) throw usageFailure('The project has no deployment file.');
  const devSocket = await devSocketOf(host, projectRootOf(configPath));
  if ((await host.files.exists(devSocket)) && (await answers(host, devSocket))) {
    return socketConnection(host, {
      ...profile,
      kind: 'socket',
      url: `unix://${devSocket}`,
      socketPath: devSocket,
    });
  }
  // No socket, or a stale file left by a `keelwerk dev` that died: run the project in process.
  const definition = await loadDefinition(configPath);
  const [first] = definition.apps;
  if (first === undefined) throw usageFailure('The deployment serves no app.');
  const runtime = await startRuntime(definition, { role: 'serve', listen: false, env: host.env });
  try {
    const located = await appIdOf(
      runtime,
      definition.apps,
      first.id,
      profile.backend,
      profile.tenant,
    );
    return {
      link: inProcessLink(runtime, located.app, {
        ...(profile.tenant !== undefined && { tenant: profile.tenant }),
        ...(located.id !== undefined && { backend: located.id }),
      }),
      close: () => runtime.stop(1000),
    };
  } catch (failure) {
    await runtime.stop(1000);
    throw failure;
  }
}
