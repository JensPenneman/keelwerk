import type { KweEnvelope } from '../keys/kwe-envelope.ts';
import { sealKwe } from '../keys/seal-kwe.ts';
import type { ProcessSubjectBinding } from './process-subject-binding.ts';
import { processSubjectBinding } from './process-subject-binding.ts';
import type { SealingContext } from './sealing-context.ts';

const encoder = new TextEncoder();

/**
 * The data subject of a process instance as its job stores it (S-124): the instance key sealed
 * under the subject's own data key, bound to the instance's stream and to the event, so the job row
 * holds no subject in the clear and erasing the subject makes it unreadable. `null` when the
 * subject is already erased.
 */
export async function sealProcessSubject(
  context: SealingContext,
  binding: ProcessSubjectBinding & { readonly subject: string },
): Promise<KweEnvelope | null> {
  const key = await context.unit.keys.dataKey(binding.subject, { create: true });
  if (key === undefined) return null;
  return sealKwe(
    key,
    encoder.encode(binding.subject),
    processSubjectBinding(context, binding),
    context.random,
  );
}
