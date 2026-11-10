import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { Scope } from '../storage/scope.ts';

/** What a provider knows about the evaluation (20.3). */
export interface FlagContext {
  readonly scope: Scope;
  readonly principal: {
    readonly kind: PrincipalKind;
    readonly id: string | null;
    readonly roles: readonly string[];
  };
  /** From `flagContextEnrichers`, which is deferred (S-135): empty in M2. */
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  /** By level: the backend, tenant or principal id. */
  readonly targetingKey: string | null;
}
