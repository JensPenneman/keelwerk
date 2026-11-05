import type { Logger } from '@keelwerk/core';

function text(value: unknown): string {
  return JSON.stringify(value, (_key, member: unknown) =>
    typeof member === 'bigint' ? member.toString() : member,
  );
}

/** A logger that keeps every line it receives, bindings of child loggers included, as JSON text. */
export interface CapturingLogger {
  readonly logger: Logger;
  readonly lines: readonly string[];
}

export function capturingLogger(): CapturingLogger {
  const lines: string[] = [];
  const make = (bindings: Readonly<Record<string, unknown>>): Logger => {
    const write = (level: string, message: string, fields?: Readonly<Record<string, unknown>>) => {
      lines.push(text({ level, message, fields: { ...bindings, ...fields } }));
    };
    return {
      debug: (message, fields) => write('debug', message, fields),
      info: (message, fields) => write('info', message, fields),
      warn: (message, fields) => write('warn', message, fields),
      error: (message, fields) => write('error', message, fields),
      child: (more) => make({ ...bindings, ...more }),
    };
  };
  return { logger: make({}), lines };
}
