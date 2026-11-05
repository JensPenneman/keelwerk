import { baselineCommand } from './baseline-command.ts';
import type { BenchCell } from './bench-cell.ts';
import type { BenchWorld } from './bench-world.ts';
import { runBenchCommand } from './run-bench-command.ts';

const actionOf = (cell: BenchCell): string => {
  if (cell.form === 'plain') return 'bench.plainDecision';
  if (cell.request === 'newId') return 'bench.generatorNewId';
  if (cell.request === 'flag') return 'bench.generatorFlag';
  return cell.batching === 'all' ? 'bench.generatorAll' : 'bench.generatorUnbatched';
};

let hits = 0;

/** Runs the cell's command `iterations` times one after the other; the mean microseconds per command. */
export async function measureCell(
  world: BenchWorld,
  cell: BenchCell,
  iterations: number,
): Promise<number> {
  const action = actionOf(cell);
  const start = performance.now();
  for (let count = 0; count < iterations; count += 1) {
    hits += 1;
    const writeId = world.writeIds[hits % world.writeIds.length] ?? '';
    const input = { ids: world.ids, requests: cell.count, writeId, hits };
    if (cell.form === 'baseline') await baselineCommand(world, input);
    else await runBenchCommand(world, action, input);
  }
  return ((performance.now() - start) * 1000) / iterations;
}
