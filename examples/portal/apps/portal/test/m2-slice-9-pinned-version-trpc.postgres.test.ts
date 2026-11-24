import { keelwerkSuperjson, trpcWebSocket } from '@keelwerk/transport-trpc';
import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  wsLink,
} from '@trpc/client';
import { EventSource } from 'eventsource';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { deckVersions } from './support/pinned-deck-app.ts';
import {
  closeAfter,
  expectCardAt,
  isHead,
  listedCard,
  memberAt,
  proveCommandsAndQueries,
  proveReopen,
  titleOf,
} from './support/pinned-deck-checks.ts';
import {
  Inbox,
  newReopen,
  type PinnedDeck,
  pinnedDeck,
  type Reopen,
  type Seen,
} from './support/pinned-deck-kit.ts';

// Exit criterion 7 of milestone M2 over tRPC: a client pinned to the older API version, by header, by
// the parameter of its URL or by the connection parameters of its socket, is answered at it.

const { older, head } = deckVersions;

let deck: PinnedDeck;
beforeAll(async () => {
  deck = await pinnedDeck('portal_pinned_trpc');
});
afterAll(() => deck?.stop());

type Api = {
  deck: {
    card: {
      create: { mutate(input: unknown): Promise<unknown> };
      query: { query(input: unknown): Promise<unknown> };
      watch: { subscribe(input: unknown, observer: unknown): { unsubscribe(): void } };
    };
  };
};

/** A tRPC client whose calls reach the host with the pin as the header or as the URL's parameter. */
function clientOf(
  pin: { header?: string; url?: string },
  options: { reopen?: Reopen; seen?: Seen[]; connectionParams?: Record<string, string> } = {},
): Api {
  const { connectionParams, ...fetching } = options;
  const fetch = deck.fetchOf({
    ...(pin.header === undefined ? {} : { version: pin.header }),
    ...fetching,
  });
  const url = `${deck.base}/trpc${pin.url === undefined ? '' : `?keelwerk-version=${pin.url}`}`;
  const transformer = keelwerkSuperjson();
  return createTRPCClient<never>({
    links: [
      splitLink({
        condition: (operation) => operation.type === 'subscription',
        true: httpSubscriptionLink({
          url,
          transformer,
          // biome-ignore lint/style/useNamingConvention: tRPC's option name
          EventSource: EventSource as never,
          eventSourceOptions: () => ({ fetch }) as never,
          ...(connectionParams === undefined ? {} : { connectionParams }),
        }),
        false: httpBatchLink({ url, transformer, fetch: fetch as never }),
      }),
    ],
  }) as never as Api;
}

/** The items a subscription delivers, and its errors as items. */
function observed(): { readonly items: Inbox<unknown>; readonly observer: object } {
  const items = new Inbox<unknown>();
  return {
    items,
    observer: {
      onData: (item: unknown) => items.push(item),
      onError: (error: unknown) => items.push({ error: String(error) }),
    },
  };
}

describe('tRPC', () => {
  test('a mutation and a query by header answer at the pinned version', async () => {
    await proveCommandsAndQueries('trpc', (version) => {
      const client = clientOf({ header: version });
      return {
        create: (title) => client.deck.card.create.mutate({ [memberAt(version)]: title }),
        list: () => client.deck.card.query.query({ first: 50 }),
      };
    });
    await expect(
      clientOf({ header: older }).deck.card.create.mutate({ title: titleOf('trpc') }),
    ).rejects.toThrow(/does not match/);
  });

  test('the query parameter of the URL pins the mutation as it pins the query', async () => {
    const client = clientOf({ url: older });
    const title = titleOf('trpc-url');
    expectCardAt(older, await client.deck.card.create.mutate({ name: title }), title);
    expectCardAt(
      older,
      listedCard(await client.deck.card.query.query({ first: 50 }), title),
      title,
    );
  });

  test('a header and a URL parameter that name two versions are refused', async () => {
    const client = clientOf({ header: older, url: head });
    await expect(client.deck.card.create.mutate({ name: titleOf('trpc') })).rejects.toThrow();
  });

  test('a subscription over server-sent events stays at its version across a reopen', async () => {
    const seen: Seen[] = [];
    const reopen = newReopen();
    const { items, observer } = observed();
    const subscription = clientOf({ header: older }, { reopen, seen }).deck.card.watch.subscribe(
      {},
      observer,
    );
    try {
      await proveReopen({
        deck,
        label: 'trpc-sse',
        items,
        cut: () => reopen.cut.promise,
        reopen: () => reopen.hold.resolve(),
      });
      expect(seen.filter((answer) => answer.stream).map((answer) => answer.version)).toEqual([
        older,
        older,
      ]);
    } finally {
      subscription.unsubscribe();
    }
  });

  test('connectionParams in the URL of a subscription are refused, not ignored', async () => {
    const seen: Seen[] = [];
    const { items, observer } = observed();
    const subscription = clientOf(
      {},
      { seen, connectionParams: { apiVersion: older } },
    ).deck.card.watch.subscribe({}, observer);
    try {
      expect(await items.next()).toMatchObject({ error: expect.stringContaining('400') });
      expect(seen.map((answer) => answer.status)).toEqual([400]);
    } finally {
      subscription.unsubscribe();
    }
  });
});

describe('the tRPC socket', () => {
  const socketClient = async (
    reopen: Reopen | undefined,
    url: string,
    connectionParams: Record<string, string>,
  ) => {
    const { sockets, socketClass } = await deck.socketsOf(reopen);
    const socket = createWSClient({
      url,
      // biome-ignore lint/style/useNamingConvention: tRPC's option name
      WebSocket: trpcWebSocket(socketClass as never),
      connectionParams,
      retryDelayMs: () => 1,
    });
    const client = createTRPCClient<never>({
      links: [wsLink({ client: socket, transformer: keelwerkSuperjson() })],
    }) as never as Api;
    return { sockets, socket, client };
  };

  test('a subscription stays at its connection parameters across a reconnect', async () => {
    const reopen = newReopen();
    const { sockets, socket, client } = await socketClient(reopen, `${deck.socketBase}/trpc`, {
      apiVersion: older,
    });
    const { items, observer } = observed();
    const subscription = client.deck.card.watch.subscribe({}, observer);
    try {
      await proveReopen({
        deck,
        label: 'trpc-ws',
        items,
        cut: async () => {
          sockets[0]?.close(3000);
          await reopen.cut.promise;
        },
        reopen: () => reopen.hold.resolve(),
      });
      expect(sockets).toHaveLength(2);
    } finally {
      subscription.unsubscribe();
      await socket.close();
    }
  });

  test('a hello that names another version than its upgrade is refused; the same one is accepted', async () => {
    const url = `${deck.socketBase}/trpc?connectionParams=1&keelwerk-version=${older}`;
    const query = {
      id: 1,
      method: 'query',
      params: { path: 'deck.card.query', input: { json: { first: 1 } } },
    };
    const hello = (apiVersion: string) => ({ method: 'connectionParams', data: { apiVersion } });
    expect((await closeAfter(deck, url, 'keelwerk.trpc.v1', hello(head), query)).reason).toContain(
      'core.validation',
    );
    const { items, observer } = observed();
    const { socket, client } = await socketClient(
      undefined,
      `${deck.socketBase}/trpc?keelwerk-version=${older}`,
      { apiVersion: older },
    );
    const subscription = client.deck.card.watch.subscribe({}, observer);
    try {
      expect(isHead(await items.next())).toBe(true);
    } finally {
      subscription.unsubscribe();
      await socket.close();
    }
  });
});
