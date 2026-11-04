import type { Tracer as OtelTracer } from '@opentelemetry/api';

/** An OpenTelemetry tracer; adapters open child spans per statement batch. */
export type Tracer = OtelTracer;
