import type { NewEvent, StreamAppend } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { id } from './support/id.ts';
import { newEvent } from './support/new-event.ts';
import { storeSuite } from './support/store-suite.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

const store = storeSuite();

function caused(n: number, commandId: string | null, causationId: string | null): NewEvent {
  const base = newEvent(n);
  return { ...base, meta: { ...base.meta, commandId, causationId } };
}

function append(n: number, events: readonly NewEvent[]): StreamAppend {
  return { stream: { type: 'app.note', id: id(n) }, expectedVersion: 0, partition: null, events };
}

describe('EventStore.find', () => {
  test('names the events of a command, the events it caused and one event, in position order', async () => {
    await store.run(tenantScope, (unit) =>
      unit.events.append([
        append(1, [caused(1, 'cmd-a', null), caused(2, 'cmd-a', null)]),
        append(2, [caused(3, 'cmd-b', 'cmd-a')]),
        append(3, [caused(4, null, null)]),
      ]),
    );
    await store.run(tenantTwo, (unit) =>
      unit.events.append([append(1, [caused(5, 'cmd-a', null)])]),
    );
    const find = (match: { commandId: string } | { causationId: string } | { eventId: string }) =>
      store
        .read(tenantScope, (unit) => unit.events.find(match, { after: null, limit: 100 }))
        .then((page) => page.events);
    expect((await find({ commandId: 'cmd-a' })).map((event) => event.position)).toEqual([1n, 2n]);
    expect((await find({ causationId: 'cmd-a' })).map((event) => event.commandId)).toEqual([
      'cmd-b',
    ]);
    expect((await find({ eventId: id(2004) })).map((event) => event.position)).toEqual([4n]);
    expect(await find({ eventId: 'not-a-uuid' })).toEqual([]);
    expect(await find({ commandId: 'cmd-none' })).toEqual([]);
    const first = await store.read(tenantScope, (unit) =>
      unit.events.find({ commandId: 'cmd-a' }, { after: null, limit: 1 }),
    );
    expect(first.events).toHaveLength(1);
    expect(first.next).toBe(1n);
    const second = await store.read(tenantScope, (unit) =>
      unit.events.find({ commandId: 'cmd-a' }, { after: first.next, limit: 5 }),
    );
    expect(second.events.map((event) => event.position)).toEqual([2n]);
    expect(second.next).toBeNull();
  });
});
