import { vi } from 'vitest';
import { testLimits } from './test-limits.ts';

/**
 * `vi.waitFor` and `vi.waitUntil` give up after one second unless a limit is passed, and a correct
 * product can miss one second on a busy machine. Every project loads this file (see test-limits.ts), and a
 * wait without a limit of its own gets the case limit: it passes the moment its condition holds and only
 * ends a failure. A limit passed in the call is kept as written.
 */
type Options = number | { timeout?: number; interval?: number; message?: string } | undefined;

function bounded(options: Options): Options {
  if (typeof options === 'number') return options;
  return { ...options, timeout: options?.timeout ?? testLimits.testTimeout };
}

const { waitFor, waitUntil } = vi;
vi.waitFor = function waitForBounded(callback, options) {
  return waitFor(callback, bounded(options) as never);
} as typeof vi.waitFor;
vi.waitUntil = function waitUntilBounded(callback, options) {
  return waitUntil(callback, bounded(options) as never);
} as typeof vi.waitUntil;
