import { erasure } from '@keelwerk/events';
import { describe, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { pgliteQuery } from './support/dump-sections.ts';
import { runErasureDumpCase } from './support/erasure-dump-case.ts';
import { dumpDispatcher } from './support/erasure-dump-markers.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';
import { dumpTime } from './support/erasure-usage-flush.ts';

describe('a PGlite dump after erasing a subject planted through every path (criterion 5, first half)', () => {
  test('the inventory names every table, the key is gone and no marker survives', {
    timeout: 240_000,
  }, async () => {
    const time = dumpTime();
    const dispatcher = dumpDispatcher();
    const worker = erasure({ pollMs: 3_600_000 });
    const runtime = await startTestRuntime(erasureDumpApp, {
      adapter: 'pglite',
      operators: true,
      clock: time.clock,
      timers: time.timers,
      workers: true,
      eventWorkers: [dispatcher, worker],
    });
    try {
      await runErasureDumpCase({
        runtime,
        worker,
        dispatcher,
        advance: time.advance,
        queries: [pgliteQuery(runtime.adapter), pgliteQuery(runtime.control.adapter)],
      });
    } finally {
      await runtime.stop();
    }
  });
});
