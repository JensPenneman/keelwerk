import type { EntityLoadMatchers } from './entity-load-matchers.ts';
import type { LoadMatchers } from './load-matchers.ts';

function opsOf(module: string, entity: string): EntityLoadMatchers {
  const matcher =
    (op: string) =>
    (...args: readonly unknown[]) =>
      ({ kind: 'load', module, entity, op, args }) as const;
  return {
    byId: matcher('byId'),
    one: matcher('one'),
    many: matcher('many'),
    count: matcher('count'),
    exists: matcher('exists'),
    query: matcher('query'),
  };
}

function named(get: (name: string) => unknown): object {
  return new Proxy(
    {},
    { get: (_target, name) => (typeof name === 'string' ? get(name) : undefined) },
  );
}

/** The matchers of `ctx.load`: `load.accounts.profile.exists({ email })` is the request the handler yields for that load. */
export const load = named((module) => named((entity) => opsOf(module, entity))) as LoadMatchers;
