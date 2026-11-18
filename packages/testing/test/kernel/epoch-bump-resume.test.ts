import type { LiveFrame, StateToken } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { useEpochDirectories, type Warning, warnings } from './support/epoch-directories.ts';
import { bootHooks } from './support/hooks-kit.ts';
import { effectOf } from './support/hooks-reads.ts';
import { restoreLiveApp } from './support/restore-live-app.ts';

type Ids = { readonly backendId: string; readonly tenants: Record<string, string> };

const directories = useEpochDirectories();
const { durableFactory, backUp, restore } = directories;

describe('what a restore leaves behind at the next start (14.7.6), PGlite on directories', () => {
  test('an executor effect a restore left requested gets its job again', {
    timeout: 180_000,
  }, async () => {
    const logged: Warning[] = [];
    const bootEffects = (join_?: Ids) =>
      bootHooks({
        adapter: 'pglite',
        endpoint: 'http://127.0.0.1:1/',
        // No worker: the effects are requested and never taken, so only the restore moves the queue.
        serveOnly: true,
        external: { factory: durableFactory(), url: 'pglite' },
        logger: warnings(logged),
        ...(join_ === undefined ? {} : { join: join_ }),
      });
    const queued = async (booted: Awaited<ReturnType<typeof bootEffects>>): Promise<number> =>
      booted.raw(async (unit) =>
        (await unit.jobs.stats('hooks')).reduce((sum, row) => sum + row.queued, 0),
      );
    const first = await bootEffects();
    directories.track(() => first.runtime.stop(1000));
    const ids = {
      backendId: first.runtime.backendId,
      tenants: { acme: first.runtime.tenants.acme.id },
    };
    await first.client.invoke('hooks.notify', { payload: 'one' });
    const effect = await effectOf(first, 'hooks.post');
    expect(effect).toMatchObject({ status: 'requested' });
    expect(await queued(first)).toBe(1);
    // The queue loses the job while the row stays requested: the state a backup of a queue that lags its rows holds.
    expect(await first.raw((unit) => unit.jobs.cancel('hooks', String(effect?.id)))).toBe(1);
    expect(await queued(first)).toBe(0);
    await first.runtime.stop(1000);
    directories.release();
    await backUp();

    const second = await bootEffects(ids);
    directories.track(() => second.runtime.stop(1000));
    await second.client.invoke('hooks.notify', { payload: 'two' });
    await second.client.invoke('hooks.notify', { payload: 'three' });
    await second.runtime.stop(1000);
    directories.release();
    await restore();

    const third = await bootEffects(ids);
    directories.track(() => third.runtime.stop(1000));
    expect(logged.some((entry) => entry.message.includes('a restore was detected'))).toBe(true);
    expect(await effectOf(third, 'hooks.post')).toMatchObject({
      id: effect?.id,
      status: 'requested',
    });
    // The restored row is requested and its job is back: keyed by the effect id, once.
    expect(await queued(third)).toBe(1);
    expect(await third.raw((unit) => unit.jobs.cancel('hooks', String(effect?.id)))).toBe(1);
  });

  test('a stream resumed with a token from before the restore answers reset; a token from after it resumes', {
    timeout: 180_000,
  }, async () => {
    type LiveRuntime = TestRuntime<typeof restoreLiveApp, 'acme'>;
    const bootLive = async (join_?: Ids): Promise<LiveRuntime> => {
      const runtime = await startTestRuntime(restoreLiveApp, {
        external: { factory: durableFactory(), url: 'pglite' },
        tenants: ['acme'],
        ...(join_ === undefined ? {} : { join: join_ }),
      });
      directories.track(() => runtime.stop(1000));
      return runtime;
    };
    const ada = testPrincipal('ada');
    const call = (runtime: LiveRuntime, action: string, input: unknown) =>
      createLocalClient(runtime, { principal: ada }).invoke(action as never, input as never);
    const resume = async (
      runtime: LiveRuntime,
      after: StateToken,
    ): Promise<readonly LiveFrame<unknown>[]> => {
      const abort = new AbortController();
      const iterator = runtime.invoker
        .subscribe<unknown, unknown>(
          {
            action: 'journal.notes',
            input: {},
            carrier: testCarrier(runtime.tenants.acme, ada),
            requestId: crypto.randomUUID(),
            signal: abort.signal,
          },
          { after },
        )
        [Symbol.asyncIterator]();
      const frames: LiveFrame<unknown>[] = [];
      try {
        for (;;) {
          const step = await iterator.next();
          if (step.done === true) break;
          frames.push(step.value);
          if ('control' in step.value && ['head', 'reset'].includes(String(step.value.control)))
            break;
        }
      } finally {
        abort.abort();
        await iterator.return?.();
      }
      return frames;
    };
    const resets = (frames: readonly LiveFrame<unknown>[]): boolean =>
      frames.some((frame) => 'control' in frame && frame.control === 'reset');
    const tokenOf = async (runtime: LiveRuntime): Promise<StateToken> =>
      ((await call(runtime, 'journal.note.get', { ids: [] })) as { state: StateToken }).state;

    const first = await bootLive();
    await call(first, 'journal.record', { text: 'one' });
    const before = await tokenOf(first);
    expect(resets(await resume(first, before))).toBe(false);
    const ids = { backendId: first.backendId, tenants: { acme: first.tenants.acme.id } };
    await first.stop(1000);
    directories.release();
    await backUp();

    const second = await bootLive(ids);
    await call(second, 'journal.record', { text: 'two' });
    await call(second, 'journal.record', { text: 'three' });
    await second.stop(1000);
    directories.release();
    await restore();

    const third = await bootLive(ids);
    expect(resets(await resume(third, before))).toBe(true);
    const after = await tokenOf(third);
    expect(resets(await resume(third, after))).toBe(false);
  });
});
