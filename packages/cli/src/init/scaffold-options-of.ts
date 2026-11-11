import type { ScaffoldOptions } from '../scaffold/scaffold-options.ts';

/** The options of a `new` run that sets none of the flags, with the app's module selection. */
export function scaffoldOptionsOf(modules: readonly string[]): ScaffoldOptions {
  return {
    kind: undefined,
    requires: [],
    optional: [],
    app: undefined,
    from: undefined,
    when: [],
    level: undefined,
    purpose: undefined,
    expires: undefined,
    effect: undefined,
    on: undefined,
    every: undefined,
    ticks: undefined,
    modules,
    scope: undefined,
    dir: undefined,
  };
}
