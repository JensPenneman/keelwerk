import { describe, expect, test } from 'vitest';
import { actionQueues } from './action-queues.ts';

describe('the action queues', () => {
  // Other packages append their queues, so this names what must be in the list.
  test('hold the commands and the reactions queues', () => {
    expect(actionQueues).toEqual(expect.arrayContaining(['commands', 'reactions']));
  });
});
