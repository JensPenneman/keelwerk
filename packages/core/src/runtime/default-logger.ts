import type { Logger } from '../observability/logger.ts';

/** The core's default logger: it writes nothing (S-46); `@keelwerk/cli` supplies the pino one. */
export const defaultLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => defaultLogger,
};
