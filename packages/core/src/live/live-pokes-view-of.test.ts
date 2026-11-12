import { describe, expect, test } from 'vitest';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import { livePokesViewOf } from './live-pokes-view-of.ts';

describe('livePokesViewOf', () => {
  test('rejects with internal for a session no pokes subscription registered', async () => {
    const unregistered = {} as unknown as InvocationSession;
    await expect(livePokesViewOf(unregistered, unregistered)).rejects.toMatchObject({
      kind: 'internal',
    });
  });
});
