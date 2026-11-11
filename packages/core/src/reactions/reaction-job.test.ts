import { describe, expect, test } from 'vitest';
import {
  noteEvent,
  reactionOf,
  reactionRegistry,
  reactionTenantScope,
} from '../../test/reaction-kit.ts';
import { reactionJob } from './reaction-job.ts';

const registry = reactionRegistry();
const now = Temporal.Instant.from('2026-03-01T08:00:01Z');
const build = { id: 'build-1', revision: 3 };
const event = noteEvent();

// sha256 of the event id, of 'chan' and of 'subject-1': a key holds no part in the clear.
const eventHash = '51f0795c66a2052f73bfd111020b40d6b47ee782384989f08de94c524fad9571';
const chanHash = '2466fcafe0531db08547f61d39bd340224e92f3410d58837e04cb845d790b970';
const subjectHash = '95efa64dfaf09a0f9bbdf42842b80fc01d96a1c75aaccc53d101a31ccb6da774';

const inputOf = (job: ReturnType<typeof reactionJob>) => (job.run as { input: unknown }).input;

const jobOf = (name: string, declaredKey?: string) =>
  reactionJob({ reaction: reactionOf(registry, name), event, declaredKey, build, now });

describe('the job of an async reaction for an event', () => {
  test('golden: a plain reaction, a FIFO one, a coalescing one, a retried one and a process', () => {
    const common = {
      queue: 'reactions',
      scope: reactionTenantScope,
      principal: { resolver: 'core.module', principalId: 'logs.system' },
      causation: {
        eventId: event.eventId,
        commandId: 'cmd-1',
        actor: { kind: 'user', id: 'ada', via: 'auth.session' },
      },
      build,
      deadLetter: expect.any(String),
    };
    const input = {
      event: event.eventId,
      streamType: 'logs.note',
      streamId: event.stream.id,
      version: 1,
      position: '7',
    };
    const run = (name: string) => ({
      action: `logs.${name}`,
      input,
      commandId: `kernel:reaction:logs.${name}:${event.eventId}`,
    });
    expect(jobOf('plain')).toEqual({
      ...common,
      run: run('plain'),
      key: { value: `logs.plain:${eventHash}`, onConflict: 'keep' },
      deadLetter: 'logs.plain',
    });
    expect(jobOf('ordered', 'chan')).toEqual({
      ...common,
      run: run('ordered'),
      key: { value: `logs.ordered:${chanHash}`, onConflict: 'append' },
      ordering: 'fifo-per-key',
      deadLetter: 'logs.ordered',
    });
    expect(jobOf('latest', 'chan')).toEqual({
      ...common,
      run: run('latest'),
      key: { value: `logs.latest:${chanHash}`, onConflict: 'replace' },
      ordering: 'fifo-per-key',
      deadLetter: 'logs.latest',
    });
    expect(jobOf('retried')).toEqual({
      ...common,
      run: run('retried'),
      key: { value: `logs.retried:${eventHash}`, onConflict: 'keep' },
      group: { id: 'logs.retried', concurrency: 2 },
      retry: { limit: 5, delays: ['10s', '20s'] },
      deadLetter: 'logs.retried',
    });
    expect(jobOf('tally', 'subject-1')).toEqual({
      ...common,
      run: run('tally'),
      key: { value: `logs.tally:${subjectHash}`, onConflict: 'append' },
      ordering: 'fifo-per-key',
      deadLetter: 'logs.tally',
    });
  });

  test('golden: the input of a process job names its instance by stream id and carries its sealed subject', () => {
    const subject = { $kwe: 1 as const, k: 'dk-1', n: 'AQEBAQEBAQEBAQEB', c: 'Yw' };
    const job = reactionJob({
      reaction: reactionOf(registry, 'tally'),
      event,
      declaredKey: 'subject-1',
      processStream: '0197a1c2-7b3e-8c11-9a55-3f2e8d6b4a20',
      subject,
      build,
      now,
    });
    expect(inputOf(job)).toEqual({
      event: event.eventId,
      streamType: 'logs.note',
      streamId: event.stream.id,
      version: 1,
      position: '7',
      processStream: '0197a1c2-7b3e-8c11-9a55-3f2e8d6b4a20',
      subject,
    });
    // An erased subject is stored as null, and a job of no process carries neither member.
    const erased = reactionJob({
      reaction: reactionOf(registry, 'tally'),
      event,
      declaredKey: 'subject-1',
      processStream: 'stream-1',
      subject: null,
      build,
      now,
    });
    expect(inputOf(erased)).toMatchObject({ subject: null });
    expect(inputOf(jobOf('plain'))).not.toHaveProperty('processStream');
    expect(inputOf(jobOf('plain'))).not.toHaveProperty('subject');
    expect(JSON.stringify(job)).not.toContain('subject-1');
  });

  test('a command-less event leaves the command out of the causation', () => {
    const job = reactionJob({
      reaction: reactionOf(registry, 'plain'),
      event: noteEvent({ commandId: null }),
      declaredKey: undefined,
      build,
      now,
    });
    expect(job.causation).toEqual({ eventId: event.eventId, actor: event.actor });
  });

  test('an empty declared key is a validation error', () => {
    expect(() => jobOf('ordered', '')).toThrow(
      expect.objectContaining({ kind: 'validation', code: 'core.validation' }),
    );
  });

  test('a coalescing reaction is ordered too, so a newer event waits behind the older one that is running', () => {
    expect(jobOf('latest', 'chan')).toMatchObject({
      key: { onConflict: 'replace' },
      ordering: 'fifo-per-key',
    });
  });

  test('the input names the event by id, stream, version and position, and holds no data', () => {
    expect(jobOf('plain').run).toMatchObject({
      input: { event: event.eventId, version: 1, position: '7' },
    });
    expect(JSON.stringify(jobOf('plain').run)).not.toContain('hello');
  });

  test('a reaction whose key failed gets a job of its own that carries the code it fails with', () => {
    const job = reactionJob({
      reaction: reactionOf(registry, 'ordered'),
      event,
      declaredKey: undefined,
      keyError: 'core.reaction_key_invalid',
      build,
      now,
    });
    expect(job.key).toEqual({ value: `logs.ordered:${eventHash}`, onConflict: 'keep' });
    expect(job).not.toHaveProperty('ordering');
    expect(job.run).toMatchObject({ input: { keyError: 'core.reaction_key_invalid' } });
  });
});
