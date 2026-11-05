import type { Logger } from '@keelwerk/core';
import pino from 'pino';
import type { LogDestination } from './log-destination.ts';

function adapt(logger: pino.Logger): Logger {
  return {
    debug: (message, fields) => logger.debug(fields ?? {}, message),
    info: (message, fields) => logger.info(fields ?? {}, message),
    warn: (message, fields) => logger.warn(fields ?? {}, message),
    error: (message, fields) => logger.error(fields ?? {}, message),
    child: (bindings) => adapt(logger.child(bindings)),
  };
}

/**
 * The core's `Logger` over pino (S-46, section 11): JSON lines on `destination`, the message first
 * and the structured fields second as the interface has them, `pino`'s own order reversed.
 */
export function jsonLogger(destination: LogDestination, level = 'info'): Logger {
  return adapt(pino({ level, base: null }, destination));
}
