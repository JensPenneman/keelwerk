import type { Logger } from '@keelwerk/core';
import pg from 'pg';

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
  send(payload: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * The notifier's own connection (14.3.7): opened at the first wake-up, outside the pool so that a
 * busy pool never delays a wake-up, and dropped after an error so that the next wake-up opens
 * another. `NOTIFY` goes through `pg_notify` so the payload is a parameter.
 */
export function notifySender(settings: NotifySenderSettings): NotifySender {
  let client: Promise<pg.Client> | undefined;
  const connect = async (): Promise<pg.Client> => {
    const created = new pg.Client({
      connectionString: settings.url,
      // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
      application_name: `${settings.applicationName}-notify`,
      connectionTimeoutMillis: settings.connectionTimeoutMs ?? 10_000,
      keepAlive: true,
      // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
      query_timeout: 5000,
    });
    created.on('error', (error) => {
      settings.log.warn('postgres notifier: the connection failed', { message: error.message });
      client = undefined;
    });
    await created.connect();
    return created;
  };
  return {
    send: async (payload) => {
      client ??= connect();
      let connected: pg.Client;
      try {
        connected = await client;
      } catch (error) {
        client = undefined;
        throw error;
      }
      try {
        await connected.query('select pg_notify($1, $2)', ['kw_events', payload]);
      } catch (error) {
        if (client !== undefined && (await client.catch(() => undefined)) === connected) {
          client = undefined;
        }
        connected.end().catch(() => undefined);
        throw error;
      }
    },
    close: async () => {
      const current = client;
      client = undefined;
      if (current === undefined) return;
      await (await current.catch(() => undefined))?.end().catch(() => undefined);
    },
  };
}
