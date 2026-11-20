import type { DataAdapter, Logger } from '@keelwerk/core';
import { broadcastNotification, checkBroadcastChannel, errors } from '@keelwerk/core';
import type { ListenConnection } from '../listen-connection.ts';
import { openListenConnection } from '../listen-connection.ts';
import { notifySender } from '../notify-sender.ts';
import { withinDeadline } from '../within-deadline.ts';
import { parseBroadcastNotification } from './parse-broadcast-notification.ts';

/**
 * The wire channel is the version of the text format; the text carries no version. The text on
 * `kw_broadcast` is `<channel>\n<padded base64>` forever. Another format takes a new wire channel:
 * during a rolling upgrade, new processes send on both channels, and old processes, which send only
 * on `kw_broadcast`, are not received by processes that listen only on the new channel.
 */
const wireChannel = 'kw_broadcast';
const bufferLimit = 1_024;
const heartbeat = { intervalMs: 5_000, timeoutMs: 3_000 };

/** One open subscription: a bounded queue read through an async iterator. */
interface Subscription {
  readonly channel: string;
  readonly iterable: AsyncIterable<Uint8Array>;
  push(payload: Uint8Array): void;
  fail(error: unknown): void;
  end(): void;
}

function subscription(channel: string, onLeave: () => void): Subscription {
  const queue: Uint8Array[] = [];
  let waiting:
    | {
        readonly resolve: (result: IteratorResult<Uint8Array>) => void;
        readonly reject: (error: unknown) => void;
      }
    | undefined;
  let finished = false;
  let failure: { readonly error: unknown } | undefined;

  const end = (): void => {
    if (finished) return;
    finished = true;
    queue.length = 0;
    onLeave();
    waiting?.resolve({ value: undefined, done: true });
    waiting = undefined;
  };
  const fail = (error: unknown): void => {
    if (finished) return;
    failure = { error };
    queue.length = 0;
    finished = true;
    onLeave();
    const waiter = waiting;
    waiting = undefined;
    if (waiter !== undefined) {
      failure = undefined;
      waiter.reject(error);
    }
  };
  const next = async (): Promise<IteratorResult<Uint8Array>> => {
    if (failure !== undefined) {
      const { error } = failure;
      failure = undefined;
      throw error;
    }
    const head = queue.shift();
    if (head !== undefined) return { value: head, done: false };
    if (finished) return { value: undefined, done: true };
    return new Promise((resolve, reject) => {
      waiting = { resolve, reject };
    });
  };
  return {
    channel,
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next,
        return: async () => {
          end();
          return { value: undefined, done: true };
        },
      }),
    },
    push: (payload) => {
      if (finished) return;
      if (waiting !== undefined) {
        const waiter = waiting;
        waiting = undefined;
        waiter.resolve({ value: payload, done: false });
        return;
      }
      if (queue.length >= bufferLimit) {
        fail(errors.unavailable('The broadcast subscriber fell behind.'));
        return;
      }
      queue.push(payload);
    },
    fail,
    end,
  };
}

export interface PostgresBroadcastSettings {
  readonly url: string;
  /** Sessions are named `<applicationName>-broadcast-listen` and `<applicationName>-broadcast-notify`. */
  readonly applicationName: string;
  readonly log: Logger;
  /** Milliseconds a new connection may take to open; default 10000. */
  readonly connectionTimeoutMs?: number;
  /** Milliseconds before a lost listen session is opened again; default 1000. */
  readonly retryMs?: number;
}

export interface PostgresBroadcast {
  /** Each subscription receives its own copy of the bytes, so one that changes them changes no other. */
  readonly source: NonNullable<DataAdapter['broadcast']>;
  /**
   * Ends every open subscription without an error and both sessions; gives up after `deadlineMs`. A
   * publish in flight when close begins resolves once it was sent, or rejects with `unavailable`,
   * which may come after the notification was sent; a valid publish after close rejects with
   * `unavailable`.
   */
  close(deadlineMs: number): Promise<void>;
}

