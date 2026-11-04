import type { Meter } from '@opentelemetry/api';
import type { Tracer } from './tracer.ts';

/** What transports and listeners receive to record spans and metrics (section 11). */
export interface Telemetry {
  readonly tracer: Tracer;
  readonly meter: Meter;
}
