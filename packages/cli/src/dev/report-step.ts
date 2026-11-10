import process from 'node:process';
import { eventMarker } from './event-marker.ts';

/**
 * Tells the supervisor that the probe finished a step (`step <what it did>`, section 13.6), so its
 * limit, which counts time without progress, starts again. `done` is a past-tense clause that
 * completes "after it ...", because the supervisor quotes the last one when the probe stalls.
 */
export function reportStep(done: string): void {
  process.stderr.write(`\n${eventMarker} step ${done}\n`);
}
