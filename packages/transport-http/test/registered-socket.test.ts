import type { KeelwerkError, SocketSession, WebSocketHandler } from '@keelwerk/core';
import { closeCodeOfError, coreError } from '@keelwerk/core/http';
import { describe, expect, test, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { HttpHostDeps, HttpHostOptions } from '../src/index.ts';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSession } from './support/fake-session.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();
const protocol = 'graphql-transport-ws';
const liveCarrier: NonNullable<HttpHostDeps['liveCarrier']> = () => ({
  name: 'websocket',
  serve: async () => undefined,
});

async function start(
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
}

interface Client {
  readonly socket: WebSocket;
  readonly texts: string[];
  next(): Promise<string>;
  readonly closed: Promise<number>;
}

/** Connects a ws client to the registered path; the refusal's status when the upgrade is refused. */
function connect(port: number): Promise<Client | { readonly status: number }> {
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

function opened(client: Client | { readonly status: number }): Client {
  if (!('socket' in client)) throw new Error(`the upgrade was refused with ${client.status}`);
  return client;
}

describe('a transport socket on the host', () => {
  test('a refusing handler is answered before the handshake', async () => {
    let calls = 0;
    const { port } = await start({
      refuse: () => coreError('core.not_found', { message: 'There is no such endpoint.' }),
      open: () => {
        calls += 1;
      },
    });
    expect(await connect(port)).toEqual({ status: 404 });
    expect(calls).toBe(0);
  });

  test('the web socket delivers messages and one close event, and refuses binary sends', async () => {
    const closes: CloseEvent[] = [];
    const { port } = await start({
      open(socket) {
        socket.addEventListener('message', (event) => {
          socket.send(`echo:${String(event.data)}`);
        });
        socket.addEventListener('close', (event) => closes.push(event));
        try {
          socket.send(new Uint8Array(1));
        } catch (failure) {
          socket.send(`binary:${failure instanceof TypeError}`);
        }
      },
    });
    const client = opened(await connect(port));
    expect(await client.next()).toBe('binary:true');
    client.socket.send('a');
    client.socket.send('b');
    expect(await client.next()).toBe('echo:a');
    expect(await client.next()).toBe('echo:b');
    client.socket.close(1000);
    await client.closed;
    await vi.waitFor(() => expect(closes).toHaveLength(1));
    expect(closes.map((event) => event.code)).toEqual([1000]);
  });

  test('a refused open closes with the code of its kind', async () => {
    const refusal: KeelwerkError = coreError('core.unauthenticated');
    const answered: boolean[] = [];
    const { port } = await start(
      {
        open(_socket, _ctx, connection) {
          void connection.open({ token: 'bad' }).then((outcome) => answered.push(outcome.ok));
        },
      },
      {},
      createFakeInvoker({
        open: (carrier) =>
          carrier.token === 'bad'
            ? { ok: false, error: refusal }
            : { ok: true, value: fakeSession() },
      }),
    );
    const client = opened(await connect(port));
    expect(await client.closed).toBe(closeCodeOfError(refusal.kind));
    expect(answered).toEqual([false]);
  });

  test('a second subscription id is malformed and one past the cap is quota_exceeded', async () => {
    const { port } = await start(
      {
        open(socket, _ctx, connection: SocketSession) {
          const ready = connection.open({});
          socket.addEventListener('message', async (event) => {
            const id = String(event.data);
            try {
              await ready;
              connection.subscription(id);
              socket.send(`${id}:ok`);
            } catch (failure) {
              socket.send(`${id}:${(failure as KeelwerkError).code}`);
            }
          });
        },
      },
      { liveSocket: { maxSubscriptionsPerSocket: 2 } },
    );
    const client = opened(await connect(port));
    for (const [id, answer] of [
      ['a', 'a:ok'],
      ['a', 'a:core.malformed_request'],
      ['b', 'b:ok'],
      ['c', 'c:core.quota_exceeded'],
    ] as const) {
      client.socket.send(id);
      expect(await client.next()).toBe(answer);
    }
  });

  test('a subscription before the open resolved, or after it was refused, is a TypeError and takes no slot', async () => {
    const answers: string[] = [];
    const { port } = await start(
      {
        open(socket, _ctx, connection: SocketSession) {
          const attempt = (label: string): void => {
            try {
              connection.subscription(label);
              answers.push(`${label}:taken`);
              socket.send(`${label}:taken`);
            } catch (failure) {
              answers.push(`${label}:${failure instanceof TypeError ? 'TypeError' : 'other'}`);
            }
          };
          void connection.open({ token: 'bad' }).then((outcome) => {
            answers.push(`open:${outcome.ok}`);
            attempt('after-refusal');
          });
          attempt('before-open');
        },
      },
      {},
      createFakeInvoker({
        open: (carrier) =>
          carrier.token === 'bad'
            ? { ok: false, error: coreError('core.unauthenticated') }
            : { ok: true, value: fakeSession() },
      }),
    );
    const client = opened(await connect(port));
    await client.closed;
    expect(answers).toEqual(['before-open:TypeError', 'open:false', 'after-refusal:TypeError']);
  });

  test('a session the first message opens meets the registration again: its refuse and its app', async () => {
    // Take the `registrationRefusal` call out of socket-session-of.ts: both sockets get their ack.
    const invoker = createFakeInvoker({
      open: (carrier) => {
        if (carrier.token === 'off') {
          return {
            ok: true,
            value: fakeSession({ scope: { level: 'tenant', backendId: 'off', tenantId: 't2' } }),
          };
        }
        if (carrier.token === 'other') return { ok: true, value: fakeSession({ app: 'other' }) };
        return { ok: true, value: fakeSession() };
      },
    });
    const answers: { token: string; ok: boolean; code?: string }[] = [];
    const { port } = await start(
      {
        refuse: (ctx) =>
          ctx.session.scope.level === 'tenant' && ctx.session.scope.backendId === 'off'
            ? coreError('core.not_found', { message: 'There is no such endpoint.' })
            : undefined,
        open(socket, _ctx, connection) {
          socket.addEventListener('message', async (event) => {
            const token = String(event.data);
            const outcome = await connection.open({ token });
            answers.push(
              outcome.ok ? { token, ok: true } : { token, ok: false, code: outcome.error.code },
            );
          });
        },
      },
      {},
      invoker,
    );
    for (const [token, ok, closeCode] of [
      ['fine', true, undefined],
      ['off', false, closeCodeOfError('not_found')],
      ['other', false, closeCodeOfError('not_found')],
    ] as const) {
      const client = opened(await connect(port));
      client.socket.send(token);
      if (ok) {
        await vi.waitFor(() => expect(answers.at(-1)).toEqual({ token, ok: true }));
        client.socket.close(1000);
      } else {
        expect(await client.closed).toBe(closeCode);
        expect(answers.at(-1)).toEqual({ token, ok: false, code: 'core.not_found' });
      }
    }
  });

  test('stop closes the socket 1001', async () => {
    const { port, host } = await start({ open: () => undefined });
    const client = opened(await connect(port));
    void host.stop(100);
    expect(await client.closed).toBe(1001);
  });
});
