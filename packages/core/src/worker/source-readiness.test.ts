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

  test('a check that cannot read the track is asked again after the pause of the policy, not after a minute', async () => {
    let now = Temporal.Instant.from('2026-01-01T00:00:00Z');
    let reads = 0;
    const source = {
      ...behind,
      handle: {
        adapter: {
          schema: {
            history: () => {
              reads += 1;
              return Promise.reject(new Error('the database is away'));
            },
          },
        },
      },
    } as unknown as QueueSource;
    const readiness = sourceReadiness(
      { now: () => now } as Clock,
      { warn: () => undefined } as unknown as Logger,
      undefined,
      () => 0.5,
    );
    const asked = async (milliseconds: number): Promise<number> => {
      now = Temporal.Instant.from('2026-01-01T00:00:00Z').add({ milliseconds });
      expect(await readiness.ready(source)).toBe(false);
      return reads;
    };
    expect(await asked(0)).toBe(1);
    expect(await asked(999)).toBe(1);
    expect(await asked(1000)).toBe(2);
    // The second failure in a row waits twice as long.
    expect(await asked(2999)).toBe(2);
    expect(await asked(3000)).toBe(3);
  });

  test('a check that read the track, ready or not, starts the failures again', async () => {
    let now = Temporal.Instant.from('2026-01-01T00:00:00Z');
    let reads = 0;
    let readable = false;
    const source = {
      ...behind,
      handle: {
        adapter: {
          schema: {
            history: () => {
              reads += 1;
              return readable ? Promise.resolve([]) : Promise.reject(new Error('away'));
            },
          },
        },
      },
    } as unknown as QueueSource;
    const readiness = sourceReadiness(
      { now: () => now } as Clock,
      { warn: () => undefined } as unknown as Logger,
      undefined,
      () => 0.5,
    );
    const at = (milliseconds: number): void => {
      now = Temporal.Instant.from('2026-01-01T00:00:00Z').add({ milliseconds });
    };
    // Two failures in a row: the next check waits two seconds.
    await readiness.ready(source);
    at(1000);
    await readiness.ready(source);
    expect(reads).toBe(2);
    // The track is read at last (and found behind); an explicit wake checks again at once.
    readable = true;
    at(3000);
    await readiness.ready(source);
    expect(reads).toBe(3);
    // Failing again counts from one: a pause of a second.
    readable = false;
    readiness.recheck();
    at(3001);
    await readiness.ready(source);
    expect(reads).toBe(4);
    at(4000);
    await readiness.ready(source);
    expect(reads).toBe(4);
    at(4001);
    await readiness.ready(source);
    expect(reads).toBe(5);
  });
});
