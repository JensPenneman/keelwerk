import { expect, test } from 'vitest';
import { id } from './support/id.ts';
import { openMemory } from './support/memory-fixture.ts';
import { newEvent } from './support/new-event.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

const append =
  (n: number): Parameters<ReturnType<typeof openMemory>['run']>[1] =>
  async (unit) => {
    await unit.events.append([
      {
        stream: { type: 'app.note', id: id(n) },
        expectedVersion: 0,
        partition: null,
        events: [newEvent(1)],
      },
    ]);
  };

test('a commit that appended events wakes the feed with its namespace and scope', async () => {
  const memory = openMemory();
  const stop = new AbortController();
  const wakes = memory.adapter.feed.wake([memory.namespace], stop.signal)[Symbol.asyncIterator]();
  const next = wakes.next();
  await memory.run(tenantScope, append(1));
  const first = await next;
  expect(first.value).toEqual({
    namespace: 'ns-1',
    scopeIds: [tenantScope.level === 'tenant' ? tenantScope.tenantId : ''],
  });
  stop.abort();
  expect((await wakes.next()).done).toBe(true);
});

test('wake-ups of one burst are merged, a rolled-back unit and a read-only unit wake nobody', async () => {
  const memory = openMemory();
  const stop = new AbortController();
  const wakes = memory.adapter.feed.wake([memory.namespace], stop.signal)[Symbol.asyncIterator]();
  await memory
    .run(tenantScope, async (unit) => {
      await append(1)(unit);
      throw new Error('boom');
    })
    .catch(() => undefined);
  await memory.read(tenantScope, async () => undefined);
  await memory.run(tenantScope, append(2));
  await memory.run(tenantTwo, append(3));
  await memory.run(tenantScope, append(4));
  const batch = await wakes.next();
  expect(batch.value?.scopeIds.length).toBe(2);
  stop.abort();
  expect((await wakes.next()).done).toBe(true);
});

test('only the namespaces asked for wake the iterator, and the level is notify', async () => {
  const memory = openMemory();
  expect(memory.adapter.feed.level).toBe('notify');
  const stop = new AbortController();
  const wakes = memory.adapter.feed
    .wake([{ ...memory.namespace, id: 'elsewhere' }], stop.signal)
    [Symbol.asyncIterator]();
  const pending = wakes.next();
  await memory.run(tenantScope, append(1));
  stop.abort();
  expect((await pending).done).toBe(true);
});

test('a signal that is already aborted ends the iterator at once', async () => {
  const memory = openMemory();
  const stop = new AbortController();
  stop.abort();
  const wakes = memory.adapter.feed.wake([memory.namespace], stop.signal)[Symbol.asyncIterator]();
  expect((await wakes.next()).done).toBe(true);
});
