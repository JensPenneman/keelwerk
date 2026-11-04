import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Receipt } from '../storage/receipt.ts';

/**
 * A command id is a key one principal chose for one request: an existing receipt with another
 * fingerprint or another principal is `core.idempotency_mismatch` (section 7.5), so another
 * principal never reads its outcome.
 */
export function assertSameRequest(existing: Receipt, receipt: Receipt): void {
  if (
    existing.principal?.resolver !== receipt.principal?.resolver ||
    existing.principal?.principalId !== receipt.principal?.principalId ||
    existing.fingerprint !== receipt.fingerprint
  ) {
    throw new KeelwerkError({
      kind: 'conflict',
      code: 'core.idempotency_mismatch',
      message: 'The command id was used with a different request.',
    });
  }
}
