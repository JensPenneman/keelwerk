import type { DecisionRecord, NewEvent, StreamAppend } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { id } from './support/id.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { newEvent } from './support/new-event.ts';
import { ownerRows } from './support/owner-rows.ts';
import { storeSuite } from './support/store-suite.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

const store = storeSuite();

const stream = (n: number, type = 'app.note'): { type: string; id: string } => ({
  type,
  id: id(n),
});

function append(
  n: number,
  events: readonly number[],
  over: Partial<StreamAppend> = {},
): StreamAppend {
  return {
    stream: stream(n),
    expectedVersion: 0,
    partition: null,
    events: events.map((event) => newEvent(event)),
    ...over,
  };
}

const _rows = async (sql: string): Promise<readonly Record<string, unknown>[]> =>
  ownerRows(store.adapter, sql);

describe('reading', () => {
  test('positions order numerically: the tenth event follows the ninth, not the first', async () => {
    await store.run(tenantScope, (unit) =>
      unit.events.append([
        append(
          1,
          Array.from({ length: 12 }, (_, index) => index + 1),
        ),
      ]),
    );
    const page = await store.read(tenantScope, (unit) => unit.events.readAll(null, { limit: 20 }));
    expect(page.events.map((event) => event.position)).toEqual(
      Array.from({ length: 12 }, (_, index) => BigInt(index + 1)),
    );
    const stream1 = await store.read(tenantScope, (unit) => unit.events.readStream(stream(1)));
    expect(stream1.map((event) => event.version)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
  });

  test('readAll with nothing past the cursor keeps the cursor as next', async () => {
    await store.run(tenantScope, (unit) => unit.events.append([append(1, [1])]));
    const page = await store.read(tenantScope, (unit) => unit.events.readAll(1n, { limit: 10 }));
    expect(page).toEqual({ events: [], next: 1n });
    const empty = await store.read(tenantTwo, (unit) => unit.events.readAll(null, { limit: 10 }));
    expect(empty.next).toBeNull();
  });

  test("readStream includes the unit's buffer in version order, and honours the range", async () => {
    await store.run(tenantScope, (unit) => unit.events.append([append(1, [1, 2])]));
    await store.run(tenantScope, async (unit) => {
      await unit.events.append([append(1, [3], { expectedVersion: 2 })]);
      const whole = await unit.events.readStream(stream(1));
      expect(whole.map((event) => [event.version, event.position])).toEqual([
        [1, 1n],
        [2, 2n],
        [3, 3n],
      ]);
      expect(
        (await unit.events.readStream(stream(1), { fromVersion: 2, toVersion: 2 })).length,
      ).toBe(1);
      expect((await unit.events.readStream(stream(1), { limit: 1 })).length).toBe(1);
      expect(await unit.events.head()).toBe(2n);
    });
  });

  test('readAll filters by selector, hides transient records unless asked, and honours the limit', async () => {
    await store.run(tenantScope, (unit) =>
      unit.events.append([
        append(1, [1, 2], { partition: 'p1' }),
        {
          stream: stream(2, 'app.team'),
          expectedVersion: 0,
          partition: null,
          events: [newEvent(1), { ...newEvent(2), transient: true }],
        },
      ]),
    );
    const all = (selector?: object, includeTransient = false, limit = 10): Promise<number[]> =>
      store.read(tenantScope, async (unit) =>
        (
          await unit.events.readAll(null, {
            limit,
            ...(selector === undefined ? {} : { selector }),
            includeTransient,
          })
        ).events.map((event) => Number(event.position)),
      );
    expect(await all()).toEqual([1, 2, 3]);
    expect(await all(undefined, true)).toEqual([1, 2, 3, 4]);
    expect(await all({ streamTypes: ['app.team'] })).toEqual([3]);
    expect(await all({ streamTypes: [] })).toEqual([]);
    expect(await all({ partition: 'p1' })).toEqual([1, 2]);
    expect(await all({ names: ['created'] })).toEqual([1, 3]);
    expect(await all({ names: ['app.note.changed'] })).toEqual([2]);
    expect(await all({ streams: [stream(2, 'app.team')] }, true)).toEqual([3, 4]);
    expect(await all(undefined, true, 2)).toEqual([1, 2]);
    expect(
      await store.read(tenantScope, (unit) => unit.events.head({ streamTypes: ['app.note'] })),
    ).toBe(2n);
    expect(
      await store.read(tenantScope, (unit) => unit.events.head({ streamTypes: ['none'] })),
    ).toBeNull();
  });

  test('the envelope the kernel handed over comes back, hashes as hex and the decision record whole', async () => {
    const decision: DecisionRecord = {
      part: 'app.note.set',
      inputDigest: 'digest',
      input: {
        keyId: 'k1',
        nonce: Uint8Array.from([1, 2, 3]),
        ciphertext: Uint8Array.from([250, 251, 252, 253]),
      },
      reads: [{ at: 12n }, { scope: 'backend', at: 9007199254740993n }],
      answers: [{ kind: 'id', entity: 'app.note', value: id(7) }],
      effects: ['e1'],
    };
    const base = newEvent(1);
    const event: NewEvent = {
      ...base,
      before: { title: 'old' },
      prevHash: 'ab'.repeat(32),
      hash: 'cd'.repeat(32),
      meta: { ...base.meta, commandId: id(5), action: 'app.note.set', decision },
    };
    await store.run(tenantScope, (unit) =>
      unit.events.append([{ ...append(1, []), events: [event] }]),
    );
    const [stored] = (
      await store.read(tenantScope, (unit) => unit.events.readAll(null, { limit: 1 }))
    ).events;
    expect(stored).toMatchObject({
      eventId: id(2001),
      namespace: 'ns-store',
      scope: tenantScope,
      shape: '0f'.repeat(32),
      version: 1,
      partition: null,
      data: { n: 1 },
      before: { title: 'old' },
      prevHash: 'ab'.repeat(32),
      hash: 'cd'.repeat(32),
      commandId: id(5),
      action: 'app.note.set',
      writer: { build: 'b', revision: 1 },
      transient: false,
      decision,
    });
    expect(stored?.recordedAt.epochMilliseconds).toBe(event.recordedAt.epochMilliseconds);
  });
});

describe('savepoints and moved scopes', () => {
  test('a savepoint that fails takes its buffered events and versions with it', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.events.append([append(1, [1])]);
      await unit
        .nested(async (inner) => {
          await inner.events.append([append(1, [2], { expectedVersion: 1 })]);
          throw new Error('undo');
        })
        .catch(() => undefined);
      expect((await unit.events.readStream(stream(1))).length).toBe(1);
      await unit.events.append([append(1, [3], { expectedVersion: 1 })]);
    });
    const all = await store.read(tenantScope, (unit) => unit.events.readAll(null, { limit: 10 }));
    expect(all.events.map((event) => [event.position, event.version])).toEqual([
      [1n, 1],
      [2n, 2],
    ]);
  });

  test('movedScopes lists the scopes whose head passed the marks; a tenant unit sees only its own', async () => {
    await store.run(tenantScope, (unit) => unit.events.append([append(1, [1, 2])]));
    await store.run(tenantTwo, (unit) => unit.events.append([append(1, [1])]));
    const one = tenantScope.level === 'tenant' ? tenantScope.tenantId : '';
    const two = tenantTwo.level === 'tenant' ? tenantTwo.tenantId : '';
    const all = await store.read(namespaceScope, (unit) => unit.events.movedScopes(new Map(), 10));
    expect(all).toEqual(
      [
        { scopeId: one, head: 2n },
        { scopeId: two, head: 1n },
      ].sort((a, b) => a.scopeId.localeCompare(b.scopeId)),
    );
    const since = await store.read(namespaceScope, (unit) =>
      unit.events.movedScopes(new Map([[one, 2n]]), 10),
    );
    expect(since).toEqual([{ scopeId: two, head: 1n }]);
    expect(await store.read(tenantScope, (unit) => unit.events.movedScopes(new Map(), 10))).toEqual(
      [{ scopeId: one, head: 2n }],
    );
    expect(
      await store.read(namespaceScope, (unit) => unit.events.movedScopes(new Map(), 1)),
    ).toHaveLength(1);
  });
});
