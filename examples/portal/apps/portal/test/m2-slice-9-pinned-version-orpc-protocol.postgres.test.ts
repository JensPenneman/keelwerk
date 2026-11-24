import { createRemoteClient } from '@keelwerk/client';
import { orpcJsonSerializers } from '@keelwerk/transport-orpc';
import { createORPCClient, getEventMeta } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { deckVersions } from './support/pinned-deck-app.ts';
import {
  closeAfter,
  expectCardAt,
  json,
  listedCard,
  memberAt,
  proveCommandsAndQueries,
  proveReopen,
  pump,
  titleOf,
} from './support/pinned-deck-checks.ts';
import {
  Inbox,
  newReopen,
  type PinnedDeck,
  pinnedDeck,
  type Seen,
} from './support/pinned-deck-kit.ts';

// Exit criterion 7 of milestone M2 over oRPC and the invocation protocol: a client pinned to the older
// API version is answered at it, and a subscription it reopens stays at it.

const { older, head } = deckVersions;

let deck: PinnedDeck;
beforeAll(async () => {
  deck = await pinnedDeck('portal_pinned_orpc_protocol');
});
afterAll(() => deck?.stop());

describe('oRPC', () => {
  type Api = {
    deck: {
      card: {
        create(input: unknown): Promise<unknown>;
        query(input: unknown): Promise<unknown>;
        watch(
          input: unknown,
          options?: { lastEventId?: string | undefined },
        ): Promise<AsyncIterableIterator<unknown>>;
      };
    };
  };
  const clientOf = (pin: { header?: string; url?: string }): Api => {
    const fetch = deck.fetchOf(pin.header === undefined ? {} : { version: pin.header });
    const url = `${deck.base}/orpc${pin.url === undefined ? '' : `?keelwerk-version=${pin.url}`}`;
    return createORPCClient<never>(
      new RPCLink({
        url,
        customJsonSerializers: orpcJsonSerializers,
        fetch: (request: Request) => fetch(request),
      }),
    ) as never as Api;
  };

  test('a command and a query by header answer at the pinned version', async () => {
    await proveCommandsAndQueries('orpc', (version) => {
      const client = clientOf({ header: version });
      return {
        create: (title) => client.deck.card.create({ [memberAt(version)]: title }),
        list: () => client.deck.card.query({ first: 50 }),
      };
    });
    await expect(
      clientOf({ header: older }).deck.card.create({ title: titleOf('orpc') }),
    ).rejects.toThrow(/does not match/);
  });

  test('the query parameter of the URL pins the command as it pins the query', async () => {
    const client = clientOf({ url: older });
    const title = titleOf('orpc-url');
    expectCardAt(older, await client.deck.card.create({ name: title }), title);
    expectCardAt(older, listedCard(await client.deck.card.query({ first: 50 }), title), title);
  });

  test('a header and a URL parameter that name two versions are refused', async () => {
    const client = clientOf({ header: older, url: head });
    await expect(client.deck.card.create({ name: titleOf('orpc') })).rejects.toThrow();
  });

  test('an event iterator reopened with its last event id stays at its version', async () => {
    const client = clientOf({ header: older });
    const items = new Inbox<unknown>();
    let stream = await client.deck.card.watch({});
    let lastEventId: string | undefined;
    pump(stream, items);
    await proveReopen({
      deck,
      label: 'orpc',
      items,
      onCard: (item) => {
        lastEventId = getEventMeta(item as never)?.id;
      },
      cut: async () => {
        await stream.return?.();
      },
      reopen: async () => {
        stream = await client.deck.card.watch({}, { lastEventId });
        pump(stream, items);
      },
    });
    await stream.return?.();
  });
});

