import { runGeneratedRead } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { deriveOnlyKeys } from './support/derive-only-keys.ts';
import { caller, tenantOf, value } from './support/generated-kit.ts';
import { namespace, open, registry, tenant, userOf } from './support/run-read-kit.ts';

type Row = { id: string; version: number; title: string; isbn: string; archivedAt?: unknown };
type Page = {
  items: Row[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  queryState: string;
  total?: number;
};

describe.each(['memory', 'pglite'] as const)('the generated actions on %s', (kind) => {
  test('a client-supplied id on a create is refused', { timeout: 90_000 }, async () => {
    const { runtime, tenant } = await tenantOf(kind);
    const call = caller(runtime, tenant);
    const refused = await call('library.book.create', {
      id: '018f0000-0000-7000-8000-000000000000',
      title: 'Dune',
      isbn: '1',
      addedBy: 'ada',
    });
    expect(refused).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  test('create, get, update, archive, restore and query', { timeout: 90_000 }, async () => {
    const { runtime, tenant } = await tenantOf(kind);
    const call = caller(runtime, tenant);
    const created = await value<Row>(
      call('library.book.create', { title: 'Dune', isbn: '1', addedBy: 'ada' }),
    );
    expect(created).toMatchObject({ title: 'Dune', version: 1 });

    const got = await value<{ list: Row[]; notFound: string[]; state: string }>(
      call('library.book.get', { ids: [created.id, 'missing'] }),
    );
    expect(got.list.map((row) => row.id)).toEqual([created.id]);
    expect(got.notFound).toEqual(['missing']);
    expect(got.state).toMatch(/^v2\.0\.\d+\.[0-9a-f]{8}\.[0-9a-f]{32}$/);

    const updated = await value<Row>(
      call('library.book.update', {
        id: created.id,
        patch: { title: 'Dune Messiah' },
        ifVersion: 1,
      }),
    );
    expect(updated).toMatchObject({ title: 'Dune Messiah', version: 2 });
    const stale = await call('library.book.update', {
      id: created.id,
      patch: { title: 'x' },
      ifVersion: 1,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: 'core.version_mismatch' } });

    expect(await call('library.book.restore', { id: created.id })).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
    await value(call('library.book.archive', { id: created.id }));
    const hidden = await value<Page>(call('library.book.query', {}));
    expect(hidden.items).toEqual([]);
    const withArchived = await value<Page>(
      call('library.book.query', { includeArchived: true, total: true }),
    );
    expect(withArchived.items).toHaveLength(1);
    expect(withArchived.total).toBe(1);
    await value(call('library.book.restore', { id: created.id }));
    expect((await value<Page>(call('library.book.query', {}))).items).toHaveLength(1);
  });

  test('query pages by cursor, binds cursors to the sort and refuses a page over the maximum', {
    timeout: 90_000,
  }, async () => {
    const { runtime, tenant } = await tenantOf(kind);
    const call = caller(runtime, tenant);
    for (const n of [1, 2, 3]) {
      await value(call('library.book.create', { title: `T${n}`, isbn: `i${n}`, addedBy: 'ada' }));
    }
    const first = await value<Page>(call('library.book.query', { first: 2, sort: ['isbn'] }));
    expect(first.items.map((row) => row.isbn)).toEqual(['i1', 'i2']);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const next = await value<Page>(
      call('library.book.query', {
        first: 2,
        after: first.pageInfo.endCursor,
        sort: ['isbn'],
      }),
    );
    expect(next.items.map((row) => row.isbn)).toEqual(['i3']);
    const other = await call('library.book.query', {
      first: 2,
      after: first.pageInfo.endCursor,
      sort: ['-isbn'],
    });
    expect(other).toMatchObject({ ok: false, error: { code: 'core.cursor_mismatch' } });
    const over = await call('library.book.query', { first: 501 });
    expect(over).toMatchObject({ ok: false, error: { kind: 'validation' } });
    const unsortable = await call('library.book.query', { sort: ['title'] });
    expect(unsortable).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  test('changes since the state of a get, queryChanges since a queryState', {
    timeout: 90_000,
  }, async () => {
    const { runtime, tenant } = await tenantOf(kind);
    const call = caller(runtime, tenant);
    const a = await value<Row>(
      call('library.book.create', { title: 'A', isbn: 'a', addedBy: 'ada' }),
    );
    const state = (await value<{ state: string }>(call('library.book.get', { ids: [a.id] }))).state;
    const page = await value<Page>(call('library.book.query', {}));
    const b = await value<Row>(
      call('library.book.create', { title: 'B', isbn: 'b', addedBy: 'ada' }),
    );
    await value(call('library.book.update', { id: a.id, patch: { title: 'A2' } }));
    const changes = await value<{
      created: string[];
      changed: string[];
      archived: string[];
      newState: string;
    }>(call('library.book.changes', { since: state }));
    expect(changes.created).toEqual([b.id]);
    expect(changes.changed).toEqual([a.id]);
    expect(changes.archived).toEqual([]);
    const again = await value<{ created: string[]; changed: string[] }>(
      call('library.book.changes', { since: changes.newState }),
    );
    expect(again.created.concat(again.changed)).toEqual([]);

    const qc = await value<{ added: { id: string; index: number }[]; removed: string[] }>(
      call('library.book.queryChanges', { sinceQueryState: page.queryState }),
    );
    expect(qc.added.map((item) => item.id).sort()).toEqual([a.id, b.id].sort());
    expect(qc.removed).toEqual([a.id]);
    const wrongSort = await value<{ cannotCalculateChanges?: boolean }>(
      call('library.book.queryChanges', {
        sinceQueryState: page.queryState,
        sort: ['-createdAt'],
      }),
    );
    expect(wrongSort.cannotCalculateChanges).toBe(true);
  });

  test('a token of another scope is core.token_scope_mismatch; another principal resets', {
    timeout: 90_000,
  }, async () => {
    const { runtime, tenant, backend } = await tenantOf(kind);
    const other = await runtime.control.createTenant({ backendId: backend.id, name: 'other' });
    const mine = caller(runtime, tenant);
    const theirs = caller(runtime, other);
    const mine1 = await value<Row>(
      mine('library.book.create', { title: 'A', isbn: 'a', addedBy: 'ada' }),
    );
    const { state } = await value<{ state: string }>(mine('library.book.get', { ids: [] }));
    expect(await theirs('library.book.changes', { since: state })).toMatchObject({
      ok: false,
      error: { code: 'core.token_scope_mismatch' },
    });
    expect(
      await value<{ list: Row[]; notFound: string[] }>(
        theirs('library.book.get', { ids: [mine1.id] }),
      ),
    ).toMatchObject({ list: [], notFound: [mine1.id] });
    expect((await value<Page>(theirs('library.book.query', {}))).items).toEqual([]);
    const bob = caller(runtime, tenant, testPrincipal('bob'));
    const reset = await value<{ cannotCalculateChanges?: boolean; reason?: string }>(
      bob('library.book.changes', { since: state }),
    );
    expect(reset).toMatchObject({ cannotCalculateChanges: true, reason: 'check' });
    expect(await mine('library.book.changes', { since: 'nonsense' })).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
  });

  test('get as of an instant and history', { timeout: 90_000 }, async () => {
    const { runtime, tenant } = await tenantOf(kind);
    const call = caller(runtime, tenant);
    const a = await value<Row>(
      call('library.book.create', { title: 'First', isbn: 'a', addedBy: 'ada' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const between = Temporal.Now.instant().toString();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await value(call('library.book.update', { id: a.id, patch: { title: 'Second' } }));
    const then = await value<{ list: Row[]; state?: string }>(
      call('library.book.get', { ids: [a.id], asOf: between }),
    );
    expect(then.list[0]?.title).toBe('First');
    expect(then.state).toBeUndefined();
    const history = await value<{ entries: { version: number; event: string }[] }>(
      call('library.book.history', { id: a.id }),
    );
    expect(history.entries.map((v) => [v.version, v.event])).toEqual([
      [1, 'created'],
      [2, 'changed'],
    ]);
  });

  test('set creates, updates and archives with per-item results, and ifInState refuses a stale collection', {
    timeout: 90_000,
  }, async () => {
    const { runtime, tenant } = await tenantOf(kind);
    const call = caller(runtime, tenant);
    const a = await value<Row>(
      call('library.book.create', { title: 'A', isbn: 'a', addedBy: 'ada' }),
    );
    const b = await value<Row>(
      call('library.book.create', { title: 'B', isbn: 'b', addedBy: 'ada' }),
    );
    const { state } = await value<{ state: string }>(call('library.book.get', { ids: [] }));
    const result = await value<{
      oldState: string;
      newState: string;
      created: string[];
      updated: string[];
      archived: string[];
      restored: string[];
      failed: { operation: string; id?: string; code: string }[];
    }>(
      call('library.book.set', {
        ifInState: state,
        create: [
          { title: 'C', isbn: 'c', addedBy: 'ada' },
          { title: 'bad', isbn: 'x', addedBy: 'ada', bogus: 1 },
        ],
        update: [
          { id: a.id, patch: { title: 'A2' }, ifVersion: 1 },
          { id: b.id, patch: { title: 'B2' }, ifVersion: 9 },
          { id: b.id, patch: { archivedAt: null } },
        ],
        archive: [{ id: 'nope' }],
        restore: [{ id: a.id }],
      }),
    );
    expect(result.created).toHaveLength(1);
    expect(result.updated).toEqual([a.id]);
    expect(result.oldState).toBe(state);
    expect(result.newState).toMatch(/^v2\./);
    const codes = result.failed.map((item) => [item.operation, item.id, item.code]);
    expect(codes).toEqual(
      expect.arrayContaining([
        ['create', undefined, 'core.validation'],
        ['update', b.id, 'core.version_mismatch'],
        ['archive', 'nope', 'core.not_found'],
        ['restore', a.id, 'core.validation'],
      ]),
    );
    const titles = await value<{ list: Row[] }>(call('library.book.get', { ids: [a.id, b.id] }));
    expect(titles.list.map((row) => row.title).sort()).toEqual(['A2', 'B']);
    const fresh = await value<{ state: string }>(call('library.book.get', { ids: [] }));
    expect(fresh.state).toBe(result.newState);
    const stale = await call('library.book.set', {
      ifInState: state,
      create: [{ title: 'D', isbn: 'd', addedBy: 'ada' }],
    });
    expect(stale).toMatchObject({ ok: false, error: { code: 'core.state_mismatch' } });
  });

  test('an anonymous caller reads and writes nothing', { timeout: 90_000 }, async () => {
    const { runtime, tenant } = await tenantOf(kind);
    const nobody = caller(runtime, tenant, testPrincipal(null));
    expect(await nobody('library.book.query', {})).toMatchObject({
      ok: false,
      error: { kind: 'unauthenticated' },
    });
    expect(
      await nobody('library.book.create', { title: 'x', isbn: 'x', addedBy: 'x' }),
    ).toMatchObject({ ok: false });
  });
});

describe('the scope epoch', () => {
  test('a token of another epoch resets', { timeout: 90_000 }, async () => {
    const adapter = open();
    const read = (epoch: number, action: string, input: unknown) =>
      runGeneratedRead({
        registry,
        adapter,
        namespace,
        scope: tenant,
        keys: deriveOnlyKeys,
        action: registry.actions.get(action) ?? (undefined as never),
        input,
        principal: userOf('ada'),
        epoch,
      }) as Promise<Record<string, unknown>>;
    const { state } = await read(0, 'library.book.get', { ids: [] });
    expect(state).toMatch(/^v2\.0\./);
    expect(await read(1, 'library.book.changes', { since: state })).toMatchObject({
      cannotCalculateChanges: true,
      reason: 'epoch',
    });
    expect(await read(0, 'library.book.changes', { since: state })).toMatchObject({
      hasMoreChanges: false,
    });
  });
});
