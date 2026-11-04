import type { EntityDescriptor, KeyService, NamespaceRef } from '@keelwerk/core';
import {
  coreApiVersions,
  createCommandRunner,
  createInvoker,
  entityBehavioursOf,
  errors,
  KeelwerkError,
  staticScopeDirectory,
} from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import type { TestApp } from './test-app.ts';
import { testEnvironment } from './test-environment.ts';
import { testPrincipalResolver } from './test-principal-resolver.ts';
import type { TestRuntime } from './test-runtime.ts';
import type { TestRuntimeOptions } from './test-runtime-options.ts';
import type { TestTenant } from './test-tenant.ts';

const backendId = '00000000-0000-4000-8000-0000000000b1';
const placementId = 'main';

function tenantId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

/** Keys are not part of the in-memory slice: every call says so instead of answering. */
const noKeys: KeyService = {
  issue: () => Promise.reject(errors.unsupported('The test runtime has no key service.')),
  verify: () => Promise.reject(errors.unsupported('The test runtime has no key service.')),
  reveal: () => Promise.reject(errors.unsupported('The test runtime has no key service.')),
  derive: () => Promise.reject(errors.unsupported('The test runtime has no key service.')),
  invalidate: () => undefined,
};

/**
 * Starts the app in process on the in-memory adapter: the full invocation pipeline and the command
 * write path, a static scope directory (until the control store, WP-43) holding one backend and
 * the named tenants. Callers reach it through `createLocalClient`.
 */
export async function startTestRuntime<
  const App extends TestApp,
  const Name extends string = 'acme' | 'globex',
>(app: App, options: TestRuntimeOptions<Name> = {}): Promise<TestRuntime<App, Name>> {
  const problems = app.registry.problems.filter((problem) => problem.severity === 'error');
  if (problems.length > 0) {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message: `The app does not compose: ${problems.map((problem) => problem.message).join('; ')}`,
    });
  }
  const names: readonly string[] = options.tenants ?? ['acme', 'globex'];
  const clock = options.clock ?? { now: () => Temporal.Now.instant() };
  const descriptors = new Map<string, EntityDescriptor>(
    [...app.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
  );
  const stop = new AbortController();
  const adapter =
    options.adapter ??
    memoryAdapter({ clock, entities: (ref) => descriptors.get(ref) }).create(
      { id: placementId, strategy: 'shared-tables' },
      testEnvironment(stop.signal),
    );
  const capabilities = await adapter.connect();
  const namespaceOf = (tenant: string | null): NamespaceRef => ({
    id: tenant === null ? 'ns-backend' : `ns-${tenant}`,
    placementId,
    appId: app.id,
    tenantId: tenant,
    root: app.id,
  });
  const tenants = names.map((name, index): TestTenant => ({ name, id: tenantId(index) }));
  const head = app.api?.dates.at(-1) ?? coreApiVersions.dates.at(-1) ?? '';
  const served = {
    ...app.registry,
    fills: new Map([
      ...app.registry.fills,
      [
        'core.principalResolvers',
        [
          ...(app.registry.fills.get('core.principalResolvers') ?? []),
          {
            point: 'core.principalResolvers',
            module: 'core',
            bound: false,
            fill: testPrincipalResolver(),
          },
        ],
      ],
    ]),
  };
  const behaviours = entityBehavioursOf(app.modules);
  const invoker = createInvoker({
    apps: new Map([
      [app.id, { registry: served, head }],
      ['core', { registry: served, head }],
    ]),
    directory: staticScopeDirectory({
      backends: [
        { id: backendId, app: app.id, placementId, namespace: namespaceOf(null), status: 'active' },
      ],
      tenants: tenants.map((tenant) => ({
        id: tenant.id,
        backendId,
        placementId,
        namespace: namespaceOf(tenant.id),
        status: 'active',
      })),
    }),
    placement: () => ({ adapter, capabilities }),
    tenantResolution: [{ kind: 'header', header: 'x-tenant' }],
    clock,
    keys: noKeys,
    compute: {
      argon2idHash: () =>
        Promise.reject(errors.unsupported('The test runtime has no compute pool.')),
      argon2idVerify: () =>
        Promise.reject(errors.unsupported('The test runtime has no compute pool.')),
      close: async () => undefined,
    },
    log: testEnvironment(stop.signal).log,
    environment: 'test',
    commands: createCommandRunner({
      behaviours: () => behaviours,
      retry: { sleep: async () => undefined },
    }),
  });
  return {
    app,
    adapter,
    tenants: Object.fromEntries(tenants.map((tenant) => [tenant.name, tenant])) as Record<
      Name,
      TestTenant
    >,
    invoker,
    head,
    stop: async () => {
      stop.abort();
      await adapter.close(0);
    },
  };
}
