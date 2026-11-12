import { sha256 } from '../crypto/sha256.ts';
import { kernelCommandId } from '../ids/kernel-command-id.ts';
import { erasureKey } from './erasure-key.ts';

/**
 * The command id of the flag scrub of one erasure (step 5b of section 14.7.5), final:
 * `kernelCommandId('erasure', <sha256 of the erasure's identity>, 'flags')`. The identity is
 * `erasureKey` (tenant, command id and canonical subject), so no other erasure replays this one's
 * receipt in the control scope, and the id has a fixed length whatever the command id is.
 */
export function flagScrubCommandId(erasure: {
  readonly tenantId: string;
  readonly commandId: string;
  readonly subjectId: string;
}): string {
  return kernelCommandId('erasure', sha256(erasureKey(erasure)), 'flags');
}
