import { scopeKeyOf } from '../effects/scope-key-of.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import { deriveUuidV8 } from '../ids/derive-uuid-v8.ts';
import type { Scope } from '../storage/scope.ts';

/**
 * The state stream of one process instance (S-124, final): the stream type is the process id and
 * the id is the version 8 UUID derived from the scope, the process id and the instance key, so
 * every instance of every tenant has a stream of its own and the same instance always finds it.
 */
export function processStreamRef(scope: Scope, processId: string, instanceKey: string): StreamRef {
  return { type: processId, id: deriveUuidV8(scopeKeyOf(scope), processId, instanceKey) };
}
