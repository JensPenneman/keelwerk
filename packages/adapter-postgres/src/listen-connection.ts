import type { Logger } from '@keelwerk/core';
import pg from 'pg';

/** What `openListenConnection` needs. */
export interface ListenConnectionSettings {
  readonly url: string;
  readonly applicationName: string;
  readonly log: Logger;
  /** Milliseconds a new connection may take to open; default 10000. */
  readonly connectionTimeoutMs?: number;
  /** The channel the session listens on, a lower-case identifier; default `kw_events`. */
  readonly channel?: string;
  /** Called with the payload of every notification of `channel`. */
  onNotification(payload: string): void;
  /** Called each time `LISTEN` succeeded, on the first attempt and on every reopen. */
  onListening?(): void;
  /** Called each time a connection is lost or an attempt fails, before the reopen is scheduled. */
  onLost?(error: unknown): void;
  /** Milliseconds before a lost connection is opened again; default 1000. */
  readonly retryMs?: number;
  /**
   * A session that only reads notices a peer that vanished without a reset (a lost host, a dropped
   * NAT or balancer entry) only through the heartbeat: every `intervalMs` the session runs
   * `select 1`, and a query that fails or takes longer than `timeoutMs` counts as a lost connection.
   */
  readonly heartbeat?: { readonly intervalMs: number; readonly timeoutMs: number };
}

/** The open `LISTEN` connection. */
export interface ListenConnection {
  close(): Promise<void>;
}

/**
 * The dedicated `LISTEN` session of 14.3.7 on `channel` (default `kw_events`), a direct connection
 * or a session-mode pooler, never a transaction-mode pooler. A lost connection is opened again after
 * a pause. On `kw_events`, wake-ups sent meanwhile are recovered by polling the heads, so the gap
 * costs latency only; other callers learn of the gap through `onLost`.
 * A first attempt that fails is logged and retried the same way.
 */
export async function openListenConnection(
  settings: ListenConnectionSettings,
): Promise<ListenConnection> {
  const channel = settings.channel ?? 'kw_events';
  if (!/^[a-z_][a-z0-9_]*$/.test(channel))
    throw new TypeError('a listen channel is a lower-case identifier');
  const retryMs = settings.retryMs ?? 1000;
  let closed = false;
  let current: pg.Client | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;

  const stopBeat = (): void => {
    if (beat !== undefined) clearInterval(beat);
    beat = undefined;
  };

  const lost = (error: unknown): void => {
    settings.log.warn('postgres listener: the connection was lost', {
      message: error instanceof Error ? error.message : String(error),
    });
    stopBeat();
    const dead = current;
    current = undefined;
    dead?.end().catch(() => undefined);
    if (!closed) settings.onLost?.(error);
    if (closed || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      void attempt();
    }, retryMs);
  };

  const startBeat = (client: pg.Client): void => {
    const heartbeat = settings.heartbeat;
    if (heartbeat === undefined || current !== client) return;
    let running = false;
    beat = setInterval(() => {
      if (running) return;
      running = true;
      client
        .query('select 1')
        .then(
          () => undefined,
          (error: unknown) => {
            if (current === client) lost(error);
          },
        )
        .finally(() => {
          running = false;
        });
    }, heartbeat.intervalMs);
  };

  const attempt = async (): Promise<void> => {
    if (closed) return;
    const client = new pg.Client({
      connectionString: settings.url,
      // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
      application_name: `${settings.applicationName}-listen`,
      connectionTimeoutMillis: settings.connectionTimeoutMs ?? 10_000,
      keepAlive: true,
      // The system default of two hours before the first probe is too long for a session that never writes.
      keepAliveInitialDelayMillis: 10_000,
      // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
      ...(settings.heartbeat === undefined ? {} : { query_timeout: settings.heartbeat.timeoutMs }),
    });
    client.on('error', lost);
    client.on('end', () => {
      if (current === client) lost(new Error('the connection ended'));
    });
    client.on('notification', (message) => {
      if (message.channel === channel) settings.onNotification(message.payload ?? '');
    });
    current = client;
    try {
      await client.connect();
      await client.query(`listen ${channel}`);
      if (current === client) {
        settings.onListening?.();
        startBeat(client);
      }
    } catch (error) {
      if (current === client) lost(error);
    }
  };

  await attempt();
  return {
    close: async () => {
      closed = true;
      stopBeat();
      if (retry !== undefined) clearTimeout(retry);
      retry = undefined;
      const client = current;
      current = undefined;
      await client?.end().catch(() => undefined);
    },
  };
}
