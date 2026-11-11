import { metrics } from '@opentelemetry/api';
import { describe, expect, test, vi } from 'vitest';
import {
  noteEvent,
  reactionOf,
  reactionRegistry,
  reactionTenantScope,
} from '../../test/reaction-kit.ts';
import { personalSealerKey } from '../encryption/personal-sealer-key.ts';
import type { KweEnvelope } from '../keys/kwe-envelope.ts';
import type { Logger } from '../observability/logger.ts';
import type { Meter } from '../observability/meter.ts';
import type { Unit } from '../storage/unit.ts';
import { openAsyncReaction } from './open-async-reaction.ts';
import type { ReactionJobInput } from './reaction-job-input.ts';

const registry = reactionRegistry();
const stored = noteEvent();
const input: ReactionJobInput = {
  event: stored.eventId,
  streamType: 'logs.note',
  streamId: stored.stream.id,
  version: 1,
  position: '7',
};

/** The sealed subject a process job carries; the fake sealer below opens it as `opened`. */
const sealed: KweEnvelope = { $kwe: 1, k: 'key-1', n: 'n', c: 'c' };

/** `unit` with a sealer that opens every sealed subject as `opened` (undefined: its key is destroyed). */
function sealingUnit(unit: Unit, opened: string | undefined): Unit {
  const wrapped = { ...unit };
  Object.defineProperty(wrapped, personalSealerKey, {
    value: {
      openProcessSubject: () => Promise.resolve(opened),
      openEvents: (events: readonly unknown[]) => Promise.resolve(events),
      readEvents: (events: readonly unknown[]) => Promise.resolve(events),
    },
    enumerable: true,
  });
  return wrapped;
}

/** A unit holding `events` on the note stream and no process stream. */
function unitHolding(events: readonly (typeof stored)[]): Unit {
  return {
    scope: reactionTenantScope,
    rows: { findOne: () => Promise.resolve(undefined) },
    events: {
      readStream: (ref: { type: string; id: string }, range?: { fromVersion?: number }) =>
        Promise.resolve(
          ref.type === 'logs.note'
            ? events.filter((event) => event.version === (range?.fromVersion ?? 0))
            : [],
        ),
    },
  } as unknown as Unit;
}

