import type { AppType, DataAdapter, EgressPolicy, SubjectId, Unit } from '@keelwerk/core';
import { defineApp } from '@keelwerk/core';
import { hooks } from '../../../src/fixtures/index.ts';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import { probes } from './probes-module.ts';

const hooksAppDef = defineApp({ id: 'hooks', modules: [hooks, probes] });

/** The signing key every hooks backend of these tests is configured with. */
const signingKey = 'hook-signing-key';

/** Loopback is allowed, so the executors can post to the fixture's local endpoint. */
const loopback: EgressPolicy = { allow: ['127.0.0.0/8'] };

/** The `hooks` app: the sketch's hooks module and the test module `probes` for the failure cases. */
export interface HooksApp extends AppType<typeof hooksAppDef> {}
export const hooksApp: HooksApp = hooksAppDef;

/**
 * Boots the hooks app with workers on the `hooks`, `probes` and `commands` queues and one tenant
 * (`acme`), configured to post to `endpoint`. Returns the runtime, a client signed in as `ada`
 * and `raw`, which runs a function over a raw unit of the tenant (below the sealing layer).
 */
export async function bootHooks(
  options: {
    readonly adapter: 'memory' | 'pglite' | DataAdapter;
    readonly endpoint: string;
    readonly capabilities?: readonly string[];
    /** Starts no workers: this runtime only requests. */
    readonly serveOnly?: boolean;
  } & Pick<TestRuntimeOptions<'acme'>, 'external' | 'join' | 'clock' | 'logger'>,
) {
  const { adapter, endpoint, capabilities, serveOnly, ...rest } = options;
  const runtime = await startTestRuntime(hooksApp, {
    tenants: ['acme'],
    adapter,
    config: { hooks: { endpoint, signingKey } },
    ...(serveOnly === true
      ? {}
      : {
          workers: {
            queues: ['hooks', 'probes', 'commands'],
            egress: loopback,
            ...(capabilities === undefined ? {} : { capabilities }),
          },
        }),
    ...rest,
  });
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  return {
    runtime,
    client: createLocalClient(runtime, { principal: testPrincipal('ada') }),
    scope,
    /** Runs `fn` over a raw unit of the tenant: below the sealing layer. */
    raw: <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
      runtime.adapter.unit(runtime.namespace, scope, fn),
  };
}

/** The input of `probes.run` for `mode`, with a personal note and a lane group of its own unless `over` says otherwise. */
export function probeInput(
  owner: SubjectId,
  mode: string,
  over: { readonly url?: string; readonly group?: string; readonly note?: string } = {},
) {
  return {
    owner,
    mode,
    url: over.url ?? 'http://127.0.0.1:1/',
    group: over.group ?? 'a',
    note: over.note ?? 'ada@example.org',
  };
}

export type BootedHooks = Awaited<ReturnType<typeof bootHooks>>;
