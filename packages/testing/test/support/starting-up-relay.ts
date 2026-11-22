import type { AddressInfo } from 'node:net';
import { createServer, Socket } from 'node:net';

/** What a PostgreSQL server that is still starting up answers to a client's first message. */
function startingUpError(): Buffer {
  const text = (code: string, value: string): Buffer => Buffer.from(`${code}${value}\0`);
  const fields = Buffer.concat([
    text('S', 'FATAL'),
    text('V', 'FATAL'),
    text('C', '57P03'),
    text('M', 'the database system is starting up'),
    Buffer.from([0]),
  ]);
  const header = Buffer.alloc(5);
  header.write('E');
  header.writeInt32BE(fields.length + 4, 1);
  return Buffer.concat([header, fields]);
}

/** A relay whose first connection is answered as by a server that is starting up. */
export interface StartingUpRelay {
  /** The given url, pointed at the relay. */
  readonly url: string;
  /**
   * Stops listening, ends the connections the relay accepted and opened, and answers once they have
   * ended.
   */
  close(): Promise<void>;
}

/**
 * Relays the connections of `url` through a local port, bytes unchanged, except the first one: it
 * is answered with SQLSTATE 57P03 and closed, as a server does while it recovers.
 */
export async function startStartingUpRelay(url: string): Promise<StartingUpRelay> {
  const target = new URL(url);
  const sockets = new Set<Socket>();
  let first = true;
  const server = createServer((client) => {
    sockets.add(client);
    client.on('error', () => undefined);
    client.on('close', () => sockets.delete(client));
    if (first) {
      first = false;
      client.once('data', () => client.end(startingUpError()));
      return;
    }
    const upstream = new Socket();
    sockets.add(upstream);
    upstream.on('error', () => undefined);
    upstream.on('close', () => sockets.delete(upstream));
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    upstream.connect(Number(target.port), target.hostname);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const relayed = new URL(url);
  relayed.hostname = '127.0.0.1';
  relayed.port = String(port);
  return {
    url: relayed.toString(),
    close: async () => {
      // No new connection once this has begun; the callback runs when the last one has ended, and
      // every one the relay holds is destroyed here, so it does.
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}