describe('opening an async reaction for its job', () => {
  test('reads the event the job names and decides with it', async () => {
    const opened = await openAsyncReaction({
      unit: unitHolding([stored]),
      registry,
      reaction: reactionOf(registry, 'plain'),
      input,
    });
    expect(opened.event?.id).toBe(stored.eventId);
    expect(opened.process).toBeUndefined();
  });

  test('a record that is no longer there completes the job deciding nothing', async () => {
    const opened = await openAsyncReaction({
      unit: unitHolding([]),
      registry,
      reaction: reactionOf(registry, 'plain'),
      input,
    });
    expect(opened.event).toBeUndefined();
    expect(opened.decide({})).toBeUndefined();
  });

  test('another event at that place is internal', async () => {
    await expect(
      openAsyncReaction({
        unit: unitHolding([noteEvent({ eventId: 'another' })]),
        registry,
        reaction: reactionOf(registry, 'plain'),
        input,
      }),
    ).rejects.toMatchObject({ kind: 'internal' });
  });

  test('a process folds the stream its job names and never computes its key', async () => {
    const reaction = reactionOf(registry, 'tally');
    const keyed = {
      ...reaction,
      key: () => {
        throw new Error('the key is not computed again');
      },
    };
    const opened = await openAsyncReaction({
      unit: sealingUnit(unitHolding([stored]), 'note-1'),
      registry,
      reaction: keyed,
      input: { ...input, processStream: 'stream-1', subject: sealed },
    });
    expect(opened.process).toMatchObject({ subject: 'note-1', state: { count: 0 }, version: 0 });
    expect(opened.process?.stream).toEqual({ type: 'logs.tally', id: 'stream-1' });
    expect(opened.decisionProcess?.streamId).toBe('stream-1');
  });

  test.each([
    ['sealed under a key that is destroyed since', sealed, undefined],
    ['erased when the job was queued', null, 'note-1'],
  ])(
    'a process job whose subject was %s decides nothing, is logged once and counted',
    async (_name, subject, opens) => {
      const lines: { message: string; fields: unknown }[] = [];
      const log = {
        warn: (message: string, fields: unknown) => lines.push({ message, fields }),
      } as unknown as Logger;
      const added: unknown[] = [];
      vi.spyOn(metrics, 'getMeter').mockReturnValue({
        createCounter: () => ({
          add: (value: number, attributes: unknown) => added.push([value, attributes]),
        }),
      } as unknown as Meter);
      const unit = unitHolding([stored]);
      const reads = vi.spyOn(unit.events, 'readStream');
      const opened = await openAsyncReaction({
        unit: sealingUnit(unit, opens),
        registry,
        reaction: reactionOf(registry, 'tally'),
        input: { ...input, processStream: 'stream-1', subject },
        log,
      });
      vi.restoreAllMocks();
      expect(opened.event).toBeUndefined();
      expect(opened.process).toBeUndefined();
      expect(opened.decide({})).toBeUndefined();
      expect(lines).toEqual([
        {
          message: 'a process job found its subject erased and decides nothing',
          fields: { reaction: 'logs.tally', event: stored.eventId },
        },
      ]);
      expect(added).toEqual([[1, { fault: 'subject_erased', reaction: 'logs.tally' }]]);
      // The stream is not folded for a subject that is gone.
      expect(reads.mock.calls.every(([ref]) => ref.type !== 'logs.tally')).toBe(true);
    },
  );

  test('a process job without its instance or its subject is internal', async () => {
    const run = (extra: Partial<ReactionJobInput>) =>
      openAsyncReaction({
        unit: sealingUnit(unitHolding([stored]), 'note-1'),
        registry,
        reaction: reactionOf(registry, 'tally'),
        input: { ...input, ...extra },
      });
    await expect(run({ subject: sealed })).rejects.toMatchObject({ kind: 'internal' });
    await expect(run({ processStream: 'stream-1' })).rejects.toMatchObject({ kind: 'internal' });
  });

  test('a job that names an event of a process stream is internal, and nothing is read', async () => {
    const reads: unknown[] = [];
    const unit = {
      scope: reactionTenantScope,
      events: {
        readStream: (...args: unknown[]) => {
          reads.push(args);
          return Promise.resolve([]);
        },
      },
    } as unknown as Unit;
    await expect(
      openAsyncReaction({
        unit,
        registry,
        reaction: reactionOf(registry, 'plain'),
        input: { ...input, streamType: 'logs.tally' },
      }),
    ).rejects.toMatchObject({ kind: 'internal', code: 'core.internal' });
    expect(reads).toEqual([]);
  });

  test('a job marked with a key error fails with that registered code before anything is read', async () => {
    const run = (keyError: string) =>
      openAsyncReaction({
        unit: unitHolding([stored]),
        registry,
        reaction: reactionOf(registry, 'ordered'),
        input: { ...input, keyError },
      });
    await expect(run('core.reaction_key_invalid')).rejects.toMatchObject({
      kind: 'validation',
      code: 'core.reaction_key_invalid',
    });
    await expect(run('core.process_instance_key_invalid')).rejects.toMatchObject({
      kind: 'validation',
      code: 'core.process_instance_key_invalid',
    });
    await expect(run('core.timeout')).rejects.toMatchObject({ kind: 'internal' });
  });

  test('an event purged before its job ran is logged once with the reaction and the event id', async () => {
    const lines: { message: string; fields: unknown }[] = [];
    const log = {
      warn: (message: string, fields: unknown) => lines.push({ message, fields }),
    } as unknown as Logger;
    await openAsyncReaction({
      unit: unitHolding([]),
      registry,
      reaction: reactionOf(registry, 'plain'),
      input,
      log,
    });
    expect(lines).toEqual([
      {
        message: 'a reaction job found its event purged and decides nothing',
        fields: { reaction: 'logs.plain', event: stored.eventId },
      },
    ]);
  });
});
