import type { Position, StreamAppend } from '@keelwerk/core';
import { isKeelwerkError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { backendScope } from './support/backend-scope.ts';
import { deploymentScope } from './support/deployment-scope.ts';
import { id } from './support/id.ts';
import { openMemory } from './support/memory-fixture.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { newEvent } from './support/new-event.ts';
import { setting } from './support/setting.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

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

describe('append, commit tail and positions (15.1.4)', () => {
  test('buffered events get consecutive positions at the commit, versions at append', async () => {
    const memory = openMemory();
    const results = await memory.run(tenantScope, (unit) =>
      unit.events.append([append(1, [1, 2]), append(2, [3])]),
    );
    expect(results).toEqual([
      { eventId: id(2001), version: 1 },
      { eventId: id(2002), version: 2 },
      { eventId: id(2003), version: 1 },
    ]);
    const all = await memory.read(tenantScope, (unit) => unit.events.readAll(null, { limit: 10 }));
    expect(
      all.events.map((event) => [event.position, event.stream.id, event.version, event.type]),
    ).toEqual([
      [1n, id(1), 1, 'app.note.created'],
      [2n, id(1), 2, 'app.note.changed'],
      [3n, id(2), 1, 'app.note.changed'],
    ]);
    expect(all.next).toBe(3n);
  });

  test('positions continue across units and follow commit order; a rolled-back unit reuses its numbers', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.events.append([append(1, [1])]));
    await expect(
      memory.run(tenantScope, async (unit) => {
        await unit.events.append([append(2, [1, 2])]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const committed = await memory.run(tenantScope, async (unit) => {
      await unit.events.append([append(3, [1])]);
      return unit.events;
    });
    expect(committed.committed()).toEqual([2n]);
    expect(await memory.read(tenantScope, (unit) => unit.events.head())).toBe(2n);
  });

  test('a reader that saw a position never sees an event at or below it later', async () => {
    const memory = openMemory();
    const seen: Position[] = [];
    for (let round = 1; round <= 4; round++) {
      await memory.run(tenantScope, (unit) =>
        unit.events.append([append(round, [1, 2], { expectedVersion: 0 })]),
      );
      const head = await memory.read(tenantScope, (unit) => unit.events.head());
      seen.push(head ?? 0n);
      const after = await memory.read(tenantScope, (unit) =>
        unit.events.readAll(head, { limit: 5 }),
      );
      expect(after.events).toEqual([]);
    }
    expect(seen).toEqual([2n, 4n, 6n, 8n]);
  });

  test('each scope counts its own positions', async () => {
    const memory = openMemory([setting]);
    await memory.run(tenantScope, (unit) => unit.events.append([append(1, [1, 2, 3])]));
    await memory.run(tenantTwo, (unit) => unit.events.append([append(1, [1])]));
    await memory.run(backendScope, (unit) =>
      unit.events.append([append(1, [1, 2], { stream: stream(1, 'app.setting') })]),
    );
    expect(await memory.read(tenantScope, (unit) => unit.events.head())).toBe(3n);
    expect(await memory.read(tenantTwo, (unit) => unit.events.head())).toBe(1n);
    expect(await memory.read(backendScope, (unit) => unit.events.head())).toBe(2n);
    const own = await memory.read(tenantTwo, (unit) => unit.events.readAll(null, { limit: 10 }));
    expect(own.events.map((event) => event.scope)).toEqual([tenantTwo]);
    expect(await memory.read(deploymentScope, (unit) => unit.events.head())).toBeNull();
  });

  test("an expected version that is not the stream's is a conflict", async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.events.append([append(1, [1])]));
    for (const expectedVersion of [0, 2]) {
      const error = await memory
        .run(tenantScope, (unit) => unit.events.append([append(1, [2], { expectedVersion })]))
        .catch((caught: unknown) => caught);
      expect(isKeelwerkError(error) && [error.kind, error.code]).toEqual([
        'conflict',
        'core.version_mismatch',
      ]);
    }
    await memory.run(tenantScope, (unit) =>
      unit.events.append([append(1, [2], { expectedVersion: 1 })]),
    );
  });

  test('a deployment unit has a log of its own; a namespace unit has none; read-only units cannot append', async () => {
    const memory = openMemory();
    await memory.run(deploymentScope, (unit) =>
      unit.events.append([append(1, [1, 2], { stream: stream(1, 'app.global') })]),
    );
    expect(await memory.read(deploymentScope, (unit) => unit.events.head())).toBe(2n);
    expect(await memory.read(tenantScope, (unit) => unit.events.head())).toBeNull();
    const moved = await memory.read(deploymentScope, (unit) =>
      unit.events.movedScopes(new Map(), 10),
    );
    expect(moved).toEqual([{ scopeId: 'deployment', head: 2n }]);
    const error = await memory
      .run(namespaceScope, (unit) => unit.events.append([append(1, [1])]))
      .catch((caught: unknown) => caught);
    expect(isKeelwerkError(error) && error.kind).toBe('internal');
    const readOnly = await memory
      .read(tenantScope, (unit) => unit.events.append([append(1, [1])]))
      .catch((caught: unknown) => caught);
    expect(isKeelwerkError(readOnly) && readOnly.kind).toBe('internal');
  });

  test('a conflict on a later stream buffers nothing of the earlier ones', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.events.append([append(2, [1])]));
    await memory.run(tenantScope, async (unit) => {
      const error = await unit.events
        .append([append(1, [1]), append(2, [2], { expectedVersion: 0 })])
        .catch((caught: unknown) => caught);
      expect(isKeelwerkError(error) && error.code).toBe('core.version_mismatch');
      expect(await unit.events.readStream(stream(1))).toEqual([]);
    });
    const all = await memory.read(tenantScope, (unit) => unit.events.readAll(null, { limit: 10 }));
    expect(all.events.map((event) => event.stream.id)).toEqual([id(2)]);
  });

  test('two appends to one stream in a batch continue its versions', async () => {
    const memory = openMemory();
    const results = await memory.run(tenantScope, (unit) =>
      unit.events.append([append(1, [1]), append(1, [2], { expectedVersion: 1 })]),
    );
    expect(results.map((result) => result.version)).toEqual([1, 2]);
  });

  test('an event of a stream whose shape is unknown is refused, not stored with an empty shape', async () => {
    const memory = openMemory();
    const error = await memory
      .run(tenantScope, (unit) =>
        unit.events.append([{ ...append(1, [1]), stream: stream(1, 'app.unknown') }]),
      )
      .catch((caught: unknown) => caught);
    expect(isKeelwerkError(error) && error.kind).toBe('internal');
  });
});

