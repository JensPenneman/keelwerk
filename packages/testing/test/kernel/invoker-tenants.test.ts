import { describe, expect, test } from 'vitest';
import {
  ada,
  call,
  kit,
  otherTenant,
  otherTenantId,
  publicQuery,
  session,
} from './support/invoker-kit.ts';
import type { ProbeContext } from './support/run-read-kit.ts';
import { book, bookRow, namespace, tenant, uuid } from './support/run-read-kit.ts';

describe('a second tenant of the same backend', () => {
  const count = publicQuery('countBooks', function* (_input: unknown, ctx: ProbeContext) {
    return yield* ctx.load.library.book.count();
  });
  const asOther = {
    transport: 'test',
    headers: { 'x-tenant': otherTenantId, authorization: 'Bearer tok-ada' },
  } as const;

  test('sees none of the rows of the first tenant through the invoker', async () => {
    const { adapter, invoker } = kit({ registry: count.registry });
    await adapter.unit(namespace, tenant, (unit) =>
      unit.rows.insert(book, [bookRow(1), bookRow(2)]),
    );
    expect(await invoker.invoke(call(count.ref, {}, { carrier: ada }))).toEqual({
      ok: true,
      value: 2,
    });
    expect(await invoker.invoke(call(count.ref, {}, { carrier: asOther }))).toEqual({
      ok: true,
      value: 0,
    });
    const lookup = await invoker.invoke(
      call('library.findByIsbn', { isbn: 'isbn-1' }, { carrier: asOther }),
    );
    expect(lookup.ok && lookup.value).not.toMatchObject({ bookId: uuid(1) });
  });

  test('a session opened for it cannot reach the rows of the first tenant', async () => {
    const { adapter, invoker } = kit({ registry: count.registry });
    await adapter.unit(namespace, tenant, (unit) => unit.rows.insert(book, [bookRow(1)]));
    const other = await session(invoker, asOther);
    expect(other.scope).toEqual(otherTenant);
    const outcome = await invoker.invoke(
      call(count.ref, {}, { carrier: { transport: 'test' }, session: other }),
    );
    expect(outcome).toEqual({ ok: true, value: 0 });
    const own = await invoker.invoke(call(count.ref, {}, { carrier: ada }));
    expect(own).toEqual({ ok: true, value: 1 });
  });
});
