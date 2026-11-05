import type { Hlc, NewEvent } from '@keelwerk/core';
import { conformanceId } from '@keelwerk/data/conformance';
import { stamp } from './stamp.ts';

/** A minimal event: number `n` makes its id and its name distinct; number 1 is the creation. */
export function newEvent(n: number, over: Partial<NewEvent> = {}): NewEvent {
  return {
    eventId: conformanceId(5000 + n),
    name: n === 1 ? 'created' : 'changed',
    schemaVersion: 1,
    shape: `${'0'.repeat(63)}1`,
    data: { n },
    before: null,
    hlc: `0000${n}` as Hlc,
    recordedAt: stamp,
    meta: {
      actor: { kind: 'system', id: null, via: 'conformance' },
      commandId: null,
      action: null,
      causationId: null,
      correlationId: conformanceId(6000),
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
