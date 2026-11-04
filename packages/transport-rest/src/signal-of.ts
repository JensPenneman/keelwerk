import type { SurfaceAction } from '@keelwerk/core';

/**
 * The invocation's signal (section 16.4.11): it carries the action's `timeoutMs`. A client
 * disconnect aborts queries but never a running command, which completes and records its outcome.
 */
export function signalOf(action: SurfaceAction, client: AbortSignal): AbortSignal {
  const timeout =
    action.timeoutMs === undefined ? undefined : AbortSignal.timeout(action.timeoutMs);
  if (action.kind === 'command') {
    return timeout ?? new AbortController().signal;
  }
  return timeout === undefined ? client : AbortSignal.any([client, timeout]);
}
