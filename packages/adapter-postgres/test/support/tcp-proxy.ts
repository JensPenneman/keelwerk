import { createServer, Socket } from 'node:net';

/** A proxy to the test database. */
export interface TcpProxy {
  readonly url: string;
  /** Keeps every open connection but forwards nothing on it any more, in either direction. */
  cut(): void;
  close(): Promise<void>;
}

/** A TCP proxy to the test database; `cut` makes the open connections half open, as a lost host or a dropped NAT entry does. */
export async function tcpProxy(target: string): Promise<TcpProxy> {
  const to = new URL(target);
  const sockets = new Set<Socket>();
  let cut = false;
  const server = createServer((client) => {
    const upstream = new Socket();
    sockets.add(client).add(upstream);
    const relay = (from: Socket, towards: Socket): void => {
      from.on('data', (chunk: Uint8Array) => {
        if (!cut) towards.write(chunk);
      });
      from.on('error', () => undefined);
      from.on('close', () => {
        if (!cut) towards.destroy();
      });
    };
    upstream.connect(Number(to.port), to.hostname);
    relay(client, upstream);
    relay(upstream, client);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the proxy has no port');
  const through = new URL(target);
  through.hostname = '127.0.0.1';
  through.port = String(address.port);
  return {
    url: through.href,
    cut: () => {
      cut = true;
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
