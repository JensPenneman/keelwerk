import type { KweBinding } from '../keys/kwe-aad.ts';
import type { SealingContext } from './sealing-context.ts';

/** Where a process job's sealed subject is bound: the instance's stream and the event the job answers. */
export interface ProcessSubjectBinding {
  readonly streamId: string;
  readonly eventId: string;
}

/** The binding the sealed subject of a process job is sealed and opened with. */
export function processSubjectBinding(
  context: SealingContext,
  binding: ProcessSubjectBinding,
): KweBinding {
  return {
    namespace: context.unit.namespace.id,
    streamId: binding.streamId,
    eventId: binding.eventId,
    field: '$subject',
  };
}
