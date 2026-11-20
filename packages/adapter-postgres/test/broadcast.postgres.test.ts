import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { BroadcastBench } from './support/broadcast-bench.ts';
import { broadcastBench, broadcastOf, received, waitMs } from './support/broadcast-bench.ts';

let bench: BroadcastBench;

beforeAll(async () => {
  bench = await broadcastBench('broadcast');
});

afterAll(async () => {
  await bench.close();
});

describe('broadcast on PostgreSQL', () => {
  test("a payload published by one adapter reaches a subscriber of the other and the publisher's own", async () => {
    const a = await bench.open('bc-a');
    const b = await bench.open('bc-b');
    const stop = new AbortController();
    const fromB = broadcastOf(b).subscribe('first', stop.signal)[Symbol.asyncIterator]();
    const fromA = broadcastOf(a).subscribe('first', stop.signal)[Symbol.asyncIterator]();
    const payload = new Uint8Array([0, 1, 2, 255]);
    expect([...(await received(a, 'first', payload, fromB))]).toEqual([...payload]);
    expect([...(await received(a, 'first', payload, fromA))]).toEqual([...payload]);
    stop.abort();
  });

  test('a subscriber receives only its channel, in publish order', async () => {
    const a = await bench.open('bc-a2');
    const b = await bench.open('bc-b2');
    const stop = new AbortController();
    const probe = broadcastOf(b).subscribe('probe', stop.signal)[Symbol.asyncIterator]();
    const mine = broadcastOf(b).subscribe('mine', stop.signal)[Symbol.asyncIterator]();
    await received(a, 'probe', new Uint8Array([0]), probe);
    await broadcastOf(a).publish('other', new Uint8Array([9]));
    await broadcastOf(a).publish('mine', new Uint8Array([1]));
    await broadcastOf(a).publish('mine', new Uint8Array([2]));
    const first = await Promise.race([mine.next(), delay(waitMs).then(() => undefined)]);
    const second = await Promise.race([mine.next(), delay(waitMs).then(() => undefined)]);
    expect([first?.value, second?.value].map((value) => [...(value ?? [])])).toEqual([[1], [2]]);
    stop.abort();
  });

  test('a payload of 8,000 bytes or more is refused before sending with core.payload_too_large', async () => {
    const a = await bench.open('bc-a3');
    await expect(broadcastOf(a).publish('big', new Uint8Array(8_000))).rejects.toMatchObject({
      kind: 'validation',
      code: 'core.payload_too_large',
    });
  });

  test('an aborted signal and close end the iterable without an error', async () => {
    const a = await bench.open('bc-a4');
    const c = await bench.open('bc-c4');
    const stop = new AbortController();
    const aborted = broadcastOf(c).subscribe('end', stop.signal)[Symbol.asyncIterator]();
    const closing = broadcastOf(a)
      .subscribe('end', new AbortController().signal)
      [Symbol.asyncIterator]();
    const pendingAborted = aborted.next();
    const pendingClosing = closing.next();
    stop.abort();
    expect((await pendingAborted).done).toBe(true);
    await a.close(5000);
    expect((await pendingClosing).done).toBe(true);
  });

  test('a terminated listen session ends every open iterable with unavailable and a new subscribe receives again', async () => {
    const a = await bench.open('bc-a5');
    const b = await bench.open('bc-b5');
    const stop = new AbortController();
    const first = broadcastOf(b).subscribe('lost', stop.signal)[Symbol.asyncIterator]();
    await received(a, 'lost', new Uint8Array([1]), first);
    const second = broadcastOf(b).subscribe('lost', stop.signal)[Symbol.asyncIterator]();
    const pending = [first, second].map(async (iterator) => {
      for (let n = 0; n < 2_000; n += 1) {
        try {
          await iterator.next();
        } catch (error) {
          return error;
        }
      }
      return undefined;
    });
    await bench.harness.owner(async (client) =>
      client.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'bc-b5-broadcast-listen'`,
      ),
    );
    for (const error of await Promise.all(pending)) {
      expect(error).toMatchObject({ kind: 'unavailable', code: 'core.unavailable' });
    }
    const deadline = Date.now() + waitMs;
    for (;;) {
      const again = broadcastOf(b).subscribe('lost', stop.signal)[Symbol.asyncIterator]();
      try {
        const payload = await received(a, 'lost', new Uint8Array([7]), again);
        expect([...payload]).toEqual([7]);
        break;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await delay(200);
      }
    }
    stop.abort();
  });

  test('a subscriber more than 1,024 payloads behind ends with unavailable', async () => {
    const a = await bench.open('bc-a6');
    const b = await bench.open('bc-b6');
    const stop = new AbortController();
    const slow = broadcastOf(b).subscribe('flood', stop.signal)[Symbol.asyncIterator]();
    const probe = broadcastOf(b).subscribe('flood-probe', stop.signal)[Symbol.asyncIterator]();
    await received(a, 'flood-probe', new Uint8Array([0]), probe);
    for (let n = 0; n < 1_100; n += 1) {
      await broadcastOf(a).publish('flood', new Uint8Array([n % 256]));
    }
    await broadcastOf(a).publish('flood-probe', new Uint8Array([1]));
    for (;;) {
      const step = await probe.next();
      if (step.done === true) throw new Error('the probe ended');
      if (step.value[0] === 1) break;
    }
    const failure = await slow.next().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ kind: 'unavailable', code: 'core.unavailable' });
    stop.abort();
  });

  test('with accelerations.notify false the adapter reports broadcast true and still broadcasts', async () => {
    const a = await bench.open('bc-a7');
    const quiet = await bench.open('bc-q7', { notify: false });
    expect(bench.connected.get(quiet)?.broadcast).toBe(true);
    const stop = new AbortController();
    const mine = broadcastOf(quiet).subscribe('quiet', stop.signal)[Symbol.asyncIterator]();
    expect([...(await received(a, 'quiet', new Uint8Array([5]), mine))]).toEqual([5]);
    stop.abort();
  });

  test('two subscriptions of one channel in one process receive separate bytes', async () => {
    const a = await bench.open('bc-a8');
    const b = await bench.open('bc-b8');
    const stop = new AbortController();
    const first = broadcastOf(b).subscribe('copies', stop.signal)[Symbol.asyncIterator]();
    const second = broadcastOf(b).subscribe('copies', stop.signal)[Symbol.asyncIterator]();
    const one = first.next();
    const two = second.next();
    const payload = new Uint8Array([1, 2, 3]);
    for (let n = 0; n < 75; n += 1) {
      await broadcastOf(a).publish('copies', payload);
      const both = await Promise.race([Promise.all([one, two]), delay(200).then(() => undefined)]);
      if (both === undefined) continue;
      const [x, y] = both;
      if (x.done === true || y.done === true) throw new Error('an iterable ended');
      x.value[0] = 99;
      expect([...y.value]).toEqual([1, 2, 3]);
      stop.abort();
      return;
    }
    throw new Error('nothing received');
  });

  test('a subscription aborted with payloads still queued ends at once and yields none of them', async () => {
    const a = await bench.open('bc-a9');
    const b = await bench.open('bc-b9');
    const stop = new AbortController();
    const probeStop = new AbortController();
    const queued = broadcastOf(b).subscribe('queued', stop.signal)[Symbol.asyncIterator]();
    const probe = broadcastOf(b)
      .subscribe('queued-probe', probeStop.signal)
      [Symbol.asyncIterator]();
    await received(a, 'queued-probe', new Uint8Array([0]), probe);
    for (const byte of [1, 2, 3]) await broadcastOf(a).publish('queued', new Uint8Array([byte]));
    await broadcastOf(a).publish('queued-probe', new Uint8Array([4]));
    for (;;) {
      const step = await probe.next();
      if (step.done === true) throw new Error('the probe ended');
      if (step.value[0] === 4) break;
    }
    stop.abort();
    expect(await queued.next()).toEqual({ value: undefined, done: true });
    probeStop.abort();
  });
});
