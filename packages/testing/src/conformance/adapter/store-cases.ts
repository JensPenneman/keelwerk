import type { Receipt } from '@keelwerk/core';
import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { stamp } from './stamp.ts';
import { storedJob } from './stored-job.ts';

const { tenantA } = conformanceScopes;
const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;

function receipt(commandId: string, over: Partial<Receipt> = {}): Receipt {
  return {
    commandId,
    action: 'conf.owner.set',
    fingerprint: 'f1',
    principal: null,
    status: 'pending',
    outcome: null,
    apiVersion: '2026-01-01',
    request: { transport: 'rest', remoteAddress: null, userAgent: null },
    clientId: null,
    clientSeq: null,
    expiresAt: stamp.add({ hours: 24 }),
    ...over,
  };
}

export function storeCases(subject: ConformanceSubject): void {
  describe('receipts (15.1.7)', () => {
    test('put is idempotent for one fingerprint and a conflict for another; complete records the outcome', async () => {
      await subject.run(tenantA, (unit) => unit.receipts.put(receipt('c1')));
      await subject.run(tenantA, (unit) => unit.receipts.put(receipt('c1')));
      const other = subject.run(tenantA, (unit) =>
        unit.receipts.put(receipt('c1', { fingerprint: 'f2' })),
      );
      expect((await failureOf(other)).kind).toBe('conflict');
      await subject.run(tenantA, (unit) =>
        unit.receipts.complete('c1', { ok: true, value: 1, effects: [] }),
      );
      expect(await subject.read(tenantA, (unit) => unit.receipts.get('c1'))).toMatchObject({
        status: 'completed',
        outcome: { ok: true, value: 1 },
      });
      expect(await subject.read(tenantA, (unit) => unit.receipts.get('nope'))).toBeUndefined();
      const unknown = subject.run(tenantA, (unit) =>
        unit.receipts.complete('nope', { ok: true, value: 1, effects: [] }),
      );
      expect((await failureOf(unknown)).kind).toBe('not_found');
    });

    test('forClient lists after a sequence number in order; acknowledge marks the receipts and keeps them', async () => {
      await subject.run(tenantA, async (unit) => {
        for (const seq of [3, 1, 2]) {
          await unit.receipts.put(receipt(`seq-${seq}`, { clientId: 'k', clientSeq: seq }));
        }
        await unit.receipts.put(receipt('other', { clientId: 'z', clientSeq: 9 }));
      });
      const listAfter = async (seq: number) =>
        (await subject.read(tenantA, (unit) => unit.receipts.forClient('k', seq, 10))).map(
          (r) => r.commandId,
        );
      expect(await listAfter(0)).toEqual(['seq-1', 'seq-2', 'seq-3']);
      expect(await listAfter(1)).toEqual(['seq-2', 'seq-3']);
      expect(
        (await subject.read(tenantA, (unit) => unit.receipts.forClient('k', 0, 2))).map(
          (r) => r.commandId,
        ),
      ).toEqual(['seq-1', 'seq-2']);
      await subject.run(tenantA, (unit) => unit.receipts.acknowledge('k', 2));
      const kept = await subject.read(tenantA, (unit) => unit.receipts.forClient('k', 0, 10));
      expect(kept.map((r) => [r.commandId, r.acknowledgedAt !== undefined])).toEqual([
        ['seq-1', true],
        ['seq-2', true],
        ['seq-3', false],
      ]);
      expect(
        (await subject.read(tenantA, (unit) => unit.receipts.get('other')))?.acknowledgedAt,
      ).toBeUndefined();
    });
  });

  describe('jobs (14.3.9)', () => {
    const take = (subject2: ConformanceSubject, worker = 'w1') =>
      subject2.run(
        namespaceScope,
        async (unit) =>
          (
            await unit.jobs.take('commands', worker, {
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
