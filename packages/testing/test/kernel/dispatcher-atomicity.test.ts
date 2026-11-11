import { errors } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import { bootReactions } from './support/reactions-kit.ts';
import { relayControl } from './support/relay-control.ts';

const reactions = [
  'relay.echo',
  'relay.flaky',
  'relay.latest',
  'relay.note',
  'relay.ordered',
  'relay.tally',
];

/** The reactions that answered the signals, one entry per echo row. */
async function answered(kit: Awaited<ReturnType<typeof bootReactions>>): Promise<string[]> {
  return (await kit.rows('acme', 'relay.echo')).map((row) => String(row.reaction)).sort();
}

describe('the dispatcher commits its jobs and its checkpoint together', () => {
  test('a unit that throws after the enqueue and before the advance commits neither: the redelivery enqueues once', async () => {
    let crashes = 0;
    const kit = await bootReactions({
      wrap: (spec) => ({
        ...spec,
        consume: async (events, unit) => {
          await spec.consume(events, unit);
          crashes += 1;
          if (crashes === 1) throw errors.internal('a crash after the enqueue');
        },
      }),
    });
    try {
      expect((await kit.send('acme', { channel: 'crash' })).ok).toBe(true);
      await kit.settle();
      expect(crashes).toBeGreaterThanOrEqual(2);
      expect(await answered(kit)).toEqual(reactions);
    } finally {
      await kit.stop();
    }
  });

  // The one test here that depends on a real deadline: the runner's batch deadline is a third of the
  // lease in wall time (one second here), and passing it is what the test is about. Every wait in it
  // is on state (the door, the logged line), and the whole test is bounded to ten seconds.
  test('a consume past its deadline enqueues nothing, and its late failure is logged once', {
    timeout: 10_000,
  }, async () => {
    const lineOf = 'work of a consumer failed after its deadline and was refused';
    const lines: LoggedLine[] = [];
    const logged = Promise.withResolvers<void>();
    const record = lines.push.bind(lines);
    lines.push = (...added) => {
      if (added.some((line) => line.message === lineOf)) logged.resolve();
      return record(...added);
    };
    // The first consume waits at a door the test opens after the deadline has passed.
    const door = Promise.withResolvers<void>();
    let delayed = false;
    const kit = await bootReactions({
      logger: recordingLogger(lines),
      // The batch deadline is a third of the lease: one second of wall time, the runner's own.
      leaseMs: 3000,
      wrap: (spec) => ({
        ...spec,
        consume: async (events, unit) => {
          if (!delayed) {
            delayed = true;
            await door.promise;
          }
          await spec.consume(events, unit);
        },
      }),
    });
    try {
      expect((await kit.send('acme', { channel: 'slow' })).ok).toBe(true);
      await kit.settle();
      expect(await answered(kit)).toEqual(reactions);
      // The abandoned consume resumes after its deadline; its refused statement is the line.
      door.resolve();
      await logged.promise;
      await kit.settle();
      const late = lines.filter((line) => line.message === lineOf);
      expect(late).toHaveLength(1);
      expect(late[0]?.fields).toMatchObject({ consumer: 'core.reactions' });
      expect(await answered(kit)).toEqual(reactions);
    } finally {
      door.resolve();
      await kit.stop();
    }
  });

  test('a key that throws fails the job of that reaction alone: every other reaction answers, nothing is parked', async () => {
    const kit = await bootReactions({ watched: true });
    try {
      relayControl.poison.add('poisoned');
      const sent = await kit.send('acme', { channel: 'poisoned' });
      if (!sent.ok) throw sent.error;
      await kit.settle();
      // The ordered reaction's key throws for this channel; the other reactions get their jobs and decide.
      expect(await answered(kit)).toEqual(reactions.filter((id) => id !== 'relay.ordered'));
      const dead = kit.spy?.completions.filter((one) => one.outcome.kind === 'dead') ?? [];
      expect(dead).toHaveLength(1);
      expect(dead[0]?.outcome).toMatchObject({
        error: {
          kind: 'validation',
          code: 'core.reaction_key_invalid',
          message: 'The reaction failed with core.reaction_key_invalid.',
        },
      });
      // The event was dispatched, not parked, and a later signal of the channel is dispatched too.
      relayControl.poison.delete('poisoned');
      expect((await kit.send('acme', { channel: 'poisoned' })).ok).toBe(true);
      await kit.settle();
      expect(await answered(kit)).toHaveLength(reactions.length * 2 - 1);
    } finally {
      relayControl.poison.clear();
      await kit.stop();
    }
  });

  test('an unparked stream enqueues the jobs of each of its events once', async () => {
    // A failure of the dispatcher's own unit, five times for the event: the stream is parked.
    let failing = true;
    const kit = await bootReactions({
      wrap: (spec) => ({
        ...spec,
        consume: async (events, unit) => {
          await spec.consume(events, unit);
          if (failing) throw errors.internal('the dispatcher cannot commit');
        },
      }),
    });
    try {
      const sent = await kit.send('acme', { channel: 'parked' });
      if (!sent.ok) throw sent.error;
      await kit.settle();
      // The dispatcher gave up on the event: nothing was enqueued, and a signal of another stream passes.
      expect(await answered(kit)).toEqual([]);
      failing = false;
      expect((await kit.send('acme', { channel: 'open' })).ok).toBe(true);
      await kit.settle();
      expect(await answered(kit)).toEqual(reactions);
      const { runtime } = kit;
      const scopeId = runtime.tenants.acme.id;
      await kit.dispatcher.unpark('core.reactions', runtime.namespace.id, scopeId, {
        type: 'relay.signal',
        id: sent.value.signalId,
      });
      await kit.settle();
      expect(await answered(kit)).toEqual([...reactions, ...reactions].sort());
      // A second unpark of a stream that is not parked changes nothing.
      await kit.settle();
      expect(await answered(kit)).toHaveLength(reactions.length * 2);
    } finally {
      await kit.stop();
    }
  });
});
