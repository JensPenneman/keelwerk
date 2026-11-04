import type { ApiVersions } from '../dsl/define-api-versions.ts';
import type { AppAuthorization, AppPolicies } from '../dsl/define-app.ts';
import type { AnyActionPart, Execution } from '../model/action-part.ts';
import type { AnyModule } from '../model/any-module.ts';

/** What `compose` reads of an app value: the selection (core first) and the options of `defineApp`. */
export interface ComposableApp {
  readonly kind: 'app';
  readonly id: string;
  readonly modules: readonly AnyModule[];
  readonly execution: { readonly [ref: string]: Execution };
  readonly appActions: { readonly [name: string]: AnyActionPart };
  readonly authorization: AppAuthorization;
  readonly policies: AppPolicies;
  readonly api: ApiVersions | null;
}
