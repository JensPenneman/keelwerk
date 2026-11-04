import { core } from '../core-module/module.ts';
import type { AnyActionPart, Execution } from '../model/action-part.ts';
import type { AnyModule } from '../model/any-module.ts';
import type { ActionRefsOf, AppActionTreeOf } from '../model/app-action-tree.ts';
import type { AppChecks } from '../model/app-checks.ts';
import type { AppEntitiesOf } from '../model/app-entities.ts';
import type { WithCore } from '../model/selection.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import { composeApp } from '../registry/compose-app.ts';
import type { Registry } from '../registry/registry.ts';
import { surfaceProblemsOf } from '../surface/surface-problems-of.ts';
import type { Empty } from '../types/empty.ts';
import type { ApiVersions } from './define-api-versions.ts';

/** The authorization options of an app (section 8.7). */
export interface AppAuthorization {
  readonly mode?: 'strict' | 'strip';
  readonly decisionLog?: 'denials' | 'all' | 'none';
}

/** Per-app rule overrides (section 8.7): rule ids to switch off and rules to add. */
export interface AppPolicies {
  readonly disable?: readonly string[];
  readonly add?: readonly object[];
  /** A module's whole rule set, replaced by these rules (section 8.7). */
  readonly replace?: { readonly [module: string]: readonly object[] };
}

/** The options of `defineApp` (section 4.5). */
export interface AppOptions<Id extends string, Ms extends readonly AnyModule[], A, X> {
  readonly id: Id;
  readonly modules: Ms;
  readonly actions?: A;
  readonly execution?: X;
  readonly authorization?: AppAuthorization;
  readonly policies?: AppPolicies;
  readonly api?: ApiVersions;
  readonly flags?: { readonly [name: string]: object };
}

/**
 * An app value. The optional `~types` key is a type-only carrier of the derived rows, references
 * and action tree; the runtime value holds the selection (core first), the app's own actions and
 * the options `compose` reads.
 */
export interface App<Id extends string, Ms extends readonly AnyModule[], A, X> {
  readonly kind: 'app';
  readonly id: Id;
  readonly modules: Ms;
  readonly execution: X;
  readonly appActions: A;
  readonly authorization: AppAuthorization;
  readonly policies: AppPolicies;
  readonly api: ApiVersions | null;
  readonly flags: { readonly [name: string]: object };
  /** The composed registry, built when the app is defined (sections 3.3 and 4.7). */
  readonly registry: Registry;
  readonly '~types'?: {
    readonly entities: AppEntitiesOf<Ms>;
    readonly actions: ActionRefsOf<Ms, A>;
    readonly tree: AppActionTreeOf<Ms, A, X>;
  };
}

/**
 * Composes an app from the `as const` tuple of its modules, with the core module first; uncallable
 * when the tuple is inconsistent (section 4.5). The registry is built once and the value passes through the compose seam.
 */
export function defineApp<
  const Id extends string,
  const Ms extends readonly AnyModule[],
  const A extends { readonly [name: string]: AnyActionPart } = Empty,
  const X extends { readonly [ref: string]: Execution } = Empty,
>(config: AppOptions<Id, Ms, A, X> & AppChecks<Ms, A, X>): App<Id, WithCore<Ms>, A, X> {
  const base = {
    kind: 'app' as const,
    id: config.id,
    modules: [core, ...config.modules],
    execution: config.execution ?? {},
    appActions: config.actions ?? {},
    authorization: config.authorization ?? {},
    policies: config.policies ?? {},
    api: config.api ?? null,
    flags: config.flags ?? {},
  };
  const built = buildRegistry(base);
  const registry: Registry = {
    ...built,
    problems: [...built.problems, ...surfaceProblemsOf(base, built)],
  };
  composeApp(base, registry);
  return { ...base, registry } as unknown as App<Id, WithCore<Ms>, A, X>;
}
