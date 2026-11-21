import { describe, expect, test, vi } from 'vitest';
import {
  keelwerkOf,
  queryMessage,
  served,
  subscriptionMessage,
  waitOptions,
} from './support/served-trpc-socket.ts';

describe('a socket while the mount closes', () => {
  test('after the mount began to close a query and a subscription are refused core.unavailable and reach no invoker', async () => {
    const { socket, mounted } = await served();
    socket.message('PING');
    await socket.pong();
    await mounted.close();
    socket.message(queryMessage(1));
    socket.message(subscriptionMessage(2));
    for (const id of [1, 2]) {
      expect(keelwerkOf(await socket.errorFor(id))).toMatchObject({
        code: 'core.unavailable',
        retryAfter: 1,
      });
    }
    expect(mounted.calls).toEqual([]);
    expect(mounted.subscribed).toEqual([]);
  });

  test('closing the mount waits for a query that runs on a socket', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { socket, mounted } = await served({
      respond: async () => {
        await gate;
        return { ok: true as const, value: {} };
      },
    });
    socket.message(queryMessage(1));
    await vi.waitFor(() => expect(mounted.calls).toHaveLength(1), waitOptions);
    let settled = false;
    const closed = mounted.close().then(() => {
      settled = true;
    });
    // The close began synchronously; a close that does not wait settles within a turn of the loop.
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    await closed;
    expect(settled).toBe(true);
    const [answer] = await socket.sentFor(1);
    expect(answer).toMatchObject({ id: 1, result: { type: 'data' } });
  });
});
