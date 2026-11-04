import type { Logger } from '@keelwerk/core';
import pg from 'pg';

/** What `openListenConnection` needs. */
export interface ListenConnectionSettings {
  readonly url: string;
  readonly applicationName: string;
  readonly log: Logger;
  /** Milliseconds a new connection may take to open; default 10000. */
  readonly connectionTimeoutMs?: number;
  /** Called with the payload of every `kw_events` notification. */
  onNotification(payload: string): void;
  /** Milliseconds before a lost connection is opened again; default 1000. */
  readonly retryMs?: number;
}

/** The open `LISTEN` connection. */
export interface ListenConnection {
  close(): Promise<void>;
}

/**
 * The dedicated `LISTEN kw_events` session of 14.3.7 (a direct connection or a session-mode
 * pooler, never a transaction-mode pooler). A lost connection is opened again after a pause;
 * wake-ups sent meanwhile are recovered by polling the heads, so the gap costs latency only. A
 * first attempt that fails is logged and retried the same way.
 */
export async function openListenConnection(
  settings: ListenConnectionSettings,
): Promise<ListenConnection> {
  const retryMs = settings.retryMs ?? 1000;
  let closed = false;
  let current: pg.Client | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const lost = (error: unknown): void => {
    settings.log.warn('postgres listener: the connection was lost', {
      message: error instanceof Error ? error.message : String(error),
    });
    const dead = current;
    current = undefined;
    dead?.end().catch(() => undefined);
    if (closed || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      void attempt();
    }, retryMs);
  };

  const attempt = async (): Promise<void> => {
    if (closed) return;
    const client = new pg.Client({
      connectionString: settings.url,
      // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
      application_name: `${settings.applicationName}-listen`,
      connectionTimeoutMillis: settings.connectionTimeoutMs ?? 10_000,
      keepAlive: true,
    });
    client.on('error', lost);
    client.on('end', () => {
      if (current === client) lost(new Error('the connection ended'));
    });
    client.on('notification', (message) => {
      if (message.channel === 'kw_events') settings.onNotification(message.payload ?? '');
    });
    current = client;
    try {
      await client.connect();
      await client.query('listen kw_events');
    } catch (error) {
      if (current === client) lost(error);
    }
  };

  await attempt();
  return {
    close: async () => {
      closed = true;
      if (retry !== undefined) clearTimeout(retry);
      retry = undefined;
      const client = current;
      current = undefined;
      await client?.end().catch(() => undefined);
    },
  };
}
