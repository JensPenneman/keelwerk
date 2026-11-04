import type { AnyActionPart, Execution } from './action-part.ts';
import type { AnyModule } from './any-module.ts';
import type { ActionRefsOf, AppActionTreeOf } from './app-action-tree.ts';
import type { AppChecks } from './app-checks.ts';
import type { AppEntitiesOf } from './app-entities.ts';
import { core } from './core-module.ts';
import type { WithCore } from './selection.ts';

/** The options of `defineApp` (section 4.5). */
export interface AppOptions<Id extends string, Ms extends readonly AnyModule[], A, X> {
  readonly id: Id;
  readonly modules: Ms;
  readonly actions?: A;
  readonly execution?: X;
  readonly authorization?: {
    readonly mode?: 'strict' | 'strip';
    readonly decisionLog?: 'denials' | 'all' | 'none';
  };
  readonly policies?: { readonly disable?: readonly string[]; readonly add?: readonly object[] };
  readonly api?: object;
  readonly flags?: { readonly [name: string]: object };
}

/** An app value. `entities`, `actions` and `tree` are type-only carriers; the runtime value holds the registry. */
export interface App<Id extends string, Ms extends readonly AnyModule[], A, X> {
  readonly kind: 'app';
  readonly id: Id;
  readonly modules: Ms;
  readonly execution: X;
  readonly entities: AppEntitiesOf<Ms>;
  readonly actions: ActionRefsOf<Ms, A>;
  readonly tree: AppActionTreeOf<Ms, A, X>;
}

/** The named type of an app value. */
export type AppType<T extends { readonly kind: 'app' }> = T;

/** Composes an app from the `as const` tuple of its modules; uncallable when the tuple is inconsistent. */
export function defineApp<
  const Id extends string,
  const Ms extends readonly AnyModule[],
  const A extends { readonly [name: string]: AnyActionPart } = {},
  const X extends { readonly [ref: string]: Execution } = {},
>(config: AppOptions<Id, Ms, A, X> & AppChecks<Ms, A, X>): App<Id, WithCore<Ms>, A, X> {
  return {
    kind: 'app',
    id: config.id,
    modules: [core, ...config.modules],
    execution: config.execution ?? {},
    entities: {},
    actions: {},
    tree: {},
  } as unknown as App<Id, WithCore<Ms>, A, X>;
}
