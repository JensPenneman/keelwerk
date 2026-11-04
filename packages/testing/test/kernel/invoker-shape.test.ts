import type { EntityDescriptor, FieldDescriptor, Registry, RuleEntry } from '@keelwerk/core';
import { field, shape } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { ada, base, call, failure, kit, publicQuery } from './support/invoker-kit.ts';
import type { ProbeContext } from './support/run-read-kit.ts';
import {
  book,
  bookRow,
  namespace,
  open,
  registry,
  silent,
  tenant,
  uuid,
} from './support/run-read-kit.ts';

describe('the shape stage', () => {
  const rowKeys = [
    'id',
    'createdAt',
    'updatedAt',
    'archivedAt',
    'version',
    ...Object.keys(book.fields),
  ];
  const rowSchema = shape(
    Object.fromEntries(rowKeys.map((key) => [key, field.string().optional()])),
  );
  const pageSchema = shape({
    items: field.list(field.json(rowSchema)),
    pageInfo: field.json(shape({})),
    queryState: field.string(),
  });
  const page = { sortable: [], defaultSort: [], defaultSize: 20, maxSize: 100 } as const;
  const own = (name: string): RuleEntry => {
    const readers = registry.rules.get('library.book.readers');
    if (readers === undefined) throw new Error('the library fixture has no readers rule');
    return {
      ...readers,
      id: name,
      where: (context: unknown) => ({
        addedBy: (context as { principal: { subject: string } }).principal.subject,
      }),
    };
  };
  const narrowed: Registry = {
    ...base,
    rules: new Map([...base.rules, ['library.book.readers', own('library.book.readers')]]),
  };
  const pageProbe = publicQuery(
    'pageProbe',
    function* (_input: unknown, ctx: ProbeContext) {
      const items = yield* ctx.load.library.book.many({});
      return { items, pageInfo: {}, queryState: '0' };
    },
    { output: pageSchema, page },
    narrowed,
  );
  const seeded = [bookRow(1), bookRow(2, { addedBy: 'bob' })];

  test('development and tests fail a row outside the caller read plan', async () => {
    const { adapter, invoker } = kit({ registry: pageProbe.registry });
    await adapter.unit(namespace, tenant, (unit) => unit.rows.insert(book, seeded));
    const error = failure(await invoker.invoke(call(pageProbe.ref, {}, { carrier: ada })));
    expect(error).toMatchObject({ kind: 'internal', code: 'core.row_outside_plan' });
  });

  test('production drops the row, keeps the page and logs it', async () => {
    const warned: unknown[] = [];
    const log = {
      ...silent,
      child: () => log,
      warn: (_m: string, fields?: unknown) => warned.push(fields),
    };
    const { adapter, invoker } = kit({
      registry: pageProbe.registry,
      environment: 'production',
      log,
    });
    await adapter.unit(namespace, tenant, (unit) => unit.rows.insert(book, seeded));
    const outcome = await invoker.invoke(call(pageProbe.ref, {}, { carrier: ada }));
    expect(
      outcome.ok && (outcome.value as { items: { id: string }[] }).items.map((r) => r.id),
    ).toEqual([uuid(1)]);
    expect(warned).toEqual([expect.objectContaining({ entity: 'library.book', rowId: uuid(2) })]);
  });

  test('maskable fields the plan does not reveal are left out with $masked', async () => {
    const maskedBook: EntityDescriptor = {
      ...book,
      fields: {
        ...book.fields,
        title: { ...(book.fields.title as FieldDescriptor), maskable: true },
      },
    };
    const revealing: RuleEntry = {
      ...own('library.book.readers'),
      where: () => ({}),
      fields: ['isbn'],
    };
    const masked: Registry = {
      ...base,
      rules: new Map([...base.rules, ['library.book.readers', revealing]]),
      entities: new Map(
        [...base.entities].map(([ref, entry]) => [
          ref,
          ref === 'library.book' ? { ...entry, descriptor: maskedBook } : entry,
        ]),
      ),
    };
    const rowProbe = publicQuery(
      'rowProbe',
      function* (_input: unknown, ctx: ProbeContext) {
        return yield* ctx.load.library.book.one({ where: { isbn: 'isbn-1' } });
      },
      { output: rowSchema },
      masked,
    );
    const { adapter, invoker } = kit({ registry: rowProbe.registry, adapter: open([maskedBook]) });
    await adapter.unit(namespace, tenant, (unit) => unit.rows.insert(maskedBook, [bookRow(1)]));
    const outcome = await invoker.invoke(call(rowProbe.ref, {}, { carrier: ada }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const row = outcome.value as Record<string, unknown>;
    expect(row.isbn).toBe('isbn-1');
    expect(row).not.toHaveProperty('title');
    expect(row.$masked).toEqual(['title']);
  });

  test('a custom output is validated against its schema in development only', async () => {
    const wrong = publicQuery('wrongOutput', () => ({ bookId: 5 }), {});
    const dev = kit({ registry: wrong.registry, environment: 'development' });
    expect(failure(await dev.invoker.invoke(call(wrong.ref, {}, { carrier: ada })))).toMatchObject({
      kind: 'internal',
    });
    const prod = kit({ registry: wrong.registry, environment: 'production' });
    expect((await prod.invoker.invoke(call(wrong.ref, {}, { carrier: ada }))).ok).toBe(true);
  });
});
