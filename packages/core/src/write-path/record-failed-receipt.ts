import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { toWire } from '../errors/to-wire.ts';
import { declaredErrorCodesOf } from '../executors/declared-error-codes-of.ts';
import { deriveScopeSecrets } from '../keys/derive-scope-secrets.ts';
import { commandJobError } from '../worker/command-job-error.ts';
import { commandDigests } from './command-digests.ts';
import { receiptRow } from './receipt-row.ts';
import type { RunCommandInput } from './run-command-input.ts';

/**
 * Records the `failed` receipt of a command whose unit rolled back with a non-retryable error
 * (15.1.7), in a short unit of its own, so a retry with the same command id answers the same error.
 * The stored error is `commandJobError`'s projection. The claim keeps an existing receipt (a replayed failure, another request's) and writes nothing then.
 * Nothing on this path reads or creates a data key: the fingerprint is the pure `commandDigests`
 * one, computed before the unit opens, so a failed command is always pinned to its id, also one
 * whose personal member's subject was erased.
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
  const { fingerprint } = commandDigests({ ...input, fingerprintKey });
  await input.adapter.unit(input.namespace, input.scope, async (unit) => {
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
