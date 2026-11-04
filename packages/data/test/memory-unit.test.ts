import type { StorageScope } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { backendScope } from './support/backend-scope.ts';
import { deploymentScope } from './support/deployment-scope.ts';
import { effectRecord } from './support/effect-record.ts';
import { failure } from './support/failure.ts';
import { id } from './support/id.ts';
import { openMemory } from './support/memory-fixture.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { newEvent } from './support/new-event.ts';
import { note } from './support/note.ts';
import { noteRow } from './support/note-row.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

test('read-write units of a namespace run one at a time in the order they asked', async () => {
  const memory = openMemory();
  const first = gate();
  const order: string[] = [];
  const a = memory.run(tenantScope, async (unit) => {
    order.push('a start');
    await first.promise;
    await unit.rows.insert(note, [noteRow(1, { title: 'a' })]);
    order.push('a end');
  });
  await tick();
  const b = memory.run(tenantTwo, async (unit) => {
    order.push('b start');
    expect((await unit.rows.find(note, {})).rows).toEqual([]);
  });
  await tick();
  expect(order).toEqual(['a start']);
  first.open();
  await Promise.all([a, b]);
  expect(order).toEqual(['a start', 'a end', 'b start']);
});

test('a read-only unit is a snapshot, and never waits for a writer', async () => {
  const memory = openMemory();
  await memory.run(tenantScope, (unit) => unit.rows.insert(note, [noteRow(1, { title: 'old' })]));
  const hold = gate();
  const proceed = gate();
  const writer = memory.run(tenantScope, async (unit) => {
    await unit.rows.update(note, [
      { id: id(1), expectedVersion: 1, values: noteRow(1, { version: 2, title: 'new' }) },
    ]);
    proceed.open();
    await hold.promise;
  });
  await proceed.promise;
  const seen = await memory.read(tenantScope, async (unit) => {
    const before = (await unit.rows.findOne(note, {}))?.title;
    hold.open();
    await writer;
    const after = (await unit.rows.findOne(note, {}))?.title;
    return [before, after];
  });
  expect(seen).toEqual(['old', 'old']);
  expect((await memory.read(tenantScope, (unit) => unit.rows.findOne(note, {})))?.title).toBe(
    'new',
  );
});

test('an error leaves nothing of the unit behind, in any store', async () => {
  const memory = openMemory();
  await memory
    .run(tenantScope, async (unit) => {
      await unit.rows.insert(note, [noteRow(1, {})]);
      await unit.usage.add('n', 1n);
      await unit.events.append([
        {
          stream: { type: 'app.note', id: id(1) },
          expectedVersion: 0,
          partition: null,
          events: [newEvent(1)],
        },
      ]);
      throw new Error('boom');
    })
    .catch(() => undefined);
  expect(await memory.read(tenantScope, (unit) => unit.rows.count(note))).toBe(0);
  expect(await memory.read(tenantScope, (unit) => unit.usage.get('n'))).toBe(0n);
  expect(await memory.read(tenantScope, (unit) => unit.events.head())).toBeNull();
});

test('nested is a savepoint: a failure rolls back to it and rethrows, a success keeps the work', async () => {
  const memory = openMemory();
  const result = await memory.run(tenantScope, async (unit) => {
    await unit.rows.insert(note, [noteRow(1, { title: 'outer' })]);
    const thrown = await unit
      .nested(async (inner) => {
        await inner.rows.insert(note, [noteRow(2, { title: 'inner' })]);
        await inner.rows.update(note, [
          { id: id(1), expectedVersion: 1, values: noteRow(1, { version: 2, title: 'changed' }) },
        ]);
        throw new Error('undo');
      })
      .catch((error: unknown) => (error as Error).message);
    const kept = await unit.nested(async (inner) => {
      await inner.rows.insert(note, [noteRow(3, { title: 'kept' })]);
      return 'ok';
    });
    const titles = (
      await unit.rows.find(note, { sort: [{ field: 'title', direction: 'asc' }] })
    ).rows.map((row) => row.title);
    return { thrown, kept, titles };
  });
  expect(result).toEqual({ thrown: 'undo', kept: 'ok', titles: ['kept', 'outer'] });
  expect(await memory.read(tenantScope, (unit) => unit.rows.count(note))).toBe(2);
});

test("savepoints nest: an inner failure leaves the outer savepoint's work", async () => {
  const memory = openMemory();
  await memory.run(tenantScope, async (unit) => {
    await unit.nested(async (outer) => {
      await outer.rows.insert(note, [noteRow(1, {})]);
      await outer
        .nested(async (inner) => {
          await inner.rows.insert(note, [noteRow(2, {})]);
          throw new Error('inner');
        })
        .catch(() => undefined);
      await outer.rows.insert(note, [noteRow(3, {})]);
    });
    await unit
      .nested(async (outer) => {
        await outer.rows.purge(note, [id(1)]);
        throw new Error('outer');
      })
      .catch(() => undefined);
  });
  const ids = (await memory.read(tenantScope, (unit) => unit.rows.find(note, {}))).rows.map(
    (row) => row.id,
  );
  expect(ids).toEqual([id(1), id(3)]);
});

