import type { DataAdapter, DataAdapterFactory } from '@keelwerk/core';
import {
  defineApp,
  defineEntity,
  defineHook,
  defineModule,
  defineModuleBase,
  defineQuery,
  defineRule,
  field,
  shape,
  startRuntime,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import {
  ada,
  boot,
  deploymentOf,
  factoryOf,
  golden,
  phaseLogger,
  recorded,
  refusal,
} from './support/runtime-kit.ts';

describe.each(['memory', 'pglite'] as const)(
  'the control store and the lifecycle on %s',
  (kind) => {
    test('an operator creates a backend and a tenant in process and the fixture command runs in the new tenant at once', {
      timeout: 60_000,
    }, async () => {
      const runtime = await boot(deploymentOf(kind));
      const backend = await runtime.control.createBackend({
        name: 'library',
        app: 'library',
        placement: 'main',
      });
      const tenant = await runtime.control.createTenant({
        backendId: backend.id,
        name: 'Acme NV',
        domains: ['Acme.example'],
      });
      const added = await runtime.invoker.invoke<unknown, { bookId: string }>({
        action: 'library.addBook',
        input: { title: 'Dune', isbn: '978-0441172719' },
        carrier: testCarrier({ name: 'acme', id: tenant.id }, ada),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        commandId: crypto.randomUUID(),
      });
      expect(added).toMatchObject({ ok: true });
      const byHost = await runtime.invoker.open({
        transport: 'test',
        host: 'acme.example:3000',
        headers: {},
      });
      expect(byHost).toMatchObject({
        ok: true,
        value: { scope: { level: 'tenant', backendId: backend.id, tenantId: tenant.id } },
      });
    });

    test('a host name another tenant holds fails the creating unit with conflict, and the first tenant keeps it', {
      timeout: 60_000,
    }, async () => {
      const runtime = await boot(deploymentOf(kind));
      const backend = await runtime.control.createBackend({
        name: 'library',
        app: 'library',
        placement: 'main',
      });
      const first = await runtime.control.createTenant({
        backendId: backend.id,
        name: 'first',
        domains: ['shared.example'],
      });
      const error = await refusal(
        runtime.control.createTenant({
          backendId: backend.id,
          name: 'second',
          domains: ['shared.example'],
        }),
      );
      expect(error.kind).toBe('conflict');
      const opened = await runtime.invoker.open({ transport: 'test', host: 'shared.example' });
      expect(opened).toMatchObject({ ok: true, value: { scope: { tenantId: first.id } } });
    });

    test('a backend name is unique, a placement and an app must exist', {
      timeout: 60_000,
    }, async () => {
      const runtime = await boot(deploymentOf(kind));
      await runtime.control.createBackend({ name: 'one', app: 'library', placement: 'main' });
      expect(
        (
          await refusal(
            runtime.control.createBackend({ name: 'one', app: 'library', placement: 'main' }),
          )
        ).kind,
      ).toBe('conflict');
      expect(
        (
          await refusal(
            runtime.control.createBackend({ name: 'two', app: 'nope', placement: 'main' }),
          )
        ).kind,
      ).toBe('validation');
      expect(
        (
          await refusal(
            runtime.control.createBackend({ name: 'two', app: 'library', placement: 'elsewhere' }),
          )
        ).kind,
      ).toBe('validation');
    });

    test('stop marks the process stopped and drains: the invocation in flight finishes, a new one is refused', {
      timeout: 60_000,
    }, async () => {
      const gate = Promise.withResolvers<void>();
      let hold = false;
      const inner = factoryOf(kind);
      const factory: DataAdapterFactory = {
        ...inner,
        create: (placement, env): DataAdapter => {
          const adapter = inner.create(placement, env);
          if (placement.id !== 'main') return adapter;
          return {
            ...adapter,
            unit: async (namespace, scope, fn, options) => {
              if (hold && scope.level === 'tenant') await gate.promise;
              return adapter.unit(namespace, scope, fn, options);
            },
          };
        },
      };
      const runtime = await startRuntime(deploymentOf(kind, { factory }), {
        role: 'all',
        listen: false,
        environment: 'test',
      });
      const backend = await runtime.control.createBackend({
        name: 'b',
        app: 'library',
        placement: 'main',
      });
      const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
      const call = (title: string) =>
        runtime.invoker.invoke({
          action: 'library.addBook',
          input: { title, isbn: title },
          carrier: testCarrier({ name: 't', id: tenant.id }, ada),
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
          commandId: crypto.randomUUID(),
        });
      hold = true;
      const inFlight = call('slow');
      await new Promise((resolve) => setTimeout(resolve, 20));
      const stopped = runtime.stop(5000);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const late = await call('late');
      expect(late).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
      gate.resolve();
      expect(await inFlight).toMatchObject({ ok: true });
      await stopped;
    });
  },
);

describe('the lifecycle order of section 3.3', () => {
  test('compose, setup, connect, migrate, start, listen, then stop', async () => {
    recorded.length = 0;
    const runtime = await startRuntime(deploymentOf('memory'), {
      role: 'all',
      listen: true,
      environment: 'test',
      logger: phaseLogger,
    });
    await runtime.stop(1000);
    expect(recorded).toEqual(golden('lifecycle-order'));
  });
});

describe('lifecycle hooks (S-27)', () => {
  const greeting = defineEntity({
    prefix: 'grt',
    fields: { note: field.string() },
  });
  const base = defineModuleBase({ id: 'welcome', version: '0.1.0', entities: { greeting } });
  const greetings = defineQuery(base, {
    scope: 'tenant',
    principal: 'user',
    output: shape({ notes: field.list(field.string()) }),
    *read(_input, ctx) {
      const rows = yield* ctx.load.welcome.greeting.many({});
      return { notes: rows.map((row) => row.note) };
    },
  });
  const welcome = defineModule(base, {
    actions: { greetings },
    policies: {
      greetings: {
        users: defineRule(base, greetings, { effect: 'allow', principal: 'user' }),
      },
    },
    lifecycle: {
      onCreated: defineHook(base, 'onTenantCreated', (tenant, ctx) => [
        ctx.write.welcome.greeting.create({ note: `welcome ${tenant.name}` }),
      ]),
    },
  });
  const welcomeApp = defineApp({ id: 'welcome-app', modules: [welcome] });

  test('onTenantCreated decides in a tenant unit of its own right after the creating unit commits', async () => {
    const runtime = await startTestRuntime(welcomeApp, { tenants: ['acme', 'globex'] });
    const client = createLocalClient(runtime, { principal: testPrincipal('ada') });
    expect(await client.invoke('welcome.greetings', {})).toEqual({ notes: ['welcome acme'] });
    expect(await client.as({ tenant: 'globex' }).invoke('welcome.greetings', {})).toEqual({
      notes: ['welcome globex'],
    });
    await runtime.stop();
  });
});
