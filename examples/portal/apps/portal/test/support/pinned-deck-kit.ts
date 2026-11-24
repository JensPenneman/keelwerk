import { connect, createServer, type Socket } from 'node:net';
import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { renderTypeId } from '@keelwerk/core';
import { requestHeaders, startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { createPortalDatabase } from './create-portal-database.ts';
import { deckVersions, pinnedDeckApp } from './pinned-deck-app.ts';

const dataItem = /"row"/;

/** The response with its body ended with an error after the first card item has arrived whole: a dropped link. */
function cutAfterFirstData(response: Response, cut: () => void): Response {
  if (response.body === null) return response;
  if (!(response.headers.get('content-type') ?? '').includes('event-stream')) return response;
  const reader = response.body.getReader();
  let seen = false;
  let tail: string | undefined;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (seen) {
        await reader.cancel();
        cut();
        controller.error(new TypeError('terminated'));
        return;
      }
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }
      const text = new TextDecoder().decode(chunk.value);
      if (tail === undefined && dataItem.test(text)) tail = '';
      if (tail !== undefined) {
        tail += text;
        // The event ends at its blank line, which may come in a later chunk than its first line.
        seen = tail.includes('\n\n');
      }
      controller.enqueue(chunk.value);
    },
  });
  return new Response(body, { status: response.status, headers: response.headers });
}

/** A list that is filled by a producer and read by a consumer that waits for what it needs, never for time. */
export class Inbox<T> {
  readonly items: T[] = [];
  #read = 0;
  readonly #waiting: (() => void)[] = [];

