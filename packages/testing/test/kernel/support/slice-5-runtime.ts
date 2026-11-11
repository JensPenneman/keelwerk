import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { Runtime } from '@keelwerk/core';
import { defineApp, secret, startRuntime } from '@keelwerk/core';
import { fallbackReporter, schemaPlanner } from '@keelwerk/data';
import { live } from '@keelwerk/live';
import { httpHost } from '@keelwerk/transport-http';
import type { EventStreamReader } from '../../../src/conformance/transport/event-stream-reader.ts';
import { readEventStream } from '../../../src/conformance/transport/read-event-stream.ts';
import { library, loans, passes } from '../../../src/fixtures/index.ts';
import { testMasterKeyName } from '../../../src/harness/test-master-key-name.ts';
import { testSecrets } from '../../../src/harness/test-secrets.ts';
import { withTestResolver } from '../../../src/harness/with-test-resolver.ts';
import type { TestDatabase } from '../../support/test-database.ts';

const placement = 'main';

/** The app of slice 5: the live module, the loan fixtures and the passes that authenticate a stream. */
const slice5App = defineApp({ id: 'slice5', modules: [live, library, loans, passes] });

/** One process of the slice: a runtime with its HTTP host over a database shared with the other processes. */
export interface Slice5Runtime {
  readonly runtime: Runtime;
  readonly backendId: string;
  readonly tenantId: string;
  /** Sends a request through the host's dispatch, as the tenant. */
  fetch(request: Request): Promise<Response>;
  /** Runs an action as a user of the test principal header; answers the wire value. */
  call<T = unknown>(action: string, input: unknown, subject: string): Promise<T>;
  /** Opens the live subscription of the loans with a pass as the bearer token. */
  follow(token: string, lastEventId?: string): Promise<EventStreamReader>;
  stop(deadlineMs?: number): Promise<void>;
}

/**
 * Starts one process of slice 5 over PostgreSQL: `startRuntime` with the HTTP host, the `slice5` app
 * and the test principal resolver. The first process creates the backend and the tenant `acme`; a
 * process with `join` attaches to what another created. `notify: false` runs the adapter without
 * `LISTEN`/`NOTIFY`, so the hub polls.
 */
export async function startSlice5Runtime(options: {
  readonly urls: TestDatabase;
  readonly notify: boolean;
  readonly join?: { readonly backendId: string; readonly tenantId: string };
}): Promise<Slice5Runtime> {
  const factory = postgresAdapter({
    ownerUrl: options.urls.adminUrl,
    accelerations: { notify: options.notify },
  });
  const runtime = await startRuntime(
    {
      apps: [withTestResolver(slice5App)],
      infrastructure: [factory, schemaPlanner(), fallbackReporter(), testSecrets, httpHost()],
      control: { adapter: factory.id, url: options.urls.appUrl },
      placements: {
        [placement]: { adapter: factory.id, strategy: 'shared-tables', url: options.urls.appUrl },
      },
      tenantResolution: [{ kind: 'header', header: 'x-tenant' }],
      keys: { masterKey: secret(testMasterKeyName) },
    },
    { role: 'serve', listen: true, environment: 'test' },
  );
  const host = runtime.host;
  if (host === undefined) throw new Error('the runtime has no HTTP host');
  let backendId: string;
  let tenantId: string;
  if (options.join === undefined) {
    const backend = await runtime.control.createBackend({
      // One database serves several tests: each of them creates its own backend.
      name: `slice5-${crypto.randomUUID().slice(0, 8)}`,
      app: slice5App.id,
      placement,
    });
    backendId = backend.id;
    tenantId = (await runtime.control.createTenant({ backendId, name: 'acme' })).id;
  } else {
    ({ backendId, tenantId } = options.join);
  }
  const fetch = (request: Request): Promise<Response> => host.fetch(request);
  const url = 'https://slice5.example.test';
  return {
    runtime,
    backendId,
    tenantId,
    fetch,
    call: async <T>(action: string, input: unknown, subject: string): Promise<T> => {
      const response = await fetch(
        new Request(`${url}/_keelwerk/v1/invoke`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-tenant': tenantId,
            'x-test-principal': JSON.stringify({ subject, roles: [], claims: {} }),
          },
          body: JSON.stringify({ action, input }),
        }),
      );
      const body = (await response.json()) as {
        ok: boolean;
        value?: T;
        error?: { code: string };
      };
      if (!body.ok) throw new Error(`${action} failed: ${body.error?.code ?? response.status}`);
      return body.value as T;
    },
    follow: async (token, lastEventId) =>
      readEventStream(
        await fetch(
          new Request(`${url}/_keelwerk/v1/subscribe?action=loans.loanEvents&input=%7B%7D`, {
            headers: {
              'x-tenant': tenantId,
              authorization: `Bearer ${token}`,
              ...(lastEventId === undefined ? {} : { 'last-event-id': lastEventId }),
            },
          }),
        ),
      ),
    stop: (deadlineMs = 2000) => runtime.stop(deadlineMs),
  };
}
