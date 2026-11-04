import type { PrincipalContext } from '../contexts/principal-context.ts';
import type { AuthorizedAction } from './authorized-action.ts';
import type { NormalizedRule } from './normalized-rule.ts';

/** What the gate reads. */
export interface GateInput {
  readonly rules: readonly NormalizedRule[];
  readonly action: AuthorizedAction;
  readonly context: PrincipalContext;
  readonly transport?: string | null;
  /** The action input, for `when`. */
  readonly input?: unknown;
}
