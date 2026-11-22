import { setTimeout as delay } from 'node:timers/promises';
import type { DataAdapter, JobWake } from '@keelwerk/core';
import { isKeelwerkError } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPostgresChangeFeed } from '../src/postgres-change-feed.ts';
import type { BroadcastBench } from './support/broadcast-bench.ts';
import { broadcastBench, broadcastOf, received } from './support/broadcast-bench.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';

/** How long a wait goes on before a look that started after it decides. */
const graceMs = 20_000;

let bench: BroadcastBench;
let adapter: DataAdapter;

beforeAll(async () => {
  bench = await broadcastBench('listen_loss');
  adapter = await bench.harness.adapter();
});

afterAll(async () => {
  await bench.close();
});

/**
 * The backends of `application` that last ran `query` and are done with it (`idle`), which for a
 * session that only listens is its `LISTEN` once it has taken effect: while it runs, a notification
 * is not yet delivered to the session.
 */
async function sessions(application: string, query: string): Promise<readonly number[]> {
  return bench.harness.owner(async (client) => {
    const found = await client.query<{ pid: number }>(
      `select pid from pg_stat_activity
       where application_name = $1 and query = $2 and state = 'idle' order by pid`,
      [application, query],
    );
    return found.rows.map((row) => row.pid);
  });
}

/** Waits until the session is listening and answers its backend's pid. */
async function sessionOf(application: string, query: string, not?: number): Promise<number> {
  const deadline = Date.now() + graceMs;
  for (;;) {
    // The look that decides is one that began after the grace had passed.
    const looked = Date.now();
    const fresh = (await sessions(application, query)).find((pid) => pid !== not);
    if (fresh !== undefined) return fresh;
    if (looked > deadline) {
      throw new Error(`no session of ${application} is listening (${query}) after ${graceMs} ms`);
    }
    await delay(50);
  }
}

async function end(pid: number): Promise<void> {
  await bench.harness.owner(async (client) =>
    client.query('select pg_terminate_backend($1)', [pid]),
  );
}

async function notify(channel: string, payload: string): Promise<void> {
  await bench.harness.owner(async (client) =>
    client.query('select pg_notify($1, $2)', [channel, payload]),
  );
}

/**
 * Reads every wake of `source` as it comes, so none waits unread; `until` resolves with the first
 * that `matches`, from `skip` on.
 */
function reading<T>(source: AsyncIterable<T>) {
  const seen: T[] = [];
  const waiting: (() => void)[] = [];
  void (async () => {
    for await (const wake of source) {
      seen.push(wake);
      for (const resume of waiting.splice(0)) resume();
    }
  })().catch(() => undefined);
  return {
    seen,
    until: async (matches: (wake: T) => boolean, skip = 0): Promise<T> => {
      const deadline = Date.now() + graceMs;
      for (;;) {
        const found = seen.slice(skip).find(matches);
        if (found !== undefined) return found;
        if (Date.now() > deadline)
          throw new Error(`no wake of the reader matched after ${graceMs} ms`);
        await Promise.race([new Promise<void>((resolve) => waiting.push(resolve)), delay(100)]);
      }
    },
  };
}

function feedOf(application: string) {
  const feed = createPostgresChangeFeed({
    url: bench.harness.database.appUrl,
    applicationName: application,
    log: testEnvironment().log,
    adapter,
    notify: true,
    // The first poll is the only one the test sees: a wake after it can come only from the session.
    pollIntervalMs: 3_600_000,
  });
  return feed;
}

describe('a LISTEN session the server ends', () => {
  test('kw_events: the session opens again and a notification after that wakes the reader', async () => {
    const application = 'loss-events';
    const feed = feedOf(application);
    const stop = new AbortController();
    try {
      const reader = reading(feed.source.wake([testNamespace], stop.signal));
      const first = await sessionOf(`${application}-listen`, 'listen kw_events');
      await notify('kw_events', `${testNamespace.id}:probe-1`);
      await reader.until((wake) => wake.scopeIds.includes('probe-1'));
      await end(first);
      const second = await sessionOf(`${application}-listen`, 'listen kw_events', first);
      expect(second).not.toBe(first);
      await notify('kw_events', `${testNamespace.id}:probe-2`);
      await reader.until((wake) => wake.scopeIds.includes('probe-2'));
    } finally {
      stop.abort();
      await feed.close(5000);
    }
  });

  test('kw_jobs: the session opens again, wakes every reader for every queue, and a notification after that names its queue', async () => {
    const application = 'loss-jobs';
    const feed = feedOf(application);
    const stop = new AbortController();
    const named = (queue: string) => (wake: JobWake) => wake.queues?.includes(queue) === true;
    try {
      const reader = reading(feed.source.jobs([testNamespace], stop.signal));
      const first = await sessionOf(`${application}-listen`, 'listen kw_jobs');
      // A wake that names a queue comes after the session's own wake for every queue, so the first
      // session has said all it says before the mark below.
      await notify('kw_jobs', `${testNamespace.id}:probe-1`);
      await reader.until(named('probe-1'));
      const mark = reader.seen.length;
      await end(first);
      const second = await sessionOf(`${application}-listen`, 'listen kw_jobs', first);
      expect(second).not.toBe(first);
      // Only the opening of the second session can have caused a wake that names no queue since the
      // mark.
      await reader.until((wake) => wake.queues === undefined, mark);
      await notify('kw_jobs', `${testNamespace.id}:probe-2`);
      await reader.until(named('probe-2'), mark);
    } finally {
      stop.abort();
      await feed.close(5000);
    }
  });

  test('kw_broadcast: the open subscriptions end with unavailable, the session opens again and a new subscription receives', async () => {
    const application = 'loss-broadcast';
    const peer = await bench.open(application);
    const stop = new AbortController();
    try {
      const subscribed = broadcastOf(peer).subscribe('news', stop.signal)[Symbol.asyncIterator]();
      const first = await received(peer, 'news', new Uint8Array([1]), subscribed);
      expect([...first]).toEqual([1]);
      const session = `${application}-broadcast-listen`;
      const pid = await sessionOf(session, 'listen kw_broadcast');
      const lost = subscribed.next().catch((error: unknown) => error);
      await end(pid);
      const failure = await lost;
      expect(isKeelwerkError(failure) && failure.code).toBe('core.unavailable');
      const again = await sessionOf(session, 'listen kw_broadcast', pid);
      expect(again).not.toBe(pid);
      // A subscription made before the session says it is listening is refused: asking again is the
      // caller's way, and it ends with the first that is not.
      const deadline = Date.now() + graceMs;
      for (;;) {
        const looked = Date.now();
        const fresh = broadcastOf(peer).subscribe('news', stop.signal)[Symbol.asyncIterator]();
        try {
          const answer = await received(peer, 'news', new Uint8Array([2]), fresh);
          expect([...answer]).toEqual([2]);
          break;
        } catch (error) {
          const unavailable = isKeelwerkError(error) && error.code === 'core.unavailable';
          if (!unavailable || looked > deadline) throw error;
          await delay(50);
        }
      }
    } finally {
      stop.abort();
    }
  });
});
