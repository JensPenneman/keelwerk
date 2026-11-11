import type { Logger } from '../observability/logger.ts';
import type { FlagProvider } from './flag-provider.ts';

/** Calls each provider's `start(signal)` once, without awaiting; a throw or rejection is logged at error level. */
export function startFlagProviders(
  providers: readonly FlagProvider[],
  signal: AbortSignal,
  log: Logger,
): void {
  for (const provider of providers) {
    const failed = (cause: unknown): void => {
      log.error('a flag provider did not start', { provider: provider.id, cause });
    };
    try {
      provider.start(signal).catch(failed);
    } catch (error) {
      failed(error);
    }
  }
}
