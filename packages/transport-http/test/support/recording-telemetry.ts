import type { Telemetry } from '@keelwerk/core';

export interface RecordedSpan {
  name: string;
  attributes: Record<string, unknown>;
  ended: boolean;
}

export interface RecordingTelemetry {
  readonly telemetry: Telemetry;
  readonly spans: RecordedSpan[];
  readonly measurements: {
    readonly name: string;
    readonly value: number;
    readonly attributes: unknown;
  }[];
}

/** A tracer and a meter that remember what they were given. */
export function createRecordingTelemetry(): RecordingTelemetry {
  const spans: RecordedSpan[] = [];
  const measurements: RecordingTelemetry['measurements'] = [];
  const instrument = (name: string, method: string) => ({
    [method]: (value: number, attributes?: unknown) => {
      measurements.push({ name, value, attributes });
    },
  });
  const telemetry = {
    tracer: {
      startSpan(name: string, options?: { attributes?: Record<string, unknown> }) {
        const span: RecordedSpan = { name, attributes: { ...options?.attributes }, ended: false };
        spans.push(span);
        return {
          updateName(next: string) {
            span.name = next;
          },
          setAttributes(attributes: Record<string, unknown>) {
            Object.assign(span.attributes, attributes);
          },
          setStatus() {},
          end() {
            span.ended = true;
          },
        };
      },
    },
    meter: {
      createHistogram: (name: string) => instrument(name, 'record'),
      createUpDownCounter: (name: string) => instrument(name, 'add'),
      createCounter: (name: string) => instrument(name, 'add'),
    },
  } as unknown as Telemetry;
  return { telemetry, spans, measurements };
}
