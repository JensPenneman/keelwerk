import type { NewEvent, StreamAppend } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { id } from './support/id.ts';
import { openMemory } from './support/memory-fixture.ts';
import { newEvent } from './support/new-event.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

function caused(n: number, commandId: string | null, causationId: string | null): NewEvent {
  const base = newEvent(n);
  return { ...base, meta: { ...base.meta, commandId, causationId } };
}

function append(n: number, events: readonly NewEvent[]): StreamAppend {
  return { stream: { type: 'app.note', id: id(n) }, expectedVersion: 0, partition: null, events };
}

describe('EventStore.find', () => {
  test('names the events of a command, the events it caused and one event, in position order', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) =>
      unit.events.append([
        append(1, [caused(1, 'cmd-a', null), caused(2, 'cmd-a', null)]),
        append(2, [caused(3, 'cmd-b', 'cmd-a')]),
        append(3, [caused(4, null, null)]),
      ]),
    );
    await memory.run(tenantTwo, (unit) =>
      unit.events.append([append(1, [caused(5, 'cmd-a', null)])]),
    );
    const find = (match: Parameters<typeof tenantEvents>[1]) => tenantEvents(memory, match);
    expect((await find({ commandId: 'cmd-a' })).map((event) => event.position)).toEqual([1n, 2n]);
    expect((await find({ causationId: 'cmd-a' })).map((event) => event.commandId)).toEqual([
      'cmd-b',
    ]);
    expect((await find({ eventId: id(2004) })).map((event) => event.position)).toEqual([4n]);
    expect(await find({ commandId: 'cmd-none' })).toEqual([]);
    expect(await tenantEvents(memory, { commandId: 'cmd-a' }, 1)).toHaveLength(1);
    const first = await memory.read(tenantScope, (unit) =>
      unit.events.find({ commandId: 'cmd-a' }, { after: null, limit: 1 }),
    );
    expect(first.next).toBe(1n);
    const second = await memory.read(tenantScope, (unit) =>
      unit.events.find({ commandId: 'cmd-a' }, { after: first.next, limit: 1 }),
    );
    expect(second.events.map((event) => event.position)).toEqual([2n]);
    expect(second.next).toBe(2n);
    const last = await memory.read(tenantScope, (unit) =>
      unit.events.find({ commandId: 'cmd-a' }, { after: second.next, limit: 1 }),
    );
    expect(last).toEqual({ events: [], next: null });
  });
});

function tenantEvents(
  memory: ReturnType<typeof openMemory>,
  match: { commandId: string } | { causationId: string } | { eventId: string },
  limit = 100,
) {
  return memory
    .read(tenantScope, (unit) => unit.events.find(match, { after: null, limit }))
    .then((page) => page.events);
}
