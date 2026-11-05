import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EntityDescriptor, InfrastructureEntry, Runtime } from '@keelwerk/core';
import { secret, startRuntime } from '@keelwerk/core';
import { memoryAdapter, schemaPlanner } from '@keelwerk/data';
import type { TestApp } from '@keelwerk/testing';
import { fetchSocket } from '../../src/host/fetch-socket.ts';
import type { FakeHandler } from './fake-host.ts';

/** What the fixture serves: an app and the HTTP host entry (`httpHost()` of `@keelwerk/transport-http`). */
export interface FixtureOptions {
  readonly app: TestApp;
  readonly host: InfrastructureEntry;
}

export const operatorHost = 'ops.example.test';

/** A running fixture deployment: the library app on the in-memory adapter, its HTTP host in process and the operator socket on disk. */
export interface FixtureDeployment {
  readonly runtime: Runtime;
  readonly socket: string;
  /** Routes what the CLI sends: the socket to the real socket, a URL to the host's dispatch. */
  readonly handler: FakeHandler;
  stop(): Promise<void>;
}

/** Starts the fixture with no backend and no tenant; a test makes them while it runs. */
export async function startFixtureDeployment(options: FixtureOptions): Promise<FixtureDeployment> {
  const entities = new Map<string, EntityDescriptor>(
    [...options.app.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
  );
  const directory = await mkdtemp(join(tmpdir(), 'kw-cli-'));
  const socket = join(directory, 'op.sock');
  const runtime = await startRuntime(
    {
      apps: [options.app],
      infrastructure: [
        memoryAdapter({ entities: (ref) => entities.get(ref) }),
        schemaPlanner(),
        options.host,
      ],
      control: { adapter: 'memory' },
      placements: { main: { adapter: 'memory', strategy: 'shared-tables' } },
      operator: { socket, hosts: [operatorHost] },
      tenantResolution: [{ kind: 'hostname' }],
      keys: { masterKey: secret('KW_FIXTURE_KEY') },
    },
    {
      role: 'all',
      listen: true,
      environment: 'test',
      env: Object.fromEntries([['KW_FIXTURE_KEY', Buffer.alloc(32, 7).toString('base64')]]),
    },
  );
  const host = runtime.host;
  if (host === undefined) throw new Error('The fixture runtime has no HTTP host.');
  return {
    runtime,
    socket,
    handler: ({ url, socketPath, request }) =>
      socketPath !== undefined
        ? fetchSocket(socketPath, url, request)
        : host.fetch(
            new Request(url, {
              method: request.method,
              headers: request.headers,
              ...(request.body !== undefined && { body: request.body }),
            }),
          ),
    stop: async () => {
      await runtime.stop(1000);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
