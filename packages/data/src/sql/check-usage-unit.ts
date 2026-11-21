import type { StorageScope } from '@keelwerk/core';
import { errors } from '@keelwerk/core';

/** The refusal both adapters make before a unit buffers a usage change; the buffer itself is the adapter's. */
export function checkUsageUnit(scope: StorageScope): void {
  if (scope.level === 'namespace') throw errors.internal('a namespace unit charges no usage');
}
