import { describe, expect, test } from 'vitest';
import { ruleEntry } from '../../test/authorization/fixtures.ts';
import { type LoggedLine, recordingLogger } from '../../test/executor-kit.ts';
import {
  actionOf,
  callOf,
  invokerOf,
  registryOf,
  scope,
  withResolver,
} from '../../test/invoker/invoker-kit.ts';
import { fakeHub, feed, itemFrame, leaf } from '../../test/invoker/live-kit.ts';
import type { FlagResolution } from '../contexts/flag-resolution.ts';
import type { FlagProvider } from '../flags/flag-provider.ts';

/** A flag request as a map yields it with `yield*`: the answer is the flag's value. */
const flagRequest = (key: string) => ({
  kind: 'flag',
  key,
  details: false,
  *[Symbol.iterator](): Generator<unknown, unknown, unknown> {
    return yield this;
  },
});

/** A flag whose value is the kind of the principal it is evaluated for. */
const whoFlag: FlagProvider = {
  id: 'test.who',
  sync: true,
  start: () => Promise.resolve(),
  resolve: <T>(_flag: unknown, context: { readonly principal: { readonly kind: string } }) =>
    ({
      value: context.principal.kind,
      variant: context.principal.kind,
      reason: 'TARGETING_MATCH',
      provider: 'test.who',
    }) as unknown as FlagResolution<T>,
};

const adapter = {
  placementId: 'main',
  unit: async (_ns: unknown, _scope: unknown, fn: (unit: object) => Promise<unknown>) =>
    fn({ scope, events: { head: async () => 7n } }),
};

const withWho = (registry: ReturnType<typeof registryOf>) =>
  ({
    ...registry,
    modules: [
      {
        id: 'doc',
        contextName: 'doc',
        requires: [],
        optional: [],
        flags: { who: { kind: 'string', level: 'tenant', default: 'nobody' } },
        extensionPoints: [],
      },
    ],
  }) as unknown as typeof registry;

