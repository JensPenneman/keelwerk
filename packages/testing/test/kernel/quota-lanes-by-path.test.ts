import { afterEach, describe, expect, test } from 'vitest';
import { drainHooks, effectOf } from './support/hooks-reads.ts';
import { bootReactions } from './support/reactions-kit.ts';
import { watchedHooks } from './support/watched-hooks.ts';

// The jobs a running process enqueues take their lane's cap and weight from the limits of their
// queue in the tenant's scope, and the queued cap only where a decision asks for something anew.
// What decides each case: the job the store was handed (`spy.enqueued`), read after the workers ran
// it to its end; nothing is timed.

const start = Temporal.Instant.from('2026-03-01T08:00:00Z');
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

const quotas = {
  'queue:posts.running': '7',
  'queue:posts.weight': '3',
  'queue:posts.queued': '50',
  'queue:commands.running': '6',
  'queue:commands.weight': '2',
  'queue:commands.queued': '40',
};

describe('the lanes of the jobs of a request that ran to its end', () => {
  test('the effect job a decision requested carries the cap of its queue; its continuation, enqueued by a worker, takes the lane of its queue and no cap', async () => {
    const booted = await watchedHooks(start, cleanup, undefined, { quotas });
    await booted.client.invoke('hooks.notify', { payload: '{"n":1}' });
    await drainHooks(booted);
    const jobs = booted.spy.enqueued.map((entry) => entry.job);
    const effect = jobs.find((job) => job.queue === 'posts');
    const continuation = jobs.find((job) => job.key?.value.startsWith('core.continuation:'));
    expect(effect).toMatchObject({ laneCap: 7, laneWeight: 3, queuedCap: 50 });
    expect(continuation).toMatchObject({ queue: 'commands', laneCap: 6, laneWeight: 2 });
    expect(continuation).not.toHaveProperty('queuedCap');
  });

  test('without limits set the lanes keep the default cap 4 and the weight 1 the backend declares', async () => {
    const booted = await watchedHooks(start, cleanup);
    await booted.client.invoke('hooks.notify', { payload: '{"n":1}' });
    await drainHooks(booted);
    const jobs = booted.spy.enqueued.map((entry) => entry.job);
    const effect = jobs.find((job) => job.queue === 'posts');
    const continuation = jobs.find((job) => job.key?.value.startsWith('core.continuation:'));
    expect(effect).toMatchObject({ laneCap: 4, laneWeight: 1, queuedCap: 10_000 });
    expect(continuation).toMatchObject({ laneCap: 4, laneWeight: 1 });
  });
});

describe('the jobs of the paths that no request starts', () => {
  test('a reaction job takes the lane its queue has for the tenant, from the view the kernel queue was started with, and carries no queued cap', async () => {
    const kit = await bootReactions({
      watched: true,
      env: {},
      config: {
        core: {
          quotas: {
            'queue:reactions.running': '9',
            'queue:reactions.weight': '5',
            'queue:reactions.queued': '60',
          },
        },
      },
    });
    cleanup.push(() => kit.stop());
    await kit.send('acme', { channel: 'news' });
    await kit.settle();
    const reactions = (kit.spy?.enqueued ?? [])
      .map((entry) => entry.job)
      .filter((job) => job.queue === 'reactions');
    expect(reactions.length).toBeGreaterThan(0);
    for (const job of reactions) {
      expect(job).toMatchObject({ laneCap: 9, laneWeight: 5 });
      expect(job).not.toHaveProperty('queuedCap');
    }
  });

  test('the effect job a rebuild enqueues again takes the lane of its queue and carries no queued cap', async () => {
    const booted = await watchedHooks(start, cleanup, undefined, { quotas, serveOnly: true });
    await booted.client.invoke('hooks.notify', { payload: '{"n":1}' });
    const effect = await effectOf(booted, 'hooks.post');
    expect(effect).toMatchObject({ status: 'requested' });
    // The queue loses the job while the row stays requested; the rebuild finds the row and enqueues it again.
    expect(await booted.raw((unit) => unit.jobs.cancel('posts', String(effect?.id)))).toBe(1);
    const before = booted.spy.enqueued.length;
    await booted.runtime.rebuild();
    const again = booted.spy.enqueued.slice(before).map((entry) => entry.job);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ queue: 'posts', laneCap: 7, laneWeight: 3 });
    expect(again[0]).not.toHaveProperty('queuedCap');
  });
});
