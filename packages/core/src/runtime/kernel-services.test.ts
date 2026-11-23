import { describe, expect, test } from 'vitest';
import { flushUsage } from '../api-versions/flush-usage.ts';
import { createWorker } from '../worker/create-worker.ts';
import { keepLeases } from './keep-leases.ts';
import { kernelServices } from './kernel-services.ts';
import { recordMarks } from './record-marks.ts';
import type { StartPhaseInput } from './start-phase-input.ts';
import { staysInService } from './stays-in-service.ts';

describe('the kernel services', () => {
  test('include the worker before the usage flush, the mark recorder and the lease keeper', () => {
    expect(kernelServices).toContain(createWorker);
    expect(kernelServices).toContain(flushUsage);
    expect(kernelServices).toContain(recordMarks);
    expect(kernelServices).toContain(keepLeases);
    expect(kernelServices.indexOf(createWorker)).toBeLessThan(kernelServices.indexOf(flushUsage));
  });

  test('the list that stays in service names a service the kernel builds', () => {
    const input = {
      connected: {},
      migrated: {},
      invoker: {},
      options: {},
      clock: { now: () => Temporal.Now.instant() },
    } as unknown as StartPhaseInput;
    const ids = kernelServices.map((build) => build(input).id);
    for (const id of staysInService) expect(ids).toContain(id);
  });
});
