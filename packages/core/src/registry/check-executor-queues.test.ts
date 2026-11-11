import { describe, expect, test } from 'vitest';
import { checkExecutorQueues } from './check-executor-queues.ts';
import type { ExecutorEntry } from './executor-entry.ts';

const executor = (queue: string): ExecutorEntry =>
  ({
    ref: 'courier.deliver',
    module: 'courier',
    effect: 'courier.deliver',
    queue,
  }) as ExecutorEntry;
const of = (queue: string) => checkExecutorQueues(new Map([['courier.deliver', executor(queue)]]));

describe('the queue of an executor', () => {
  test('may not be named like a queue of actions', () => {
    for (const queue of ['reactions', 'commands']) {
      expect(of(queue)).toEqual([
        expect.objectContaining({
          code: 'executorQueueReserved',
          severity: 'error',
          module: 'courier',
          ref: 'courier.deliver',
        }),
      ]);
    }
  });

  test('any other name passes', () => {
    expect(of('effects')).toEqual([]);
    expect(of('mail')).toEqual([]);
  });
});
