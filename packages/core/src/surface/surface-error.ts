import type { ErrorKind } from '../errors/error-kind.ts';
import type { FieldNode } from './field-node.ts';

export interface SurfaceError {
  /** 'accounts.email_taken', 'core.version_mismatch'. */
  readonly code: string;
  readonly kind: ErrorKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly data?: FieldNode;
}
