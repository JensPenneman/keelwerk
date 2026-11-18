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
const lineage = { depth: 1, origin: event.eventId };

const keySecret = new Uint8Array(32).fill(7);

// HMAC-SHA-256 of the reaction id and the event id, 'chan' or 'subject-1' under the key secret of
// 32 bytes of 7: a key holds no part in the clear. WP-130: regenerated, the digest is keyed and
// binds its owner (the reaction); computed outside the kernel with node:crypto.
const plainHash = '3963bae9d4feb352cb904db4c9056e99376943d254ed38e566272fbdf35ab5ac';
const retriedHash = '5bd78329a4ed53ee9dbb6779336a4ad75699626b266798c8ace3bdee34f44ab4';
const orderedEventHash = 'c72524a63855b382cbaa7a991be257d063086468546726dbeb52ce243a179505';
const orderedChanHash = 'c757ee61fc4b04d68fffa88b3a8fc3c516889ca280f09a3e0dac3063637b3992';
const latestChanHash = '8b1960885da6c6b20a1477271f90105864c0912ade703686722073d855073d08';
const subjectHash = '5ec3ab543cc78cd84488661c2e13f3cce539e98b7c8f5e4207892f16937d00b3';

const inputOf = (job: ReturnType<typeof reactionJob>) => (job.run as { input: unknown }).input;

const jobOf = (name: string, declaredKey?: string) =>
  reactionJob({
    reaction: reactionOf(registry, name),
    event,
    declaredKey,
    lineage,
    build,
    now,
    keySecret,
  });

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
        lineage,
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
      key: { value: `logs.plain:${plainHash}`, onConflict: 'keep' },
      deadLetter: 'logs.plain',
    });
    expect(jobOf('ordered', 'chan')).toEqual({
      ...common,
      run: run('ordered'),
      key: { value: `logs.ordered:${orderedChanHash}`, onConflict: 'append' },
      ordering: 'fifo-per-key',
      deadLetter: 'logs.ordered',
    });
    expect(jobOf('latest', 'chan')).toEqual({
      ...common,
      run: run('latest'),
      key: { value: `logs.latest:${latestChanHash}`, onConflict: 'replace' },
      ordering: 'fifo-per-key',
      deadLetter: 'logs.latest',
    });
    expect(jobOf('retried')).toEqual({
      ...common,
      run: run('retried'),
      key: { value: `logs.retried:${retriedHash}`, onConflict: 'keep' },
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
      lineage,
      processStream: '0197a1c2-7b3e-8c11-9a55-3f2e8d6b4a20',
      subject,
      build,
      now,
      keySecret,
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
      lineage,
      processStream: 'stream-1',
      subject: null,
      build,
      now,
      keySecret,
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
      lineage,
      build,
      now,
      keySecret,
    });
    expect(job.causation).toEqual({ eventId: event.eventId, actor: event.actor, lineage });
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
      lineage,
      build,
      now,
      keySecret,
    });
    expect(job.key).toEqual({ value: `logs.ordered:${orderedEventHash}`, onConflict: 'keep' });
    expect(job).not.toHaveProperty('ordering');
    expect(job.run).toMatchObject({ input: { keyError: 'core.reaction_key_invalid' } });
  });

  test('golden: the causation of a reaction job carries its lineage', () => {
    const deep = { depth: 3, origin: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01' };
    const job = reactionJob({
      reaction: reactionOf(registry, 'plain'),
      event,
      declaredKey: undefined,
      lineage: deep,
      build,
      now,
      keySecret,
    });
    expect(job.causation).toEqual({
      eventId: event.eventId,
      commandId: 'cmd-1',
      actor: event.actor,
      lineage: deep,
    });
    expect(JSON.stringify(job.causation)).toContain(
      '"lineage":{"depth":3,"origin":"0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01"}',
    );
  });
});
