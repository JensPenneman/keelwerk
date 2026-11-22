import type { KeelwerkError, SocketSession } from '@keelwerk/core';
import { closeCodeOfError, coreError } from '@keelwerk/core/http';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSession } from './support/fake-session.ts';
import {
  connectRegisteredSocket,
  liveCarrier,
  opened,
  protocol,
  registeredSocketKit,
} from './support/registered-socket-kit.ts';

const { setup, start } = registeredSocketKit();

describe('a transport socket on the host', () => {
  test('a refusing handler is answered before the handshake', async () => {
    let calls = 0;
    const { port } = await start({
      refuse: () => coreError('core.not_found', { message: 'There is no such endpoint.' }),
      open: () => {
        calls += 1;
      },
    });
    expect(await connectRegisteredSocket(port)).toEqual({ status: 404 });
    expect(calls).toBe(0);
  });

  test('a route under the socket path counts its predicate once and a throwing one refuses the upgrade', async () => {
    const calls: string[] = [];
    let opens = 0;
    const made = setup({ listen: { port: 0 } }, createFakeInvoker(), { liveCarrier });
    made.host.upgrade(
      { app: 'library', transport: 'chat', path: '/chat', protocols: [protocol] },
      {
        open: () => {
          opens += 1;
        },
      },
    );
    made.host.route(
      {
        app: 'library',
        transport: 'trpc-test',
        prefix: '/chat',
        streams: (request) => {
          calls.push(request.method);
          throw new Error('predicate failed');
        },
      },
      async () => Response.json({}),
    );
    const { port } = await made.host.listen();
    expect(await connectRegisteredSocket(port ?? 0)).toEqual({ status: 500 });
    expect(calls).toEqual(['GET']);
    expect(opens).toBe(0);
  });

  test('the web socket delivers messages and one close event, and refuses binary sends', async () => {
    const closes: CloseEvent[] = [];
    const closed = Promise.withResolvers<CloseEvent>();
    const { port } = await start({
      open(socket) {
        socket.addEventListener('message', (event) => {
          socket.send(`echo:${String(event.data)}`);
        });
        socket.addEventListener('close', (event) => {
          closes.push(event);
          closed.resolve(event);
        });
        try {
          socket.send(new Uint8Array(1));
        } catch (failure) {
          socket.send(`binary:${failure instanceof TypeError}`);
        }
      },
    });
    const client = opened(await connectRegisteredSocket(port));
    expect(await client.next()).toBe('binary:true');
    client.socket.send('a');
    client.socket.send('b');
    expect(await client.next()).toBe('echo:a');
    expect(await client.next()).toBe('echo:b');
    client.socket.close(1000);
    await client.closed;
    // The host's side of the socket reports its close in its own turn: the signal is the event it hands over.
    // The length below shows that no second event came in the same run of dispatching as the first; that
    // one event is all that is dispatched rests on web-socket-of.ts, which dispatches from a single promise
    // reaction. A later duplicate is not what this length shows, and nothing here sleeps for one.
    await closed.promise;
    expect(closes).toHaveLength(1);
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
    const client = opened(await connectRegisteredSocket(port));
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
    const client = opened(await connectRegisteredSocket(port));
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
    const client = opened(await connectRegisteredSocket(port));
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
      const client = opened(await connectRegisteredSocket(port));
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

  test("the session the host hands to a handler states the host's message bound: liveSocket.maxMessageBytes", async () => {
    // Set `maxMessageBytes` in socket-session-of.ts to Infinity: the value the handler reads is not the setting.
    const seen = Promise.withResolvers<number>();
    const { port } = await start(
      { open: (_socket, _ctx, connection) => seen.resolve(connection.maxMessageBytes) },
      { liveSocket: { maxMessageBytes: 4_321 } },
    );
    const client = opened(await connectRegisteredSocket(port));
    onTestFinished(() => client.socket.close(1000));
    // The handler's open settles the promise: nothing in the background decides it. The host is stopped by the file's afterEach.
    expect(await seen.promise).toBe(4_321);
  });

  test('stop closes the socket 1001', async () => {
    const { port, host } = await start({ open: () => undefined });
    const client = opened(await connectRegisteredSocket(port));
    void host.stop(100);
    expect(await client.closed).toBe(1001);
  });
});
