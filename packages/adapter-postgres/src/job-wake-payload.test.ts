import { parseWakePayload } from '@keelwerk/data';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { decodeJobQueues } from './decode-job-queues.ts';
import { encodeJobQueue } from './encode-job-queue.ts';
import { everyQueue } from './every-queue.ts';
import { createNotifier } from './notifier.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** What the reader of `kw_jobs` makes of the payload the notifier sends for these reports. */
async function received(
  reports: readonly string[],
  maxPayloadBytes?: number,
): Promise<readonly (readonly string[] | undefined)[]> {
  const sent: string[] = [];
  const notifier = createNotifier({
    send: async (payload) => {
      sent.push(payload);
    },
    onError: () => undefined,
    ...(maxPayloadBytes === undefined ? {} : { maxPayloadBytes }),
  });
  for (const report of reports) notifier.committed('ns:1', report);
  await vi.advanceTimersByTimeAsync(50);
  await notifier.stop();
  return sent.map((payload) => {
    const parsed = parseWakePayload(payload);
    expect(parsed?.namespace).toBe('ns:1');
    return decodeJobQueues(parsed?.items);
  });
}

test('a kw_jobs payload keeps queue names with a colon or a comma; `*` and an overflow mean every queue', async () => {
  const awkward = ['a:b', 'c,d', 'e%f', 'g h', '*', 'ünï'];
  expect(await received(awkward.map(encodeJobQueue))).toEqual([awkward]);
  expect(await received([everyQueue, ...awkward.map(encodeJobQueue)])).toEqual([undefined]);
  // A list past the payload limit becomes `<namespace>:*`.
  expect(await received(awkward.map(encodeJobQueue), 20)).toEqual([undefined]);
});

test('a list that cannot be decoded means every queue', () => {
  expect(decodeJobQueues(['%E0%A4%A'])).toBeUndefined();
});
