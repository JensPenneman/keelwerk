import type { AdapterEnvironment, Logger } from '@keelwerk/core';
import { testTracer } from './test-tracer.ts';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

/** The environment a test runtime hands its adapter: a silent log and secrets that resolve to nothing. */
export function testEnvironment(
  signal: AbortSignal,
): AdapterEnvironment & { readonly log: Logger } {
  return {
    deploymentId: '00000000-0000-4000-8000-0000000000d1',
    log: silent,
    tracer: testTracer,
    secrets: { resolve: async () => '' },
    signal,
  };
}
