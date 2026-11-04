import type {
  AnswerContext,
  ComputePool,
  DataAdapter,
  EntityDescriptor,
  NamespaceRef,
  Registry,
  RequestAnswerer,
  StorageScope,
  Unit,
} from '@keelwerk/core';
import { normalizeRule } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import type { ProbeContext } from './support/run-read-kit.ts';
import {
  backend,
  book,
  bookRow,
  namespace,
  open,
  registry,
  runnable,
  withQuery,
} from './support/run-read-kit.ts';

describe('flags, computations and the seam', () => {
  test('a flag request answers the declared default and is recorded (S-23)', async () => {
    const withFlag: Registry = {
      ...registry,
      modules: registry.modules.map((module) =>
        module.id === 'library'
          ? {
              ...module,
              flags: {
                newShelves: { kind: 'boolean', level: 'tenant', default: false },
              },
            }
          : module,
      ),
    };
    const probe = withQuery(
      'flagged',
      function* (_input: unknown, ctx: ProbeContext) {
        const on = yield* ctx.flags.library.newShelves;
        const details = yield* ctx.flagDetails('library.newShelves');
        return { on, details };
      },
      withFlag,
    );
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    const result = await run();
    expect(result.output).toEqual({
      on: false,
      details: { value: false, variant: 'false', reason: 'DEFAULT', provider: 'default' },
    });
    expect(result.flags).toEqual([
      { key: 'library.newShelves', variant: 'false', reason: 'DEFAULT', ruleVersion: null },
    ]);
  });

  test('compute goes to the pool and a replaced answerer is used', async () => {
    const probe = withQuery('hash', function* (_input: unknown, ctx: ProbeContext) {
      return yield* ctx.compute.argon2idVerify('v', 'p');
    });
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    const compute: ComputePool = {
      argon2idHash: async () => 'h',
      argon2idVerify: async (verifier, password) => verifier === 'v' && password === 'p',
      close: async () => undefined,
    };
    expect((await run({ compute })).output).toBe(true);
    const replace: Partial<RequestAnswerer> = { compute: async () => 'replaced' };
    expect((await run({ compute, replace })).output).toBe('replaced');
  });
});

describe('reads across scopes (14.3.6)', () => {
  const backendBook: EntityDescriptor = { ...book, tenancy: 'backend' };
  const backendRegistry: Registry = {
    ...registry,
    entities: new Map(
      [...registry.entities].map(([ref, entry]) => [
        ref,
        ref === 'library.book' ? { ...entry, descriptor: backendBook } : entry,
      ]),
    ),
  };
  test('with concurrent units a tenant query reads backend entities in a unit of the backend, recorded as such', async () => {
    const probe = withQuery(
      'backendRead',
      function* (_input: unknown, ctx: ProbeContext) {
        return yield* ctx.load.library.book.count();
      },
      backendRegistry,
    );
    const adapter = open([backendBook]);
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    await adapter.unit(namespace, backend, (unit) =>
      unit.rows.insert(backendBook, [bookRow(1), bookRow(2)]),
    );
    const result = await run({ adapter, concurrentUnits: true });
    expect(result.output).toBe(2);
    expect(result.reads).toEqual([{ scope: 'backend', at: 0n }]);
  });

  test('without concurrent units it uses a read-only savepoint with the scope swapped', async () => {
    const probe = withQuery(
      'backendNested',
      function* (_input: unknown, ctx: ProbeContext) {
        return yield* ctx.load.library.book.count();
      },
      backendRegistry,
    );
    const adapter = open([backendBook]);
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    const swapped: unknown[] = [];
    const wrapped = {
      ...adapter,
      unit: (
        ns: NamespaceRef,
        scope: StorageScope,
        fn: (unit: Unit) => Promise<unknown>,
        options?: object,
      ) =>
        adapter.unit(
          ns,
          scope,
          (unit) =>
            fn({
              ...unit,
              nested: async (inner: (unit: Unit) => Promise<unknown>, nestedOptions?: object) => {
                swapped.push(nestedOptions);
                return inner({
                  ...unit,
                  rows: {
                    ...unit.rows,
                    find: async () => ({
                      rows: [],
                      pageInfo: {
                        hasNextPage: false,
                        hasPreviousPage: false,
                        startCursor: null,
                        endCursor: null,
                      },
                      total: 7,
                      position: 5n,
                    }),
                  },
                });
              },
            } as Unit),
          options,
        ),
    } as unknown as DataAdapter;
    const result = await run({ adapter: wrapped, concurrentUnits: false });
    expect(swapped).toEqual([{ as: backend, readOnly: true }]);
    expect(result.output).toBe(7);
    expect(result.reads).toEqual([{ scope: 'backend', at: 5n }]);
  });

  test('a tenant entity from a backend scope is refused', async () => {
    const probe = withQuery('tenantFromBackend', function* (_input: unknown, ctx: ProbeContext) {
      return yield* ctx.load.library.book.count();
    });
    const { run } = runnable({ registry: probe.registry, action: probe.ref, scope: backend });
    await expect(run()).rejects.toMatchObject({ code: 'core.request_not_allowed' });
  });
});

