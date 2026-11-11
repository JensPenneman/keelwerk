import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { RuleMatch } from '../errors/rule-match.ts';

/** The stages of section 9.2 an invocation can stop at; `open` covers resolveScope, resolvePrincipal and resolveVersion. */
export type InvokerStage =
  | 'open'
  | 'locate'
  | 'admit'
  | 'validate'
  | 'translate'
  | 'authorize'
  | 'prepare'
  | 'execute'
  | 'shape'
  | 'complete';

/** What the invoker reports of one invocation or subscription to `InvokerOptions.onDecision` (section 11). */
export interface InvocationDecision {
  readonly kind: 'invoke' | 'subscribe';
  readonly requestId: string;
  readonly action: string;
  /** `inv.carrier.transport`, as the stream line prints it. */
  readonly transport: string;
  /** `complete` when it succeeded; otherwise the stage that failed. */
  readonly stage: InvokerStage;
  /** Allowed: the allow rules in effect, in `authorize`'s order. Forbidden: the error's `rules`. Otherwise empty. */
  readonly rules: readonly RuleMatch[];
  /** Absent on success. */
  readonly error?: KeelwerkError;
}

/** Development instrumentation: called synchronously, once per invocation, after `complete`. */
export type DecisionHook = (decision: InvocationDecision) => void;
