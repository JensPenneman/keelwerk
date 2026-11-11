import type { KweEnvelope } from '../keys/kwe-envelope.ts';
import { openKwe } from '../keys/open-kwe.ts';
import type { ProcessSubjectBinding } from './process-subject-binding.ts';
import { processSubjectBinding } from './process-subject-binding.ts';
import type { SealingContext } from './sealing-context.ts';

const decoder = new TextDecoder();

/** The subject a job sealed with `sealProcessSubject`; `undefined` once the subject's keys are destroyed. */
export async function openProcessSubject(
  context: SealingContext,
  binding: ProcessSubjectBinding & { readonly sealed: KweEnvelope },
): Promise<string | undefined> {
  const key = await context.keyById(binding.sealed.k);
  const plain = openKwe(binding.sealed, key?.material, processSubjectBinding(context, binding));
  return plain === undefined ? undefined : decoder.decode(plain);
}
