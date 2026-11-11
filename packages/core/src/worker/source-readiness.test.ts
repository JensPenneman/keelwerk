import { describe, expect, test } from 'vitest';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { QueueSource } from './queue-source.ts';
import { sourceReadiness } from './source-readiness.ts';

const behind: QueueSource = {
  namespace: { id: 'ns-1', placementId: 'main', appId: 'library', tenantId: null, root: 'library' },
  handle: { adapter: { schema: { history: async () => [] } } as never },
  registry: {} as never,
};
const clock: Clock = { now: () => Temporal.Instant.from('2026-01-01T00:00:00Z') } as Clock;

async function warnings(waiting?: string): Promise<string[]> {
  const lines: string[] = [];
  const log = { warn: (message: string) => void lines.push(message) } as unknown as Logger;
  const readiness =
    waiting === undefined ? sourceReadiness(clock, log) : sourceReadiness(clock, log, waiting);
  await readiness.ready(behind);
  await readiness.ready(behind);
  return lines;
}

describe('sourceReadiness', () => {
  test('a source that is behind is warned about once, naming what waits', async () => {
    expect(await warnings()).toEqual([
      'namespace ns-1 misses framework step 0002; its jobs wait for `keelwerk db apply`',
    ]);
    expect(await warnings('its consumers')).toEqual([
      'namespace ns-1 misses framework step 0002; its consumers wait for `keelwerk db apply`',
    ]);
  });
});
