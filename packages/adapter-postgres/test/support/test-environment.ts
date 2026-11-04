import type { AdapterEnvironment, Logger, Tracer } from '@keelwerk/core';
import { testScopes } from './test-scopes.ts';

const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};

const span = {
  recordException: () => undefined,
  setStatus: () => undefined,
  end: () => undefined,
};

/** A tracer that opens spans doing nothing: `startActiveSpan` runs its callback with one. */
const tracer = {
  startActiveSpan: (...args: readonly unknown[]) => {
    const run = args.at(-1);
    if (typeof run !== 'function') throw new TypeError('startActiveSpan needs a callback');
    return run(span);
  },
} as unknown as Tracer;

/** An adapter environment for tests: a silent logger and a tracer whose spans do nothing. */
export function testEnvironment(deploymentId = testScopes.deploymentId): AdapterEnvironment {
  return {
    deploymentId,
    log,
    tracer,
    secrets: { resolve: async () => '' },
    signal: new AbortController().signal,
  };
}
