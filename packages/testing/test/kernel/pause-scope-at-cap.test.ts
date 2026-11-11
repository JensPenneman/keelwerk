import { reactionMatches } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import type { ReactionsKit } from './support/reactions-kit.ts';
import { bootReactions } from './support/reactions-kit.ts';
import { relayApp } from './support/relay-app.ts';

/** The jobs one `relay.signal.created` event makes: one for each async reaction or process of the relay app that listens to it. */
const jobsOfOneEvent = [...relayApp.registry.reactions.values()].filter(
  (reaction) => reaction.timing === 'async' && reactionMatches(reaction, 'relay.signal.created'),
).length;

/** The jobs of the `reactions` lane a tenant has queued (available, scheduled, waiting) and those that are due. */
const lane = async (kit: ReactionsKit, tenant: 'acme' | 'globex') => {
  const { runtime } = kit;
  const stats = await runtime.adapter.unit(
    runtime.namespace,
    kit.scopeOf(tenant),
    (unit) => unit.jobs.stats('reactions'),
    { readOnly: true },
  );
  return {
    queued: stats.reduce((total, row) => total + row.queued, 0),
    due: stats.reduce((total, row) => total + row.due, 0),
  };
};
const echoesOf = async (kit: ReactionsKit, tenant: 'acme' | 'globex', channel: string) =>
  (await kit.rows(tenant, 'relay.echo')).filter((row) => row.channel === channel);

describe('the dispatcher pauses a scope above 90 percent of its queued cap', () => {
  test('jobs in back-off hold their scope although none is due, and another tenant is dispatched meanwhile; the scope resumes when they are done', async () => {
    // A cap of 2: the line is 1.8 queued jobs. The reaction `relay.flaky` fails three times on the
    // channel `down` and waits 10, 20 and 40 seconds between its attempts, and `relay.gated` fails once
    // and waits 10, so both jobs of the first event are scheduled (due 0) and still queued.
    const kit = await bootReactions({ queued: 2, holdMs: 1000 });
    try {
      expect((await kit.send('acme', { channel: 'down' })).ok).toBe(true);
      await kit.settle();
      // Every other reaction answered; two jobs wait in back-off. The lane is above the line with nothing due.
      expect(await lane(kit, 'acme')).toEqual({ queued: 2, due: 0 });

      // A new event of acme is held; the event of globex is dispatched in the same pass.
      expect((await kit.send('acme', { channel: 'open' })).ok).toBe(true);
      expect((await kit.send('globex', { channel: 'other' })).ok).toBe(true);
      await kit.settle();
      expect(await echoesOf(kit, 'acme', 'open')).toEqual([]);
      expect((await echoesOf(kit, 'globex', 'other')).length).toBeGreaterThan(0);
      expect((await lane(kit, 'acme')).queued).toBe(2);

      // The retries run and end (the fourth attempt of the flaky one succeeds, the gated one is refused for good): the lane empties, the hold ends and the event is dispatched.
      for (const seconds of [11, 21, 41]) {
        await kit.advanceTo(kit.now().add({ seconds }));
      }
      expect((await lane(kit, 'acme')).queued).toBe(0);
      // The hold ends on the runtime clock, and the pass that lifts it is woken by a wall timer of at most
      // a second: wait on the state (the event's echoes), a bounded number of rounds.
      for (let round = 0; round < 10; round += 1) {
        if ((await echoesOf(kit, 'acme', 'open')).length > 0) break;
        await kit.advanceTo(kit.now().add({ seconds: 2 }));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect((await echoesOf(kit, 'acme', 'open')).length).toBeGreaterThan(0);
    } finally {
      await kit.stop();
    }
  });

  test('the batch is not weighed against the cap: one job in back-off does not hold a scope whose next batch makes as many jobs as the cap', async () => {
    // The cap is the jobs of one event, so a batch of one event just fits the cap. `relay.gated` fails
    // once on every event and waits 10 seconds: after the first event one job is queued, under the line
    // of 0.9 times the cap. A rule that also weighed the batch (1 + the batch above the cap) would hold
    // the scope and the echoes of the second event would never appear.
    const kit = await bootReactions({ queued: jobsOfOneEvent, holdMs: 1000 });
    try {
      expect((await kit.send('acme', { channel: 'first' })).ok).toBe(true);
      await kit.settle();
      expect(await lane(kit, 'acme')).toEqual({ queued: 1, due: 0 });
      expect((await kit.send('acme', { channel: 'second' })).ok).toBe(true);
      await kit.settle();
      expect((await echoesOf(kit, 'acme', 'second')).length).toBeGreaterThan(0);
    } finally {
      await kit.stop();
    }
  });
});
