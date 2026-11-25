import type { DataAdapter, Registry } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { controlSourceOf } from '../../src/doctor/control-source-of.ts';
import { doctorReadBounds } from '../../src/doctor/doctor-read-bounds.ts';
import { createFakeHost } from '../support/fake-host.ts';

const namespace = { id: 'ns-control' } as never;
const registry = {
  entities: new Map([['core.process', { descriptor: { ref: 'core.process' } }]]),
} as unknown as Registry;

describe('the source over the control store', () => {
  test('every read is a read-only deployment-scope unit with the statement time limit of the bounds', async () => {
    const opened: unknown[] = [];
    const adapter = {
      unit: async (
        given: unknown,
        level: unknown,
        fn: (unit: unknown) => Promise<unknown>,
        options: unknown,
      ) => {
        opened.push({ given, level, options });
        return fn('the unit');
      },
    } as unknown as DataAdapter;
    const source = controlSourceOf(adapter, namespace, registry, createFakeHost().host.schedule);
    expect(await source.read(async (unit) => unit)).toBe('the unit');
    expect(opened).toEqual([
      {
        given: namespace,
        level: { level: 'deployment' },
        options: { readOnly: true, timeoutMs: doctorReadBounds.unitTimeoutMs },
      },
    ]);
  });

  test('an entity is the descriptor of the registry, and one the registry lacks is an error', async () => {
    const adapter = {
      unit: async (_namespace: unknown, _level: unknown, fn: (unit: unknown) => Promise<unknown>) =>
        fn('the unit'),
    } as unknown as DataAdapter;
    const source = controlSourceOf(adapter, namespace, registry, createFakeHost().host.schedule);
    expect(await source.read(async (_unit, entity) => entity('core.process'))).toEqual({
      ref: 'core.process',
    });
    await expect(source.read(async (_unit, entity) => entity('core.missing'))).rejects.toThrow(
      'the registry has no entity core.missing',
    );
  });

  test('a unit that never answers fails when its deadline passes, and the timer is the bound of the deadline', async () => {
    const adapter = { unit: () => new Promise<never>(() => undefined) } as unknown as DataAdapter;
    const fake = createFakeHost();
    const source = controlSourceOf(adapter, namespace, registry, fake.host.schedule);
    const reading = source.read(async () => 'never');
    expect(fake.timers.map((timer) => timer.milliseconds)).toEqual([doctorReadBounds.deadlineMs]);
    fake.timers[0]?.fire();
    await expect(reading).rejects.toThrow('no answer within the bound');
  });
});
