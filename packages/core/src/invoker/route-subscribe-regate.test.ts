import { describe, expect, test } from 'vitest';
import {
  actionOf,
  callOf,
  carrier,
  invokerOf,
  registryOf,
} from '../../test/invoker/invoker-kit.ts';
import { fakeHub, feed, head, withHub } from '../../test/invoker/live-kit.ts';
import { envFlagProvider } from '../flags/env-flag-provider.ts';

/** The session the hub was given, which it revalidates. */
function revalidatorOf(calls: readonly unknown[][]) {
  const session = calls[0]?.find(
    (argument): argument is { revalidate(): Promise<{ ok: boolean; error?: { code: string } }> } =>
      typeof argument === 'object' &&
      argument !== null &&
      'revalidate' in argument &&
      typeof argument.revalidate === 'function',
  );
  if (session === undefined) throw new Error('the hub was not given the session');
  return session;
}

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
    const session = revalidatorOf(calls);
    reads.length = 0;
    expect((await session.revalidate()).ok).toBe(true);
    expect(reads).toEqual([]);
    await iterator.return?.();
  });

  describe('a subscription gated by a kill switch', () => {
    // The flag is read through the deployment's provider chain (`flagProviders`); the provider answers from `variables` when it is asked.
    const killable = actionOf('doc.feed', { ...feed, gate: 'live' });
    const gated = {
      ...registryOf([killable]),
      modules: [
        {
          id: 'doc',
          contextName: 'doc',
          requires: [],
          optional: [],
          flags: {
            live: { kind: 'boolean', level: 'tenant', default: true, purpose: 'kill-switch' },
          },
          extensionPoints: [],
        },
      ],
    } as unknown as ReturnType<typeof registryOf>;

    async function openStream(variables: Record<string, string | undefined>) {
      const { hub, calls } = fakeHub([head]);
      const invoker = invokerOf(
        gated,
        { flagProviders: [envFlagProvider(variables)] },
        { liveHub: hub },
      );
      const opened = await invoker.open(carrier);
      if (!opened.ok) throw opened.error;
      const iterator = invoker
        .subscribe(callOf('doc.feed', {}, { carrier, session: opened.value }))
        [Symbol.asyncIterator]();
      expect((await iterator.next()).done).toBe(false);
      const session = revalidatorOf(calls);
      return { session, iterator };
    }

    test('an open stream ends at its next revalidation once the switch is closed, with core.feature_suspended', async () => {
      const variables: Record<string, string | undefined> = {};
      const { session, iterator } = await openStream(variables);
      expect((await session.revalidate()).ok).toBe(true);
      variables.KEELWERK_FLAG_DOC_LIVE = 'false';
      const ended = await session.revalidate();
      expect(ended.ok).toBe(false);
      expect(ended.error?.code).toBe('core.feature_suspended');
      await iterator.return?.();
    });
  });
});