describe('the renewal of a subscription whose items are mapped by a generator', () => {
  test('the loads of the next item run with the principal and the flags of the renewal', async () => {
    const mapped = actionOf('doc.feed', {
      ...feed,
      handler: () => ({
        kind: 'liveSource',
        source: leaf(),
        map: function* (item: { n: number }) {
          const who = yield* flagRequest('doc.who');
          return { n: who === 'user' ? item.n * 100 : item.n };
        },
      }),
    });
    const { hub, calls } = fakeHub([itemFrame(1), itemFrame(2)]);
    const invoker = invokerOf(
      withResolver(withWho(registryOf([mapped]))),
      { placement: () => ({ adapter }) as never, flagProviders: [whoFlag] },
      { liveHub: hub },
    );
    // The subscriber starts anonymous; the carrier it opened its session with signs in later.
    const headers: Record<string, string> = { 'x-tenant': 't1' };
    const own = { transport: 'test', headers };
    const opened = await invoker.open(own);
    if (!opened.ok) throw opened.error;
    const stream = invoker
      .subscribe(callOf('doc.feed', {}, { carrier: own, session: opened.value }))
      [Symbol.asyncIterator]();
    const first = await stream.next();
    const session = calls[0]?.find(
      (argument): argument is { revalidate(): Promise<{ ok: boolean }> } =>
        typeof argument === 'object' &&
        argument !== null &&
        'revalidate' in argument &&
        typeof argument.revalidate === 'function',
    );
    headers.authorization = 'Bearer tok-ada';
    expect((await session?.revalidate())?.ok).toBe(true);
    const second = await stream.next();
    expect(first.value).toMatchObject({ event: { n: 1 } });
    // Without the renewal's principal and flags the second item would be mapped as the first was.
    expect(second.value).toMatchObject({ event: { n: 200 } });
    await stream.return?.();
  });

  test('the read rules of the next item are decided for the principal of the renewal', async () => {
    const rows = [{ id: 'p1', title: 'first' }];
    const stored = {
      placementId: 'main',
      unit: async (_ns: unknown, _scope: unknown, fn: (unit: object) => Promise<unknown>) =>
        fn({
          scope,
          events: { head: async () => 7n },
          rows: {
            // A condition no row can meet (the rule's answer for a principal it does not allow) finds nothing.
            find: async (_descriptor: unknown, query: { where?: { op?: string } }) => ({
              rows: query.where?.op === 'never' ? [] : rows,
              position: 7n,
              pageInfo: {
                hasNextPage: false,
                hasPreviousPage: false,
                startCursor: null,
                endCursor: null,
              },
            }),
          },
        }),
    };
    const mapped = actionOf('doc.feed', {
      ...feed,
      entity: 'doc.post',
      handler: (
        _input: unknown,
        ctx: { readonly target: { forCaller(): { byId(id: string): unknown } } },
      ) => ({
        kind: 'liveSource',
        source: leaf(),
        map: function* (item: { n: number }) {
          const row = (yield* ctx.target.forCaller().byId('p1') as Generator<unknown, unknown>) as
            | { title: string }
            | undefined;
          return { n: row === undefined ? -item.n : item.n };
        },
      }),
    });
    const plain = registryOf([mapped]);
    const post = plain.entities.get('doc.post');
    // Only a signed-in user reads posts; the loaded rows pass the module's view, which needs the origin of its fields.
    const registry = {
      ...plain,
      entities: new Map([['doc.post', { ...post, origin: {} }]]),
      rules: new Map([
        [
          'doc.post.users',
          ruleEntry({
            id: 'doc.post.users',
            effect: 'allow',
            actions: ['read'],
            where: (context) =>
              (context as { principal: { kind: string } }).principal.kind === 'user' ? {} : false,
          }),
        ],
      ]),
    } as unknown as typeof plain;
    const { hub, calls } = fakeHub([itemFrame(1), itemFrame(2)]);
    const invoker = invokerOf(
      withResolver(registry),
      { placement: () => ({ adapter: stored }) as never },
      { liveHub: hub },
    );
    // The subscriber is signed in; the carrier it opened its session with goes back to a stale cookie later.
    const headers: Record<string, string> = { 'x-tenant': 't1', authorization: 'Bearer tok-ada' };
    const own = { transport: 'test', headers };
    const opened = await invoker.open(own);
    if (!opened.ok) throw opened.error;
    const stream = invoker
      .subscribe(callOf('doc.feed', {}, { carrier: own, session: opened.value }))
      [Symbol.asyncIterator]();
    const first = await stream.next();
    const session = calls[0]?.find(
      (argument): argument is { revalidate(): Promise<{ ok: boolean }> } =>
        typeof argument === 'object' &&
        argument !== null &&
        'revalidate' in argument &&
        typeof argument.revalidate === 'function',
    );
    delete headers.authorization;
    headers.cookie = 'sid=stale';
    expect((await session?.revalidate())?.ok).toBe(true);
    const second = await stream.next();
    expect(first.value).toMatchObject({ event: { n: 1 } });
    // Decided for the signed-in user the read would still find the row and map it as the first.
    expect(second.value).toMatchObject({ event: { n: -2 } });
    await stream.return?.();
  });

  /** A subscription whose first item waits on a read that never answers. */
  const hungStream = (lines: LoggedLine[] = []) => {
    const hung = actionOf('doc.feed', {
      ...feed,
      entity: 'doc.post',
      handler: (_input: unknown, ctx: { readonly target: { byId(id: string): unknown } }) => ({
        kind: 'liveSource',
        source: leaf(),
        map: function* (item: { n: number }) {
          yield* ctx.target.byId(`p${item.n}`) as Generator<unknown, unknown>;
          return item;
        },
      }),
    });
    const waiting = {
      placementId: 'main',
      unit: async (_ns: unknown, _scope: unknown, fn: (unit: object) => Promise<unknown>) =>
        fn({
          scope,
          events: { head: async () => 7n },
          rows: { find: () => new Promise<never>(() => undefined) },
        }),
    };
    const plain = registryOf([hung]);
    const post = plain.entities.get('doc.post');
    const registry = {
      ...plain,
      entities: new Map([['doc.post', { ...post, origin: {} }]]),
    } as unknown as typeof plain;
    const { hub } = fakeHub([itemFrame(1)]);
    const invoker = invokerOf(
      withResolver(registry),
      { placement: () => ({ adapter: waiting }) as never, log: recordingLogger(lines) },
      { liveHub: hub },
    );
    const abort = new AbortController();
    const stream = invoker
      .subscribe(
        callOf(
          'doc.feed',
          {},
          { carrier: { transport: 'test', headers: { 'x-tenant': 't1' } }, signal: abort.signal },
        ),
      )
      [Symbol.asyncIterator]();
    return { stream, abort };
  };

  /** What a pending `next()` settled with, or 'hung' when it did not within two seconds. */
  const settled = (pending: Promise<unknown>) =>
    Promise.race([
      pending.then(
        (value) => value,
        () => 'failed' as const,
      ),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 2000)),
    ]);

  test('a map unit that is open ends quietly when the client goes', async () => {
    const lines: LoggedLine[] = [];
    const { stream, abort } = hungStream(lines);
    const pending = stream.next();
    // The unit is waiting on its read; the client goes.
    await new Promise<void>((resolve) => setImmediate(resolve));
    abort.abort();
    // The stream is done, not failed with an internal error, and nothing is logged as an error.
    expect(await settled(pending)).toEqual({ done: true, value: undefined });
    expect(lines.filter((line) => line.level === 'error')).toEqual([]);
  });

  test('a map unit that is open ends when the stream is returned, the invocation still running', async () => {
    const { stream } = hungStream();
    const pending = stream.next();
    await new Promise<void>((resolve) => setImmediate(resolve));
    void stream.return?.();
    expect(await settled(pending)).toEqual({ done: true, value: undefined });
  });
});
