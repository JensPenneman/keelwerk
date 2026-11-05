import type { BenchCell } from './bench-cell.ts';
import type { BenchWorld } from './bench-world.ts';
import { measureCell } from './measure-cell.ts';
import type { OverheadOptions } from './overhead-options.ts';
import type { OverheadSamples } from './overhead-samples.ts';

/**
 * Runs every cell in rounds, each cell in a world of its own that is started fresh, because the
 * in-memory adapter and the event table slow down as the log grows and a shared world would
 * favour the cells that run first. The order of the cells alternates between forward and backward
 * from one round to the next, so a drift of the host does not favour one form either.
 */
export async function measureOverhead(
  start: () => Promise<BenchWorld>,
  cells: readonly BenchCell[],
  options: OverheadOptions,
): Promise<OverheadSamples> {
  let adapter: BenchWorld['label'] = 'memory';
  const perRound: number[][] = [];
  for (let round = 0; round < options.rounds; round += 1) {
    const order = round % 2 === 0 ? cells : [...cells].reverse();
    const microseconds = new Map<BenchCell, number>();
    for (const cell of order) {
      const world = await start();
      adapter = world.label;
      try {
        if (options.warmup > 0) await measureCell(world, cell, options.warmup);
        microseconds.set(cell, await measureCell(world, cell, options.iterations));
      } finally {
        await world.stop();
      }
    }
    perRound.push(cells.map((cell) => microseconds.get(cell) ?? Number.NaN));
  }
  return { adapter, cells, perRound };
}
