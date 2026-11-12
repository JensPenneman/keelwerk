import type { LiveServerMessage } from '@keelwerk/core';
import type { WebSocket as WsSocket } from 'ws';

/** A client of `keelwerk.live.v1` that keeps every message it receives. */
export interface LiveSocketClient {
  readonly socket: WsSocket;
  send(message: unknown): void;
  /** The next server message parsed; rejects after `ms` (default 10,000). */
  next(ms?: number): Promise<LiveServerMessage>;
  /** Reads messages until one passes `test`; answers all of them up to and including it. */
  until(
    test: (message: LiveServerMessage) => boolean,
    ms?: number,
  ): Promise<readonly LiveServerMessage[]>;
  /** The close code and reason once the socket closed. */
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>;
  close(): Promise<void>;
}

/** Wraps an open ws client: messages are queued from the moment of the call, so none is missed. */
export function liveSocketClient(socket: WsSocket): LiveSocketClient {
  const queue: LiveServerMessage[] = [];
  let waiting: (() => void) | undefined;
  socket.on('message', (data) => {
    queue.push(JSON.parse(String(data)) as LiveServerMessage);
    waiting?.();
  });
  const closed = new Promise<{ readonly code: number; readonly reason: string }>((resolve) => {
    socket.on('close', (code, reason) => {
      resolve({ code, reason: reason.toString('utf8') });
      waiting?.();
    });
  });
  const next = async (ms = 10_000): Promise<LiveServerMessage> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const message = queue.shift();
      if (message !== undefined) return message;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('no message from the server in time');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        waiting = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  };
  return {
    socket,
    send: (message) => socket.send(typeof message === 'string' ? message : JSON.stringify(message)),
    next,
    until: async (test, ms = 10_000) => {
      const seen: LiveServerMessage[] = [];
      for (;;) {
        const message = await next(ms);
        seen.push(message);
        if (test(message)) return seen;
      }
    },
    closed,
    close: async () => {
      if (socket.readyState !== socket.CLOSED) socket.close();
      await closed;
    },
  };
}
