import type { NewEvent, StreamAppend } from '@keelwerk/core';
import { conformanceId } from '@keelwerk/data/conformance';

/** One append to a stream of another type, which retention never purges. */
export function appendPurgeKept(number: number, events: readonly NewEvent[]): StreamAppend {
  return {
    stream: { type: 'conf.kept', id: conformanceId(number) },
    partition: null,
    tenancy: 'tenant',
    expectedVersion: 0,
    events,
  };
}