describe('ctx.ask across scopes (14.3.6)', () => {
  const backendBook: EntityDescriptor = { ...book, tenancy: 'backend' };
  const backendRegistry: Registry = {
    ...registry,
    entities: new Map(
      [...registry.entities].map(([ref, entry]) => [
        ref,
        ref === 'library.book' ? { ...entry, descriptor: backendBook } : entry,
      ]),
    ),
  };
  const withBackendQuery = (base: Registry) => {
    const inner = withQuery(
      'backendCount',
      function* (_input: unknown, ctx: ProbeContext) {
        return yield* ctx.load.library.book.count();
      },
      base,
    );
    const action = inner.registry.actions.get(inner.ref);
    if (action === undefined) throw new Error('the probe action is missing');
    const scoped: Registry = {
      ...inner.registry,
      actions: new Map([...inner.registry.actions, [inner.ref, { ...action, scope: 'backend' }]]),
    };
    return withQuery(
      'askBackend',
      function* (_input: unknown, ctx: ProbeContext) {
        return yield* ctx.ask(inner.ref, {});
      },
      scoped,
    );
  };

  const signedIn = registry.rules.get('library.findByIsbn.signedIn');
  if (signedIn === undefined) throw new Error('the library fixture has no signedIn rule');
  const rules = [
    normalizeRule({ ...signedIn, id: 'library.backendCount.signedIn', actions: ['backendCount'] }),
  ];

  test('the asked query reads in the backend unit it runs in, without opening another', async () => {
    const probe = withBackendQuery(backendRegistry);
    const adapter = open([backendBook]);
    await adapter.unit(namespace, backend, (unit) =>
      unit.rows.insert(backendBook, [bookRow(1), bookRow(2), bookRow(3)]),
    );
    let opened = 0;
    const counted = {
      ...adapter,
      unit: (
        ns: NamespaceRef,
        scope: StorageScope,
        fn: (unit: Unit) => Promise<unknown>,
        options?: object,
      ) => {
        opened += 1;
        return adapter.unit(ns, scope, fn, options);
      },
    } as unknown as DataAdapter;
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    const result = await run({ adapter: counted, concurrentUnits: true, rules });
    expect(result.output).toBe(3);
    expect(opened).toBe(2);
  });

  test('the asked backend query does not reach a tenant entity', async () => {
    const probe = withBackendQuery(registry);
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    await expect(run({ concurrentUnits: true, rules })).rejects.toMatchObject({
      code: 'core.request_not_allowed',
    });
  });
});

describe('answerer context', () => {
  test('the answer context carries the module and the form of the part', async () => {
    let seen: Pick<AnswerContext, 'module' | 'form'> | undefined;
    const probe = withQuery('context', function* (_input: unknown, ctx: ProbeContext) {
      return yield* ctx.compute.argon2idHash('p', new Uint8Array(1));
    });
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    await run({
      replace: {
        compute: async (_request, context) => {
          seen = { module: context.module, form: context.form };
          return 'x';
        },
      },
    });
    expect(seen).toEqual({ module: 'library', form: 'read' });
  });
});
