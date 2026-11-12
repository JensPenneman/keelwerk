import { randomBytes } from 'node:crypto';
import { coreError } from '@keelwerk/core/http';
import type { RawData, WebSocket as WsSocket } from 'ws';
import type { OpenLiveSocket } from './open-live-socket.ts';
import type { WebSocketConnectionOptions } from './websocket-connection-options.ts';

/** Messages read ahead of the consumer before the socket stops reading. */
const readAhead = 16;

function gone(): Error {
  return coreError('core.unavailable', { message: 'The socket is closed.', retryable: false });
}

function bytesOf(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + part.byteLength, 0);
  return data.byteLength;
}

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8');
}

/**
 * The host's websocket `CarrierConnection` (S-155) over one `ws` socket. `send` rejects `unavailable`
 * once the socket is closing and resolves when ws flushed the message; a send left unflushed for
 * `stallMs` terminates the socket, so a client that does not read holds neither memory nor a task.
 * `receive` yields text messages in order and stops reading when the consumer falls behind, by count
 * (`readAhead`) and by bytes (one `maxMessageBytes`); a binary message closes 4000 and more than
 * `maxMessagesPerWindow` in a fixed window closes 4429, both before the message is read. A client
 * ping counts against the same window and is answered with a pong only while the socket holds no
 * more than `maxBufferedBytes` (ws's automatic pong is off: it would write however full the socket
 * is); a socket over the bound is terminated. `ping` sends a random nonce and is true only on a pong
 * that echoes it within `pongTimeoutMs`, so an unsolicited pong keeps nothing alive. The signal aborts when the
 * socket starts to close, so every subscription of it ends. Every wait is on the options' timers and
 * every listener and wait is released when the socket is gone, however it ended.
 */
