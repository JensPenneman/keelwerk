import type { EntityDescriptor, Runtime, Unit } from '@keelwerk/core';
import { fallbackReport } from '@keelwerk/data';
import { afterEach, describe, expect, test } from 'vitest';
import { checkFallbacks } from '../src/doctor/check-fallbacks.ts';
import { checkHealth } from '../src/doctor/check-health.ts';
import { controlReaderOf } from '../src/doctor/control-reader-of.ts';
import { removeTrees } from './layout-fixtures/materialise-tree.ts';
import { bootRuntime } from './support/boot-runtime.ts';

const stopped: Runtime[] = [];

async function started(kind: 'memory' | 'pglite', mask: boolean) {
  const booted = await bootRuntime(kind, mask);
  stopped.push(booted.runtime);
  return booted;
}

afterEach(async () => {
  await removeTrees();
  await Promise.allSettled(stopped.splice(0).map((runtime) => runtime.stop(1000)));
});

describe.each(['memory', 'pglite'] as const)('a running deployment on %s', (kind) => {
  test('the control store answers, the process is ready and health is clean', async () => {
    const { runtime, adapters } = await started(kind, false);
    const control = adapters.get('control');
    if (control === undefined) throw new Error('the control adapter was not opened');
    const source = {
      read: <T>(fn: (unit: Unit) => Promise<T>) =>
        control.unit(
          {
            id: 'ns-control',
            placementId: 'control',
            appId: 'core',
            tenantId: null,
            root: 'kw__control',
          },
          { level: 'deployment' },
          fn,
          { readOnly: true },
        ),
      entity: (ref: string): EntityDescriptor => {
        const entry = runtime.registry('demo').entities.get(ref);
        if (entry === undefined) throw new Error(`no entity ${ref}`);
        return entry.descriptor;
      },
    };
    const reader = controlReaderOf(source, () => Temporal.Now.instant());
    expect(await reader.reachable()).toEqual({ reachable: true, detail: 'answered' });
    const processes = await reader.processes();
    expect(processes).toHaveLength(1);
    expect(processes[0]).toMatchObject({ state: 'ready', roles: ['serve', 'work'] });
    expect(checkHealth(processes).map((finding) => finding.severity)).toEqual(['note']);
    expect(await reader.hookFailures()).toEqual([]);
  }, 60_000);

  test('with the accelerations off, doctor lists the fallbacks and their cost', async () => {
    const { adapters, capabilities } = await started(kind, true);
    expect(adapters.has('main')).toBe(true);
    const main = capabilities.get('main');
    if (main === undefined) throw new Error('the placement was not connected');
    const found = checkFallbacks(
      [{ name: 'main', adapter: kind, cluster: 'local', capabilities: main }],
      undefined,
      undefined,
    );
    const rows = fallbackReport(main);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(found.map((finding) => finding.message)).toEqual(
      rows.map(
        (row) => `${row.capability} is absent: the kernel runs ${row.path}; cost: ${row.cost}`,
      ),
    );
    expect(found.map((finding) => finding.message).join('\n')).toContain('rowLocks is absent');
    expect(found.map((finding) => finding.message).join('\n')).toContain(
      'cost: repeated units under contention',
    );
    expect(found.every((finding) => finding.fix !== '')).toBe(true);
  }, 60_000);

  test('a placement that was not opened is named, not guessed at', () => {
    expect(
      checkFallbacks(
        [{ name: 'main', adapter: kind, cluster: 'x', capabilities: undefined }],
        undefined,
        undefined,
      )[0]?.message,
    ).toBe(`the ${kind} adapter was not opened, so its fallbacks are unknown`);
  });
});
