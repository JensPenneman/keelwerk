import type { AdapterEnvironment } from '@keelwerk/core';

type Tracer = AdapterEnvironment['tracer'];
type Span = ReturnType<Tracer['startSpan']>;

const noSpan: Span = {
  spanContext: () => ({ traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 0 }),
  setAttribute: () => noSpan,
  setAttributes: () => noSpan,
  addEvent: () => noSpan,
  addLink: () => noSpan,
  addLinks: () => noSpan,
  setStatus: () => noSpan,
  updateName: () => noSpan,
  end: () => undefined,
  isRecording: () => false,
  recordException: () => undefined,
};

/** A tracer that records nothing: spans open and end without effect. */
export const testTracer: Tracer = {
  startSpan: () => noSpan,
  startActiveSpan: ((...args: readonly unknown[]) => {
    const callback = args.at(-1) as (span: Span) => unknown;
    return callback(noSpan);
  }) as Tracer['startActiveSpan'],
};
