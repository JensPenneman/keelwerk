import type { Span as OtelSpan } from '@opentelemetry/api';

/** An OpenTelemetry span (`ctx.trace` of an executor, child spans of the data layer). */
export type Span = OtelSpan;
