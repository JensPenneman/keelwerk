import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { toWire } from '../errors/to-wire.ts';
import { declaredErrorCodesOf } from '../executors/declared-error-codes-of.ts';
import { deriveScopeSecrets } from '../keys/derive-scope-secrets.ts';
import { commandJobError } from '../worker/command-job-error.ts';
import { commandFingerprint } from './command-fingerprint.ts';
import { PersonalKeyDestroyed } from './personal-key-destroyed.ts';
import { receiptRow } from './receipt-row.ts';
import type { RunCommandInput } from './run-command-input.ts';
import { runInUnitKeys } from './run-in-unit-keys.ts';

/**
 * Records the `failed` receipt of a command whose unit rolled back with a non-retryable error
 * (15.1.7), in a short unit of its own, so a retry with the same command id answers the same error.
 * The stored error is `commandJobError`'s projection. The claim keeps an existing receipt (a replayed failure, another request's) and writes nothing then.
 * Nothing on this path creates a data key: a failed attempt rolled its own unit back, and a client
 * must not make the store keep a key for a subject it named before any rule ran. When a personal
 * member's subject has no data key (it never had one, or it was destroyed) no receipt is recorded,
 * quietly: the client still gets the failure of the attempt, and a retry runs the command again.
 */
export async function recordFailedReceipt(
  input: RunCommandInput,
  commandId: string,
  error: KeelwerkError,
): Promise<void> {
  const { action } = input;
  const now = input.clock.now();
  // The stored failure is the closed projection: a declared error's data (an address, say) never reaches the receipt row (D9).
  const stored = commandJobError(error, declaredErrorCodesOf(input.registry, action.module));
  const outcome = {
    ok: false,
    error: { ...toWire(stored, 'public'), requestId: input.request.requestId },
  } as const;
  // Before the unit opens: a derivation inside it would open a second unit once the key service's
  // cache expired. A failed derivation records no receipt (the caller ignores the failure).
  const { fingerprintKey } = await deriveScopeSecrets(input.keys, input.scope);
  await input.adapter.unit(input.namespace, input.scope, async (unit) => {
    let fingerprint: string;
    try {
      // Inside the unit: the data key of a personal member's subject lives there. It is only read.
      fingerprint = await commandFingerprint(
        { ...runInUnitKeys(input, unit), fingerprintKey },
        { unit, create: false },
      );
    } catch (error) {
      // A subject without a data key leaves no fingerprint to record, so nothing is recorded: a
      // retry runs the command again.
      if (
        error instanceof PersonalKeyDestroyed ||
        (error instanceof KeelwerkError && error.kind === 'forbidden')
      ) {
        return;
      }
      throw error;
    }
    const receipt = receiptRow({
      commandId,
      action: action.ref,
      fingerprint,
      principal: input.principal,
      apiVersion: input.apiVersion,
      request: input.request,
      ...(input.client === undefined ? {} : { client: input.client }),
      now,
      ...(action.idempotencyWindowMs === undefined ? {} : { windowMs: action.idempotencyWindowMs }),
    });
    if ((await unit.receipts.claim(receipt)) === 'inserted') {
      await unit.receipts.complete(commandId, outcome);
    }
  });
}
