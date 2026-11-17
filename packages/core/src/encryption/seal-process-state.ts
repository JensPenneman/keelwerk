import type { KweEnvelope } from '../keys/kwe-envelope.ts';
import { sealKwe } from '../keys/seal-kwe.ts';
import { processStateBinding } from './process-state-binding.ts';
import type { ProcessSubjectBinding } from './process-subject-binding.ts';
import type { SealingContext } from './sealing-context.ts';

const encoder = new TextEncoder();

/**
 * The folded state of a process instance that has a data subject, as its cache stores it (S-124):
 * the state's JSON text (UTF-8) sealed under the subject's own data key, bound to the instance's
 * stream and to the event at the cached version, so the cache record holds no personal value in
 * the clear and erasing the subject makes it unreadable. The key is never created here: `null`
 * when the subject has no key, that is when it is erased.
 */
export async function sealProcessState(
  context: SealingContext,
  binding: ProcessSubjectBinding & { readonly subject: string; readonly state: string },
): Promise<KweEnvelope | null> {
  const key = await context.unit.keys.dataKey(binding.subject, { create: false });
  if (key === undefined) return null;
  return sealKwe(
    key,
    encoder.encode(binding.state),
    processStateBinding(context, binding),
    context.random,
  );
}
