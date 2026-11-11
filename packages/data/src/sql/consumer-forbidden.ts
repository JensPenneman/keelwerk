import type { StorageScope } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';

/** The refusal of a consumer store member the unit's scope does not reach (`core.forbidden`). */
export function consumerForbidden(message: string, scope: StorageScope): KeelwerkError {
  return new KeelwerkError({
    kind: 'forbidden',
    code: 'core.forbidden',
    message,
    details: { scope: scope.level },
  });
}
