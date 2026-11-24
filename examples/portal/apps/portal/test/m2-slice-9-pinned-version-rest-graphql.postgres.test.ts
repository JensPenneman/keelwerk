import { readEventStream } from '@keelwerk/testing';
import { EventSource } from 'eventsource';
import { createClient as createGraphqlWsClient } from 'graphql-ws';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { deckVersions } from './support/pinned-deck-app.ts';
import {
  closeAfter,
  expectCardAt,
  isHead,
  json,
  listedCard,
  memberAt,
  pick,
  proveCommandsAndQueries,
  proveReopen,
  pump,
  rowOf,
  titleOf,
} from './support/pinned-deck-checks.ts';
import {
  Inbox,
  newReopen,
  type PinnedDeck,
  pinnedDeck,
  type Seen,
} from './support/pinned-deck-kit.ts';

// Exit criterion 7 of milestone M2 over REST and GraphQL: after a breaking change with a version change,
// a client pinned to the older API version still works. The app renamed a card's `name` to `title`
// between its two versions, so every case shows the older client answered `name` and no `title`, and
// the head client the reverse; a pin that works by accident, because the change never reaches it, fails.

const { older, head } = deckVersions;
const jsonHeaders = { 'content-type': 'application/json' };

let deck: PinnedDeck;
beforeAll(async () => {
  deck = await pinnedDeck('portal_pinned_rest_graphql');
});
afterAll(() => deck?.stop());

describe('REST', () => {
  const cards = (base = deck.base) => `${base}/api/deck/cards`;
  const post = (version: string | undefined, body: unknown, query = '', headers = {}) =>
    deck.fetchOf(version === undefined ? {} : { version })(`${cards()}${query}`, {
      method: 'POST',
      headers: { ...jsonHeaders, ...headers },
      body: JSON.stringify(body),
    });

  test('a command and a query by header answer at the pinned version', async () => {
    await proveCommandsAndQueries('rest', (version) => ({
      create: async (title) => {
        const created = await post(version, { [memberAt(version)]: title });
        expect(created.status).toBe(201);
        expect(created.headers.get('keelwerk-version')).toBe(version);
        return created.json();
      },
      list: () => deck.fetchOf({ version })(cards()).then(json),
    }));
    expect((await post(older, { title: titleOf('rest') })).status).toBe(422);
  });

  test('the query parameter pins a POST as it pins a GET', async () => {
    const title = titleOf('rest-url');
    const created = await post(undefined, { name: title }, `?keelwerk-version=${older}`);
    expect(created.status).toBe(201);
    expectCardAt(older, await created.json(), title);
    const listed = await deck.fetchOf()(`${cards()}?keelwerk-version=${older}`).then(json);
    expectCardAt(older, listedCard(listed, title), title);
  });

  test('a command accepted for later is stored in head form: its receipt reads the same at both versions', async () => {
    const title = titleOf('rest-async');
    const accepted = await post(older, { name: title }, '', { prefer: 'respond-async' });
    expect(accepted.status).toBe(202);
    await deck.drain();
    const receipt = new URL(accepted.headers.get('location') ?? '', deck.base).href;
    const [atOlder, atHead] = await Promise.all(
      [older, head].map((version) => deck.fetchOf({ version })(receipt).then(json)),
    );
    expect(atOlder).toEqual(atHead);
    expect(atOlder).toMatchObject({ apiVersion: older, status: 'completed' });
    // The card the command made reads under each version's own member.
    for (const version of [older, head]) {
      const listed = await deck.fetchOf({ version })(cards()).then(json);
      expectCardAt(version, listedCard(listed, title), title);
    }
  });

  test('a subscription pinned by the parameter stays at it across a reopen', async () => {
    const seen: Seen[] = [];
    const reopen = newReopen();
    const items = new Inbox<unknown>();
    const source = new EventSource(`${cards()}/watch?keelwerk-version=${older}`, {
      fetch: deck.fetchOf({ reopen, seen }) as never,
    });
    source.addEventListener('head', (event) => items.push({ head: JSON.parse(event.data) }));
    source.addEventListener('data', (event) => items.push(JSON.parse(event.data)));
    try {
      await proveReopen({
        deck,
        label: 'rest-sse',
        items,
        cut: () => reopen.cut.promise,
        reopen: () => reopen.hold.resolve(),
      });
      expect(seen.filter((answer) => answer.stream).map((answer) => answer.version)).toEqual([
        older,
        older,
      ]);
    } finally {
      source.close();
    }
  });
});

describe('a stream token', () => {
  test('is tied to its version: a reopen that names none is served at the default and resyncs', async () => {
    const watch = `${deck.base}/api/deck/cards/watch`;
    const first = titleOf('token-first');
    const pinned = readEventStream(
      await deck.fetchOf({ version: older })(watch, { headers: { accept: 'text/event-stream' } }),
    );
    await pinned.until((frame) => frame.event === 'head');
    await deck.create(first);
    const [item] = (await pinned.until((frame) => frame.event === 'data')).slice(-1);
    await pinned.close();
    expectCardAt(older, rowOf(item?.data), first);
    const seen: Seen[] = [];
    const reopened = readEventStream(
      await deck.fetchOf({ seen })(watch, {
        headers: { accept: 'text/event-stream', 'last-event-id': item?.id ?? '' },
      }),
    );
    // A card created once the stream is open is a data frame that would follow a token that held.
    await deck.create(titleOf('token-second'));
    const [answer] = (
      await reopened.until((frame) => frame.event === 'reset' || frame.event === 'data')
    ).slice(-1);
    await reopened.close();
    expect(answer).toMatchObject({ event: 'reset', data: { reason: 'resync' } });
    expect(seen[0]?.version).toBe(head);
  });
});

