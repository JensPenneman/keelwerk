import type { TrpcWsBridge, TrpcWsClient } from './trpc-ws-bridge.ts';

const open = 1;

/** What a socket may hold before tRPC listens, as a multiple of the smaller of the backend's body limit and the host's message bound. */
const queueFactor = 4;

/**
 * The host's web socket as the `ws` client tRPC's connection handler works with. The one `message`
 * listener is added at once, since the host starts reading with the first listener (and reads on, so
 * the host's own pause no longer holds the client back): a text queues until `first` takes the first
 * one, then until `attach` hands the rest to tRPC's listeners, in order, as UTF-8 buffers. What the
 * queue holds is bounded in bytes, four times the smaller of the backend's body limit and `hostMaxBytes`,
 * the largest message the host takes (more closes 4429 `core.quota_exceeded`), so a body limit above
 * the host's bound does not raise what a socket holds. A text of more than `maxBytes()` bytes (the backend's body limit, counted in
 * bytes and strictly more, as over HTTP), measured when it is handed over, so with the limit of the
 * session that was opened, is dropped and the socket closes 4400 `core.payload_too_large`. `close`
 * listeners run once, on the socket's close event. `error` is never emitted. `send` writes only while
 * the socket is open, and `client.close()` closes it 1000.
 */
export function trpcWsBridgeOf(
  socket: WebSocket,
  maxBytes: () => number,
  hostMaxBytes: number = Number.POSITIVE_INFINITY,
): TrpcWsBridge {
  const queued: { readonly text: string; readonly bytes: number }[] = [];
  const listeners: ((data: Buffer, isBinary: boolean) => void)[] = [];
  const closers: (() => void)[] = [];
  let queuedBytes = 0;
  let attached = false;
  let closed = false;
  let ended = false;
  let waiting: ((text: string | undefined) => void) | undefined;
  const end = (code: number, reason: string): void => {
    ended = true;
    queued.length = 0;
    queuedBytes = 0;
    socket.close(code, reason);
  };
  /** Whether a text of `bytes` bytes is over the limit, which closes the socket: strictly more, as `readBoundedBody` refuses a body. */
  const refused = (bytes: number): boolean => {
    if (bytes <= maxBytes()) return false;
    end(4400, 'core.payload_too_large');
    return true;
  };
  const give = (text: string): void => {
    for (const listener of listeners) listener(Buffer.from(text, 'utf8'), false);
  };
  socket.addEventListener('message', (event) => {
    if (ended || !(event instanceof MessageEvent) || typeof event.data !== 'string') return;
    const text = event.data;
    const bytes = Buffer.byteLength(text, 'utf8');
    if (attached) {
      if (!refused(bytes)) give(text);
      return;
    }
    if (waiting !== undefined) {
      const resolve = waiting;
      waiting = undefined;
      resolve(refused(bytes) ? undefined : text);
      return;
    }
    if (queuedBytes + bytes > queueFactor * Math.min(maxBytes(), hostMaxBytes)) {
      end(4429, 'core.quota_exceeded');
      return;
    }
    queued.push({ text, bytes });
    queuedBytes += bytes;
  });
  socket.addEventListener('close', () => {
    closed = true;
    waiting?.(undefined);
    waiting = undefined;
    for (const close of closers.splice(0)) close();
  });
  const client: TrpcWsClient = {
    get readyState(): number {
      return socket.readyState;
    },
    send: (data) => {
      if (socket.readyState === open) socket.send(data);
    },
    close: () => {
      socket.close(1000);
    },
    on: ((event: 'message' | 'error', listener: (...held: never[]) => void) => {
      if (event === 'message')
        listeners.push(listener as (data: Buffer, isBinary: boolean) => void);
    }) as TrpcWsClient['on'],
    once: (_event, listener) => {
      if (closed) listener();
      else closers.push(listener);
    },
  };
  return {
    client,
    first: () => {
      const head = queued.shift();
      if (head !== undefined) {
        queuedBytes -= head.bytes;
        return Promise.resolve(refused(head.bytes) ? undefined : head.text);
      }
      if (closed || ended) return Promise.resolve(undefined);
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    attach: () => {
      attached = true;
      queuedBytes = 0;
      for (const { text, bytes } of queued.splice(0)) {
        if (ended) return;
        if (refused(bytes)) return;
        give(text);
      }
    },
  };
}
