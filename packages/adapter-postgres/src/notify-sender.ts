import type { Logger } from '@keelwerk/core';
import type pg from 'pg';
import { createPostgresClient } from './connections/create-postgres-client.ts';

/** What `notifySender` needs. */
export interface NotifySenderSettings {
  readonly url: string;
  readonly applicationName: string;
  readonly log: Logger;
  /** Milliseconds a new connection may take to open; default 10000. */
  readonly connectionTimeoutMs?: number;
}

/** The sender and the way to end its connection. */
export interface NotifySender {
  send(payload: string, channel?: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * The notifier's own connection (14.3.7): opened at the first wake-up, outside the pool so that a
 * busy pool never delays a wake-up, and dropped after an error so that the next wake-up opens
 * another. `NOTIFY` goes through `pg_notify` so the payload is a parameter.
 */
export function notifySender(settings: NotifySenderSettings): NotifySender {
  let client: Promise<pg.Client> | undefined;
  /** The connection `client` holds once it is open. */
  let live: pg.Client | undefined;
  let closed = false;
  const connect = async (): Promise<pg.Client> => {
    const created = createPostgresClient({
      onError: (error) => {
        // The driver reports one ended connection twice (the server's message, then the end of the
        // socket), and the second report can come after the next wake-up opened another connection:
        // only the connection that is held is dropped, and only once.
        if (live !== created) return;
        live = undefined;
        client = undefined;
        settings.log.warn('postgres notifier: the connection failed', { message: error.message });
      },
      connectionString: settings.url,
      // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
      application_name: `${settings.applicationName}-notify`,
      connectionTimeoutMillis: settings.connectionTimeoutMs ?? 10_000,
      keepAlive: true,
      // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
      query_timeout: 5000,
    });
    await created.connect();
    live = created;
    if (closed) {
      // The sender was closed while this connection was opening: nothing will use it.
      created.end().catch(() => undefined);
      throw new Error('The notify sender is closed');
    }
    return created;
  };
  return {
    send: async (payload, channel) => {
      // A wake-up that arrives after the close has nobody to wake and must not open a connection.
      if (closed) return;
      client ??= connect();
      let connected: pg.Client;
      try {
        connected = await client;
      } catch (error) {
        client = undefined;
        if (closed) return;
        throw error;
      }
      try {
        await connected.query('select pg_notify($1, $2)', [channel ?? 'kw_events', payload]);
      } catch (error) {
        if (client !== undefined && (await client.catch(() => undefined)) === connected) {
          client = undefined;
        }
        if (live === connected) live = undefined;
        connected.end().catch(() => undefined);
        throw error;
      }
    },
    close: async () => {
      closed = true;
      const current = client;
      client = undefined;
      live = undefined;
      if (current === undefined) return;
      await (await current.catch(() => undefined))?.end().catch(() => undefined);
    },
  };
}
