import type { InvocationSession } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { libraryActions } from './support/library-actions.ts';
import { quietHub } from './support/quiet-hub.ts';
import { type SocketHost, socketHost } from './support/socket-host.ts';
import { userSession } from './support/user-session.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const hosts: SocketHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

const start = Temporal.Instant.from('2026-11-11T12:00:00Z');
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A session expiring at `expiresMs` (none: no expiry); `answers[n]` decides what the n-th check answers
 * (default: the session it checked): the renewed one, which lives until 20 s, or a short one, until 5 s.
 */
async function opened(
  answers: Record<number, () => Promise<'same' | 'renewed' | 'short' | 'refuse'>>,
  expiresMs: number | null = 10_000,
) {
  const state = { checks: 0 };
  const sessionExpiring = (ms: number | null): InvocationSession => {
    const session: InvocationSession = userSession('ada', {
      ...(ms !== null && { expiresAt: start.add({ milliseconds: ms }) }),
      revalidate: async () => {
        state.checks += 1;
        const kind = (await answers[state.checks]?.()) ?? 'same';
        if (kind === 'refuse') {
          return { ok: false, error: coreError('core.unauthenticated', { message: 'refused' }) };
        }
        return {
          ok: true,
          value: kind === 'renewed' ? renewed : kind === 'short' ? short : session,
        };
      },
    });
    return session;
  };
  const renewed = sessionExpiring(20_000);
  const short = sessionExpiring(5_000);
  const session = sessionExpiring(expiresMs);
  const made = await socketHost(quietHub({ open: 0 }), {
    session,
    actions: libraryActions,
    host: { liveSocket: { revalidateMs: 3_600_000 } },
  });
  hosts.push(made);
  const client = await made.connect();
  if (!('socket' in client)) throw new Error(`refused with ${client.status}`);
  client.send({ type: 'hello' });
  expect(await client.next()).toMatchObject({ type: 'welcome' });
  const invoke = async (id: string) => {
    client.send({ type: 'invoke', id, request: { action: 'library.echo', input: 1 } });
    return client.next();
  };
  return { made, client, state, invoke };
}

describe('a socket whose session was renewed in time is not ended at its old expiry', () => {
  test('the check a second before the expiry kept it, an invoke half a second before it renewed', async () => {
    const { made, state, invoke } = await opened({ 2: async () => 'renewed' });
    await made.at(9_000);
    await settle();
    expect(state.checks).toBe(1);
    made.moveTo(9_500);
    expect(await invoke('i1')).toMatchObject({ type: 'result', id: 'i1', response: { ok: true } });
    expect(state.checks).toBe(2);
    // The clock reaches the old expiry, and passes it: the session the socket holds is good until 20 s.
    await made.at(10_000);
    await settle();
    made.moveTo(10_500);
    expect(await invoke('i2')).toMatchObject({ type: 'result', id: 'i2', response: { ok: true } });
  });

  test('an invoke renewed it at 5 s: the clock passes the old expiry and the socket goes on', async () => {
    const { made, invoke } = await opened({ 1: async () => 'renewed' });
    made.moveTo(5_000);
    expect(await invoke('i1')).toMatchObject({ type: 'result', id: 'i1', response: { ok: true } });
    await made.at(9_000);
    await made.at(10_000);
    await settle();
    made.moveTo(10_500);
    expect(await invoke('i2')).toMatchObject({ type: 'result', id: 'i2', response: { ok: true } });
  });

  test('the renewal lands while the wait of the check a second before the expiry sleeps toward the old expiry', async () => {
    const slow = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    const { made, client, invoke } = await opened({
      1: async () => {
        started.resolve();
        await slow.promise;
        return 'renewed';
      },
      // The check a second before the expiry answers late: it is still running when the old expiry comes.
      2: async () => {
        await held.promise;
        return 'same';
      },
    });
    // An invoke at 5 s starts a check that is slow; the check a second before the expiry waits behind it.
    made.moveTo(5_000);
    client.send({ type: 'invoke', id: 'i1', request: { action: 'library.echo', input: 1 } });
    await started.promise;
    await made.at(9_000);
    await settle();
    // The renewal lands before the clock reaches the old expiry, and the old expiry is then reached.
    slow.resolve();
    expect(await client.next()).toMatchObject({ type: 'result', id: 'i1', response: { ok: true } });
    await made.at(10_000);
    await settle();
    held.resolve();
    made.moveTo(10_500);
    expect(await invoke('i2')).toMatchObject({ type: 'result', id: 'i2', response: { ok: true } });
  });
});

/** The close the client sees: a socket the host has not ended by now is closed by the client (1005). */
async function closeSeen(client: Awaited<ReturnType<typeof opened>>['client']) {
  await settle();
  await client.close();
  return client.closed;
}

describe('a check that hands the socket an earlier expiry, or one where it had none', () => {
  test.each([
    ['a session expiring at 60 s', 60_000],
    ['a session without an expiry', null],
  ] as const)(
    'an invoke at 1 s brings %s to 5 s: the idle socket ends at 5 s',
    async (_title, expiresMs) => {
      const { made, client, invoke } = await opened({ 1: async () => 'short' }, expiresMs);
      made.moveTo(1_000);
      expect(await invoke('i1')).toMatchObject({
        type: 'result',
        id: 'i1',
        response: { ok: true },
      });
      await made.at(5_000);
      expect(await closeSeen(client)).toMatchObject({ code: 4401, reason: 'core.unauthenticated' });
    },
  );
});

describe('after the keeper has ended the socket', () => {
  test('it asks no further check: an invoke that waited behind the refused check asks none', async () => {
    const answer = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const { made, client, state } = await opened(
      {
        1: async () => {
          started.resolve();
          await answer.promise;
          return 'refuse';
        },
      },
      null,
    );
    // The periodic check is asked and held; an invoke asks a check, which waits behind it. The pong comes
    // after the invoke has been taken, so the invoke's check is queued by then.
    await made.at(3_600_000);
    await started.promise;
    client.send({ type: 'invoke', id: 'i1', request: { action: 'library.echo', input: 1 } });
    client.send({ type: 'ping' });
    expect(await client.next()).toMatchObject({ type: 'pong' });
    answer.resolve();
    expect(await client.closed).toMatchObject({ code: 4401 });
    await settle();
    expect(state.checks).toBe(1);
  });
});
