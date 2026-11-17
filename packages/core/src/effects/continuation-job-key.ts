import { enqueueKey } from './enqueue-key.ts';

/**
 * The stored key of the continuation job of a settled effect (7.9.5): `core.continuation:<effect
 * id>`. Its first half holds a dot, which no module id does (5.1), so no keyed `enqueue` of a
 * module (stored as `enqueueKey(<module id>, key)`) can equal it, a module named `continuation`
 * included. The one builder: `enqueueContinuation` writes it.
 */
export function continuationJobKey(effectId: string): string {
  return enqueueKey('core.continuation', effectId);
}