describe('reading', () => {
  test('readAll with nothing past the cursor keeps the cursor as next', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.events.append([append(1, [1])]));
    const page = await memory.read(tenantScope, (unit) => unit.events.readAll(1n, { limit: 10 }));
    expect(page).toEqual({ events: [], next: 1n });
    const empty = await memory.read(tenantTwo, (unit) => unit.events.readAll(null, { limit: 10 }));
    expect(empty.next).toBeNull();
  });

  test("readStream includes the unit's buffer in version order, and honours the range", async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.events.append([append(1, [1, 2])]));
    await memory.run(tenantScope, async (unit) => {
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
    const memory = openMemory();
    await memory.run(tenantScope, (unit) =>
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
      memory.read(tenantScope, async (unit) =>
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
    expect(await all({ partition: 'p1' })).toEqual([1, 2]);
    expect(await all({ names: ['created'] })).toEqual([1, 3]);
    expect(await all({ names: ['app.note.changed'] })).toEqual([2]);
    expect(await all({ streams: [stream(2, 'app.team')] }, true)).toEqual([3, 4]);
    expect(await all(undefined, true, 2)).toEqual([1, 2]);
    const head = await memory.read(tenantScope, (unit) =>
      unit.events.head({ streamTypes: ['app.note'] }),
    );
    expect(head).toBe(2n);
    expect(
      await memory.read(tenantScope, (unit) => unit.events.head({ streamTypes: ['none'] })),
    ).toBeNull();
  });

  test('events carry the envelope the kernel handed over', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.events.append([append(1, [1])]));
    const [event] = (
      await memory.read(tenantScope, (unit) => unit.events.readAll(null, { limit: 1 }))
    ).events;
    expect(event).toMatchObject({
      eventId: id(2001),
      namespace: 'ns-1',
      scope: tenantScope,
      shape: '0f'.repeat(32),
      version: 1,
      partition: null,
      data: { n: 1 },
      writer: { build: 'b', revision: 1 },
      transient: false,
    });
  });
});

describe('savepoints and moved scopes', () => {
  test('a savepoint that fails takes its buffered events and versions with it', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
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
    const all = await memory.read(tenantScope, (unit) => unit.events.readAll(null, { limit: 10 }));
    expect(all.events.map((event) => [event.position, event.version])).toEqual([
      [1n, 1],
      [2n, 2],
    ]);
  });

  test('movedScopes lists the scopes whose head passed the marks; a tenant unit sees only its own', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.events.append([append(1, [1, 2])]));
    await memory.run(tenantTwo, (unit) => unit.events.append([append(1, [1])]));
    const one = tenantScope.level === 'tenant' ? tenantScope.tenantId : '';
    const two = tenantTwo.level === 'tenant' ? tenantTwo.tenantId : '';
    const all = await memory.read(namespaceScope, (unit) => unit.events.movedScopes(new Map(), 10));
    expect(all).toEqual(
      [
        { scopeId: one, head: 2n },
        { scopeId: two, head: 1n },
      ].sort((a, b) => a.scopeId.localeCompare(b.scopeId)),
    );
    const since = await memory.read(namespaceScope, (unit) =>
      unit.events.movedScopes(new Map([[one, 2n]]), 10),
    );
    expect(since).toEqual([{ scopeId: two, head: 1n }]);
    expect(
      await memory.read(tenantScope, (unit) => unit.events.movedScopes(new Map(), 10)),
    ).toEqual([{ scopeId: one, head: 2n }]);
    expect(
      await memory.read(namespaceScope, (unit) => unit.events.movedScopes(new Map(), 1)),
    ).toHaveLength(1);
  });
});
