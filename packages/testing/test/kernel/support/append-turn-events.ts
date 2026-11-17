import { createHash, randomUUID } from 'node:crypto';
import type { StreamAppend, Unit } from '@keelwerk/core';
import { newEvent } from '../../../src/conformance/adapter/new-event.ts';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Appends `count` `turned` events of a process straight to the stream of one instance, 1,000 per
 * batch, hash-chained, in the unit `inUnit` opens.
 */
export async function appendTurnEvents(
  inUnit: (work: (unit: Unit) => Promise<unknown>) => Promise<unknown>,
  stream: { readonly type: string; readonly id: string },
  count: number,
): Promise<void> {
  let previous: string | null = null;
  for (let first = 1; first <= count; first += 1000) {
    const events = Array.from({ length: Math.min(1000, count - first + 1) }, (_, offset) => {
      const version = first + offset;
      const hash = sha256(`turn-${String(version)}`);
      const event = newEvent(version, {
        eventId: randomUUID(),
        name: 'turned',
        data: { n: version },
        prevHash: previous,
        hash,
      });
      previous = hash;
      return event;
    });
    const append: StreamAppend = {
      stream,
      expectedVersion: first - 1,
      partition: null,
      events,
      tenancy: 'tenant',
    };
    await inUnit((unit) => unit.events.append([append]));
  }
}
