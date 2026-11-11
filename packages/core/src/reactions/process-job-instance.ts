import { personalSealerOf } from '../encryption/personal-sealer-of.ts';
import { errors } from '../errors/errors.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { processStreamRef } from './process-stream-ref.ts';
import type { ReactionJobInput } from './reaction-job-input.ts';

/**
 * What a process job carries of its instance (S-124): the id of the instance's state stream, which
 * the job folds without computing the key again, and for a process that declares its data subject
 * the instance key sealed under the subject's own key (`null` when that subject is erased), so the
 * job row holds no key in the clear. `internal` when the unit cannot seal.
 */
export async function processJobInstance(
  unit: Unit,
  reaction: Pick<ReactionEntry, 'id' | 'dataSubject'>,
  event: Pick<StoredEvent, 'scope' | 'eventId'>,
  instanceKey: string,
): Promise<Pick<ReactionJobInput, 'processStream' | 'subject'>> {
  const processStream = processStreamRef(event.scope, reaction.id, instanceKey).id;
  if (reaction.dataSubject !== 'instanceKey') return { processStream };
  const sealer = personalSealerOf(unit);
  if (sealer === undefined) {
    throw errors.internal(`the dispatcher's unit cannot seal the subject of "${reaction.id}"`);
  }
  const subject = await sealer.sealProcessSubject({
    streamId: processStream,
    eventId: event.eventId,
    subject: instanceKey,
  });
  return { processStream, subject };
}
