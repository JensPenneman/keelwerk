import type { NewEvent } from '@keelwerk/core';
import { id } from './id.ts';
import { stamp } from './stamp.ts';

/** A minimal event; `n` makes its id and its name distinct. */
export function newEvent(n: number, over: Partial<NewEvent> = {}): NewEvent {
  return {
    eventId: id(2000 + n),
    name: n === 1 ? 'created' : 'changed',
    schemaVersion: 1,
    shape: 'shape-1',
    data: { n },
    before: null,
    hlc: `0000${n}` as NewEvent['hlc'],
    recordedAt: stamp,
    meta: {
      actor: { kind: 'system', reason: 'test' } as unknown as NewEvent['meta']['actor'],
      commandId: null,
      action: null,
      causationId: null,
      correlationId: id(3000),
      client: null,
      merge: null,
      traceparent: null,
      writer: { build: 'b', revision: 1 },
      flags: [],
      decision: null,
    },
    transient: false,
    prevHash: null,
    hash: null,
    ...over,
  };
}
