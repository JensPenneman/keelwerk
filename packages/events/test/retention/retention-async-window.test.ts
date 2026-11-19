import { afterEach, describe, expect, test } from 'vitest';
import { bootRetention, type RetentionKit } from './support/retention-kit.ts';

let kit: RetentionKit | undefined;
afterEach(async () => {
  await kit?.runtime.stop();
  kit = undefined;
});

const kinds = ['memory', 'pglite'] as const;
const run = { timeout: 60_000 } as const;

/**
 * An asynchronous command accepted now whose job runs 23 hours in, an hour before the first window
 * ends. The runtime clock follows the wall clock between advances, so instants are compared to the
 * minute.
 */
async function lateJob(kind: (typeof kinds)[number]) {
  const started = await bootRetention(kind);
  kit = started;
  const accepted = started.runtime.clock.now();
  const { commandId } = await started.call('acme', 'retprobe.queued', undefined, 'async');
  expect((await started.receiptOf('acme', commandId))?.status).toBe('accepted');
  await started.advance(23);
  return { started, accepted, commandId };
}

describe('the window of the receipt of an asynchronous command', () => {
  test.each(kinds)('counts from the completion when that is later, on %s', run, async (kind) => {
    const { started, accepted, commandId } = await lateJob(kind);
    const completed = await started.receiptOf('acme', commandId);
    expect(completed?.status).toBe('completed');
    const expected = accepted.add({ hours: 23 + 24 }).epochMilliseconds;
    expect(Math.abs((completed?.expiresAt.epochMilliseconds ?? 0) - expected)).toBeLessThan(60_000);
  });

  test.each(kinds)(
    'a retry after the first window answers the recorded outcome, on %s',
    run,
    async (kind) => {
      const { started, commandId } = await lateJob(kind);
      await started.advance(2);
      const retried = await started.call('acme', 'retprobe.queued', commandId, 'async');
      expect(retried.ok).toBe(true);
      // No second job: the receipt is the completed one, not a new accepted one.
      expect(await started.runtime.drainJobs()).toBe(0);
      expect((await started.receiptOf('acme', commandId))?.status).toBe('completed');
    },
  );

  test.each(kinds)(
    'retention keeps the receipt until the new expiry, then takes it, on %s',
    run,
    async (kind) => {
      const { started, commandId } = await lateJob(kind);
      await started.advance(2);
      await started.pass();
      expect((await started.receiptOf('acme', commandId))?.status).toBe('completed');
      // The new window ends 47 hours in.
      await started.advance(23);
      await started.pass();
      expect(await started.receiptOf('acme', commandId)).toBeUndefined();
    },
  );
});
