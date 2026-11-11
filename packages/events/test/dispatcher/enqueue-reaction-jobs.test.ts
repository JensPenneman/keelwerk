import { createHash } from 'node:crypto';
import type { JobQueue, JobSpec, Logger, Registry, Unit } from '@keelwerk/core';
import { processStreamRef, sealingUnit } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { enqueueReactionJobs } from '../../src/dispatcher/enqueue-reaction-jobs.ts';
import {
  dispatchRegistry,
  eventOf,
  reactionKeys,
  reactionLiteral,
} from './support/dispatch-registry.ts';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const registry = dispatchRegistry();
const now = Temporal.Instant.from('2026-03-01T08:00:01Z');
const build = { id: 'build-1', revision: 1 };

/** The subject whose keys are destroyed. */
const erased = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a99';

/** A queue that keeps the specs it is given, and a unit that reads no row. */
function fixture() {
  const specs: JobSpec[] = [];
  const queue = {
    enqueue: (spec: JobSpec) => {
      specs.push(spec);
      return Promise.resolve(String(specs.length));
    },
  } as unknown as JobQueue;
  const raw = {
    rows: { find: () => Promise.resolve({ rows: [] }) },
    scope: eventOf('trace.note.created').scope,
    namespace: { id: 'ns-1' },
    // A subject's data key; the subject erased is `erased`.
    keys: {
      dataKey: (subject: string) =>
        Promise.resolve(
          subject === erased ? undefined : { id: 'dk-1', material: new Uint8Array(32).fill(7) },
        ),
    },
  } as unknown as Unit;
  const unit = sealingUnit(raw, {
    keys: { derive: () => Promise.reject(new Error('no index keys here')) },
    describe: () => undefined,
    maxScan: 1,
    random: (bytes) => new Uint8Array(bytes).fill(1),
  });
  return { specs, queue, unit };
}
/** A logger that keeps the warnings it is given. */
function recorder() {
  const warnings: { message: string; fields: unknown }[] = [];
  const log = {
    warn: (message: string, fields: unknown) => warnings.push({ message, fields }),
  } as unknown as Logger;
  return { log, warnings };
}
const run = (
  events: Parameters<typeof enqueueReactionJobs>[0]['events'],
  over: { readonly registry?: Registry; readonly log?: Logger } = {},
) => {
  const { specs, queue, unit } = fixture();
  return enqueueReactionJobs({
    unit,
    registry: over.registry ?? registry,
    events,
    queue,
    log: over.log ?? recorder().log,
    build,
    now,
  }).then((count) => ({ count, specs }));
};
const actionsOf = (specs: readonly JobSpec[]) =>
  specs.map((spec) => ('action' in spec.run ? spec.run.action : '')).sort();

