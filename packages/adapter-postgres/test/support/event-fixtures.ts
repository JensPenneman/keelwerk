import type { NewEvent, StreamAppend } from '@keelwerk/core';
import { id } from './store-rows.ts';

const stamp = Temporal.Instant.from('2026-01-01T00:00:00Z');

/** A minimal event; `n` makes its id distinct. */
export function newEvent(n: number): NewEvent {
  return {
    eventId: id(100_000 + n),
    name: 'changed',
    schemaVersion: 1,
    shape: '0f'.repeat(32),
    data: { n },
    before: null,
    hlc: `0000${n}` as NewEvent['hlc'],
    recordedAt: stamp,
    meta: {
      actor: { kind: 'system', id: null, via: 'test' },
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
  };
}

/** Events numbered `events`, appended to stream `n` of type `app.ticket` at an expected version. */
export function streamAppend(
  n: number,
  events: readonly number[],
  expectedVersion = 0,
): StreamAppend {
  return {
    stream: { type: 'app.ticket', id: id(n) },
    expectedVersion,
    partition: null,
    events: events.map(newEvent),
  };
}