/**
 * `DataAdapter.broadcast` on PostgreSQL: `NOTIFY kw_broadcast` outside every unit, one
 * `LISTEN kw_broadcast` session per process. The session only reads, so a heartbeat finds a peer that
 * vanished without a reset; every open subscription then ends with `unavailable`.
 *
 * Payloads on `kw_broadcast` are neither authenticated nor sealed, and row-level security does not
 * apply. Every role that can connect to the database (the application role of any placement or app
 * whose url names this database, a reporting login, the owner) can `LISTEN kw_broadcast` and read
 * the records of every tenant's topics. It can also send `pg_notify('kw_broadcast', '<any valid
 * channel>\n<base64>')`, which every process delivers to that channel's subscribers as if the kernel
 * had published it. No grant can restrict `LISTEN` or `NOTIFY`. The adapter gives no isolation and
 * no proof of origin: isolation rests on the channel name and on who holds a database login.
 * Payloads are plaintext on the server: they appear in server logs with `log_statement=all` (bind
 * parameters are logged) and in the notification queue under `pg_notify/`. A caller publishes
 * nothing such a role may not read and treats what it receives as untrusted input. The topic
 * envelope is WP-179's. The url must reach a session (a direct connection or a session-mode pooler,
 * never a transaction-mode pooler), because `LISTEN` is held on it, with or without the change feed's
 * `notify`.
 */
export function createPostgresBroadcast(settings: PostgresBroadcastSettings): PostgresBroadcast {
  const name = `${settings.applicationName}-broadcast`;
  const connectionTimeoutMs = settings.connectionTimeoutMs ?? 10_000;
  const subscriptions = new Set<Subscription>();
  let state: 'closed' | 'idle' | 'opening' | 'listening' | 'down' = 'idle';
  let listening: Promise<ListenConnection> | undefined;
  let sender: ReturnType<typeof notifySender> | undefined;

  const lostError = (): unknown => errors.unavailable('The broadcast connection was lost.');

  const deliver = (text: string): void => {
    const parsed = parseBroadcastNotification(text);
    if (parsed === undefined) {
      settings.log.warn('postgres broadcast: a malformed notification was dropped');
      return;
    }
    let first = true;
    for (const open of [...subscriptions]) {
      if (open.channel !== parsed.channel) continue;
      open.push(first ? parsed.payload : parsed.payload.slice());
      first = false;
    }
  };

  const openSession = (): void => {
    if (listening !== undefined) return;
    state = 'opening';
    listening = openListenConnection({
      url: settings.url,
      applicationName: name,
      channel: wireChannel,
      connectionTimeoutMs,
      heartbeat,
      log: settings.log,
      ...(settings.retryMs === undefined ? {} : { retryMs: settings.retryMs }),
      onNotification: deliver,
      onListening: () => {
        if (state !== 'closed') state = 'listening';
      },
      onLost: () => {
        if (state === 'closed') return;
        state = 'down';
        for (const open of [...subscriptions]) open.fail(lostError());
      },
    });
  };

  const source: PostgresBroadcast['source'] = {
    publish: async (channel, payload) => {
      const text = broadcastNotification(channel, payload);
      if (state === 'closed') throw errors.unavailable('The broadcast is closed.');
      sender ??= notifySender({
        url: settings.url,
        applicationName: name,
        log: settings.log,
        connectionTimeoutMs,
      });
      try {
        await sender.send(text, wireChannel);
      } catch (cause) {
        throw errors.unavailable('The broadcast could not be sent.', { cause });
      }
    },
    subscribe: (channel, signal) => {
      checkBroadcastChannel(channel);
      const onAbort = (): void => open.end();
      const open: Subscription = subscription(channel, () => {
        subscriptions.delete(open);
        signal.removeEventListener('abort', onAbort);
      });
      if (state === 'closed' || signal.aborted) {
        open.end();
        return open.iterable;
      }
      subscriptions.add(open);
      signal.addEventListener('abort', onAbort, { once: true });
      if (state === 'idle') openSession();
      if (state === 'down') open.fail(lostError());
      return open.iterable;
    },
  };

  return {
    source,
    close: async (deadlineMs) => {
      state = 'closed';
      for (const open of [...subscriptions]) open.end();
      const session = listening;
      const send = sender;
      const ended = Promise.all([
        session?.then(
          (connection) => connection.close(),
          () => undefined,
        ),
        send?.close(),
      ]);
      if (await withinDeadline(ended, deadlineMs)) {
        settings.log.warn('postgres broadcast: the sessions did not close before the deadline');
      }
    },
  };
}