describe('the invocation protocol', () => {
  type Client = {
    invoke(action: string, input: unknown): Promise<unknown>;
    subscribe(action: string, input: unknown): AsyncIterable<unknown>;
  };
  const clientOf = (version: string, options: Record<string, unknown> = {}): Client =>
    createRemoteClient<never>({
      url: deck.base,
      apiVersion: version,
      fetch: deck.fetchOf() as never,
      retry: { baseDelayMs: 1, maxDelayMs: 2 } as never,
      ...options,
    }) as never as Client;

  test('a command and a query answer at the pinned version', async () => {
    await proveCommandsAndQueries('protocol', (version) => {
      const client = clientOf(version);
      return {
        create: (title) => client.invoke('deck.card.create', { [memberAt(version)]: title }),
        list: () => client.invoke('deck.card.query', { first: 50 }),
      };
    });
    await expect(
      clientOf(older).invoke('deck.card.create', { title: titleOf('protocol') }),
    ).rejects.toThrow();
  });

  test('a subscription over server-sent events stays at its version across a reopen', async () => {
    const seen: Seen[] = [];
    const reopen = newReopen();
    const items = new Inbox<unknown>();
    const frames = clientOf(older, { fetch: deck.fetchOf({ reopen, seen }) }).subscribe(
      'deck.card.watch',
      {},
    );
    pump(frames, items);
    await proveReopen({
      deck,
      label: 'protocol-sse',
      items,
      cut: () => reopen.cut.promise,
      reopen: () => reopen.hold.resolve(),
    });
    expect(seen.filter((answer) => answer.stream).map((answer) => answer.version)).toEqual([
      older,
      older,
    ]);
  });

  test('a subscription over a WebSocket stays at its version across a reopen', async () => {
    const reopen = newReopen();
    const { sockets, socketClass } = await deck.socketsOf(reopen);
    const items = new Inbox<unknown>();
    pump(
      clientOf(older, {
        live: 'websocket',
        webSocket: (url: string, protocols: string[]) => new socketClass(url, protocols),
      }).subscribe('deck.card.watch', {}),
      items,
    );
    await proveReopen({
      deck,
      label: 'protocol-ws',
      items,
      cut: async () => {
        sockets[0]?.close(3000);
        await reopen.cut.promise;
      },
      reopen: () => reopen.hold.resolve(),
    });
    expect(sockets).toHaveLength(2);
  });

  test('a hello that names another version than its upgrade is refused', async () => {
    const url = `${deck.socketBase}/_keelwerk/v1/live?keelwerk-version=${older}`;
    const hello = { type: 'hello', apiVersion: head };
    const watch = { type: 'subscribe', id: 's', action: 'deck.card.watch', input: {} };
    const refused = await closeAfter(deck, url, 'keelwerk.live.v1', hello, watch);
    expect(refused.reason).toContain('core.validation');
  });
});

describe('a tenant pinned to the older version', () => {
  const ask = (version: string | undefined, query: string) =>
    deck.fetchOf(version === undefined ? {} : { version })(`${deck.pinnedBase}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query }),
    });
  const list = (member: string) => `{ deckCards(first: 50) { nodes { ${member} } } }`;

  test('is served the older contract over REST and GraphQL, and the head reads the same row', async () => {
    const title = titleOf('tenant');
    const cards = `${deck.pinnedBase}/api/deck/cards`;
    const created = await deck.fetchOf()(cards, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: title }),
    });
    expect(created.headers.get('keelwerk-version')).toBe(older);
    expectCardAt(older, await created.json(), title);
    const unpinned = await ask(undefined, list('name'));
    expect(unpinned.status).toBe(200);
    expect((await ask(undefined, list('title'))).status).toBe(422);
    const atHead = await deck.fetchOf({ version: head })(cards).then(json);
    expectCardAt(head, listedCard(atHead, title), title);
    expect((await ask(head, list('title'))).status).toBe(200);
  });
});

describe('a request that names two versions', () => {
  const endpoints = [
    '/api/deck/cards',
    '/graphql',
    '/trpc/deck.card.query',
    '/orpc/deck/card/query',
    '/_keelwerk/v1/surface',
  ];

  test.each([
    [
      'the header against the parameter',
      `?keelwerk-version=${head}`,
      { 'keelwerk-version': older },
    ],
    ['the parameter twice', `?keelwerk-version=${older}&keelwerk-version=${head}`, {}],
  ])('is refused on every carrier, naming both: %s', async (_form, query, headers) => {
    for (const path of endpoints) {
      const answer = await deck.fetchOf()(`${deck.base}${path}${query}`, { headers });
      const text = JSON.stringify(await answer.json());
      expect(answer.status, path).toBe(422);
      expect(text, path).toContain('core.validation');
      expect(text, path).toContain(older);
      expect(text, path).toContain(head);
      expect(answer.headers.get('keelwerk-version'), path).toBeNull();
    }
  });

  test('is accepted when the version is the same; a header sent twice names no version', async () => {
    const cards = `${deck.base}/api/deck/cards`;
    const same = await deck.fetchOf({ version: older })(
      `${cards}?keelwerk-version=${older}&keelwerk-version=${older}`,
    );
    expect(same.status).toBe(200);
    expect(same.headers.get('keelwerk-version')).toBe(older);
    const joined = await deck.fetchOf()(cards, {
      headers: { 'keelwerk-version': `${older}, ${head}` },
    });
    expect(joined.status).toBe(400);
    expect(JSON.stringify(await joined.json())).toContain('core.api_version_invalid');
  });
});
