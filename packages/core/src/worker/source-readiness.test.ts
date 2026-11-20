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

  test('sweeps that ask while the check is under way wait for it and share it', async () => {
    const answer = Promise.withResolvers<readonly { track: string; id: string }[]>();
    let reads = 0;
    const source = {
      ...behind,
      handle: {
        adapter: {
          schema: {
            history: () => {
              reads += 1;
              return answer.promise;
            },
          },
        },
      },
    } as unknown as QueueSource;
    const readiness = sourceReadiness(clock, { warn: () => undefined } as unknown as Logger);
    const first = readiness.ready(source);
    const second = readiness.ready(source);
    answer.resolve([{ track: 'keelwerk.framework', id: '0002' }]);
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(reads).toBe(1);
  });

  test('a sweep that comes after an explicit wake checks afresh, not on the answer of a check that began before it', async () => {
    const answers = [
      Promise.withResolvers<readonly { track: string; id: string }[]>(),
      Promise.withResolvers<readonly { track: string; id: string }[]>(),
    ];
    let reads = 0;
    const source = {
      ...behind,
      handle: {
        adapter: {
          schema: { history: () => answers[reads++]?.promise },
        },
      },
    } as unknown as QueueSource;
    const readiness = sourceReadiness(clock, { warn: () => undefined } as unknown as Logger);
    const before = readiness.ready(source);
    // The migration finishes while the first check reads: its answer is stale for a sweep that follows.
    readiness.recheck();
    const after = readiness.ready(source);
    // Both checks read at once: broken code fails here, not by waiting for an answer that never comes.
    expect(reads).toBe(2);
    answers[1]?.resolve([{ track: 'keelwerk.framework', id: '0002' }]);
    expect(await after).toBe(true);
    answers[0]?.resolve([]);
    // The stale answer comes last and does not turn the ready source back.
    expect(await before).toBe(true);
    expect(await readiness.ready(source)).toBe(true);
  });
});
