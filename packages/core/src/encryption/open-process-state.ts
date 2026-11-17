import type { KweEnvelope } from '../keys/kwe-envelope.ts';
import { openKwe } from '../keys/open-kwe.ts';
import { processStateBinding } from './process-state-binding.ts';
import type { ProcessSubjectBinding } from './process-subject-binding.ts';
import type { SealingContext } from './sealing-context.ts';

const decoder = new TextDecoder();

/** The JSON text `sealProcessState` sealed; `undefined` once the subject's keys are destroyed, or for another stream or event. */
export async function openProcessState(
  context: SealingContext,
  binding: ProcessSubjectBinding & { readonly sealed: KweEnvelope },
): Promise<string | undefined> {
  const key = await context.keyById(binding.sealed.k);
  const plain = openKwe(binding.sealed, key?.material, processStateBinding(context, binding));
  return plain === undefined ? undefined : decoder.decode(plain);
}
