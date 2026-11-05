import type { Position, StorageScope } from '@keelwerk/core';
import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { appendOf } from './append-of.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { newEvent } from './new-event.ts';

const { tenantA, tenantB, tenantC, deployment } = conformanceScopes;
const namespaceScope: StorageScope = { level: 'namespace', reason: 'conformance' };
const mismatch = { kind: 'conflict', code: 'core.version_mismatch' };

/** A small deterministic generator, so the random delays of a run repeat. */
function delays(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % 6;
  };
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function eventStoreCases(subject: ConformanceSubject): void {
  describe('event store (15.1.4, 14.10 case 6)', () => {
    test('events get consecutive positions at the commit and versions at the append', async () => {
      const results = await subject.run(tenantA, (unit) =>
        unit.events.append([appendOf(1, [1, 2]), appendOf(2, [3])]),
      );
      expect(results.map((r) => [r.eventId, r.version])).toEqual([
        [conformanceId(5001), 1],
        [conformanceId(5002), 2],
        [conformanceId(5003), 1],
      ]);
      const all = await subject.read(tenantA, (unit) => unit.events.readAll(null, { limit: 10 }));
      expect(all.events.map((e) => [e.position, e.stream.id, e.version, e.type])).toEqual([
        [1n, conformanceId(1), 1, 'conf.owner.created'],
        [2n, conformanceId(1), 2, 'conf.owner.changed'],
        [3n, conformanceId(2), 1, 'conf.owner.changed'],
      ]);
      expect(all.next).toBe(3n);
      expect(all.events[0]?.scope).toEqual(tenantA);
    });

    test('positions follow commit order, a rolled-back unit reuses its numbers, committed() lists them', async () => {
      await subject.run(tenantA, (unit) => unit.events.append([appendOf(1, [1])]));
      await subject
        .run(tenantA, async (unit) => {
          await unit.events.append([appendOf(2, [1, 2])]);
          throw new Error('boom');
        })
        .catch(() => undefined);
      const events = await subject.run(tenantA, async (unit) => {
        await unit.events.append([appendOf(3, [1])]);
        return unit.events;
      });
      expect(events.committed()).toEqual([2n]);
      expect(await subject.read(tenantA, (unit) => unit.events.head())).toBe(2n);
    });

    test('an expected version that is not the stream version is a conflict, for a second stream too', async () => {
      await subject.run(tenantA, (unit) => unit.events.append([appendOf(1, [1])]));
      for (const expectedVersion of [0, 2]) {
        expect(
          await failureOf(
            subject.run(tenantA, (unit) =>
              unit.events.append([appendOf(1, [2], { expectedVersion })]),
            ),
          ),
        ).toEqual(mismatch);
      }
      await subject.run(tenantA, (unit) =>
        unit.events.append([appendOf(1, [2], { expectedVersion: 1 })]),
      );
    });

    test('a batch over several streams is atomic: one stale stream appends nothing', async () => {
      await subject.run(tenantA, (unit) => unit.events.append([appendOf(2, [1])]));
      const refused = subject.run(tenantA, (unit) =>
        unit.events.append([appendOf(1, [1]), appendOf(2, [2], { expectedVersion: 5 })]),
      );
      expect(await failureOf(refused)).toEqual(mismatch);
      const stream = (n: number) => ({ type: 'conf.owner', id: conformanceId(n) });
      expect(await subject.read(tenantA, (unit) => unit.events.readStream(stream(1)))).toEqual([]);
      expect(await subject.read(tenantA, (unit) => unit.events.head())).toBe(1n);
    });

    test('reads inside the unit see the buffered events; readStream takes a version range and a limit', async () => {
      const stream = { type: 'conf.owner', id: conformanceId(1) };
      const inside = await subject.run(tenantA, async (unit) => {
        await unit.events.append([appendOf(1, [1, 2, 3, 4])]);
        return (await unit.events.readStream(stream)).map((e) => e.version);
      });
      expect(inside).toEqual([1, 2, 3, 4]);
      const range = (r: { fromVersion?: number; toVersion?: number; limit?: number }) =>
        subject.read(tenantA, async (unit) =>
          (await unit.events.readStream(stream, r)).map((e) => e.version),
        );
      expect(await range({ fromVersion: 2 })).toEqual([2, 3, 4]);
      expect(await range({ fromVersion: 2, toVersion: 3 })).toEqual([2, 3]);
      expect(await range({ limit: 2 })).toEqual([1, 2]);
    });

    test('readAll pages by position: next is the last position returned, or the position asked after', async () => {
      await subject.run(tenantA, (unit) => unit.events.append([appendOf(1, [1, 2, 3, 4, 5])]));
      const first = await subject.read(tenantA, (unit) => unit.events.readAll(null, { limit: 2 }));
      expect(first.events.map((e) => e.position)).toEqual([1n, 2n]);
      expect(first.next).toBe(2n);
      const second = await subject.read(tenantA, (unit) =>
        unit.events.readAll(first.next, { limit: 10 }),
      );
      expect(second.events.map((e) => e.position)).toEqual([3n, 4n, 5n]);
      const none = await subject.read(tenantA, (unit) => unit.events.readAll(5n, { limit: 10 }));
      expect(none).toEqual({ events: [], next: 5n });
    });

    test('selectors filter by stream type, name, partition and stream; transient events are left out unless asked for', async () => {
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendOf(1, [1, 2], {}, 'conf.owner'),
          appendOf(2, [1], { partition: 'p1' }, 'conf.kitchen'),
          { ...appendOf(3, [1], {}, 'conf.owner'), events: [newEvent(7, { transient: true })] },
        ]),
      );
      const read = async (selector: object, includeTransient = false) =>
        (
          await subject.read(tenantA, (unit) =>
            unit.events.readAll(null, { limit: 10, selector, includeTransient }),
          )
        ).events.map((e) => e.position);
      expect(await read({})).toEqual([1n, 2n, 3n]);
      expect(await read({}, true)).toEqual([1n, 2n, 3n, 4n]);
      expect(await read({ streamTypes: ['conf.kitchen'] })).toEqual([3n]);
      expect(await read({ names: ['changed'] })).toEqual([2n]);
      expect(await read({ partition: 'p1' })).toEqual([3n]);
      expect(await read({ streams: [{ type: 'conf.owner', id: conformanceId(1) }] })).toEqual([
        1n,
        2n,
      ]);
      expect(
        await subject.read(tenantA, (unit) => unit.events.head({ streamTypes: ['conf.kitchen'] })),
      ).toBe(3n);
      expect(
        await subject.read(tenantA, (unit) => unit.events.head({ partition: 'nope' })),
      ).toBeNull();
    });

    test('movedScopes names the scopes of the namespace whose head moved after the given marks', async () => {
      await subject.run(tenantA, (unit) => unit.events.append([appendOf(1, [1, 2])]));
      await subject.run(tenantB, (unit) => unit.events.append([appendOf(1, [1])]));
      const moved = async (since: ReadonlyMap<string, Position>) =>
        (await subject.read(namespaceScope, (unit) => unit.events.movedScopes(since, 10)))
          .map((m) => [m.scopeId, m.head] as const)
          .sort();
      expect(await moved(new Map())).toEqual(
        [
          [tenantA.tenantId, 2n],
          [tenantB.tenantId, 1n],
        ].sort(),
      );
      expect(await moved(new Map([[tenantA.tenantId, 2n]]))).toEqual([[tenantB.tenantId, 1n]]);
      expect(await moved(new Map([[tenantA.tenantId, 1n]]))).toEqual(
        [
          [tenantA.tenantId, 2n],
          [tenantB.tenantId, 1n],
        ].sort(),
      );
    });

    test('movedScopes names the deployment scope by the deployment id', async () => {
      const deploymentId = subject.deploymentId;
      if (deploymentId === undefined) return;
      await subject.run(deployment, (unit) =>
        unit.events.append([appendOf(1, [1, 2], {}, 'conf.network')]),
      );
      const moved = await subject.read(namespaceScope, (unit) =>
        unit.events.movedScopes(new Map(), 10),
      );
      expect(moved).toEqual([{ scopeId: deploymentId, head: 2n }]);
      const since = new Map([[deploymentId, 2n]]);
      expect(
        await subject.read(namespaceScope, (unit) => unit.events.movedScopes(since, 10)),
      ).toEqual([]);
    });

    test('find names the events of a command, the events it caused and one event, per scope, in pages', async () => {
      const caused = (n: number, commandId: string | null, causationId: string | null) => {
        const base = newEvent(n);
        return { ...base, meta: { ...base.meta, commandId, causationId } };
      };
      const stream = (n: number, events: ReturnType<typeof caused>[]) => ({
        stream: { type: 'conf.owner', id: conformanceId(n) },
        expectedVersion: 0,
        partition: null,
        events,
      });
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          stream(1, [caused(1, 'cmd-a', null), caused(2, 'cmd-a', null)]),
          stream(2, [caused(3, 'cmd-b', 'cmd-a')]),
          stream(3, [caused(4, null, null)]),
        ]),
      );
      await subject.run(tenantB, (unit) =>
        unit.events.append([stream(1, [caused(5, 'cmd-a', null)])]),
      );
      const find = async (
        match: { commandId: string } | { causationId: string } | { eventId: string },
      ) =>
        (
          await subject.read(tenantA, (unit) =>
            unit.events.find(match, { after: null, limit: 100 }),
          )
        ).events;
      expect((await find({ commandId: 'cmd-a' })).map((event) => event.position)).toEqual([1n, 2n]);
      expect((await find({ causationId: 'cmd-a' })).map((event) => event.commandId)).toEqual([
        'cmd-b',
      ]);
      expect((await find({ eventId: conformanceId(5004) })).map((event) => event.position)).toEqual(
        [4n],
      );
      expect(await find({ eventId: 'not-a-uuid' })).toEqual([]);
      expect(await find({ commandId: 'cmd-none' })).toEqual([]);
      const first = await subject.read(tenantA, (unit) =>
        unit.events.find({ commandId: 'cmd-a' }, { after: null, limit: 1 }),
      );
      expect(first.events).toHaveLength(1);
      expect(first.next).toBe(1n);
      const second = await subject.read(tenantA, (unit) =>
        unit.events.find({ commandId: 'cmd-a' }, { after: first.next, limit: 5 }),
      );
      expect(second.events.map((event) => event.position)).toEqual([2n]);
      expect(second.next).toBeNull();
    });

    test('with many writers and random delays before the commit, no reader sees a position at or below one it has seen', async () => {
      const scopes = [tenantA, tenantB, tenantC];
      const writers = subject.networked ? 24 : 12;
      const next = delays(7);
      let writing = true;
      const observed = new Map<StorageScope, Position[]>(scopes.map((s) => [s, []]));
      const readers = scopes.map(async (scope) => {
        let seen: Position | null = null;
        while (writing) {
          const page = await subject.read(scope, (unit) =>
            unit.events.readAll(seen, { limit: 50 }),
          );
          for (const event of page.events) {
            if (seen !== null && event.position <= seen)
              throw new Error('a position at or below one already seen appeared');
            seen = event.position;
            observed.get(scope)?.push(event.position);
          }
          await pause(1);
        }
      });
      const work = Array.from({ length: writers }, async (_, index) => {
        const scope = scopes[index % scopes.length] ?? tenantA;
        await pause(next());
        await subject.run(scope, async (unit) => {
          await unit.events.append([appendOf(100 + index, [1, 2])]);
          await pause(next());
        });
      });
      try {
        await Promise.all(work);
      } finally {
        writing = false;
        await Promise.allSettled(readers);
      }
      await Promise.all(readers);
      for (const [index, scope] of scopes.entries()) {
        const mine = Array.from({ length: writers }, (_, n) => n).filter(
          (n) => n % scopes.length === index,
        ).length;
        const all = await subject.read(scope, (unit) => unit.events.readAll(null, { limit: 1000 }));
        expect(all.events.map((e) => e.position)).toEqual(
          Array.from({ length: mine * 2 }, (_, n) => BigInt(n + 1)),
        );
        const watched = observed.get(scope) ?? [];
        expect([...watched].sort((a, b) => (a < b ? -1 : 1))).toEqual(watched);
      }
    }, 60_000);

    test.runIf(subject.networked)(
      'a writer of one tenant never waits on the commit tail of another tenant',
      async () => {
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        let entered: () => void = () => undefined;
        const inside = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const slow = subject.run(tenantA, async (unit) => {
          await unit.events.append([appendOf(1, [1])]);
          entered();
          await held;
        });
        await inside;
        const releaseLater = setTimeout(release, 2500);
        const started = Date.now();
        await subject.run(tenantB, (unit) => unit.events.append([appendOf(1, [1])]));
        const waited = Date.now() - started;
        clearTimeout(releaseLater);
        release();
        await slow;
        expect(waited).toBeLessThan(2000);
        expect(await subject.read(tenantB, (unit) => unit.events.head())).toBe(1n);
      },
      30_000,
    );
  });
}
