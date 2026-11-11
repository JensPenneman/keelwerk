import { describe, expect, test } from 'vitest';
import { callOf, carrier } from '../../test/invoker/invoker-kit.ts';
import { fakeHub, feed, head, withHub } from '../../test/invoker/live-kit.ts';

describe('the revalidation of a subscription', () => {
  test('reads nothing of the request carrier after the subscription is set up, so the stream does not keep it', async () => {
    const reads: string[] = [];
    const watched = new Proxy(carrier, {
      get: (target, name, receiver) => {
        reads.push(String(name));
        return Reflect.get(target, name, receiver);
      },
    });
    const { hub, calls } = fakeHub([head]);
    const invoker = withHub(hub, [feed]);
    // The session is opened with its own carrier; the request's carrier is only what the call is made with.
    const opened = await invoker.open(carrier);
    if (!opened.ok) throw opened.error;
    const iterator = invoker
      .subscribe(callOf('doc.feed', {}, { carrier: watched, session: opened.value }))
      [Symbol.asyncIterator]();
    await iterator.next();
    const session = calls[0]?.find(
      (argument): argument is { revalidate(): Promise<{ ok: boolean }> } =>
        typeof argument === 'object' &&
        argument !== null &&
        'revalidate' in argument &&
        typeof argument.revalidate === 'function',
    );
    expect(session).toBeDefined();
    reads.length = 0;
    expect((await session?.revalidate())?.ok).toBe(true);
    expect(reads).toEqual([]);
    await iterator.return?.();
  });
});
