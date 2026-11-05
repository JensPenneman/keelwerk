import type { BenchCell } from './bench-cell.ts';
import { loadCounts } from './load-counts.ts';

/**
 * Every cell of one adapter, in the order a round starts with. The requests that need no adapter
 * (`ctx.newId`, a flag read) are measured on the in-memory adapter only, where they show the
 * interpreter alone.
 */
export function benchCells(adapter: 'memory' | 'postgres'): readonly BenchCell[] {
  const generator = (request: BenchCell['request'], batching: BenchCell['batching']) =>
    loadCounts.map((count): BenchCell => ({ form: 'generator', request, batching, count }));
  return [
    ...loadCounts.map(
      (count): BenchCell => ({ form: 'baseline', request: 'load', batching: 'none', count }),
    ),
    { form: 'plain', request: 'load', batching: 'none', count: 0 },
    ...generator('load', 'unbatched'),
    ...generator('load', 'all'),
    ...(adapter === 'memory'
      ? [...generator('newId', 'unbatched'), ...generator('flag', 'unbatched')]
      : []),
  ];
}
