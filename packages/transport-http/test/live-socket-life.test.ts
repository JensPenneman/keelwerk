import type { InvocationSession, LiveFrame } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { type LoggedLine, recordingLogger } from '@keelwerk/testing';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { libraryActions } from './support/library-actions.ts';
import type { LiveSocketClient } from './support/live-socket-client.ts';
import { quietHub } from './support/quiet-hub.ts';
import { type SocketHost, type SocketHostOptions, socketHost } from './support/socket-host.ts';
import { userSession } from './support/user-session.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const hosts: SocketHost[] = [];
const clients: LiveSocketClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

type Subscribe = Parameters<typeof socketHost>[0];

async function started(subscribe: Subscribe, options: SocketHostOptions = {}) {
  const made = await socketHost(subscribe, { session: userSession('ada'), ...options });
  hosts.push(made);
  return made;
}

async function helloed(made: SocketHost, hello: Record<string, unknown> = {}) {
  const client = await made.connect();
  if (!('socket' in client)) throw new Error(`refused with ${client.status}`);
  clients.push(client);
  client.send({ type: 'hello', ...hello });
  expect(await client.next()).toMatchObject({ type: 'welcome' });
  return client;
}

const subscribe = (client: LiveSocketClient, id: string, extra: Record<string, unknown> = {}) =>
  client.send({ type: 'subscribe', id, action: 'loans.loanEvents', input: {}, ...extra });

/** A session whose checks answer from `state`: revoked, or still good with the expiry given. */
function revocable(state: { revoked: boolean; checks: number }, expiresAt?: Temporal.Instant) {
  const session: InvocationSession = userSession('ada', {
    ...(expiresAt === undefined ? {} : { expiresAt }),
    revalidate: async () => {
      state.checks += 1;
      return state.revoked
        ? { ok: false, error: coreError('core.unauthenticated') }
        : { ok: true, value: session };
    },
  });
  return session;
}

