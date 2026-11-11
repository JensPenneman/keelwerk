import { describe, expect, test } from 'vitest';
import { reactionRegistry } from '../../test/reaction-kit.ts';
import { checkAsyncReactions } from './check-async-reactions.ts';

const { reactions } = reactionRegistry();

describe('the boot check for asynchronous reactions', () => {
  test('refuses each async reaction when no event worker runs asyncReactions', () => {
    const problems = checkAsyncReactions(reactions, [{ runs: ['retention'] }]);
    expect(problems.map((problem) => problem.ref).sort()).toEqual([
      'logs.latest',
      'logs.ordered',
      'logs.plain',
      'logs.retried',
      'logs.tally',
    ]);
    expect(problems[0]).toMatchObject({
      code: 'asyncReactionsUnavailable',
      severity: 'error',
      module: 'logs',
    });
    expect(problems[0]?.message).toContain('@keelwerk/events');
    expect(checkAsyncReactions(reactions, [])).toHaveLength(5);
  });

  test('is lifted by a worker that runs asyncReactions', () => {
    expect(checkAsyncReactions(reactions, [{ runs: ['retention', 'asyncReactions'] }])).toEqual([]);
  });

  test('an app without async reactions needs no worker', () => {
    expect(checkAsyncReactions(new Map(), [])).toEqual([]);
  });
});
