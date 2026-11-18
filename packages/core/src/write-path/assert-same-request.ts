import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Receipt } from '../storage/receipt.ts';
import { isLegacyDigest } from './is-legacy-digest.ts';

/**
 * A command id is a key one principal chose for one request: an existing receipt with another
 * fingerprint or another principal is `core.idempotency_mismatch` (section 7.5), so another
 * principal never reads its outcome. A stored fingerprint equals the new one, or it is in the 0.1.0
 * form (64 bare hex characters) and equals `legacyFingerprint()`, the 0.1.0 form of the same
 * request, which is computed only then; the decision base is never compared with a receipt.
 */
export function assertSameRequest(
  existing: Receipt,
  receipt: Receipt,
  legacyFingerprint: () => string,
): void {
  if (
    existing.principal?.resolver !== receipt.principal?.resolver ||
    existing.principal?.principalId !== receipt.principal?.principalId ||
    !(
      existing.fingerprint === receipt.fingerprint ||
      (isLegacyDigest(existing.fingerprint) && existing.fingerprint === legacyFingerprint())
    )
  ) {
    throw new KeelwerkError({
      kind: 'conflict',
      code: 'core.idempotency_mismatch',
      message: 'The command id was used with a different request.',
    });
  }
}
