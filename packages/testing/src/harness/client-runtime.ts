import type { TestRuntime } from './test-runtime.ts';

/** What a local client needs of a runtime: the app, its in-process invoker, its tenants and its API version. */
export type ClientRuntime<App, Name extends string = string> = Pick<
  TestRuntime<App, Name>,
  'app' | 'invoker' | 'tenants' | 'head'
>;
