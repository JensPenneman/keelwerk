import { KeelwerkError } from '@keelwerk/core';

export function malformedCondition(
  message: string,
  details: Record<string, unknown>,
): KeelwerkError {
  return new KeelwerkError({
    kind: 'validation',
    code: 'core.malformed_request',
    message,
    details,
  });
}
