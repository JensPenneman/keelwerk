import type { ConditionInput } from '../conditions/condition-input.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';

/** One policy rule as the registry holds it (section 8.1); the callbacks take the principal context of the DSL. */
export interface RuleEntry {
  /** 'auth.credential.self': module id, target and file name. */
  readonly id: string;
  /** The module that owns the rule file. */
  readonly module: string;
  readonly effect: 'allow' | 'deny';
  readonly subject:
    | { readonly module: string; readonly entity?: string }
    | {
        readonly kinds?: readonly ('query' | 'command' | 'subscription')[];
        readonly transports?: readonly string[];
      };
  /** Action names, set operations, the aliases 'read' and 'write', or '*'. */
  readonly actions: readonly string[];
  readonly principal?: PrincipalKind | readonly PrincipalKind[];
  /** The row acted on (the pre-image), the rows read. */
  where?(context: unknown): ConditionInput | boolean;
  /** The row produced (the post-image of creates and updates). */
  check?(context: unknown): ConditionInput | boolean;
  /** Module-level, app and cross-module rules. */
  when?(context: unknown, input: unknown): boolean;
  /** Reads: the maskable fields this rule reveals; writes: the fields that may change. */
  readonly fields?: readonly string[];
  /** Required for deny rules. */
  readonly reason?: string;
  /** The module that mounted the rule through a contribution. */
  readonly contributedBy?: string;
  /** App-level `policies.disable` removed it. */
  readonly disabled: boolean;
}
