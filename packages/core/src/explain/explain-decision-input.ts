import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { PrincipalContext } from '../contexts/principal-context.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';

/** What `explainDecision` evaluates. */
export interface ExplainDecisionInput {
  readonly registry: Pick<Registry, 'actions' | 'entities'>;
  readonly rules: readonly NormalizedRule[];
  readonly action: ActionEntry;
  readonly context: PrincipalContext;
  /** The transport the request would come in on; default: none. */
  readonly transport?: string | null;
  /** The validated action input, for `when`. */
  readonly input?: unknown;
}
