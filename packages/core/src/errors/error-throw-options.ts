import type { ErrorIssue } from './error-issue.ts';
import type { RuleMatch } from './rule-match.ts';

/** What a thrown error can carry beside its details: every member is optional. */
export interface ErrorThrowOptions {
  /** Replaces the declared message for this throw. */
  readonly message?: string;
  readonly issues?: readonly ErrorIssue[];
  readonly retryable?: boolean;
  /** Seconds. */
  readonly retryAfter?: number;
  readonly rules?: readonly RuleMatch[];
  /** `forbidden`: the deciding deny rule's reason. */
  readonly reason?: string;
  readonly cause?: unknown;
}
