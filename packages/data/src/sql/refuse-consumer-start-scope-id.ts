import { errors } from '@keelwerk/core';
import { consumerStartScopeId } from './consumer-start-scope-id.ts';

/**
 * Refuses the scope id of a consumer's start record where a scope is named (15.2.3): the id marks
 * a consumer as started and is never the checkpoint, the parked stream or the unit of a scope.
 */
export function refuseConsumerStartScopeId(scopeId: string): void {
  if (scopeId === consumerStartScopeId) {
    throw errors.validation('this scope id is reserved for the start record of a consumer');
  }
}
