import type { Socket } from 'node:net';
import { createConnection, createServer } from 'node:net';

const forward = (from: Socket, to: Socket, delayMs: number): void => {
  // Equal delays fire in insertion order, so the byte stream keeps its order.
  from.on('data', (chunk) => setTimeout(() => to.write(chunk), delayMs));
  from.on('end', () => setTimeout(() => to.end(), delayMs));
  from.on('error', () => to.destroy());
};

/**
 * A TCP proxy that delays every chunk by `delayMs` in each direction, to approximate a database in
 * another availability zone. Node timers have millisecond resolution, so the added round trip is
 * measured rather than assumed.
 */
export async function startDelayProxy(
  target: { readonly host: string; readonly port: number },
  delayMs: number,
): Promise<{ readonly port: number; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = createConnection(target.port, target.host);
    for (const socket of [client, upstream]) {
      socket.setNoDelay(true);
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    }
    forward(client, upstream, delayMs);
    forward(upstream, client, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('proxy has no port');
  return {
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
