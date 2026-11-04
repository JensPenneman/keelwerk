import type { ErrorIssue, ErrorKind, RuleMatch } from '@keelwerk/core';

/** What the constructor takes. */
export interface ClientErrorInit {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly message: string;
  readonly issues?: readonly ErrorIssue[];
  readonly details?: unknown;
  readonly retryable?: boolean;
  readonly retryAfter?: number;
  readonly rules?: readonly RuleMatch[];
  readonly reason?: string;
  readonly requestId?: string;
  readonly cause?: unknown;
}

/**
 * The error the client rejects with. It has the members of the core's `KeelwerkError` and its
 * name, so `isKeelwerkError` accepts it, but it is its own class: the browser-safe client takes
 * no value import from the core's main entry (section 22).
 */
export class ClientError extends Error {
  override readonly name: string = 'KeelwerkError';
  readonly kind: ErrorKind;
  readonly code: string;
  readonly retryable: boolean;
  declare readonly issues?: readonly ErrorIssue[];
  declare readonly details?: unknown;
  declare readonly retryAfter?: number;
  declare readonly rules?: readonly RuleMatch[];
  declare readonly reason?: string;
  /** The request id the host answered with, for support. */
  declare readonly requestId?: string;

  constructor(init: ClientErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.code = init.code;
    this.retryable =
      init.retryable ?? (init.kind === 'unavailable' || init.kind === 'rate_limited');
    if (init.issues !== undefined) this.issues = init.issues;
    if (init.details !== undefined) this.details = init.details;
    if (init.retryAfter !== undefined) this.retryAfter = init.retryAfter;
    if (init.rules !== undefined) this.rules = init.rules;
    if (init.reason !== undefined) this.reason = init.reason;
    if (init.requestId !== undefined) this.requestId = init.requestId;
  }
}
