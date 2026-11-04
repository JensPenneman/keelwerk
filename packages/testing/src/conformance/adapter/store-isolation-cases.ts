import type { StorageScope } from '@keelwerk/core';
import { conformanceEntities, conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { appendOf } from './append-of.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { rowAt } from './row-at.ts';
import { stamp } from './stamp.ts';
import { storedJob } from './stored-job.ts';

const { kitchen, owner, probe, setting, network, ticket } = conformanceEntities;
const { tenantA, tenantB, backend, otherBackend, deployment } = conformanceScopes;
const namespaceScope: StorageScope = { level: 'namespace', reason: 'conformance' };
const forbidden = { kind: 'forbidden', code: 'core.forbidden' };

export function storeIsolationCases(subject: ConformanceSubject): void {
  describe('two tenants over events, receipts, jobs, usage, buckets, keys and serials', () => {
    test('each tenant has an event log of its own, with positions of its own', async () => {
      await subject.run(tenantA, (unit) => unit.events.append([appendOf(1, [1, 2, 3])]));
      await subject.run(tenantB, (unit) => unit.events.append([appendOf(1, [1])]));
      expect(await subject.read(tenantA, (unit) => unit.events.head())).toBe(3n);
      expect(await subject.read(tenantB, (unit) => unit.events.head())).toBe(1n);
      const stream = { type: 'conf.owner', id: conformanceId(1) };
      expect(
        (await subject.read(tenantB, (unit) => unit.events.readStream(stream))).map(
          (event) => event.version,
        ),
      ).toEqual([1]);
      const all = await subject.read(tenantB, (unit) => unit.events.readAll(null, { limit: 10 }));
      expect(all.events.map((event) => event.scope)).toEqual([tenantB]);
      expect(
        await subject.read(tenantA, (unit) => unit.events.head({ streamTypes: ['conf.other'] })),
      ).toBeNull();
    });

    test('a receipt, a job, a usage counter and a bucket belong to one tenant', async () => {
      await subject.run(tenantA, async (unit) => {
        await unit.receipts.put({
          commandId: 'c1',
          action: 'conf.owner.set',
          fingerprint: 'f',
          principal: null,
          status: 'pending',
          outcome: null,
          apiVersion: '2026-01-01',
          request: { transport: 'rest', remoteAddress: null, userAgent: null },
          clientId: 'k',
          clientSeq: 1,
          expiresAt: stamp.add({ hours: 1 }),
        });
        await unit.jobs.enqueue(storedJob());
        await unit.usage.add('requests', 9n);
        await unit.buckets.take('shared', 5, { capacity: 5, refillPerSecond: 0.001 });
      });
      expect(await subject.read(tenantB, (unit) => unit.receipts.get('c1'))).toBeUndefined();
      expect(await subject.read(tenantB, (unit) => unit.receipts.forClient('k', 0, 10))).toEqual(
        [],
      );
      expect(await subject.read(tenantB, (unit) => unit.usage.get('requests'))).toBe(0n);
      expect(
        (
          await subject.run(tenantB, (unit) =>
            unit.buckets.take('shared', 5, { capacity: 5, refillPerSecond: 0.001 }),
          )
        ).ok,
      ).toBe(true);
      expect(
        (
          await subject.run(tenantA, (unit) =>
            unit.buckets.take('shared', 1, { capacity: 5, refillPerSecond: 0.001 }),
          )
        ).ok,
      ).toBe(false);
      const taken = await subject.run(
        namespaceScope,
        async (unit) =>
          (
            await unit.jobs.take('commands', 'w', {
              limit: 10,
              capabilitySets: [''],
              maxRevision: 100,
              leaseMs: 30_000,
            })
          ).jobs,
      );
      expect(taken.map((job) => job.scope)).toEqual([tenantA]);
    });

    test("a tenant's data keys are its own", async () => {
      const created = await subject.run(tenantA, (unit) =>
        unit.keys.dataKey('subject', { create: true }),
      );
      expect(
        await subject.run(tenantB, (unit) => unit.keys.dataKey('subject', { create: false })),
      ).toBeUndefined();
      expect(
        await subject.run(tenantB, (unit) => unit.keys.keyById(created?.id ?? '')),
      ).toBeUndefined();
      const own = await subject.run(tenantB, (unit) =>
        unit.keys.dataKey('subject', { create: true }),
      );
      expect(own?.id).not.toBe(created?.id);
      await subject.run(tenantB, (unit) => unit.keys.shred('subject'));
      expect(
        (await subject.run(tenantA, (unit) => unit.keys.dataKey('subject', { create: false })))?.id,
      ).toBe(created?.id);
    });

    test('serial counters are per tenant', async () => {
      expect(
        await subject.run(tenantA, (unit) => unit.serials.next(ticket, 'seq', ['box'], 3)),
      ).toBe(1n);
      expect(await subject.run(tenantB, (unit) => unit.serials.next(ticket, 'seq', ['box']))).toBe(
        1n,
      );
      expect(await subject.run(tenantA, (unit) => unit.serials.next(ticket, 'seq', ['box']))).toBe(
        4n,
      );
    });
  });

  describe('scope levels reach their own entities only', () => {
    test.each([
      ['a backend unit', backend],
      ['another backend unit', otherBackend],
      ['a deployment unit', deployment],
    ] as const)('%s is refused on tenant entities', async (_name, scope) => {
      expect(
        await failureOf(subject.run(scope, (unit) => unit.rows.insert(owner, [rowAt(1, {})]))),
      ).toEqual(forbidden);
      expect(await failureOf(subject.read(scope, (unit) => unit.rows.find(owner, {})))).toEqual(
        forbidden,
      );
      expect(await failureOf(subject.read(scope, (unit) => unit.rows.count(kitchen)))).toEqual(
        forbidden,
      );
      expect(
        await failureOf(
          subject.read(scope, (unit) =>
            unit.rows.matching(probe, [], { op: 'is', relation: 'owner', where: { op: 'never' } }),
          ),
        ),
      ).toEqual(forbidden);
    });

    test('a tenant unit is refused on backend and deployment entities', async () => {
      expect(
        await failureOf(
          subject.run(tenantA, (unit) => unit.rows.insert(setting, [rowAt(1, { key: 'k' })])),
        ),
      ).toEqual(forbidden);
      expect(await failureOf(subject.read(tenantA, (unit) => unit.rows.find(network, {})))).toEqual(
        forbidden,
      );
    });

    test('backends hold rows of their own, and the deployment holds its own entities', async () => {
      await subject.run(backend, (unit) =>
        unit.rows.insert(setting, [rowAt(1, { key: 'k', value: 'one' })]),
      );
      await subject.run(otherBackend, (unit) =>
        unit.rows.insert(setting, [rowAt(1, { key: 'k', value: 'two' })]),
      );
      await subject.run(deployment, (unit) =>
        unit.rows.insert(network, [rowAt(1, { name: 'net' })]),
      );
      const value = (scope: StorageScope) =>
        subject.read(scope, async (unit) => (await unit.rows.findOne(setting, {}))?.value);
      expect(await value(backend)).toBe('one');
      expect(await value(otherBackend)).toBe('two');
      expect((await subject.read(deployment, (unit) => unit.rows.findOne(network, {})))?.name).toBe(
        'net',
      );
    });

    test('a namespace unit reaches no scoped data', async () => {
      expect(
        await failureOf(subject.read(namespaceScope, (unit) => unit.rows.count(owner))),
      ).toEqual(forbidden);
      expect(
        await failureOf(subject.read(namespaceScope, (unit) => unit.rows.count(setting))),
      ).toEqual(forbidden);
      expect(
        await failureOf(subject.read(namespaceScope, (unit) => unit.receipts.get('c1'))),
      ).toEqual(forbidden);
    });

    test('tenant, backend and deployment units own an event log; a namespace unit has none', async () => {
      for (const scope of [tenantA, backend, deployment]) {
        await subject.run(scope, (unit) => unit.events.append([appendOf(1, [1, 2])]));
        expect(await subject.read(scope, (unit) => unit.events.head())).toBe(2n);
      }
      expect(
        await failureOf(
          subject.run(namespaceScope, (unit) => unit.events.append([appendOf(1, [1])])),
        ),
      ).toEqual({ kind: 'internal', code: 'core.internal' });
    });

    test('only a deployment unit has the scope key store', async () => {
      expect(await subject.run(deployment, async (unit) => unit.scopeKeys !== undefined)).toBe(
        true,
      );
      for (const scope of [tenantA, backend]) {
        expect(await subject.run(scope, async (unit) => unit.scopeKeys === undefined)).toBe(true);
      }
    });
  });

  describe('a nested backend view does not see the tenant buffers', () => {
    test('events a tenant appended in the unit are not backend events', async () => {
      await subject.run(backend, (unit) => unit.events.append([appendOf(1, [1])]));
      await subject.run(tenantA, async (unit) => {
        await unit.events.append([appendOf(2, [2, 3])]);
        const seen = await unit.nested(
          async (inner) => ({
            stream: await inner.events.readStream({ type: 'conf.owner', id: conformanceId(2) }),
            all: (await inner.events.readAll(null, { limit: 10 })).events,
            head: await inner.events.head(),
          }),
          { as: backend, readOnly: true },
        );
        expect(seen.stream).toEqual([]);
        expect(seen.all.map((event) => event.scope)).toEqual([backend]);
        expect(seen.head).toBe(1n);
      });
    });
  });
}
