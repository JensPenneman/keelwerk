import type { KweBinding } from '../keys/kwe-aad.ts';
import type { ProcessSubjectBinding } from './process-subject-binding.ts';
import type { SealingContext } from './sealing-context.ts';

/**
 * The binding a sealed process state is sealed and opened with (S-124): the namespace, the
 * instance's stream id, the id of the event at the cached version and the field name `$state`. A
 * cache copied to another instance, or kept past a newer event, therefore does not open.
 */
export function processStateBinding(
  context: SealingContext,
  binding: ProcessSubjectBinding,
): KweBinding {
  return {
    namespace: context.unit.namespace.id,
    streamId: binding.streamId,
    eventId: binding.eventId,
    field: '$state',
  };
}
