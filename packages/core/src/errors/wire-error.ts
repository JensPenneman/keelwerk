import type { ErrorKind } from './error-kind.ts';
import type { RuleMatch } from './rule-match.ts';

/** The one serialised form of an error, used by every transport, the sync protocol and receipts (section 16.4.6). */
export interface WireError {
  readonly kind: ErrorKind;
  /** Stable, module-prefixed: 'accounts.email_taken'. */
  readonly code: string;
  /** For `internal`, the taxonomy title outside development. */
  readonly message: string;
  readonly retryable: boolean;
  /** Seconds; `rate_limited` and `unavailable`. */
  readonly retryAfter?: number;
  readonly issues?: readonly {
    readonly path: readonly (string | number)[];
    readonly message: string;
  }[];
  /** Typed by the declared error's data schema. */
  readonly details?: unknown;
  /** `forbidden`: the deciding deny rule's reason. */
  readonly reason?: string;
  /** Audience-dependent. */
  readonly rules?: readonly RuleMatch[];
  readonly requestId: string;
}
