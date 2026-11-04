import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eventsOf } from './events-of.ts';
import type { SpikeKit } from './start-spike-kit.ts';
import { startSpikeKit } from './start-spike-kit.ts';

const runs = 80;
type Form = 'separate' | 'inline';

let kit: SpikeKit;
beforeAll(async () => {
  kit = await startSpikeKit();
});
afterAll(() => kit.stop());

function plain(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
}

interface Cost {
  medianMs: number;
  p95Ms: number;
  readUnits: number;
  writeUnits: number;
  rowQueries: number;
  effectRecords: number;
  recordBytes: number;
}

/** What one scenario does per run: prepare the world, then the command to time. */
interface Scenario {
  setup(form: Form, n: number): Promise<{ readonly action: string; readonly input: unknown }>;
  /** The decision record's size, taken once from the first run. */
  recordOf(output: unknown): Promise<unknown>;
}

/** Alternates the forms run by run, so growth of the store does not favour one of them. */
async function measure(scenario: Scenario): Promise<Record<Form, Cost>> {
  const times: Record<Form, number[]> = { separate: [], inline: [] };
  const costs = {} as Record<Form, Cost>;
  for (let n = 0; n < runs; n += 1) {
    for (const form of ['separate', 'inline'] as const) {
      const { action, input } = await scenario.setup(form, n);
      kit.trace.length = 0;
      const logged = kit.log.records.length;
      const started = performance.now();
      const result = await kit.call(form, action, input);
      times[form].push(performance.now() - started);
      if (n === 0) {
        costs[form] = {
          medianMs: 0,
          p95Ms: 0,
          readUnits: kit.trace.filter((entry) => entry === 'unit:read').length,
          writeUnits: kit.trace.filter((entry) => entry === 'unit:write').length,
          rowQueries: kit.trace.filter((entry) => entry === 'find').length,
          effectRecords: kit.log.records.length - logged,
          recordBytes: JSON.stringify(await scenario.recordOf(result.output), plain).length,
        };
      }
    }
  }
  for (const form of ['separate', 'inline'] as const) {
    const sorted = times[form].toSorted((a, b) => a - b);
    costs[form].medianMs = quantile(sorted, 0.5);
    costs[form].p95Ms = quantile(sorted, 0.95);
  }
  return costs;
}

const connect: Scenario = {
  setup: async (form, n) => {
    const state = `m-${form}-${n}`;
    await kit.call('separate', 'github.startConnect', { state });
    return {
      action: form === 'separate' ? 'github.connect' : 'github.connectInline',
      input: { code: `good-${n}`, state },
    };
  },
  recordOf: async (output) => {
    const { connectionId } = output as { connectionId: string };
    return (await eventsOf(kit.world, 'github.connection', connectionId))[0]?.decision;
  },
};

function ingestScenario(): Scenario {
  let lastDevice = '';
  return {
    setup: async (form, n) => {
      const registered = await kit.call('separate', 'trail.registerDevice', {
        name: `d-${form}-${n}`,
      });
      lastDevice = (registered.output as { deviceId: string }).deviceId;
      return {
        action: form === 'separate' ? 'trail.ingestPositions' : 'trail.ingestPositionsInline',
        input: {
          deviceId: lastDevice,
          fixes: Array.from({ length: 10 }, (_, index) => ({
            at: `2026-11-04T10:${String(index).padStart(2, '0')}:00Z`,
            lat: 51.05,
            lon: 3.72,
          })),
        },
      };
    },
    recordOf: async () => (await eventsOf(kit.world, 'trail.device', lastDevice)).at(-1)?.decision,
  };
}

describe('measured cost per command on the in-memory adapter', () => {
  test('GitHub connection, both forms', { timeout: 60_000 }, async () => {
    const costs = await measure(connect);
    process.stdout.write(`MEASURE connect ${JSON.stringify(costs)}\n`);
    expect(costs.separate.writeUnits).toBe(1);
    expect(costs.inline.writeUnits).toBe(1);
    expect(costs.separate.effectRecords).toBe(2);
    expect(costs.inline.effectRecords).toBe(2);
  });

  test('Trail position ingest, both forms', { timeout: 60_000 }, async () => {
    const costs = await measure(ingestScenario());
    process.stdout.write(`MEASURE ingest ${JSON.stringify(costs)}\n`);
    expect(costs.separate.writeUnits).toBe(1);
    expect(costs.inline.writeUnits).toBe(1);
    expect(costs.separate.readUnits).toBe(0);
    expect(costs.separate.effectRecords).toBe(0);
    expect(costs.inline.effectRecords).toBe(0);
  });
});
