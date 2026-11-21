import type { WebSocketHandler } from '@keelwerk/core';
import { WebSocket } from 'ws';
import type { HttpHostDeps, HttpHostOptions } from '../../src/index.ts';
import { createFakeInvoker } from './fake-invoker.ts';
import { useHosts } from './use-hosts.ts';

/** The subprotocol the sockets of these tests negotiate. */
export const protocol = 'graphql-transport-ws';
export const liveCarrier: NonNullable<HttpHostDeps['liveCarrier']> = () => ({
  name: 'websocket',
  serve: async () => undefined,
});

/** A host with `handler` registered at `/chat`, listening on a port; call it once per test file, at the top. */
export function registeredSocketKit() {
  const { setup } = useHosts();
  return {
    setup,
    async start(
      handler: WebSocketHandler,
      options: HttpHostOptions = {},
      invoker = createFakeInvoker(),
    ) {
      const made = setup({ listen: { port: 0 }, ...options }, invoker, { liveCarrier });
      made.host.upgrade(
        { app: 'library', transport: 'chat', path: '/chat', protocols: [protocol] },
        handler,
      );
      const { port } = await made.host.listen();
      return { ...made, port: port ?? 0 };
    },
  };
}

/** A connected ws client of the registered path. */
export interface RegisteredSocketClient {
  readonly socket: WebSocket;
  readonly texts: string[];
  next(): Promise<string>;
  readonly closed: Promise<number>;
}

/** Connects a ws client to the registered path; the refusal's status when the upgrade is refused. */
export function connectRegisteredSocket(
  port: number,
): Promise<RegisteredSocketClient | { readonly status: number }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/chat`, [protocol], {
      headers: { host: 'x.example' },
    });
    const texts: string[] = [];
    const waiting: ((text: string) => void)[] = [];
    const closed = new Promise<number>((done) => socket.once('close', (code) => done(code)));
    socket.on('message', (data) => {
      const text = String(data);
      const next = waiting.shift();
      if (next === undefined) texts.push(text);
      else next(text);
    });
    socket.once('open', () =>
      resolve({
        socket,
        texts,
        closed,
        next: () => {
          const text = texts.shift();
          return text === undefined
            ? new Promise<string>((arrived) => waiting.push(arrived))
            : Promise.resolve(text);
        },
      }),
    );
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve({ status: response.statusCode ?? 0 });
    });
    socket.once('error', reject);
  });
}

/** The client, or an error naming the status that refused the upgrade. */
export function opened(
  client: RegisteredSocketClient | { readonly status: number },
): RegisteredSocketClient {
  if (!('socket' in client)) throw new Error(`the upgrade was refused with ${client.status}`);
  return client;
}
