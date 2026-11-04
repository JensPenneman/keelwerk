import type { HybridClock } from '../clock/hybrid-clock.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';

/** Where an effect record is written: a unit, the run it belongs to, and the meta and process clock of its events. */
export interface EffectRecordTarget {
  readonly unit: Unit;
  readonly run: RunCommandInput;
  readonly clock: Clock;
  readonly meta: EventMeta;
  readonly hybridClock: HybridClock;
}
