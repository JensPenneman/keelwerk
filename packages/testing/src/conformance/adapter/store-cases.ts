import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { receiptStoreCases } from './receipt-store-cases.ts';
import { storedJob } from './stored-job.ts';

const { tenantA } = conformanceScopes;
const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;

export function storeCases(subject: ConformanceSubject): void {
  receiptStoreCases(subject);

  describe('jobs (14.3.9)', () => {
    const take = (subject2: ConformanceSubject, worker = 'w1', queue = 'commands') =>
      subject2.run(
        namespaceScope,
        async (unit) =>
          (
            await unit.jobs.take(queue, worker, {
              limit: 10,
              capabilitySets: [''],
              maxRevision: 100,
              leaseMs: 30_000,
            })
          ).jobs,
      );
    const hour = Temporal.Now.instant().add({ hours: 1 });
    const past = Temporal.Now.instant().subtract({ minutes: 1 });

    test('enqueue then take hands the job to one worker with its attempt', async () => {
      const id = await subject.run(tenantA, (unit) => unit.jobs.enqueue(storedJob()));
      const jobs = await take(subject);
      expect(jobs.map((job) => job.id)).toEqual([id]);
      expect(jobs[0]?.attempt.jobId).toBe(id);
      expect(await take(subject, 'w2')).toEqual([]);
    });

    test('a job keyed keep leaves the pending one; replace swaps it', async () => {
      const keyed = (onConflict: 'keep' | 'replace', input: number) =>
        storedJob({ key: { value: 'k', onConflict }, run: { action: 'a', input } });
      const kept = await subject.run(tenantA, async (unit) => [
        await unit.jobs.enqueue(keyed('keep', 1)),
        await unit.jobs.enqueue(keyed('keep', 2)),
      ]);
      expect(kept[1]).toBe(kept[0]);
      expect((await take(subject)).map((job) => job.run)).toEqual([{ action: 'a', input: 1 }]);
      const replaced = await subject.run(tenantA, async (unit) => [
        await unit.jobs.enqueue(keyed('replace', 3)),
        await unit.jobs.enqueue(keyed('replace', 4)),
      ]);
      expect(replaced[1]).not.toBe(replaced[0]);
      expect((await take(subject)).map((job) => job.run)).toEqual([{ action: 'a', input: 4 }]);
    });

    test('coalesce keeps the existing job and moves its time to the earlier one', async () => {
      const coalesce = (runAt: Temporal.Instant) =>
        storedJob({ key: { value: 'c', onConflict: 'coalesce' }, runAt });
      const ids = await subject.run(tenantA, async (unit) => [
        await unit.jobs.enqueue(coalesce(hour)),
        await unit.jobs.enqueue(coalesce(past)),
      ]);
      expect(ids[1]).toBe(ids[0]);
      await subject.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10));
      expect(await take(subject)).toHaveLength(1);
      const keptEarlier = await subject.run(tenantA, async (unit) => [
        await unit.jobs.enqueue(coalesce(past)),
        await unit.jobs.enqueue(coalesce(hour)),
      ]);
      expect(keptEarlier[1]).toBe(keptEarlier[0]);
      await subject.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10));
      expect(await take(subject)).toHaveLength(1);
    });

    test('a scheduled job is promoted when it is due, and cancel removes the pending jobs of a key', async () => {
      await subject.run(tenantA, async (unit) => {
        await unit.jobs.enqueue(
          storedJob({ runAt: hour, key: { value: 'later', onConflict: 'replace' } }),
        );
        await unit.jobs.enqueue(
          storedJob({ runAt: hour, key: { value: 'other', onConflict: 'replace' } }),
        );
      });
      expect(await take(subject)).toEqual([]);
      expect(await subject.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10))).toBe(
        0,
      );
      expect(await subject.run(tenantA, (unit) => unit.jobs.cancel('commands', 'later'))).toBe(1);
      expect(await subject.run(tenantA, (unit) => unit.jobs.cancel('commands', 'later'))).toBe(0);
    });

    test('cancel of a key in the timers queue takes the running attempt too: its completion is refused and its command unit rolls back', async () => {
      await subject.run(tenantA, (unit) =>
        unit.jobs.enqueue(
          storedJob({ queue: 'timers', key: { value: 'running', onConflict: 'replace' } }),
        ),
      );
      const [job] = await take(subject, 'w1', 'timers');
      if (job === undefined) throw new Error('no job was taken');
      expect(await subject.run(tenantA, (unit) => unit.jobs.cancel('timers', 'running'))).toBe(1);
      // The command the job ran commits in a unit of its own that also completes the job: refused.
      await expect(
        subject.run(tenantA, async (unit) => {
          await unit.jobs.enqueue(storedJob({ key: { value: 'effect', onConflict: 'keep' } }));
          if (!(await unit.jobs.complete(job.attempt, 'w1', { kind: 'succeeded' }))) {
            throw new Error('lease lost');
          }
        }),
      ).rejects.toThrow('lease lost');
      expect(await subject.run(tenantA, (unit) => unit.jobs.cancel('commands', 'effect'))).toBe(0);
      expect(
        await subject.run(namespaceScope, (unit) => unit.jobs.heartbeat([job.attempt], 'w1', 1000)),
      ).toEqual([]);
      expect(await take(subject, 'w1', 'timers')).toEqual([]);
      expect(await subject.run(tenantA, (unit) => unit.jobs.cancel('timers', 'running'))).toBe(0);
    });

    test('cancel of a running keyed timer gives its group slot back', async () => {
      await subject.run(namespaceScope, (unit) =>
        unit.jobs.provisionGroup({ id: 'g', concurrency: 1, scope: 'namespace' }),
      );
      const grouped = (key: string, input: number) =>
        storedJob({
          queue: 'timers',
          key: { value: key, onConflict: 'keep' },
          group: { id: 'g', concurrency: 1, scope: 'namespace' },
          run: { action: 'a', input },
        });
      await subject.run(tenantA, async (unit) => {
        await unit.jobs.enqueue(grouped('first', 1));
        await unit.jobs.enqueue(grouped('second', 2));
      });
      expect((await take(subject, 'w1', 'timers')).map((job) => job.run)).toEqual([
        { action: 'a', input: 1 },
      ]);
      // The group is full: the second job waits for the slot.
      expect(await take(subject, 'w1', 'timers')).toEqual([]);
      expect(await subject.run(tenantA, (unit) => unit.jobs.cancel('timers', 'first'))).toBe(1);
      expect((await take(subject, 'w1', 'timers')).map((job) => job.run)).toEqual([
        { action: 'a', input: 2 },
      ]);
    });

    test('cancel of a key in another queue leaves the running attempt: it is not counted and its completion succeeds', async () => {
      await subject.run(tenantA, (unit) =>
        unit.jobs.enqueue(storedJob({ key: { value: 'crossing', onConflict: 'replace' } })),
      );
      const [job] = await take(subject);
      if (job === undefined) throw new Error('no job was taken');
      expect(await subject.run(tenantA, (unit) => unit.jobs.cancel('commands', 'crossing'))).toBe(
        0,
      );
      expect(
        await subject.run(namespaceScope, (unit) => unit.jobs.heartbeat([job.attempt], 'w1', 1000)),
      ).toEqual([job.attempt]);
      expect(
        await subject.run(namespaceScope, (unit) =>
          unit.jobs.complete(job.attempt, 'w1', { kind: 'succeeded' }),
        ),
      ).toBe(true);
    });

    test('a job that ended before the cancel is not cancelled', async () => {
      await subject.run(tenantA, (unit) =>
        unit.jobs.enqueue(storedJob({ key: { value: 'done', onConflict: 'replace' } })),
      );
      const [job] = await take(subject);
      if (job === undefined) throw new Error('no job was taken');
      await subject.run(namespaceScope, (unit) =>
        unit.jobs.complete(job.attempt, 'w1', { kind: 'succeeded' }),
      );
      expect(await subject.run(tenantA, (unit) => unit.jobs.cancel('commands', 'done'))).toBe(0);
    });

    test('complete is conditional on the worker and the attempt', async () => {
      await subject.run(tenantA, (unit) => unit.jobs.enqueue(storedJob()));
      const [job] = await take(subject);
      if (job === undefined) throw new Error('no job was taken');
      expect(
        await subject.run(namespaceScope, (unit) =>
          unit.jobs.complete(job.attempt, 'w2', { kind: 'succeeded' }),
        ),
      ).toBe(false);
      expect(
        await subject.run(namespaceScope, (unit) =>
          unit.jobs.complete(job.attempt, 'w1', { kind: 'succeeded' }),
        ),
      ).toBe(true);
    });

    test('a job for another scope than the unit, and any enqueue from a read-only unit, is refused', async () => {
      const foreign = storedJob({ scope: conformanceScopes.tenantB });
      expect(
        (await failureOf(subject.run(tenantA, (unit) => unit.jobs.enqueue(foreign)))).kind,
      ).toBe('forbidden');
      expect(
        await failureOf(subject.read(tenantA, (unit) => unit.jobs.enqueue(storedJob()))),
      ).toEqual({ kind: 'internal', code: 'core.internal' });
    });
  });

  describe('usage, buckets and subject keys', () => {
    test('usage adds, reads and rolls back with its unit', async () => {
      expect(await subject.run(tenantA, (unit) => unit.usage.add('requests', 3n))).toBe(3n);
      expect(await subject.run(tenantA, (unit) => unit.usage.add('requests', 4n))).toBe(7n);
      expect(await subject.run(tenantA, (unit) => unit.usage.add('requests', -2n))).toBe(5n);
      await subject
        .run(tenantA, async (unit) => {
          await unit.usage.add('requests', 100n);
          throw new Error('undo');
        })
        .catch(() => undefined);
      expect(await subject.read(tenantA, (unit) => unit.usage.get('requests'))).toBe(5n);
      expect(await subject.read(tenantA, (unit) => unit.usage.get('other'))).toBe(0n);
    });

    test('a bucket is created full, refuses when empty and says how long to wait', async () => {
      const limits = { capacity: 3, refillPerSecond: 0.001 };
      const takes = await subject.run(tenantA, async (unit) => [
        await unit.buckets.take('b', 1, limits),
        await unit.buckets.take('b', 2, limits),
        await unit.buckets.take('b', 1, limits),
      ]);
      expect(takes.map((take) => take.ok)).toEqual([true, true, false]);
      expect(takes[2]?.retryAfter).toBeGreaterThan(0);
      expect((await subject.run(tenantA, (unit) => unit.buckets.take('fresh', 3, limits))).ok).toBe(
        true,
      );
    });

    test('a check reads a bucket without taking from it or creating it', async () => {
      const limits = { capacity: 3, refillPerSecond: 0.001 };
      const reads = await subject.run(tenantA, async (unit) => [
        await unit.buckets.check('c', 3, limits),
        await unit.buckets.take('c', 3, limits),
        await unit.buckets.check('c', 1, limits),
        await unit.buckets.check('c', 1, limits),
      ]);
      expect(reads.map((read) => read.ok)).toEqual([true, true, false, false]);
      expect(reads[2]?.retryAfter).toBeGreaterThan(0);
      // a check of a bucket never taken from reads it full
      expect(
        (await subject.run(tenantA, (unit) => unit.buckets.check('never', 3, limits))).ok,
      ).toBe(true);
    });

    test('a data key is created on demand, found by id, and gone once shredded', async () => {
      expect(
        await subject.run(tenantA, (unit) =>
          unit.keys.dataKey(conformanceId(7001), { create: false }),
        ),
      ).toBeUndefined();
      const created = await subject.run(tenantA, (unit) =>
        unit.keys.dataKey(conformanceId(7001), { create: true }),
      );
      expect(created?.material).toHaveLength(32);
      const again = await subject.run(tenantA, (unit) =>
        unit.keys.dataKey(conformanceId(7001), { create: false }),
      );
      expect(again?.id).toBe(created?.id);
      expect((await subject.run(tenantA, (unit) => unit.keys.keyById(created?.id ?? '')))?.id).toBe(
        created?.id,
      );
      const shredded = await subject.run(tenantA, (unit) => unit.keys.shred(conformanceId(7001)));
      expect(shredded.keyIds).toContain(created?.id);
      expect(
        await subject.run(tenantA, (unit) =>
          unit.keys.dataKey(conformanceId(7001), { create: false }),
        ),
      ).toBeUndefined();
      expect(
        await subject.run(tenantA, (unit) => unit.keys.keyById(created?.id ?? '')),
      ).toBeUndefined();
    });

    test('a sealed value opens under its value key and not after the key is destroyed', async () => {
      const plain = new Uint8Array([1, 2, 3, 4]);
      const binding = {
        entity: 'conf.credential',
        id: '00000000-0000-7000-8000-000000000001',
        field: 'token',
      };
      const sealed = await subject.run(tenantA, (unit) => unit.keys.sealValue(binding, plain));
      expect(await subject.run(tenantA, (unit) => unit.keys.openValue(sealed))).toEqual(plain);
      // An expected binding must be the one the value was sealed for.
      expect(await subject.run(tenantA, (unit) => unit.keys.openValue(sealed, binding))).toEqual(
        plain,
      );
      for (const other of [
        { ...binding, entity: 'conf.other' },
        { ...binding, id: '00000000-0000-7000-8000-000000000002' },
        { ...binding, field: 'secret' },
      ]) {
        expect(
          await subject.run(tenantA, (unit) => unit.keys.openValue(sealed, other)),
        ).toBeUndefined();
      }
      await subject.run(tenantA, (unit) => unit.keys.destroyValueKey(sealed.keyId));
      expect(await subject.run(tenantA, (unit) => unit.keys.openValue(sealed))).toBeUndefined();
    });

    test('subject references list in order after a stream', async () => {
      const streams = [1, 2, 3].map((n) => ({ type: 'conf.owner', id: conformanceId(8000 + n) }));
      await subject.run(tenantA, (unit) => unit.keys.addRefs(conformanceId(7001), streams));
      await subject.run(tenantA, (unit) =>
        unit.keys.addRefs(conformanceId(7001), streams.slice(0, 1)),
      );
      expect(
        await subject.read(tenantA, (unit) => unit.keys.refs(conformanceId(7001), null, 10)),
      ).toEqual(streams);
      expect(
        await subject.read(tenantA, (unit) =>
          unit.keys.refs(conformanceId(7001), streams[0] ?? null, 10),
        ),
      ).toEqual(streams.slice(1));
    });
  });
}