  push(item: T): void {
    this.items.push(item);
    for (const wake of this.#waiting.splice(0)) wake();
  }

  /** The first item that holds, waiting for a push while there is none. */
  async until(holds: (item: T) => boolean): Promise<T> {
    for (;;) {
      const found = this.items.find(holds);
      if (found !== undefined) return found;
      await new Promise<void>((wake) => this.#waiting.push(wake));
    }
  }

  /** Settles once `n` items that `holds` have been pushed. */
  async reach(n: number, holds: (item: T) => boolean): Promise<void> {
    while (this.items.filter(holds).length < n) {
      await new Promise<void>((wake) => this.#waiting.push(wake));
    }
  }

  /** The next item in the order it was pushed that `skip` does not pass over, waiting for a push while there is none. */
  async next(skip: (item: T) => boolean = () => false): Promise<T> {
    for (;;) {
      while (this.#read < this.items.length) {
        const item = this.items[this.#read++] as T;
        if (!skip(item)) return item;
      }
      await new Promise<void>((wake) => this.#waiting.push(wake));
    }
  }
}

/**
 * The order of a reopen, held by the case: the first connection is cut (`cut` settles when it is),
 * and a client that connects again waits until the case calls `release`, so the case creates what
 * the reopened stream must replay while no connection is open.
 */
export interface Reopen {
  readonly cut: PromiseWithResolvers<void>;
  readonly hold: PromiseWithResolvers<void>;
}

/** A reopen not yet cut and not yet released. */
export const newReopen = (): Reopen => ({
  cut: Promise.withResolvers<void>(),
  hold: Promise.withResolvers<void>(),
});

/** The status, version and kind of an answer the host gave. */
export interface Seen {
  readonly status: number;
  readonly version: string | null;
  /** Whether the answer is an event stream. */
  readonly stream: boolean;
}

/** What a case needs of a client socket: the class a library builds its sockets from, and the sockets it built. */
export interface CountedSockets {
  readonly sockets: WebSocket[];
  readonly socketClass: typeof WebSocket;
}

/** What `pinnedDeck` hands a case. */
export interface PinnedDeck {
  /** The URL of the tenant that follows the head, and of the tenant that was pinned to the older version when it was created. */
  readonly base: string;
  readonly pinnedBase: string;
  readonly socketBase: string;
  readonly principal: Record<string, string>;
  /**
   * A `fetch` that goes through the host with the test principal. `version` is set as the header
   * `Keelwerk-Version`; `reopen` cuts the first event stream after its first card item, as a dropped
   * connection does, and holds the next one back; every answer is appended to `seen`.
   */
  fetchOf(options?: { version?: string; reopen?: Reopen; seen?: Seen[] }): typeof fetch;
  /**
   * The WebSocket class for a client. It carries the test principal on its upgrade and counts its
   * sockets; with `reopen` its connections go through a relay that holds every connection after the
   * first back until the case releases it, and that settles `reopen.cut` when the first one ends.
   */
  socketsOf(reopen?: Reopen): Promise<CountedSockets>;
  /** Creates a card at the head version. */
  create(title: string): Promise<void>;
  /** Settles once the workers have run what was accepted for later. */
  drain(): Promise<unknown>;
  stop(): Promise<void>;
}

/** The deck app on its own PostgreSQL database, with the five transports mounted on a listening host. */
export async function pinnedDeck(databaseName: string): Promise<PinnedDeck> {
  const urls = await createPortalDatabase(databaseName);
  const running = await startTransportRuntime({
    app: pinnedDeckApp,
    host: httpHost({ listen: { port: 0 }, trustedProxies: ['127.0.0.1'] }),
    config: {
      graphql: { cors: [], websocket: true },
      trpc: { cors: [], websocket: true },
      orpc: { cors: [] },
    },
    tenants: ['acme', 'pinned'],
    tenantApiVersions: { pinned: deckVersions.older },
    workers: true,
    external: { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl },
  });
  const prefixOf = (tenant: string): string =>
    `/t/${renderTypeId('tnt', running.tenants[tenant] ?? '')}`;
  const port = running.runtime.port;
  const principal = Object.fromEntries(requestHeaders({ subject: 'ada' }));
  const fetchOf: PinnedDeck['fetchOf'] = ({ version, reopen, seen } = {}) => {
    let opened = 0;
    return async (input, init) => {
      const request = new Request(input, init);
      for (const [name, value] of Object.entries(principal)) request.headers.set(name, value);
      if (version !== undefined) request.headers.set('keelwerk-version', version);
      const stream = (request.headers.get('accept') ?? '').includes('event-stream');
      if (reopen !== undefined && stream && opened++ > 0) await reopen.hold.promise;
      const response = await running.fetch(request);
      seen?.push({
        status: response.status,
        version: response.headers.get('keelwerk-version'),
        stream: (response.headers.get('content-type') ?? '').includes('event-stream'),
      });
      return reopen === undefined || opened > 1
        ? response
        : cutAfterFirstData(response, reopen.cut.resolve);
    };
  };
  const relays: ReturnType<typeof createServer>[] = [];
  return {
    base: `http://127.0.0.1:${port}${prefixOf('acme')}`,
    pinnedBase: `http://127.0.0.1:${port}${prefixOf('pinned')}`,
    socketBase: `ws://127.0.0.1:${port}${prefixOf('acme')}`,
    principal,
    fetchOf,
    async socketsOf(reopen) {
      const sockets: WebSocket[] = [];
      let via = port;
      if (reopen !== undefined) {
        let count = 0;
        const relay = createServer(async (client: Socket) => {
          const first = count++ === 0;
          if (!first) await reopen.hold.promise;
          const upstream = connect(port as number, '127.0.0.1');
          const end = (): void => {
            client.destroy();
            upstream.destroy();
            if (first) reopen.cut.resolve();
          };
          client.pipe(upstream).pipe(client);
          client.on('close', end).on('error', end);
          upstream.on('close', end).on('error', end);
        });
        relays.push(relay);
        await new Promise<void>((listening) => relay.listen(0, '127.0.0.1', listening));
        via = (relay.address() as { port: number }).port;
      }
      class CountedSocket extends WebSocket {
        constructor(
          url: string | URL,
          offer?: string | string[] | { protocols?: string | string[] },
        ) {
          const offered =
            typeof offer === 'object' && !Array.isArray(offer) ? offer.protocols : offer;
          super(String(url).replace(`:${port}`, `:${via}`), {
            protocols: offered,
            headers: principal,
          } as never);
          sockets.push(this);
        }
      }
      return { sockets, socketClass: CountedSocket };
    },
    async create(title) {
      const response = await fetchOf({ version: deckVersions.head })(
        `http://127.0.0.1:${port}${prefixOf('acme')}/api/deck/cards`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        },
      );
      if (response.status !== 201)
        throw new Error(`Creating ${title} answered ${response.status}.`);
    },
    drain: () => running.drainJobs(),
    async stop() {
      for (const relay of relays) relay.close();
      await running.stop();
    },
  };
}
