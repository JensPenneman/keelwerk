import type {
  EntityDescriptor,
  FieldDescriptor,
  Registry,
  Scope,
  StorageRow,
} from '@keelwerk/core';
import { normalizeRule } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import type { ProbeContext } from './support/run-read-kit.ts';
import {
  book,
  bookRow,
  registry,
  runnable,
  tenant,
  uuid,
  withQuery,
} from './support/run-read-kit.ts';

const tenantBackend = tenant.level === 'tenant' ? tenant.backendId : '';

describe('two tenants', () => {
  const other: Scope = {
    level: 'tenant',
    backendId: tenantBackend,
    tenantId: '00000000-0000-4000-8000-0000000000a2',
  };
  const reading = withQuery('everything', function* (_input: unknown, ctx: ProbeContext) {
    const loads = ctx.load.library.book;
    return {
      many: yield* loads.many({}),
      count: yield* loads.count(),
      byId: yield* loads.byId(uuid(1)),
      query: yield* loads.query({}),
    };
  });

  test('rows seeded in tenant A are invisible to a read in tenant B', async () => {
    const { seed, run } = runnable({ registry: reading.registry, action: reading.ref });
    await seed([bookRow(1), bookRow(2)]);
    const own = (await run()).output as { count: number };
    expect(own.count).toBe(2);
    const result = (await run({ scope: other })).output as {
      many: readonly unknown[];
      count: number;
      byId: unknown;
      query: { items: readonly unknown[] };
    };
    expect(result.many).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.byId).toBeUndefined();
    expect(result.query.items).toEqual([]);
  });
});

describe('ctx.target', () => {
  const maskedBook: EntityDescriptor = {
    ...book,
    fields: {
      ...book.fields,
      title: { ...(book.fields.title as FieldDescriptor), maskable: true },
    },
  };
  const masked: Registry = {
    ...registry,
    entities: new Map(
      [...registry.entities].map(([ref, entry]) => [
        ref,
        ref === 'library.book' ? { ...entry, descriptor: maskedBook } : entry,
      ]),
    ),
  };
  const readers = registry.rules.get('library.book.readers');
  if (readers === undefined) throw new Error('the library fixture has no readers rule');
  const targetRule = normalizeRule({
    ...readers,
    id: 'library.book.targetOwn',
    actions: ['targetRead'],
    fields: ['isbn'],
    where: (context: unknown) => ({
      addedBy: (context as { principal: { subject: string } }).principal.subject,
    }),
  });

  test('is narrowed and masked by the invoked action plan, which the entity query plan is not', async () => {
    const base = withQuery(
      'targetRead',
      function* (_input: unknown, ctx: ProbeContext) {
        return {
          target: yield* (ctx.target as NonNullable<ProbeContext['target']>).many({}),
          generated: yield* ctx.load.library.book.forCaller().many({}),
        };
      },
      masked,
    );
    const action = base.registry.actions.get(base.ref);
    if (action === undefined) throw new Error('the probe action is missing');
    const mounted: Registry = {
      ...base.registry,
      actions: new Map([
        ...base.registry.actions,
        [base.ref, { ...action, entity: 'library.book' }],
      ]),
    };
    const { seed, run } = runnable({ registry: mounted, action: base.ref });
    await seed([bookRow(1), bookRow(2, { addedBy: 'bob' })]);
    const result = (await run({ rules: [targetRule] })).output as {
      target: readonly StorageRow[];
      generated: readonly StorageRow[];
    };
    expect(result.target).toHaveLength(1);
    expect(result.target[0]).toMatchObject({ id: uuid(1), isbn: 'isbn-1', $masked: ['title'] });
    expect(result.target[0]).not.toHaveProperty('title');
    expect(result.generated).toEqual(result.target);
  });

  test('an unmounted action plans forCaller as the entity query, which no rule here allows', async () => {
    const plain = withQuery(
      'plainRead',
      function* (_input: unknown, ctx: ProbeContext) {
        return yield* ctx.load.library.book.forCaller().many({});
      },
      masked,
    );
    const { seed, run } = runnable({ registry: plain.registry, action: plain.ref });
    await seed([bookRow(1)]);
    expect((await run({ rules: [targetRule] })).output).toEqual([]);
  });

  test('does not exist in a module the action is not mounted in', async () => {
    const probe = withQuery('noTarget', (_input: unknown, ctx: ProbeContext) => typeof ctx.target);
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    expect((await run()).output).toBe('undefined');
  });
});