test('afterCommit runs after a successful commit, in order, and not for a failed unit or savepoint', async () => {
  const memory = openMemory();
  const calls: string[] = [];
  await memory.run(tenantScope, async (unit) => {
    unit.afterCommit(() => calls.push('first'));
    await unit
      .nested(async (inner) => {
        inner.afterCommit(() => calls.push('dropped'));
        throw new Error('undo');
      })
      .catch(() => undefined);
    await unit.nested(async (inner) => {
      inner.afterCommit(() => calls.push('second'));
    });
    expect(calls).toEqual([]);
  });
  expect(calls).toEqual(['first', 'second']);
  await memory
    .run(tenantScope, async (unit) => {
      unit.afterCommit(() => calls.push('never'));
      throw new Error('boom');
    })
    .catch(() => undefined);
  expect(calls).toEqual(['first', 'second']);
});

test('a hook that throws does not fail the committed unit or stop the others', async () => {
  const memory = openMemory();
  const calls: string[] = [];
  await memory.run(tenantScope, async (unit) => {
    await unit.rows.insert(note, [noteRow(1, {})]);
    unit.afterCommit(() => {
      throw new Error('hook');
    });
    unit.afterCommit(() => calls.push('after'));
  });
  expect(calls).toEqual(['after']);
  expect(await memory.read(tenantScope, (unit) => unit.rows.count(note))).toBe(1);
});

test('namespaces are separate stores', async () => {
  const memory = openMemory();
  await memory.run(tenantScope, (unit) => unit.rows.insert(note, [noteRow(1, {})]));
  const other = await memory.adapter.unit(
    { ...memory.namespace, id: 'ns-2' },
    tenantScope,
    (unit) => unit.rows.count(note),
    { readOnly: true },
  );
  expect(other).toBe(0);
});

test('the unit tells its scope and read-only flag; an aborted signal and a closed adapter refuse', async () => {
  const memory = openMemory();
  const info = await memory.read(tenantScope, async (unit) => [
    unit.scope,
    unit.readOnly,
    unit.namespace.id,
  ]);
  expect(info).toEqual([tenantScope, true, 'ns-1']);
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await expect(
    memory.adapter.unit(memory.namespace, tenantScope, async () => 1, {
      signal: controller.signal,
    }),
  ).rejects.toThrow('stop');
  const late = new AbortController();
  await expect(
    memory.adapter.unit(
      memory.namespace,
      tenantScope,
      async () => {
        late.abort(new Error('late'));
      },
      { signal: late.signal },
    ),
  ).rejects.toThrow('late');
  expect(await memory.read(tenantScope, (unit) => unit.rows.count(note))).toBe(0);
  await memory.adapter.close(100);
  expect((await failure(memory.run(tenantScope, async () => 1))).kind).toBe('unavailable');
  expect((await failure(memory.read(tenantScope, async () => 1))).kind).toBe('unavailable');
  expect(await memory.adapter.health()).toEqual({ ok: false, detail: 'closed' });
});

test('a unit nested in a read-write unit of its namespace times out instead of hanging', async () => {
  const memory = openMemory();
  const error = await memory
    .run(tenantScope, () =>
      failure(memory.adapter.unit(memory.namespace, tenantTwo, async () => 1, { timeoutMs: 20 })),
    )
    .catch((caught: unknown) => caught);
  expect(error).toEqual({ kind: 'unavailable', code: 'core.timeout' });
});

test('an aborted signal ends the wait for the namespace', async () => {
  const memory = openMemory();
  const controller = new AbortController();
  const waiting = await memory.run(tenantScope, async () => {
    const pending = memory.adapter.unit(memory.namespace, tenantTwo, async () => 1, {
      signal: controller.signal,
    });
    controller.abort(new Error('stop'));
    return pending.catch((caught: unknown) => caught);
  });
  expect(waiting).toEqual(new Error('stop'));
  expect(await memory.run(tenantTwo, async () => 2)).toBe(2);
});

test('an invocation entity is stored under the scope of the unit, and a second tenant sees nothing', async () => {
  const memory = openMemory();
  await memory.run(tenantScope, (unit) =>
    unit.rows.insert(effectRecord, [noteRow(1, { title: 'a' })]),
  );
  await memory.run(backendScope, (unit) =>
    unit.rows.insert(effectRecord, [noteRow(2, { title: 'b' })]),
  );
  await memory.run(deploymentScope, (unit) =>
    unit.rows.insert(effectRecord, [noteRow(3, { title: 'c' })]),
  );
  const titlesIn = (scope: StorageScope): Promise<unknown[]> =>
    memory.read(scope, async (unit) =>
      (await unit.rows.find(effectRecord, {})).rows.map((row) => row.title),
    );
  expect(await titlesIn(tenantScope)).toEqual(['a']);
  expect(await titlesIn(tenantTwo)).toEqual([]);
  expect(await titlesIn(backendScope)).toEqual(['b']);
  expect(await titlesIn(deploymentScope)).toEqual(['c']);
  expect(
    await failure(memory.read(namespaceScope, (unit) => unit.rows.count(effectRecord))),
  ).toEqual({
    kind: 'forbidden',
    code: 'core.forbidden',
  });
});
