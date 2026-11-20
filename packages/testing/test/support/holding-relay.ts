import type { AddressInfo } from 'node:net';
import { createServer, Socket } from 'node:net';

/** What the relay keeps back on one held connection: the server's bytes, and whether it ended or reset. */
interface Kept {
  chunks: Uint8Array[];
  bytes: number;
  ended: boolean;
  /** The client side of the connection, and how many bytes it had written when the hold began. */
  client: Socket;
  writtenBefore: number;
}

/** A relay between a client and the test database that can keep back what the server says. */
export interface HoldingRelay {
  /** The given url, pointed at the relay. */
  readonly url: string;
  /**
   * On every connection open now, keeps back what the server sends, its end included, until the
   * client next writes there, then delivers it in order. Connections opened later are not held. Call
   * it only while no statement waits for its answer. A reset of the server counts as its end.
   */
  hold(): void;
  /** Resolves once the connections held by the last `hold()` have kept at least `bytes` bytes of what the server sent. */
  whenKept(bytes: number): Promise<void>;
  /** Resolves once every connection held by the last `hold()` has seen the server end or reset it. After an end everything the server sent is kept; after a reset only what the relay had read. */
  whenServerEnded(): Promise<void>;
  /** What the relay has written to the client side of the held connections since the last `hold()`, and whether it has ended any of them. Read at once, with no waiting. */
  delivered(): { bytes: number; ended: boolean };
  /** Ends every connection and stops listening. */
  close(): Promise<void>;
}

/** Relays the connections of `url` through a local port; bytes pass both ways unchanged. */
export async function startHoldingRelay(url: string): Promise<HoldingRelay> {
  const target = new URL(url);
  const sockets = new Set<Socket>();
  const holds = new Set<() => Kept>();
  let held: Kept[] = [];
  const waiters = new Set<() => void>();
  const notify = (): void => {
    for (const waiter of waiters) waiter();
  };
  const until = (condition: () => boolean): Promise<void> =>
    new Promise((resolve) => {
      const check = (): void => {
        if (!condition()) return;
        waiters.delete(check);
        resolve();
      };
      waiters.add(check);
      check();
    });
  const server = createServer((client) => {
    // Half open: when the server ends, the end is the relay's to pass on (or keep back), not Node's to answer.
    const upstream = new Socket({ allowHalfOpen: true });
    sockets.add(client).add(upstream);
    let kept: Kept | undefined;
    const release = (): void => {
      if (kept === undefined) return;
      const { chunks, ended } = kept;
      kept = undefined;
      for (const chunk of chunks) client.write(chunk);
      if (ended) client.end();
    };
    holds.add(() => {
      kept = { chunks: [], bytes: 0, ended: false, client, writtenBefore: client.bytesWritten };
      return kept;
    });
    upstream.on('data', (chunk: Uint8Array) => {
      if (kept === undefined) {
        client.write(chunk);
        return;
      }
      kept.chunks.push(chunk);
      kept.bytes += chunk.length;
      notify();
    });
    upstream.on('end', () => {
      if (kept === undefined) {
        client.end();
        return;
      }
      kept.ended = true;
      notify();
    });
    client.on('data', (chunk: Uint8Array) => {
      upstream.write(chunk);
      release();
    });
    client.on('end', () => upstream.end());
    for (const socket of [client, upstream]) {
      socket.on('error', () => undefined);
    }
    client.on('close', () => upstream.destroy());
    // What is kept back still has to reach the client: release() delivers it and ends the client, also
    // when the upstream was reset and never sent an end.
    upstream.on('close', () => {
      if (kept === undefined) {
        client.destroy();
        return;
      }
      kept.ended = true;
      notify();
    });
    upstream.connect(Number(target.port), target.hostname);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const relayed = new URL(url);
  relayed.hostname = '127.0.0.1';
  relayed.port = String(port);
  return {
    url: relayed.toString(),
    hold: () => {
      held = [...holds].map((hold) => hold());
      holds.clear();
    },
    whenKept: (bytes) => until(() => held.reduce((sum, kept) => sum + kept.bytes, 0) >= bytes),
    whenServerEnded: () => until(() => held.every((kept) => kept.ended)),
    delivered: () => ({
      bytes: held.reduce(
        (sum, { client, writtenBefore }) => sum + client.bytesWritten - writtenBefore,
        0,
      ),
      ended: held.some(({ client }) => client.writableEnded),
    }),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
