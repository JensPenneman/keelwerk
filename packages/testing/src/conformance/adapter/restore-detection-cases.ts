import type { NamespaceRef, ScopeCounters, ScopeMark, StorageScope, Unit } from '@keelwerk/core';
import { canonicalizeJson, epochBumpsOf } from '@keelwerk/core';
import { conformanceEntities, conformanceScopes } from '@keelwerk/data/conformance';
import { beforeEach, describe, expect, test } from 'vitest';
import { appendOf } from './append-of.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { restoreDetectionLedgerCases } from './restore-detection-ledger-cases.ts';

const { ticket } = conformanceEntities;
const { tenantC, deployment } = conformanceScopes;
const namespaceScope: StorageScope = { level: 'namespace', reason: 'restore detection' };
const at = Temporal.Instant.from('2026-11-17T10:00:00Z');

const uuid = (): string => crypto.randomUUID();

function markOf(over: Partial<ScopeMark> & Pick<ScopeMark, 'scopeId' | 'namespaceId'>): ScopeMark {
  return { position: 0n, serials: {}, epoch: 0, updatedAt: at, ...over };
}

/**
 * Case 11 of 14.10 (14.7.6): what restore detection needs of an adapter: the identity it answers,
 * the counters of every scope (read, raised, never lowered), the marks and identities of the control
 * root (the marks' compare-and-set), and the indexed lookups of the ledger (`find`, `unfinished`).
 * The marks, identities and ledger live in the control store's root only, so those cases run in a
 * namespace of that root, provisioned here beside the subject's own.
 */
