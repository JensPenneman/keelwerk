import { createServer } from 'node:net';
import type { Logger } from '@keelwerk/core';
import { expect, onTestFinished, test, vi } from 'vitest';
import { openListenConnection } from './listen-connection.ts';

/** A local port that nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

test('a listen session that cannot reconnect waits one second, then two, then four, with the draw at one half', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const port = await closedPort();
  const waiting: { readonly count: number; readonly resolve: () => void }[] = [];
  let lost = 0;
  const lostNo = (count: number): Promise<void> =>
    lost >= count
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          waiting.push({ count, resolve });
        });
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => log,
  };
  const connection = await openListenConnection({
    url: `postgres://user:secret@127.0.0.1:${port}/db`,
    applicationName: 'listen-test',
    log,
    random: () => 0.5,
    onNotification: () => undefined,
    onLost: () => {
      lost += 1;
      for (const entry of waiting.filter((each) => each.count <= lost)) entry.resolve();
    },
  });
  onTestFinished(async () => {
    await connection.close();
  });
  // The first attempt was refused when `openListenConnection` answered.
  expect(lost).toBe(1);
  for (const [attempt, pause] of [
    [2, 1000],
    [3, 2000],
    [4, 4000],
  ] as const) {
    await vi.advanceTimersByTimeAsync(pause - 1);
    expect(lost).toBe(attempt - 1);
    await vi.advanceTimersByTimeAsync(1);
    await lostNo(attempt);
    expect(lost).toBe(attempt);
  }
});