export function websocketConnection(
  socket: WsSocket,
  options: WebSocketConnectionOptions,
): OpenLiveSocket {
  const everything = new AbortController();
  /** Aborted when the socket is gone: every wait of the connection hangs on it. */
  const released = new AbortController();
  const inbox: { readonly text: string; readonly bytes: number }[] = [];
  let inboxBytes = 0;
  const sends = new Set<{ readonly reject: (error: Error) => void }>();
  let wake: (() => void) | undefined;
  let pending: { readonly nonce: Buffer; readonly answer: (ok: boolean) => void } | undefined;
  let closing = false;
  let code: number | undefined;
  let ended = false;
  let paused = false;
  let windowStart = options.clock.now();
  let inWindow = 0;
  let settle: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const after = (ms: number): Temporal.Instant => options.clock.now().add({ milliseconds: ms });
  const terminate = (): void => {
    try {
      socket.terminate();
    } catch {
      // The socket is gone already.
    }
  };
  const closeWith = (code: number, reason: string): void => {
    if (closing || ended) return;
    closing = true;
    everything.abort();
    wake?.();
    // A paused socket would never read the peer's answer to the close frame.
    if (paused) {
      paused = false;
      socket.resume();
    }
    try {
      socket.close(code, reason);
    } catch {
      terminate();
      return;
    }
    // A peer that never answers the close frame is cut off once the handshake has had `stallMs`.
    void options.timers.sleepUntil(after(options.stallMs), released.signal).then((reached) => {
      if (reached) terminate();
    });
  };
  /** Counts one frame of the client against the fixed window; false once the window is full (the socket is closing 4429). */
  const admit = (): boolean => {
    const now = options.clock.now();
    if (
      Temporal.Instant.compare(now, windowStart.add({ milliseconds: options.messageWindowMs })) >= 0
    ) {
      windowStart = now;
      inWindow = 0;
    }
    inWindow += 1;
    if (inWindow > options.maxMessagesPerWindow) {
      closeWith(4429, 'rate_limited');
      return false;
    }
    return true;
  };
  const onMessage = (data: RawData, isBinary: boolean): void => {
    if (closing || ended) return;
    if (isBinary) {
      closeWith(4000, 'binary_message');
      return;
    }
    if (!admit()) return;
    const entry = { text: textOf(data), bytes: bytesOf(data) };
    inbox.push(entry);
    inboxBytes += entry.bytes;
    wake?.();
    if ((inbox.length >= readAhead || inboxBytes > options.maxMessageBytes) && !paused) {
      paused = true;
      socket.pause();
    }
  };
  const onPing = (data: Buffer): void => {
    if (closing || ended) return;
    if (!admit()) return;
    // A client that does not read holds every pong we write: past the bound it is cut off.
    if (socket.bufferedAmount > options.maxBufferedBytes) {
      terminate();
      return;
    }
    try {
      socket.pong(data);
    } catch {
      terminate();
    }
  };
  const onPong = (data: Buffer): void => {
    if (closing || ended) return;
    if (!admit()) return;
    if (pending !== undefined && data.equals(pending.nonce)) pending.answer(true);
  };
  const onClose = (received?: number): void => {
    if (ended) return;
    code = received;
    ended = true;
    closing = true;
    everything.abort();
    released.abort();
    socket.off('message', onMessage);
    socket.off('ping', onPing);
    socket.off('pong', onPong);
    socket.off('close', onClose);
    for (const send of [...sends]) send.reject(gone());
    sends.clear();
    inbox.length = 0;
    inboxBytes = 0;
    pending?.answer(false);
    wake?.();
    settle();
  };
  socket.on('message', onMessage);
  socket.on('ping', onPing);
  socket.on('pong', onPong);
  socket.on('close', onClose);
  // A socket error is followed by `close`; the listener only keeps the error from being unhandled.
  socket.on('error', () => undefined);
  if (socket.readyState === socket.CLOSED) onClose();

  async function* receive(): AsyncGenerator<string> {
    for (;;) {
      if (closing || ended) return;
      const next = inbox.shift();
      if (next !== undefined) {
        inboxBytes -= next.bytes;
        if (paused && inbox.length < readAhead / 2 && inboxBytes <= options.maxMessageBytes / 2) {
          paused = false;
          socket.resume();
        }
        yield next.text;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }

  const send = (text: string): Promise<void> => {
    if (closing || ended || socket.readyState !== socket.OPEN) return Promise.reject(gone());
    return new Promise<void>((resolve, reject) => {
      const entry = { reject };
      const cancel = new AbortController();
      sends.add(entry);
      socket.send(text, (error) => {
        cancel.abort();
        sends.delete(entry);
        // Node's write callbacks pass null on success.
        if (!error) resolve();
        else reject(gone());
      });
      if (socket.bufferedAmount > options.maxBufferedBytes) {
        terminate();
        return;
      }
      void options.timers.sleepUntil(after(options.stallMs), cancel.signal).then((reached) => {
        if (reached) terminate();
      });
    });
  };

  const ping = (): Promise<boolean> => {
    if (closing || ended || socket.readyState !== socket.OPEN) return Promise.resolve(false);
    // The heartbeat never queues behind a socket that holds more than the bound.
    if (socket.bufferedAmount > options.maxBufferedBytes) {
      terminate();
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      const cancel = new AbortController();
      const nonce = randomBytes(8);
      const answer = (ok: boolean): void => {
        if (pending === waiter) pending = undefined;
        cancel.abort();
        resolve(ok);
      };
      const waiter = { nonce, answer };
      pending = waiter;
      void options.timers
        .sleepUntil(after(options.pongTimeoutMs), cancel.signal)
        .then((reached) => {
          if (reached) answer(false);
        });
      try {
        socket.ping(nonce);
      } catch {
        answer(false);
      }
    });
  };

  return {
    connection: {
      kind: 'websocket',
      send,
      receive,
      ping,
      bufferedBytes: () => socket.bufferedAmount,
      signal: everything.signal,
      close: (code, reason) => {
        closeWith(code, reason);
        return Promise.resolve();
      },
    },
    closeWith,
    terminate,
    goAway: () => closeWith(1001, 'going_away'),
    closeCode: () => code,
    closed,
  };
}