export function restoreDetectionCases(subject: ConformanceSubject): void {
  describe('restore detection (14.7.6, 14.10 case 11)', () => {
    const control = (): NamespaceRef => ({
      ...subject.namespace(),
      id: 'ns-conformance-control',
      root: 'kw__control',
    });
    const inControl = <T>(fn: (unit: Unit) => Promise<T>, readOnly = false) =>
      subject.adapter().unit(control(), deployment, fn, readOnly ? { readOnly } : {});
    const counters = (page: Parameters<NonNullable<Unit['counters']>['list']>[0]) =>
      subject.read(namespaceScope, async (unit) => unit.counters?.list(page) ?? []);
    const raise = (row: ScopeCounters) =>
      subject.run(namespaceScope, async (unit) => unit.counters?.raise(row));
    const marksOf = (unit: Unit): NonNullable<Unit['marks']> => {
      if (unit.marks === undefined) throw new Error('the deployment unit has no marks');
      return unit.marks;
    };

    beforeEach(async () => {
      await subject.adapter().schema.provision(control(), []);
    });

    test('identity answers the same non-empty values twice', async () => {
      const first = await subject.adapter().identity();
      const second = await subject.adapter().identity();
      expect(first.systemId).not.toBe('');
      expect(first.timeline).not.toBe('');
      expect(second).toEqual(first);
    });

    test('counters list a scope with its last position, its epoch and its marked serials, and leave stream serials out', async () => {
      const partition = `rd-${uuid()}`;
      await subject.run(tenantC, async (unit) => {
        await unit.serials.next(ticket, 'seq', [partition], 3);
        await unit.events.append([appendOf(900, [1, 2])]);
      });
      await subject.run(tenantC, async (unit) => {
        await unit.streams.append('conf.restore', 'k', [{ n: 1 }]);
      });
      const head = await subject.read(tenantC, (unit) => unit.events.head());
      const [listed] = await counters({ limit: 10, scopeIds: [tenantC.tenantId] });
      expect(listed?.scopeId).toBe(tenantC.tenantId);
      expect(listed?.position).toBe(head ?? 0n);
      expect(listed?.epoch).toBeGreaterThanOrEqual(1);
      const names = Object.keys(listed?.serials ?? {});
      const marked = names.find((name) => (JSON.parse(name) as string[])[2]?.includes(partition));
      expect(marked).toBeDefined();
      expect(listed?.serials[marked ?? '']).toBe(3n);
      expect(names.every((name) => !(JSON.parse(name) as string[])[0]?.startsWith('stream:'))).toBe(
        true,
      );
      const everyone = await counters({ limit: 1000 });
      expect(everyone.some((row) => row.scopeId === tenantC.tenantId)).toBe(true);
      const ids = everyone.map((row) => row.scopeId);
      expect([...ids].sort()).toEqual(ids);
      const after = await counters({ limit: 1, after: ids[0] ?? '' });
      expect(after.map((row) => row.scopeId)).toEqual(ids.slice(1, 2));
    });

    test('raise never lowers, creates a missing row and raises position, epoch and serials', async () => {
      const scopeId = uuid();
      const name = canonicalizeJson([ticket.ref, 'seq', 'rd-raise']);
      expect(await counters({ limit: 10, scopeIds: [scopeId] })).toEqual([]);
      await raise({ scopeId, position: 7n, epoch: 3, serials: { [name]: 4n } });
      const [created] = await counters({ limit: 10, scopeIds: [scopeId] });
      expect(created).toMatchObject({ scopeId, position: 7n, epoch: 3 });
      expect(created?.serials[name]).toBe(4n);
      await raise({ scopeId, position: 2n, epoch: 1, serials: { [name]: 1n } });
      const [kept] = await counters({ limit: 10, scopeIds: [scopeId] });
      expect(kept).toMatchObject({ position: 7n, epoch: 3 });
      expect(kept?.serials[name]).toBe(4n);
      await raise({ scopeId, position: 9n, epoch: 3, serials: { [name]: 6n } });
      const [raised] = await counters({ limit: 10, scopeIds: [scopeId] });
      expect(raised).toMatchObject({ position: 9n, epoch: 3 });
      expect(raised?.serials[name]).toBe(6n);
    });

    test('a read-only unit raises no counter', async () => {
      await expect(
        subject.read(namespaceScope, async (unit) =>
          unit.counters?.raise({ scopeId: uuid(), position: 1n, epoch: 1, serials: {} }),
        ),
      ).rejects.toThrow();
    });

    test('marks raise keeps the greater values and a stored epoch, and a new row takes the mark epoch', async () => {
      const namespaceId = `ns-${uuid()}`;
      const scopeId = uuid();
      const name = canonicalizeJson([ticket.ref, 'seq', 'rd-marks']);
      await inControl((unit) =>
        marksOf(unit).raise([
          markOf({ scopeId, namespaceId, position: 10n, serials: { [name]: 5n }, epoch: 2 }),
        ]),
      );
      await inControl((unit) =>
        marksOf(unit).raise([
          markOf({ scopeId, namespaceId, position: 4n, serials: { [name]: 9n }, epoch: 0 }),
        ]),
      );
      const [row] = await inControl((unit) => marksOf(unit).list(namespaceId, { limit: 10 }), true);
      expect(row).toMatchObject({ scopeId, namespaceId, position: 10n, epoch: 2 });
      expect(row?.serials[name]).toBe(9n);
      expect(row?.updatedAt.toString()).toBe(at.toString());
    });

    test('bump moves the epoch only from the epoch it is given and answers the stored one', async () => {
      const namespaceId = `ns-${uuid()}`;
      const scopeId = uuid();
      const bump = (epoch: number, from: number, position = 0n) =>
        inControl((unit) =>
          marksOf(unit).bump(markOf({ scopeId, namespaceId, epoch, position }), from),
        );
      // A missing row counts as epoch 0 and is inserted.
      expect(await bump(2, 0, 5n)).toBe(2);
      // Another process that saw 0 loses: the stored epoch comes back and nothing moves.
      expect(await bump(3, 0, 8n)).toBe(2);
      const [held] = await inControl(
        (unit) => marksOf(unit).list(namespaceId, { limit: 10 }),
        true,
      );
      expect(held).toMatchObject({ epoch: 2, position: 5n });
      // From the right epoch the bump moves it and raises the position.
      expect(await bump(4, 2, 9n)).toBe(4);
      const [moved] = await inControl(
        (unit) => marksOf(unit).list(namespaceId, { limit: 10 }),
        true,
      );
      expect(moved).toMatchObject({ epoch: 4, position: 9n });
      // A missing row is not inserted from an epoch other than 0.
      const other = uuid();
      expect(
        await inControl((unit) =>
          marksOf(unit).bump(markOf({ scopeId: other, namespaceId, epoch: 2 }), 1),
        ),
      ).toBe(0);
      expect(
        await inControl((unit) => marksOf(unit).list(namespaceId, { limit: 10 }), true),
      ).toHaveLength(1);
    });

    test('list pages by scope id and bumped lists the rows above epoch 0 only', async () => {
      const namespaceId = `ns-${uuid()}`;
      const ids = [uuid(), uuid(), uuid()].sort();
      await inControl((unit) =>
        marksOf(unit).raise(
          ids.map((scopeId, index) => markOf({ scopeId, namespaceId, epoch: index === 1 ? 3 : 0 })),
        ),
      );
      const first = await inControl((unit) => marksOf(unit).list(namespaceId, { limit: 2 }), true);
      expect(first.map((row) => row.scopeId)).toEqual(ids.slice(0, 2));
      const rest = await inControl(
        (unit) => marksOf(unit).list(namespaceId, { limit: 2, after: ids[1] ?? '' }),
        true,
      );
      expect(rest.map((row) => row.scopeId)).toEqual(ids.slice(2));
      const bumped = await inControl((unit) => marksOf(unit).bumped(), true);
      expect(
        bumped.filter((row) => row.namespaceId === namespaceId).map((row) => row.scopeId),
      ).toEqual([ids[1]]);
      expect(bumped.every((row) => row.epoch > 0)).toBe(true);
    });

    test('identities record replaces the namespace row', async () => {
      const namespaceId = `ns-${uuid()}`;
      const record = (systemId: string, timeline: string) =>
        inControl((unit) => {
          if (unit.identities === undefined) throw new Error('the unit has no identities');
          return unit.identities.record({ namespaceId, systemId, timeline, recordedAt: at });
        });
      const all = () =>
        inControl(async (unit) => unit.identities?.all() ?? [], true).then((rows) =>
          rows.filter((row) => row.namespaceId === namespaceId),
        );
      await record('system-1', '1');
      expect(await all()).toEqual([
        { namespaceId, systemId: 'system-1', timeline: '1', recordedAt: at },
      ]);
      await record('system-2', '2');
      expect(await all()).toEqual([
        { namespaceId, systemId: 'system-2', timeline: '2', recordedAt: at },
      ]);
    });

    test('a counter rewound below its mark is found by epochBumpsOf and the bump raises it past the mark', async () => {
      const namespaceId = `ns-${uuid()}`;
      const scopeId = uuid();
      const name = canonicalizeJson([ticket.ref, 'seq', 'rd-rewind']);
      // The mark was written when the scope stood at position 5; the restored counters have no row.
      await inControl((unit) =>
        marksOf(unit).raise([
          markOf({ scopeId, namespaceId, position: 5n, serials: { [name]: 3n } }),
        ]),
      );
      const marks = await inControl((unit) => marksOf(unit).list(namespaceId, { limit: 10 }), true);
      const current = await subject.adapter().identity();
      const [decision] = epochBumpsOf({
        recorded: undefined,
        current,
        namespaceId,
        now: at,
        marks: new Map(marks.map((mark) => [mark.scopeId, mark])),
        counters: new Map(),
        anchors: new Map(),
        epochs: new Map(),
      });
      expect(decision?.bump).toEqual({ scopeId, from: 0, to: 2, reason: 'counter' });
      if (decision === undefined) throw new Error('no bump');
      const stored = await inControl((unit) =>
        marksOf(unit).bump(decision.mark, decision.bump.from),
      );
      expect(stored).toBe(2);
      await raise(decision.raise);
      const [after] = await counters({ limit: 10, scopeIds: [scopeId] });
      expect(after).toMatchObject({ position: 5n, epoch: 2 });
      expect(after?.serials[name]).toBe(3n);
    });

    test('counters at an epoch above a restored mark are found by epochBumpsOf and the bump moves past both', async () => {
      const namespaceId = `ns-${uuid()}`;
      const scopeId = uuid();
      // The placement was bumped once (epoch 2) and the control store was restored from before
      // that bump: the mark reads epoch 0 at the old position, the counters read epoch 2.
      await inControl((unit) =>
        marksOf(unit).raise([markOf({ scopeId, namespaceId, position: 4n })]),
      );
      await raise({ scopeId, position: 6n, epoch: 2, serials: {} });
      const marks = await inControl((unit) => marksOf(unit).list(namespaceId, { limit: 10 }), true);
      const rows = await counters({ limit: 10, scopeIds: [scopeId] });
      const [decision] = epochBumpsOf({
        recorded: undefined,
        current: await subject.adapter().identity(),
        namespaceId,
        now: at,
        marks: new Map(marks.map((mark) => [mark.scopeId, mark])),
        counters: new Map(rows.map((row) => [row.scopeId, row])),
        anchors: new Map(),
        epochs: new Map(),
      });
      expect(decision?.bump).toEqual({ scopeId, from: 0, to: 3, reason: 'counter' });
      if (decision === undefined) throw new Error('no bump');
      expect(await inControl((unit) => marksOf(unit).bump(decision.mark, 0))).toBe(3);
      await raise(decision.raise);
      const [after] = await counters({ limit: 10, scopeIds: [scopeId] });
      expect(after).toMatchObject({ position: 6n, epoch: 3 });
    });

    restoreDetectionLedgerCases(inControl);
  });
}
