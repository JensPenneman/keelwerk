import type { NewEvent } from '@keelwerk/core';
import { newEvent } from './new-event.ts';
import { stamp } from './stamp.ts';

/** A transient record of event number `n`, recorded `hours` after the suites' stamp. */
export function purgeRecord(n: number, hours: number): NewEvent {
  return newEvent(n, { transient: true, recordedAt: stamp.add({ hours }) });
}
