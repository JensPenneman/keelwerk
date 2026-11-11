import type {
  DataAdapter,
  InvocationSession,
  NamespaceRef,
  StorageScope,
  StoredJobSpec,
  Unit,
  UnitOptions,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  ada,
  byHeaderCarrier,
  call,
  failure,
  head,
  kit,
  publicQuery,
  session,
} from './support/invoker-kit.ts';
import { book, bookRow, namespace, open, tenant, uuid } from './support/run-read-kit.ts';

describe('the fixture query through the invoker', () => {
  test('scope by header, a test resolver, the gate, the shape stage and the envelope', async () => {
    const { adapter, invoker } = kit();
    await adapter.unit(namespace, tenant, (unit) =>
      unit.rows.insert(book, [bookRow(1), bookRow(2)]),
    );
    const outcome = await invoker.invoke(
      call('library.findByIsbn', { isbn: 'isbn-2' }, { carrier: ada }),
    );
    expect(outcome).toEqual({ ok: true, value: { bookId: uuid(2), title: 'Book 2' } });
  });

  test('scope by host name and the session it opens', async () => {
    const { invoker } = kit();
    const opened = await session(invoker, {
      transport: 'test',
      host: 'LIB.example:8443',
      headers: { authorization: 'Bearer tok-ada' },
    });
    expect(opened.scope).toEqual(tenant);
    expect(opened.app).toBe('library');
    expect(opened.apiVersion).toBe(head);
    expect(opened.deprecation).toBeNull();
    expect(opened.resolvedBy).toBe('hostname');
    expect(opened.principal).toMatchObject({
      kind: 'user',
      subject: 'ada',
      roles: ['reader'],
      claims: { books: 0 },
    });
  });

  test('an invocation reuses the session it was given', async () => {
    const { adapter, invoker } = kit();
    await adapter.unit(namespace, tenant, (unit) => unit.rows.insert(book, [bookRow(1)]));
    const opened = await session(invoker, ada);
    const outcome = await invoker.invoke(
      call(
        'library.findByIsbn',
        { isbn: 'isbn-1' },
        { carrier: { transport: 'test' }, session: opened },
      ),
    );
    expect(outcome.ok).toBe(true);
  });

  test('revalidate runs the resolvers again', async () => {
    const { invoker } = kit();
    const opened = await session(invoker, ada);
    const again = await opened.revalidate();
    expect(again.ok && again.value !== opened && again.value.principal.kind === 'user').toBe(true);
  });
});

describe('open', () => {
  test('an unknown host or header value is not_found, a suspended tenant unavailable', async () => {
    const { invoker } = kit();
    expect(failure(await invoker.open({ transport: 'test', host: 'nope.example' }))).toMatchObject({
      kind: 'not_found',
    });
    expect(
      failure(await invoker.open({ transport: 'test', headers: { 'x-tenant': 'tnt-unknown' } })),
    ).toMatchObject({ kind: 'not_found' });
    expect(
      failure(await invoker.open({ transport: 'test', headers: { 'x-tenant': 'tnt-suspended' } })),
    ).toMatchObject({ kind: 'unavailable' });
  });

  test('an invalid bearer token fails open with unauthenticated', async () => {
    const { invoker } = kit();
    const bad = {
      ...byHeaderCarrier,
      headers: { ...byHeaderCarrier.headers, authorization: 'Bearer bad' },
    };
    expect(failure(await invoker.open(bad))).toMatchObject({ kind: 'unauthenticated' });
    const unknown = { ...bad, headers: { ...bad.headers, authorization: 'Bearer who-knows' } };
    expect(failure(await invoker.open(unknown))).toMatchObject({ kind: 'unauthenticated' });
    const publicCall = await invoker.invoke(
      call('library.findByIsbn', { isbn: 'x' }, { carrier: bad }),
    );
    expect(failure(publicCall).kind).toBe('unauthenticated');
  });

  test('an unknown cookie session is anonymous and carries the cookie to clear', async () => {
    const { invoker } = kit();
    const opened = await session(invoker, {
      ...byHeaderCarrier,
      headers: { ...byHeaderCarrier.headers, cookie: 'sid=stale' },
    });
    expect(opened.principal.kind).toBe('anonymous');
    expect(opened.clearCookies).toEqual(['sid']);
  });

  test('no credentials give the anonymous principal', async () => {
    const { invoker } = kit();
    expect((await session(invoker, byHeaderCarrier)).principal.kind).toBe('anonymous');
  });

  test('a local carrier is the operator at deployment level', async () => {
    const { invoker } = kit();
    const opened = await session(invoker, { transport: 'cli', local: { inProcess: true } });
    expect(opened.scope).toEqual({ level: 'deployment' });
    expect(opened.app).toBe('core');
    expect(opened.resolvedBy).toBe('local');
    expect(opened.principal).toMatchObject({ kind: 'operator', via: 'core.operator' });
  });

  test('the effects a resolver returns become keyed job rows of the session scope', async () => {
    const adapter = open();
    const jobs: StoredJobSpec[] = [];
    const spied = {
      ...adapter,
      unit: <T>(
        ns: NamespaceRef,
        scope: StorageScope,
        fn: (unit: Unit) => Promise<T>,
        options?: UnitOptions,
      ) =>
        adapter.unit(
          ns,
          scope,
          (unit) =>
            fn({
              ...unit,
              jobs: {
                ...unit.jobs,
                enqueue: (spec) => {
                  jobs.push(spec);
                  return unit.jobs.enqueue(spec);
                },
              },
            }),
          options,
        ),
    } satisfies DataAdapter;
    const { invoker } = kit({ adapter: spied });
    const slide = {
      ...byHeaderCarrier,
      headers: { ...byHeaderCarrier.headers, authorization: 'Bearer tok-slide' },
    };
    await session(invoker, slide);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      queue: 'commands',
      run: { action: 'library.addBook', input: {} },
      scope: tenant,
      key: { value: 'slide', onConflict: 'keep' },
    });
  });

  test('a resolver runs in a read-only unit', async () => {
    const adapter = open();
    const opened: boolean[] = [];
    const spied = {
      ...adapter,
      unit: <T>(
        ns: NamespaceRef,
        scope: StorageScope,
        fn: (unit: Unit) => Promise<T>,
        options?: UnitOptions,
      ) =>
        adapter.unit(
          ns,
          scope,
          (unit) => {
            opened.push(unit.readOnly);
            return fn(unit);
          },
          options,
        ),
    } satisfies DataAdapter;
    const { invoker } = kit({ adapter: spied });
    await session(invoker, ada);
    expect(opened).toEqual([true]);
  });
});