describe('the life of a socket', () => {
  test('stop closes every socket with 1001 and ends every subscription', async () => {
    const state = { open: 0 };
    const made = await started(quietHub(state));
    const first = await helloed(made);
    const second = await helloed(made);
    subscribe(first, 'a');
    subscribe(second, 'b');
    await vi.waitFor(() => expect(state.open).toBe(2));
    await made.host.stop(1000);
    expect(await first.closed).toMatchObject({ code: 1001 });
    expect(await second.closed).toMatchObject({ code: 1001 });
    expect(state.open).toBe(0);
  });

  test('a revoked session closes the socket with 4401 within revalidateMs; a subscription failing unauthenticated closes it at once', async () => {
    const state = { revoked: false, checks: 0 };
    const made = await started(quietHub({ open: 0 }), { session: revocable(state) });
    const client = await helloed(made);
    state.revoked = true;
    await made.at(59_999);
    expect(state.checks).toBe(0);
    await made.at(60_000);
    expect(await client.next()).toMatchObject({
      type: 'error',
      error: { kind: 'unauthenticated' },
    });
    expect(await client.closed).toMatchObject({ code: 4401 });

    const quick = { revoked: false, checks: 0 };
    const failing = await started(
      (): AsyncIterable<LiveFrame<unknown>> => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            quick.revoked = true;
            throw coreError('core.unauthenticated');
          },
        }),
      }),
      { session: revocable(quick) },
    );
    const second = await helloed(failing);
    subscribe(second, 'x');
    expect(await second.closed).toMatchObject({ code: 4401 });
    expect(quick.checks).toBeGreaterThanOrEqual(1);
  });

  test('a session past expiresAt is checked before the next invoke', async () => {
    const state = { revoked: false, checks: 0 };
    const past = Temporal.Instant.from('2026-11-11T11:59:00Z');
    const made = await started(quietHub({ open: 0 }), {
      session: revocable(state, past),
      actions: libraryActions,
    });
    const client = await helloed(made);
    expect(state.checks).toBe(0);
    client.send({ type: 'invoke', id: 'i', request: { action: 'library.echo', input: 1 } });
    expect(await client.next()).toMatchObject({ type: 'result', id: 'i', response: { ok: true } });
    expect(state.checks).toBe(1);
  });

  test('a session past expiresAt whose check fails gets no invoke, and a queued command after a 4401 close does not run', async () => {
    const state = { revoked: true, checks: 0 };
    const past = Temporal.Instant.from('2026-11-11T11:59:00Z');
    const made = await started(quietHub({ open: 0 }), {
      session: revocable(state, past),
      actions: libraryActions,
    });
    const client = await helloed(made);
    for (const id of ['i1', 'i2', 'i3']) {
      client.send({ type: 'invoke', id, request: { action: 'library.echo', input: 1 } });
    }
    expect(await client.closed).toMatchObject({ code: 4401 });
    expect(made.invoker.invoked).toHaveLength(0);
  });

  test('the maximum duration ends each subscription with end max_duration, then closes 1000', async () => {
    const state = { open: 0 };
    const made = await started(quietHub(state), { host: { live: { maxDurationMs: 60_000 } } });
    const client = await helloed(made);
    subscribe(client, 'a');
    subscribe(client, 'b');
    await vi.waitFor(() => expect(state.open).toBe(2));
    await made.at(60_000);
    const seen = await client
      .until((message) => message.type === 'end' && message.id === 'b')
      .catch(() => []);
    const ended = seen.filter((message) => message.type === 'end');
    expect(ended.map((message) => message.type === 'end' && message.reason)).toContain(
      'max_duration',
    );
    expect(await client.closed).toMatchObject({ code: 1000, reason: 'max_duration' });
    expect(state.open).toBe(0);
  });

  test('every wait and listener is released however the socket ends', async () => {
    const ends: readonly (readonly [
      string,
      (made: SocketHost, client: LiveSocketClient) => Promise<void>,
    ])[] = [
      ['close', async (_made, client) => void (await client.close())],
      ['terminate', async (_made, client) => void client.socket.terminate()],
      ['stop', async (made) => made.host.stop(1000)],
      ['protocol error', async (_made, client) => client.send('not json')],
    ];
    for (const [, end] of ends) {
      const state = { open: 0 };
      const made = await started(quietHub(state));
      const client = await helloed(made);
      subscribe(client, 'a');
      await vi.waitFor(() => expect(state.open).toBe(1));
      await end(made, client);
      await client.closed;
      await vi.waitFor(() => expect(state.open).toBe(0));
      await vi.waitFor(() => expect(made.timers.pending()).toBe(0));
    }
  });

  test('log lines and spans of a socket hold ids and counts only', async () => {
    const lines: LoggedLine[] = [];
    const made = await started(quietHub({ open: 0 }), { deps: { log: recordingLogger(lines) } });
    const client = await helloed(made, { token: 'SECRET-TOKEN', traceparent: 'SECRET-TRACE' });
    subscribe(client, 'a', { input: { key: 'SECRET-INPUT' }, after: 'SECRET-AFTER!' });
    await client.until((message) => message.type === 'error');
    client.send({ type: 'invoke', id: 'i', request: { action: 'SECRET-ACTION' } });
    await client.until((message) => message.type === 'result');
    await client.close();
    await vi.waitFor(() =>
      expect(lines.some((line) => line.message === 'live socket closed')).toBe(true),
    );
    const closing = lines.find((line) => line.message === 'live socket closed');
    expect(Object.keys(closing?.fields ?? {}).sort()).toEqual([
      'code',
      'connectionId',
      'subscriptions',
    ]);
    const text = JSON.stringify([lines, made.telemetry.spans]);
    expect(text).not.toContain('SECRET');
  });

  test('an action with a cookie hint is refused over the socket', async () => {
    const made = await started(quietHub({ open: 0 }), { actions: libraryActions });
    const client = await helloed(made);
    client.send({ type: 'invoke', id: 'login', request: { action: 'auth.login' } });
    const answer = await client.next();
    expect(answer).toMatchObject({
      type: 'result',
      id: 'login',
      response: { ok: false, error: { code: 'core.unsupported' } },
    });
    expect(JSON.stringify(answer)).not.toContain('secret-token');
    expect(made.invoker.invoked).toHaveLength(0);
  });
});
