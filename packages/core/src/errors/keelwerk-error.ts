import type { ErrorIssue } from './error-issue.ts';
import type { ErrorKind } from './error-kind.ts';
import type { RuleMatch } from './rule-match.ts';

/** What the constructor takes; `retryable` defaults to true for `unavailable` and `rate_limited`. */
interface KeelwerkErrorInit {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly message: string;
  readonly issues?: readonly ErrorIssue[];
  readonly details?: unknown;
  readonly retryable?: boolean;
  /** Seconds. */
  readonly retryAfter?: number;
  readonly rules?: readonly RuleMatch[];
  readonly cause?: unknown;
}

/** The one error class of the taxonomy (section 10); transports serialise it with `toWire`. */
export class KeelwerkError extends Error {
  override readonly name: string = 'KeelwerkError';
  readonly kind: ErrorKind;
  /** Stable, module-prefixed: 'accounts.email_taken'. */
  readonly code: string;
  declare readonly issues?: readonly ErrorIssue[];
  /** Typed by the ErrorSpec's data schema. */
  declare readonly details?: unknown;
  readonly retryable: boolean;
  /** Seconds. */
  declare readonly retryAfter?: number;
  declare readonly rules?: readonly RuleMatch[];

  constructor(init: KeelwerkErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.code = init.code;
    this.retryable =
      init.retryable ?? (init.kind === 'unavailable' || init.kind === 'rate_limited');
    if (init.issues !== undefined) this.issues = init.issues;
    if (init.details !== undefined) this.details = init.details;
    if (init.retryAfter !== undefined) this.retryAfter = init.retryAfter;
    if (init.rules !== undefined) this.rules = init.rules;
  }
}