describe('the jobs of one batch', () => {
  test('one job per matching async reaction per event, none for an inline reaction', async () => {
    const { count, specs } = await run([eventOf('trace.note.created')]);
    expect(count).toBe(3);
    expect(actionsOf(specs)).toEqual(['trace.every', 'trace.ordered', 'trace.plain']);
    expect(specs.every((spec) => spec.queue === 'reactions')).toBe(true);
    // Each job runs as its module's service principal, caused by the event and the actor that wrote it.
    for (const spec of specs) {
      expect(spec.principal).toEqual({ resolver: 'core.module', principalId: 'trace.system' });
      expect(spec.causation).toMatchObject({
        commandId: 'cmd-1',
        actor: { kind: 'user', id: 'ada', via: 'auth.session' },
      });
    }
    expect(specs.every((spec) => spec.deadLetter === spec.key?.value.split(':')[0])).toBe(true);
  });

  test("an `on: 'all'` reaction gets every event but the ones it excepts", async () => {
    const { specs } = await run([
      eventOf('trace.mark.created', { stream: { type: 'trace.mark', id: 'm' } }),
    ]);
    expect(actionsOf(specs)).toEqual([]);
    const other = await run([eventOf('trace.note.changed')]);
    expect(actionsOf(other.specs)).toEqual(['trace.every']);
  });

  test('a transient record is skipped, and events keep their order', async () => {
    const first = eventOf('trace.note.created', { eventId: 'e1' });
    const second = eventOf('trace.note.created', { eventId: 'e2' });
    const { specs } = await run([
      first,
      eventOf('trace.note.created', { eventId: 'skipped', transient: true }),
      second,
    ]);
    const ids = specs.map((spec) =>
      'action' in spec.run ? (spec.run.input as { event: string }).event : '',
    );
    expect(ids.filter((id) => id === 'skipped')).toEqual([]);
    expect(ids.indexOf('e1')).toBeLessThan(ids.indexOf('e2'));
    expect(specs).toHaveLength(6);
  });

  test('the declared key is computed for the reactions that group by it, once per event and module', async () => {
    reactionKeys.seen = 0;
    const { specs } = await run([eventOf('trace.note.created')]);
    expect(reactionKeys.seen).toBe(1);
    const ordered = specs.find(
      (spec) => 'action' in spec.run && spec.run.action === 'trace.ordered',
    );
    // The row is gone in this unit, so the key falls back to the function's own default.
    expect(ordered?.key).toEqual({
      value: `trace.ordered:${sha256('none')}`,
      onConflict: 'append',
    });
    expect(ordered?.ordering).toBe('fifo-per-key');
  });

  test('no async reaction, no job', async () => {
    const { queue, unit, specs } = fixture();
    const quiet = { ...registry, reactions: new Map() };
    expect(
      await enqueueReactionJobs({
        unit,
        registry: quiet,
        events: [eventOf('trace.note.created')],
        queue,
        log: recorder().log,
        build,
        now,
      }),
    ).toBe(0);
    expect(specs).toEqual([]);
  });

  describe('the events of a process stream', () => {
    const withProcess = dispatchRegistry({ process: 'plain' });
    const processEvent = () => eventOf('trace.tally.noted');

    test('reach no reaction: an on-all one and one that names the process event get no job', async () => {
      const { count, specs } = await run([processEvent()], { registry: withProcess });
      expect(count).toBe(0);
      expect(specs).toEqual([]);
    });

    test('and an entity event still reaches the on-all reaction', async () => {
      const { specs } = await run([processEvent(), eventOf('trace.note.changed')], {
        registry: withProcess,
      });
      expect(actionsOf(specs)).toEqual(['trace.every']);
    });
  });

  describe('a reaction whose key fails', () => {
    const failing = (name: string, key: () => unknown) => ({
      [name]: reactionLiteral({ ordering: 'fifo-per-key', key }),
    });

    test('gets a job of its own that fails when it runs, and no other reaction waits for it', async () => {
      const { log, warnings } = recorder();
      const broken = dispatchRegistry({
        extra: {
          ...failing('throws', () => {
            throw new Error('ada@example.com');
          }),
          ...failing('empty', () => ''),
          ...failing('silent', () => undefined),
        },
      });
      const { count, specs } = await run([eventOf('trace.note.created')], {
        registry: broken,
        log,
      });
      expect(count).toBe(6);
      expect(actionsOf(specs)).toEqual([
        'trace.empty',
        'trace.every',
        'trace.ordered',
        'trace.plain',
        'trace.silent',
        'trace.throws',
      ]);
      for (const name of ['throws', 'empty', 'silent']) {
        const spec = specs.find((one) => 'action' in one.run && one.run.action === `trace.${name}`);
        expect(spec?.run).toMatchObject({ input: { keyError: 'core.reaction_key_invalid' } });
        expect(spec?.key?.onConflict).toBe('keep');
        expect(spec?.ordering).toBeUndefined();
      }
      const ordered = specs.find(
        (one) => 'action' in one.run && one.run.action === 'trace.ordered',
      );
      expect(ordered?.run).not.toHaveProperty('input.keyError');
      // The reaction id and the error code only: never the message of the error.
      expect(warnings).toHaveLength(3);
      expect(JSON.stringify(warnings)).not.toContain('example.com');
      expect(warnings.map((line) => line.fields)).toEqual(
        ['trace.empty', 'trace.silent', 'trace.throws'].map((reaction) => ({
          reaction,
          code: 'core.reaction_key_invalid',
        })),
      );
    });

    test('the instance key of a process with personal members must be a UUID, else its job fails alone', async () => {
      const personal = dispatchRegistry({ process: 'personal' });
      const archived = (id: string) =>
        eventOf('trace.note.archived', { stream: { type: 'trace.note', id } });
      const uuid = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a12';
      const { specs, count } = await run([archived(uuid), archived('not-a-uuid')], {
        registry: personal,
      });
      const tally = specs.filter((one) => 'action' in one.run && one.run.action === 'trace.tally');
      expect(count).toBe(specs.length);
      expect(
        tally.map((one) => (one.run as { input: { keyError?: string } }).input.keyError),
      ).toEqual([undefined, 'core.process_instance_key_invalid']);
    });

    test('a process job names its instance by the derived stream id; one with a data subject carries it sealed, or null when it is erased', async () => {
      const personal = dispatchRegistry({ process: 'personal' });
      const archived = (id: string) =>
        eventOf('trace.note.archived', { stream: { type: 'trace.note', id } });
      const uuid = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a12';
      const { specs } = await run([archived(uuid), archived(erased)], { registry: personal });
      const inputs = specs
        .filter((one) => 'action' in one.run && one.run.action === 'trace.tally')
        .map(
          (one) =>
            (one.run as { input: { processStream?: string; subject?: { $kwe?: number } | null } })
              .input,
        );
      const scope = eventOf('trace.note.created').scope;
      expect(inputs.map((input) => input.processStream)).toEqual([
        processStreamRef(scope, 'trace.tally', uuid).id,
        processStreamRef(scope, 'trace.tally', erased).id,
      ]);
      expect(inputs[0]?.subject).toMatchObject({ $kwe: 1, k: 'dk-1' });
      expect(inputs[1]?.subject).toBeNull();
      // The sealed subject holds the instance key in no readable form.
      expect(JSON.stringify(inputs[0]?.subject)).not.toContain(uuid);
    });

    test('a process without a data subject carries the stream id and no subject', async () => {
      const { specs } = await run([eventOf('trace.note.archived')], {
        registry: dispatchRegistry({ process: 'plain' }),
      });
      const [input] = specs
        .filter((one) => 'action' in one.run && one.run.action === 'trace.tally')
        .map((one) => (one.run as unknown as { input: Record<string, unknown> }).input);
      expect(input?.processStream).toEqual(expect.any(String));
      expect(input).not.toHaveProperty('subject');
    });
  });

  describe('the key of a process', () => {
    test('is computed from the event without `current`, as the process computes it again; a reaction key still has it', async () => {
      const seen: { process: boolean; reaction: boolean }[] = [];
      const withCurrent = (event: { readonly current?: unknown }): string => {
        seen.push({ process: event.current !== undefined, reaction: false });
        return 'k';
      };
      const kept = dispatchRegistry({
        process: 'plain',
        processKey: withCurrent as never,
        extra: {
          viewed: reactionLiteral({
            on: 'trace.note.archived',
            ordering: 'fifo-per-key',
            key: (event: { readonly current?: unknown }) => {
              seen.push({ process: false, reaction: event.current !== undefined });
              return 'v';
            },
          }),
        },
      });
      const { specs, queue } = fixture();
      const unit = {
        rows: { findOne: () => Promise.resolve({ id: 'n1', text: 'a', kwVersion: 1 }) },
        scope: eventOf('trace.note.created').scope,
      } as unknown as Unit;
      await enqueueReactionJobs({
        unit,
        registry: kept,
        events: [eventOf('trace.note.archived', { stream: { type: 'trace.note', id: 'n1' } })],
        queue,
        log: recorder().log,
        build,
        now,
      });
      expect(specs.length).toBeGreaterThan(0);
      // The process key ran, and it was given no row.
      expect(seen.filter((one) => !one.reaction).every((one) => one.process === false)).toBe(true);
      expect(seen.some((one) => !one.reaction)).toBe(true);
      expect(seen.filter((one) => one.reaction)).toEqual([{ process: false, reaction: true }]);
    });
  });
});
