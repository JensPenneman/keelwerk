import { errors } from '../errors/errors.ts';

/**
 * A timer key a module chooses may not start with `core:`, the kernel's prefix (the deadline
 * timers of external effects, 7.9.5): a `setTimer` or `cancelTimer` with one is a validation
 * error, which names the prefix and never the key.
 */
export function checkTimerKey(key: string): void {
  if (!key.startsWith('core:')) return;
  throw errors.validation('A timer key that starts with "core:" is reserved for the kernel.', {
    issues: [{ path: ['key'], message: 'The prefix "core:" is reserved.' }],
  });
}
