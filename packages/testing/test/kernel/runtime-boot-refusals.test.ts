import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DataAdapter, DataAdapterFactory, LedgerSink, Logger } from '@keelwerk/core';
import {
  contracts,
  defineApp,
  defineModule,
  defineModuleBase,
  env,
  startRuntime,
} from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { describe, expect, test } from 'vitest';
import { schemaPlanner } from '../../src/harness/schema-planner.ts';
import { testSecrets } from '../../src/harness/test-secrets.ts';
import { boot, deploymentOf, phaseLogger, refusal } from './support/runtime-kit.ts';

describe('boot refusals', () => {
  test('a required deployment contract nobody provides is missingInfrastructure', async () => {
    const blobsUser = defineModule(
      defineModuleBase({ id: 'blob-user', version: '0.1.0', requires: [contracts.blobs] }),
      {},
    );
    const files = defineApp({ id: 'files', modules: [blobsUser] });
    const error = await refusal(boot(deploymentOf('memory', { apps: [files] })));
    expect(error.details).toMatchObject({ code: 'missingInfrastructure', ref: 'blobs' });
  });

  test('the tenant resolvers scopeKey and path wait for the scope directory: scopeDirectoryUnavailable', async () => {
    const error = await refusal(
      boot(deploymentOf('memory', { tenantResolution: [{ kind: 'scopeKey' }] })),
    );
    expect(error.details).toMatchObject({
      code: 'scopeDirectoryUnavailable',
      resolver: 'scopeKey',
    });
  });

  test('a data adapter nobody lists is refused before anything opens', async () => {
    const error = await refusal(boot(deploymentOf('memory', { control: { adapter: 'oracle' } })));
    expect(error.kind).toBe('validation');
  });

  test('an env() url naming a variable that is not set is a validation error naming it', async () => {
    const error = await refusal(
      boot(deploymentOf('memory', { control: { adapter: 'memory', url: env('KW_MISSING_URL') } })),
    );
    expect(error.kind).toBe('validation');
    expect(error.message).toContain('KW_MISSING_URL');
  });

  test("a placement that does not host the backend's app, and a host name that is no name, are validation errors", async () => {
    const runtime = await boot(
      deploymentOf('memory', {
        placements: {
          main: { adapter: 'memory', strategy: 'shared-tables' },
          other: { adapter: 'memory', strategy: 'shared-tables', apps: ['elsewhere'] },
        },
      }),
    );
    const hosted = await refusal(
      runtime.control.createBackend({ name: 'b', app: 'library', placement: 'other' }),
    );
    expect(hosted.kind).toBe('validation');
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'library',
      placement: 'main',
    });
    const host = await refusal(
      runtime.control.createTenant({ backendId: backend.id, name: 't', domains: ['not a host'] }),
    );
    expect(host.kind).toBe('validation');
  });

  test('an in-memory placement refuses a second process', async () => {
    let shared: DataAdapter | undefined;
    const inner = memoryAdapter();
    const once: DataAdapterFactory = {
      ...inner,
      create: (placement, env) => {
        if (shared === undefined) {
          const adapter = inner.create(placement, env);
          shared = { ...adapter, close: async () => undefined };
        }
        return shared;
      },
    };
    const deployment = deploymentOf('memory', {
      infrastructure: [once, schemaPlanner(), testSecrets],
    });
    await boot(deployment);
    const second = await refusal(boot(deployment));
    expect(second.kind).toBe('unavailable');
  });
});

/** A module package on disk with one migration file in the track `own`. */
async function driftModule(steps: string): Promise<ReturnType<typeof defineModule>> {
  const root = await mkdtemp(join(tmpdir(), 'kw-drift-'));
  await mkdir(join(root, 'migrations', 'own'), { recursive: true });
  await writeFile(
    join(root, 'migrations', 'own', '0001-initial.ts'),
    `export const migration = { id: '0001-initial', track: 'drift', steps: ${steps} };\n`,
  );
  return defineModule(defineModuleBase({ id: 'drift', version: '0.1.0' }), {
    migrations: pathToFileURL(join(root, 'migrations/')),
  });
}

/** Adapters that survive a runtime's `stop`, so a second boot meets the first one's history. */
function durable(): DataAdapterFactory {
  const inner = memoryAdapter();
  const kept = new Map<string, DataAdapter>();
  return {
    ...inner,
    create: (placement, env) => {
      const known = kept.get(placement.id);
      if (known !== undefined) return known;
      const adapter = inner.create(placement, env);
      const wrapped: DataAdapter = { ...adapter, close: async () => undefined };
      kept.set(placement.id, wrapped);
      return wrapped;
    },
  };
}

describe('migrate (section 3.3)', () => {
  test('development applies the pending files, production accepts the same history and refuses a drifted one', async () => {
    const factory = durable();
    const original = defineApp({ id: 'drifting', modules: [await driftModule('[]')] });
    const infrastructure = [factory, schemaPlanner(), testSecrets];
    const base = deploymentOf('memory', { apps: [original], infrastructure });
    const first = await startRuntime(base, {
      role: 'all',
      listen: false,
      environment: 'development',
    });
    await first.stop(1000);
    const again = await startRuntime(base, {
      role: 'all',
      listen: false,
      environment: 'production',
    });
    await again.stop(1000);
    const changed = defineApp({
      id: 'drifting',
      modules: [
        await driftModule(
          "[{ op: 'rebuild', entity: 'drift.thing', reason: 'changed after it was applied' }]",
        ),
      ],
    });
    const drifted = await refusal(
      startRuntime(deploymentOf('memory', { apps: [changed], infrastructure }), {
        role: 'all',
        listen: false,
        environment: 'production',
      }),
    );
    expect(drifted.message).toMatch(/migration drift/);
    expect(drifted.kind).toBe('conflict');
  });
});

describe('anchors (S-35)', () => {
  test('a scope behind its newest anchor is logged as rewound', async () => {
    const inner = memoryAdapter();
    let shared: DataAdapter | undefined;
    const once: DataAdapterFactory = {
      ...inner,
      create: (placement, env) => {
        if (shared === undefined) {
          const adapter = inner.create(placement, env);
          shared = { ...adapter, close: async () => undefined };
        }
        return shared;
      },
    };
    const sink: LedgerSink = {
      id: 'test.ledger',
      append: async () => undefined,
      read: async function* () {
        const history = await shared?.schema.history({
          id: 'ns-control',
          placementId: 'control',
          appId: 'core',
          tenantId: null,
          root: 'kw__control',
        });
        const deploymentId = history?.find((row) => row.track === 'keelwerk.deployment')?.id ?? '';
        yield {
          type: 'anchor',
          scopeId: deploymentId,
          position: '99999',
          hash: 'h',
          stream: { type: 'core.backend', id: 'x' },
          recordedAt: '2026-11-04T00:00:00Z',
          writer: { process: 'p', build: 'b' },
        } as const;
      },
    };
    const errors: string[] = [];
    const logger: Logger = {
      ...phaseLogger,
      error: (message) => {
        errors.push(message);
      },
      child: () => logger,
    };
    const runtime = await boot(
      deploymentOf('memory', {
        infrastructure: [once, schemaPlanner(), testSecrets, sink],
      }),
      { logger },
    );
    expect(runtime).toBeDefined();
    expect(errors.some((message) => message.includes('behind its newest anchor'))).toBe(true);
  });
});