describe('sessions', () => {
  test('a forged session object is internal', async () => {
    const { invoker } = kit();
    const real = await session(invoker, ada);
    const forged: InvocationSession = { ...real };
    const outcome = await invoker.invoke(
      call('library.findByIsbn', { isbn: 'x' }, { carrier: ada, session: forged }),
    );
    expect(failure(outcome)).toMatchObject({ kind: 'internal', code: 'core.internal' });
  });

  test('a session of another invoker is no session here', async () => {
    const other = await session(kit().invoker, ada);
    const outcome = await kit().invoker.invoke(
      call('library.findByIsbn', { isbn: 'x' }, { carrier: ada, session: other }),
    );
    expect(failure(outcome).kind).toBe('internal');
  });
});

describe('the pipeline stages fail closed', () => {
  test('locate: an unknown action is not_implemented, a level mismatch forbidden', async () => {
    const backendOnly = publicQuery('levels', () => 1, { scope: 'deployment' });
    const { invoker } = kit({ registry: backendOnly.registry });
    expect(
      failure(await invoker.invoke(call('library.nothing', {}, { carrier: ada }))),
    ).toMatchObject({
      kind: 'not_implemented',
    });
    expect(
      failure(await invoker.invoke(call(backendOnly.ref, {}, { carrier: ada }))),
    ).toMatchObject({
      kind: 'forbidden',
    });
  });

  test('validate: a bad input is validation with issues', async () => {
    const { invoker } = kit();
    const error = failure(
      await invoker.invoke(call('library.findByIsbn', { isbn: 7 }, { carrier: ada })),
    );
    expect(error.kind).toBe('validation');
    expect(error.issues?.[0]?.path).toEqual(['isbn']);
  });

  test('authorize: an anonymous caller of a policy action is unauthenticated, a wrong kind forbidden', async () => {
    const { invoker } = kit();
    const anon = failure(
      await invoker.invoke(call('library.findByIsbn', { isbn: 'x' }, { carrier: byHeaderCarrier })),
    );
    expect(anon.kind).toBe('unauthenticated');
    const gated = publicQuery('gated', () => 1, { auth: 'policy' });
    const denied = kit({ registry: gated.registry });
    const forbidden = failure(await denied.invoker.invoke(call(gated.ref, {}, { carrier: ada })));
    expect(forbidden).toMatchObject({ kind: 'forbidden', code: 'core.forbidden' });
  });

  test('public actions run anonymous', async () => {
    const open = publicQuery('hello', () => 'hello');
    const { invoker } = kit({ registry: open.registry });
    const outcome = await invoker.invoke(call(open.ref, {}, { carrier: byHeaderCarrier }));
    expect(outcome).toEqual({ ok: true, value: 'hello' });
  });

  test('execute: a command without a write path is not_implemented', async () => {
    const command = publicQuery('cmd', () => 1, { kind: 'command' });
    const { invoker } = kit({ registry: command.registry });
    expect(failure(await invoker.invoke(call(command.ref, {}, { carrier: ada })))).toMatchObject({
      kind: 'not_implemented',
    });
  });

  test('subscribing to a query is unsupported, at locate', async () => {
    const { invoker } = kit();
    const frames = invoker.subscribe(call('library.findByIsbn', {}, { carrier: ada }));
    await expect(frames[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      kind: 'unsupported',
      code: 'core.unsupported',
    });
  });

  test('createInvoker refuses the resolvers that need the scope directory', () => {
    for (const kind of ['scopeKey', 'path'] as const) {
      expect(() => kit({ tenantResolution: [{ kind }] })).toThrowError(
        expect.objectContaining({
          details: expect.objectContaining({ code: 'scopeDirectoryUnavailable' }),
        }),
      );
    }
  });
});