describe('GraphQL', () => {
  const send = (
    version: string | undefined,
    query: string,
    variables: unknown = {},
    urlQuery = '',
  ) =>
    deck.fetchOf(version === undefined ? {} : { version })(`${deck.base}/graphql${urlQuery}`, {
      method: 'POST',
      headers: { ...jsonHeaders, accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  const create = (member: string) =>
    `mutation($i: DeckCardCreateInput!) { deckCardCreate(input: $i) { ... on DeckCardCreateSuccess { result { id ${member} } } } }`;
  const list = (member: string) => `{ deckCards(first: 50) { nodes { id ${member} } } }`;
  const watch = (member: string) =>
    `subscription($a: String) { deckCardWatch(after: $a) { __typename ... on DeckCardWatchItem { id state row { ${member} } } ... on StreamHead { state } } }`;

  test('a mutation and a query by header answer at the pinned version', async () => {
    await proveCommandsAndQueries('graphql', (version) => {
      const member = memberAt(version);
      return {
        create: async (title) =>
          pick(
            await send(version, create(member), { i: { [member]: title } }).then(json),
            'data',
            'deckCardCreate',
            'result',
          ),
        list: async () => pick(await send(version, list(member)).then(json), 'data', 'deckCards'),
      };
    });
    // A selection of the head's member is refused at the older version, and the reverse.
    expect((await send(older, list('title'))).status).toBe(422);
    expect((await send(head, list('name'))).status).toBe(422);
  });

  test('the query parameter pins a POST', async () => {
    const title = titleOf('graphql-url');
    const created = await send(
      undefined,
      create('name'),
      { i: { name: title } },
      `?keelwerk-version=${older}`,
    ).then(json);
    expectCardAt(older, pick(created, 'data', 'deckCardCreate', 'result'), title);
  });

  test('a subscription over server-sent events stays at its version across a reopen', async () => {
    const open = async (after?: string) =>
      readEventStream(
        await deck.fetchOf({ version: older })(`${deck.base}/graphql`, {
          method: 'POST',
          headers: { ...jsonHeaders, accept: 'text/event-stream' },
          body: JSON.stringify({ query: watch('name'), variables: { a: after ?? null } }),
        }),
      );
    const feed = (stream: Awaited<ReturnType<typeof open>>): void =>
      pump(
        (async function* () {
          for (let frame = await stream.next(); frame !== undefined; frame = await stream.next()) {
            if (frame.event === 'next') yield frame.data;
          }
        })(),
        items,
      );
    const items = new Inbox<unknown>();
    let stream = await open();
    let token: string | undefined;
    feed(stream);
    await proveReopen({
      deck,
      label: 'graphql-sse',
      items,
      onCard: (item) => {
        token = pick(item, 'data', 'deckCardWatch', 'state') as string;
      },
      cut: () => stream.close(),
      reopen: async () => {
        stream = await open(token);
        feed(stream);
      },
    });
    await stream.close();
  });

  test('a graphql-ws client stays at the version of its connection parameters across a reopen', async () => {
    const { sockets, socketClass } = await deck.socketsOf();
    const connect = () =>
      createGraphqlWsClient({
        url: `${deck.socketBase}/graphql`,
        webSocketImpl: socketClass,
        connectionParams: { apiVersion: older },
        retryAttempts: 0,
      });
    const items = new Inbox<unknown>();
    let client = connect();
    let token: string | undefined;
    pump(client.iterate({ query: watch('name'), variables: { a: null } }), items);
    await proveReopen({
      deck,
      label: 'graphql-ws',
      items,
      onCard: (item) => {
        token = pick(item, 'data', 'deckCardWatch', 'state') as string;
      },
      cut: () => client.dispose() as Promise<void>,
      reopen: () => {
        client = connect();
        pump(client.iterate({ query: watch('name'), variables: { a: token ?? null } }), items);
      },
    });
    await client.dispose();
    expect(sockets).toHaveLength(2);
  });

  test('a hello that names another version than its upgrade is refused; the same one is accepted', async () => {
    const url = `${deck.socketBase}/graphql?keelwerk-version=${older}`;
    const refused = await closeAfter(deck, url, 'graphql-transport-ws', {
      type: 'connection_init',
      payload: { apiVersion: head },
    });
    expect(refused.reason).toContain('core.validation');
    const { socketClass } = await deck.socketsOf();
    const client = createGraphqlWsClient({
      url,
      webSocketImpl: socketClass,
      connectionParams: { apiVersion: older },
      retryAttempts: 0,
    });
    const frames = client
      .iterate({ query: watch('name'), variables: { a: null } })
      [Symbol.asyncIterator]();
    expect(isHead(await frames.next().then((step) => step.value))).toBe(true);
    await client.dispose();
  });
});
