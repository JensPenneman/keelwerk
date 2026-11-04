import type { Meter as OtelMeter } from '@opentelemetry/api';

/** The OpenTelemetry meter the core hands to transports and adapters (section 16.11). */
export type Meter = OtelMeter;
