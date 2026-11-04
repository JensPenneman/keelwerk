import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { ErrorKind } from './error-kind.ts';

/** What `defineError` takes beside the code: the kind, the message and the schema of `details`. */
export interface ErrorSpec {
  readonly kind: ErrorKind;
  /** Typed `details`; a Standard Schema, validated when the error is thrown. */
  readonly data?: StandardSchemaV1;
  readonly message: string;
  /** Overrides the kind's default (retryable for `unavailable` and `rate_limited`). */
  readonly retryable?: boolean;
}
