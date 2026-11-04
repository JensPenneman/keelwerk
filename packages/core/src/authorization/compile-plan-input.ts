import type { PrincipalContext } from '../contexts/principal-context.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { AuthorizedAction } from './authorized-action.ts';
import type { NormalizedRule } from './normalized-rule.ts';

/** What `compilePlan` reads. */
export interface CompilePlanInput {
  readonly rules: readonly NormalizedRule[];
  readonly action: AuthorizedAction;
  readonly entity: EntityDescriptor;
  readonly context: PrincipalContext;
  /** The transport the request came in on; `null` when unknown. */
  readonly transport?: string | null;
  /** The action input, for the `when` of cross-module rules. */
  readonly input?: unknown;
}
