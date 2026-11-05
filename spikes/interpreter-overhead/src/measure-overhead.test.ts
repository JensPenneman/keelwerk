import { describe, expect, test } from 'vitest';
import { benchCells } from './bench-cells.ts';
import { commandRows } from './command-rows.ts';
import { measureOverhead } from './measure-overhead.ts';
import { measureRecordCost } from './measure-record-cost.ts';
import { overheadRows } from './overhead-rows.ts';
import { runBenchCommand } from './run-bench-command.ts';
import { startBenchWorld } from './start-bench-world.ts';

describe('the interpreter overhead measurement on the in-memory adapter', () => {
  test('runs every cell once and derives the tables', { timeout: 60_000 }, async () => {
    {
      const samples = await measureOverhead(() => startBenchWorld(), benchCells('memory'), {
        iterations: 1,
        warmup: 0,
        rounds: 3,
      });
      expect(samples.cells).toHaveLength(21);
      expect(samples.perRound).toHaveLength(3);
      for (const round of samples.perRound) {
        for (const value of round) expect(value).toBeGreaterThan(0);
      }
      expect(commandRows(samples)).toHaveLength(6);
      expect(overheadRows(samples).length).toBeGreaterThan(0);
    }
  });

  test('the generator form records the position of the target and one per load', {
    timeout: 60_000,
  }, async () => {
    const world = await startBenchWorld();
    try {
      const input = { ids: world.ids, requests: 5, writeId: world.writeIds[0] ?? '', hits: 7 };
      await runBenchCommand(world, 'bench.generatorAll', input);
      const events = await world.runtime.adapter.unit(world.namespace, world.scope, (unit) =>
        unit.events.readAll(null, { limit: 1000, includeTransient: true }),
      );
      const last = events.events.at(-1);
      expect(last?.type).toBe('bench.item.changed');
      expect(last?.decision?.reads).toHaveLength(6);
    } finally {
      await world.stop();
    }
  });

  test('measures the decision record', () => {
    const costs = measureRecordCost(50, 1);
    expect(costs.map((cost) => cost.loads)).toEqual([0, 1, 5, 20]);
  });
});
