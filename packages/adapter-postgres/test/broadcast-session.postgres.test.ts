import { setTimeout as delay } from 'node:timers/promises';
import type { DataAdapter } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { BroadcastBench } from './support/broadcast-bench.ts';
import { broadcastBench, broadcastOf, received, waitMs } from './support/broadcast-bench.ts';
import { tcpProxy } from './support/tcp-proxy.ts';

let bench: BroadcastBench;

beforeAll(async () => {
  bench = await broadcastBench('broadcast_session');
});

afterAll(async () => {
  await bench.close();
});

describe('the broadcast listen session on PostgreSQL', () => {
  test('the wire format of a broadcast text is pinned, and a forged text is dropped inside the listen loop', async () => {
    const b = await bench.open('bc-b10');
    const stop = new AbortController();
    const mine = broadcastOf(b).subscribe('first', stop.signal)[Symbol.asyncIterator]();
    const other = broadcastOf(b).subscribe('elsewhere', stop.signal)[Symbol.asyncIterator]();
    const raw = async (text: string): Promise<void> => {
      await bench.harness.owner(async (client) =>
        client.query('select pg_notify($1, $2)', ['kw_broadcast', text]),
      );
    };
    // The session is listening once a probe channel of the same adapter answers; each raw text below
    // commits before the next is sent, and the listen session receives notifications in commit order,
    // so each is sent exactly once.
    const probe = broadcastOf(b).subscribe('probe', stop.signal)[Symbol.asyncIterator]();
    await received(b, 'probe', new Uint8Array([9]), probe);
    // The channel kw_broadcast, `<channel>\n<padded base64>`: what processes of another version send.
    await raw('first\nAAEC/w==');
    const answer = await Promise.race([mine.next(), delay(waitMs).then(() => undefined)]);
    if (answer === undefined || answer.done === true) throw new Error('nothing received');
    expect([...answer.value]).toEqual([0, 1, 2, 255]);
    const before = bench.warnings.length;
    for (const forged of ['garbage', `${'c'.repeat(201)}\nAQI=`, 'a\nAQI']) await raw(forged);
    await raw('first\nBQ==');
    const next = await Promise.race([mine.next(), delay(waitMs).then(() => undefined)]);
    expect([...(next?.value ?? [])]).toEqual([5]);
    expect(
      bench.warnings
        .slice(before)
        .filter((line) => line === 'postgres broadcast: a malformed notification was dropped'),
    ).toHaveLength(3);
    const untouched = await Promise.race([other.next(), delay(500).then(() => 'quiet')]);
    expect(untouched).toBe('quiet');
    stop.abort();
  });

  test('a listen session that goes silent without closing ends every open iterable with unavailable within the heartbeat bound', async () => {
    const proxy = await tcpProxy(bench.harness.database.appUrl);
    let b: DataAdapter | undefined;
    try {
      const a = await bench.open('bc-a11');
      b = await bench.open('bc-b11', undefined, proxy.url);
      const stop = new AbortController();
      const first = broadcastOf(b).subscribe('silent', stop.signal)[Symbol.asyncIterator]();
      await received(a, 'silent', new Uint8Array([1]), first);
      const second = broadcastOf(b).subscribe('silent', stop.signal)[Symbol.asyncIterator]();
      const failures = [first, second].map(async (iterator) => {
        for (;;) {
          try {
            const step = await iterator.next();
            if (step.done === true) return undefined;
          } catch (error) {
            return error;
          }
        }
      });
      proxy.cut();
      for (const error of await Promise.all(failures)) {
        expect(error).toMatchObject({ kind: 'unavailable', code: 'core.unavailable' });
      }
      stop.abort();
    } finally {
      await b?.close(5000);
      await proxy.close();
    }
  });
});
