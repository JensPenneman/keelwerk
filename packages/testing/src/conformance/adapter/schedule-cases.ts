import type { StorageScope, StoredSchedule, Unit } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';

const { tenantA, tenantB } = conformanceScopes;
const scopeA = tenantA.tenantId;
const scopeB = tenantB.tenantId;
const inNamespace: StorageScope = { level: 'namespace', reason: 'conformance' };
const T0 = Temporal.Instant.from('2026-01-01T00:00:00Z');
const at = (minutes: number): Temporal.Instant => T0.add({ minutes });
/** A write in a read-only unit; every adapter answers the same kind and code. */
const refusedWrite = { kind: 'internal', code: 'core.internal' };
const nightly = 'library.nightly';
const hourly = 'library.hourly';

/**
 * The schedule store of every adapter (9.5.6, 14.3.9, S-118): one row per schedule and scope with
 * the last and the next tick, and a conditional claim that holds once per tick and scope.
 */
export function scheduleCases(subject: Pick<ConformanceSubject, 'run' | 'read'>): void {
  const inA = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> => subject.run(tenantA, fn);
  const inB = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> => subject.run(tenantB, fn);
  const inNs = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> => subject.run(inNamespace, fn);
  const dueNs = (now: Temporal.Instant, limit = 100) =>
    subject.read(inNamespace, (unit) => unit.jobs.schedules().due(now, limit));

  describe('schedules (9.5.6, 14.10 case 10)', () => {
    test('upsert inserts a row and keeps an existing next tick', { timeout: 30_000 }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(60)));
      expect(await dueNs(at(5))).toEqual([
        { scheduleId: nightly, scopeId: scopeA, lastTick: null, nextTick: at(5) },
      ]);
      expect(await dueNs(at(4))).toEqual([]);
    });

    test('upsert moves a row to an earlier next tick and never to a later one', {
      timeout: 30_000,
    }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(60)));
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      expect(await dueNs(at(5))).toEqual([
        { scheduleId: nightly, scopeId: scopeA, lastTick: null, nextTick: at(5) },
      ]);
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(30)));
      expect(await dueNs(at(59))).toEqual([
        { scheduleId: nightly, scopeId: scopeA, lastTick: null, nextTick: at(5) },
      ]);
    });

    test('due answers rows up to now in next-tick order within the limit', {
      timeout: 30_000,
    }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(10)));
      await inA((unit) => unit.jobs.schedules().upsert(hourly, at(5)));
      await inB((unit) => unit.jobs.schedules().upsert(nightly, at(1)));
      await inB((unit) => unit.jobs.schedules().upsert(hourly, at(20)));
      const rows = await dueNs(at(10));
      expect(rows.map((row) => [row.scopeId, row.scheduleId])).toEqual([
        [scopeB, nightly],
        [scopeA, hourly],
        [scopeA, nightly],
      ]);
      const limited = await dueNs(at(30), 2);
      expect(limited.map((row) => [row.scopeId, row.scheduleId])).toEqual([
        [scopeB, nightly],
        [scopeA, hourly],
      ]);
    });

    test('due after a key answers the rows that sort after it, so a caller walks the window by window', {
      timeout: 30_000,
    }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(10)));
      await inA((unit) => unit.jobs.schedules().upsert(hourly, at(5)));
      await inB((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      await inB((unit) => unit.jobs.schedules().upsert(hourly, at(5)));
      const walked: (readonly [string, string])[] = [];
      let after: Pick<StoredSchedule, 'nextTick' | 'scopeId' | 'scheduleId'> | undefined;
      for (let window = 0; window < 4; window += 1) {
        const rows = await subject.read(inNamespace, (unit) =>
          unit.jobs.schedules().due(at(30), 2, after),
        );
        for (const row of rows) walked.push([row.scopeId, row.scheduleId]);
        const last = rows.at(-1);
        if (rows.length < 2 || last === undefined) break;
        after = { nextTick: last.nextTick, scopeId: last.scopeId, scheduleId: last.scheduleId };
      }
      const all = await dueNs(at(30));
      expect(walked).toEqual(all.map((row) => [row.scopeId, row.scheduleId]));
      expect(walked).toHaveLength(4);
      expect(new Set(walked.map((entry) => entry.join())).size).toBe(4);
      const own = await subject.read(tenantA, (unit) =>
        unit.jobs
          .schedules()
          .due(at(30), 100, { nextTick: at(5), scopeId: scopeA, scheduleId: hourly }),
      );
      expect(own.map((row) => row.scheduleId)).toEqual([nightly]);
    });

    test('a scoped unit sees its own rows, a namespace unit every scope', {
      timeout: 30_000,
    }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(1)));
      await inB((unit) => unit.jobs.schedules().upsert(nightly, at(2)));
      const own = await subject.read(tenantA, (unit) => unit.jobs.schedules().due(at(10), 100));
      expect(own.map((row) => row.scopeId)).toEqual([scopeA]);
      const other = await subject.read(tenantB, (unit) => unit.jobs.schedules().due(at(10), 100));
      expect(other.map((row) => row.scopeId)).toEqual([scopeB]);
      expect((await dueNs(at(10))).map((row) => row.scopeId)).toEqual([scopeA, scopeB]);
    });

    test('claimTick holds once per tick: a second claim of the same tick is false', {
      timeout: 30_000,
    }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      expect(
        await inA((unit) => unit.jobs.schedules().claimTick(nightly, scopeA, at(5), at(10))),
      ).toBe(true);
      expect(
        await inA((unit) => unit.jobs.schedules().claimTick(nightly, scopeA, at(5), at(10))),
      ).toBe(false);
      expect(
        await inA((unit) =>
          unit.jobs.schedules().claimTick('library.absent', scopeA, at(5), at(10)),
        ),
      ).toBe(false);
    });

    test('claimTick records the claimed tick as the last and moves the next', {
      timeout: 30_000,
    }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      await inA((unit) => unit.jobs.schedules().claimTick(nightly, scopeA, at(5), at(10)));
      expect(await dueNs(at(9))).toEqual([]);
      expect(await dueNs(at(10))).toEqual([
        { scheduleId: nightly, scopeId: scopeA, lastTick: at(5), nextTick: at(10) },
      ]);
    });

    test('two units claiming one tick at once: exactly one wins', { timeout: 30_000 }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      const claims = await Promise.all([
        subject.run(tenantA, (unit) =>
          unit.jobs.schedules().claimTick(nightly, scopeA, at(5), at(10)),
        ),
        subject.run(inNamespace, (unit) =>
          unit.jobs.schedules().claimTick(nightly, scopeA, at(5), at(10)),
        ),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
    });

    test('a rolled-back claim leaves the row due', { timeout: 30_000 }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      await inA(async (unit) => {
        expect(await unit.jobs.schedules().claimTick(nightly, scopeA, at(5), at(10))).toBe(true);
        throw new Error('boom');
      }).catch(() => undefined);
      expect(await dueNs(at(5))).toEqual([
        { scheduleId: nightly, scopeId: scopeA, lastTick: null, nextTick: at(5) },
      ]);
    });

    test('a scoped unit naming another scope is forbidden; upsert in a namespace unit is forbidden; a namespace unit may claim any scope', {
      timeout: 30_000,
    }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      await inB((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      const crossed = await failureOf(
        inA((unit) => unit.jobs.schedules().claimTick(nightly, scopeB, at(5), at(10))),
      );
      expect(crossed.code).toBe('core.forbidden');
      const seeded = await failureOf(inNs((unit) => unit.jobs.schedules().upsert(nightly, at(5))));
      expect(seeded.code).toBe('core.forbidden');
      expect(
        await inNs((unit) => unit.jobs.schedules().claimTick(nightly, scopeB, at(5), at(10))),
      ).toBe(true);
      expect((await dueNs(at(5))).map((row) => row.scopeId)).toEqual([scopeA]);
    });

    test('a read-only unit refuses upsert and claimTick', { timeout: 30_000 }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      const upsert = await failureOf(
        subject.read(tenantA, (unit) => unit.jobs.schedules().upsert(hourly, at(5))),
      );
      expect(upsert).toMatchObject(refusedWrite);
      const claim = await failureOf(
        subject.read(tenantA, (unit) =>
          unit.jobs.schedules().claimTick(nightly, scopeA, at(5), at(10)),
        ),
      );
      expect(claim).toMatchObject(refusedWrite);
      expect(await dueNs(at(5))).toHaveLength(1);
    });

    test('a unit aborted through its signal commits no claimTick', {
      timeout: 30_000,
    }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      const late = new AbortController();
      await expect(
        subject.run(
          tenantA,
          async (unit) => {
            expect(await unit.jobs.schedules().claimTick(nightly, scopeA, at(5), at(10))).toBe(
              true,
            );
            late.abort(new Error('late'));
          },
          { signal: late.signal },
        ),
      ).rejects.toThrow('late');
      expect(await dueNs(at(5))).toEqual([
        { scheduleId: nightly, scopeId: scopeA, lastTick: null, nextTick: at(5) },
      ]);
      const stopped = new AbortController();
      stopped.abort(new Error('stopped'));
      await expect(
        subject.run(
          inNamespace,
          (unit) => unit.jobs.schedules().claimTick(nightly, scopeA, at(5), at(10)),
          { signal: stopped.signal },
        ),
      ).rejects.toThrow('stopped');
      expect(await dueNs(at(5))).toHaveLength(1);
      expect(
        await inA((unit) => unit.jobs.schedules().claimTick(nightly, scopeA, at(5), at(10))),
      ).toBe(true);
    });

    test('remove deletes one row of one scope: a namespace unit any scope, a scoped unit its own', {
      timeout: 30_000,
    }, async () => {
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      await inA((unit) => unit.jobs.schedules().upsert(hourly, at(5)));
      await inB((unit) => unit.jobs.schedules().upsert(nightly, at(5)));
      expect(await inNs((unit) => unit.jobs.schedules().remove(nightly, scopeA))).toBe(true);
      expect(await inNs((unit) => unit.jobs.schedules().remove(nightly, scopeA))).toBe(false);
      expect((await dueNs(at(5))).map((row) => [row.scopeId, row.scheduleId]).toSorted()).toEqual(
        [
          [scopeA, hourly],
          [scopeB, nightly],
        ].toSorted(),
      );
      expect(await inB((unit) => unit.jobs.schedules().remove(nightly, scopeB))).toBe(true);
      const crossed = await failureOf(inA((unit) => unit.jobs.schedules().remove(hourly, scopeB)));
      expect(crossed.code).toBe('core.forbidden');
      const refused = await failureOf(
        subject.read(inNamespace, (unit) => unit.jobs.schedules().remove(hourly, scopeA)),
      );
      expect(refused).toMatchObject(refusedWrite);
      expect((await dueNs(at(5))).map((row) => row.scheduleId)).toEqual([hourly]);
      // A removed row is seeded again as new: the next tick is the one the upsert names.
      await inA((unit) => unit.jobs.schedules().upsert(nightly, at(60)));
      expect(await dueNs(at(30))).toHaveLength(1);
    });

    test('instants are kept to the millisecond', { timeout: 30_000 }, async () => {
      const fine = T0.add({ milliseconds: 1234, microseconds: 567 });
      await inA((unit) => unit.jobs.schedules().upsert(nightly, fine));
      const [row] = await dueNs(at(5));
      expect(row?.nextTick.toString()).toBe('2026-01-01T00:00:01.234Z');
      await inA((unit) =>
        unit.jobs.schedules().claimTick(nightly, scopeA, fine, at(10).add({ microseconds: 9 })),
      );
      const [claimed] = await dueNs(at(10));
      expect(claimed?.lastTick?.toString()).toBe('2026-01-01T00:00:01.234Z');
      expect(claimed?.nextTick.toString()).toBe('2026-01-01T00:10:00Z');
    });
  });
}
