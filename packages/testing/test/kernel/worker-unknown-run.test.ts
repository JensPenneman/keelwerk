import type { StoredJobSpec } from '@keelwerk/core';
import { afterAll, expect, test } from 'vitest';
import { acmeScope, jobOf, lines, startWatched } from './support/worker-kit.ts';

const log = lines();
const { runtime, spy } = await startWatched({ workers: true, logger: log.logger });
afterAll(() => runtime.stop());

test('a job whose run this build does not know ends failed on its first attempt with core.internal', async () => {
  const marker = 'secret-marker-1f9c';
  await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.jobs.enqueue(
      jobOf(runtime, {
        queue: 'commands',
        run: { unknown: true, marker } as unknown as StoredJobSpec['run'],
      }),
    ),
  );
  expect(await runtime.drainJobs()).toBeGreaterThanOrEqual(1);
  expect(spy.completions).toHaveLength(1);
  const [completion] = spy.completions;
  expect(completion?.attempt.attempt).toBe(1);
  expect(completion?.outcome).toMatchObject({
    kind: 'failed',
    error: { kind: 'internal', code: 'core.internal' },
  });
  const seen = JSON.stringify([completion, log.warnings, log.errors]);
  expect(seen).not.toContain(marker);
  expect(seen).not.toContain('unknown');
});
