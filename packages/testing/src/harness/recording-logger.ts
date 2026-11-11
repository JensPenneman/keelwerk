import type { Logger } from '@keelwerk/core';
import type { LoggedLine } from './logged-line.ts';

/** A logger that keeps every line it was given, with the bindings of `child` merged in. */
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
