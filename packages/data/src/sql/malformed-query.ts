import { KeelwerkError } from '@keelwerk/core';

export function malformedQuery(message: string): KeelwerkError {
  return new KeelwerkError({ kind: 'validation', code: 'core.malformed_request', message });
}
