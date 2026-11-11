import { trace } from '@opentelemetry/api';
import type { Logger } from '../src/observability/logger.ts';
import type { Span } from '../src/observability/span.ts';

// Core's tests may not import @keelwerk/testing (testing depends on core), so core keeps this
// recording logger of its own; every other package uses `recordingLogger` of @keelwerk/testing.

/** One line a recording logger saw. */
export interface LoggedLine {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** A logger that keeps every line it was given, bindings of `child` included. */
export function recordingLogger(
  lines: LoggedLine[] = [],
  bindings: Readonly<Record<string, unknown>> = {},
): Logger {
  const at =
    (level: LoggedLine['level']) =>
    (message: string, fields: Readonly<Record<string, unknown>> = {}): void => {
      lines.push({ level, message, fields: { ...bindings, ...fields } });
    };
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (more) => recordingLogger(lines, { ...bindings, ...more }),
  };
}

/** A span that records nothing (the API's non-recording span). */
export function inertSpan(): Span {
  return trace.getTracer('test').startSpan('test');
}
