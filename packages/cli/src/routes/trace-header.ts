import type { CliHost } from '../context/cli-host.ts';

/** A W3C `traceparent` with fresh ids, and the trace id to print. */
export function traceHeader(host: CliHost): {
  readonly traceparent: string;
  readonly traceId: string;
} {
  const traceId = host.newId().replaceAll('-', '');
  const spanId = host.newId().replaceAll('-', '').slice(-16);
  return { traceparent: `00-${traceId}-${spanId}-01`, traceId };
}
