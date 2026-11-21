import type { TestSocket } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { trpcSocketDialect } from './support/trpc-socket-dialect.ts';

/** A socket that answers what it is told to, in order. */
function answering(...messages: unknown[]): TestSocket {
  const queue = messages.map((message) => JSON.stringify(message));
  return {
    send: () => undefined,
    next: async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('No message is left.');
      return next;
    },
    closed: new Promise(() => undefined),
    ping: async () => new Uint8Array(),
    close: async () => undefined,
  } as unknown as TestSocket;
}

describe('the socket dialect of tRPC', () => {
  test('a head event is the head, any other event after started is not', async () => {
    const started = { id: 's', result: { type: 'started' } };
    const item = { id: 's', result: { type: 'data', data: { data: { loanId: 'x' } } } };
    const control = { control: 'head', state: 'v2.1.1.scope.aaaa' };
    expect(
      await trpcSocketDialect.subscribe(
        answering(started, { id: 's', result: { type: 'data', data: control } }),
        's',
      ),
    ).toEqual({ kind: 'head' });
    const answer = await trpcSocketDialect.subscribe(answering(started, item), 's');
    expect(answer.kind).toBe('other');
  });
});
