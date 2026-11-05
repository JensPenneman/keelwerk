import type { AdapterEnvironment, Logger, Tracer } from '@keelwerk/core';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

/** A span that records nothing: every member is a function that answers the span itself. */
const span: object = new Proxy(
  {},
  {
    get: () => () => span,
  },
);

/** A tracer that records nothing, for an adapter that is only connected to read its capabilities. */
const quiet = {
  startSpan: () => span,
  startActiveSpan: (...args: readonly unknown[]) => {
    const work = args.at(-1);
    return typeof work === 'function' ? work(span) : undefined;
  },
} as unknown as Tracer;

/** What an adapter is given when doctor connects it only to read its capabilities: no logging, no tracing, secrets from `env`. */
export function adapterEnvironmentOf(
  env: Readonly<Record<string, string | undefined>>,
): AdapterEnvironment {
  return {
    deploymentId: 'doctor',
    log: silent,
    tracer: quiet,
    secrets: {
      resolve: async (ref) => {
        const value = env[ref.ref];
        if (value === undefined) throw new Error(`the secret ${ref.ref} is not set`);
        return value;
      },
    },
    signal: new AbortController().signal,
  };
}
