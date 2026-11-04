import type { RowEnvironment } from '../authorization/row-environment.ts';
import { coreErrorCodes } from '../errors/core-error-codes.ts';
import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * Turns whatever a stage threw into the error the outcome carries. A `KeelwerkError` passes when
 * it is a core error or one the action declares; anything else, an undeclared module error
 * included, becomes `internal` with the original as its cause. Outside development the message is
 * the taxonomy's and says nothing of the original (section 16.4.6).
 */
export function mapUnknownError(
  error: unknown,
  environment: RowEnvironment,
  declared: readonly string[] = [],
): KeelwerkError {
  if (isKeelwerkError(error) && (error.code.startsWith('core.') || declared.includes(error.code))) {
    return error;
  }
  const original = error instanceof Error ? error.message : String(error);
  return new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: environment === 'development' ? original : coreErrorCodes['core.internal'].message,
    cause: error,
  });
}
