import type { AdapterEnvironment, Logger, Tracer } from '@keelwerk/core';
import { testScopes } from './test-scopes.ts';

const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};

/** An adapter environment for tests: a silent logger; the adapter opens no spans, so the tracer is empty. */
export function testEnvironment(deploymentId = testScopes.deploymentId): AdapterEnvironment {
  return {
    deploymentId,
    log,
    tracer: {} as Tracer,
    secrets: { resolve: async () => '' },
    signal: new AbortController().signal,
  };
}
