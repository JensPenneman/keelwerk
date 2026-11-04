import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { toWire } from '../errors/to-wire.ts';
import { inputFingerprint } from './input-fingerprint.ts';
import { receiptRow } from './receipt-row.ts';
import type { RunCommandInput } from './run-command-input.ts';

/**
 * Records the `failed` receipt of a command whose unit rolled back with a non-retryable error
 * (15.1.7), in a short unit of its own, so a retry with the same command id answers the same error.
 * The claim keeps an existing receipt (a replayed failure, another request's) and writes nothing then.
 */
export async function recordFailedReceipt(
  input: RunCommandInput,
  commandId: string,
  error: KeelwerkError,
): Promise<void> {
  const { action } = input;
  const now = input.clock.now();
  const receipt = receiptRow({
    commandId,
    action: action.ref,
    fingerprint: inputFingerprint(action.ref, input.apiVersion, input.input),
    principal: input.principal,
    apiVersion: input.apiVersion,
    request: input.request,
    ...(input.client === undefined ? {} : { client: input.client }),
    now,
    ...(action.idempotencyWindowMs === undefined ? {} : { windowMs: action.idempotencyWindowMs }),
  });
  const outcome = {
    ok: false,
    error: { ...toWire(error, 'public'), requestId: input.request.requestId },
  } as const;
  await input.adapter.unit(input.namespace, input.scope, async (unit) => {
    if ((await unit.receipts.claim(receipt)) === 'inserted') {
      await unit.receipts.complete(commandId, outcome);
    }
  });
}
