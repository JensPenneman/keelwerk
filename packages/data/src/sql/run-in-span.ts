import type { Tracer } from '@keelwerk/core';

/** Span status code of an error (OpenTelemetry's `SpanStatusCode.ERROR`). */
const spanError = 2;

/**
 * Runs `work` in an active span of `tracer` (14.3.6: every unit runs in a span, and the statements
 * of its stores are children of it). The span records a failure and always ends. Without a tracer
 * the work runs bare.
 */
export async function runInSpan<T>(
  tracer: Tracer | undefined,
  name: string,
  attributes: Readonly<Record<string, string | boolean>>,
  work: () => Promise<T>,
): Promise<T> {
  if (tracer === undefined) return work();
  return tracer.startActiveSpan(name, { attributes: { ...attributes } }, async (span) => {
    try {
      return await work();
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: spanError });
      throw error;
    } finally {
      span.end();
    }
  });
}
