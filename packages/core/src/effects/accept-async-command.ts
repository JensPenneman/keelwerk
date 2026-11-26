import { hybridClock } from '../clock/hybrid-clock.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import { checkCallerCommandId } from '../ids/check-caller-command-id.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { CommandResult } from '../invoker/command-runner.ts';
import { deriveScopeSecrets } from '../keys/derive-scope-secrets.ts';
import { checkErasureGrant } from '../subjects/check-erasure-grant.ts';
import { erasureAction } from '../subjects/erasure-action.ts';
import { erasureRetry } from '../subjects/erasure-retry.ts';
import { appendReceiptChange } from '../write-path/append-receipt-change.ts';
import { assertSameRequest } from '../write-path/assert-same-request.ts';
import { commandDigests } from '../write-path/command-digests.ts';
import { defaultNodeId } from '../write-path/default-node-id.ts';
import { receiptRow } from '../write-path/receipt-row.ts';
import { replayReceipt } from '../write-path/replay-receipt.ts';
import { retryUnit } from '../write-path/retry-unit.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { commandJobRun } from './command-job-run.ts';
import { commandQueue } from './command-queue.ts';
import { jobInput } from './job-input.ts';
import { sealJobInput } from './seal-job-input.ts';

/**
 * Accepts an asynchronous command (section 7.4): the invoker has validated and authorized it, and
 * this writes its `accepted` receipt and its job in one unit, so either both exist or neither. The
 * answer is `{ commandId, status: 'accepted' }`; the receipt stays `accepted` until a worker takes
 * the job. The unit also appends the receipt's transient `created` record (S-145), so a watcher
 * sees the command arrive. The job carries the principal reference, the causation, the enqueuer's
 * build and the API version of the input, and its command id is the receipt's. The input is stored
 * with its secret members sealed (`sealJobInput`), while the receipt's fingerprint is
 * `commandDigests` of the plaintext input, secrets and verifiers withheld. A retry with the same id
 * and input answers `accepted` again and enqueues nothing; a receipt a worker finished replays its
 * outcome; another input is `core.idempotency_mismatch`. A fresh `core.eraseSubject` is also
 * checked for ownership (`checkErasureGrant`) before its job is written, and its job is retried
 * without an end (`erasureRetry`); a replayed receipt skips that.
 */
export async function acceptAsyncCommand(input: RunCommandInput): Promise<CommandResult> {
  const { action } = input;
  input.signal?.throwIfAborted();
  checkCallerCommandId(input.commandId);
  const commandId = input.commandId ?? newUuidV7();
  const now = input.clock.now();
  // Before the unit opens: a derivation inside it would open a second unit once the cache expired.
  const { fingerprintKey } = await deriveScopeSecrets(input.keys, input.scope);
  // Pure: the same text serves every retry of the unit, and no key is read or created.
  const digests = commandDigests({ ...input, fingerprintKey });
  const accepted: CommandResult = {
    output: {},
    receipt: { commandId, status: 'accepted' },
  };
  return retryUnit(
    () =>
      input.adapter.unit(
        input.namespace,
        input.scope,
        async (unit) => {
          const receipt = {
            ...receiptRow({
              commandId,
              action: action.ref,
              fingerprint: digests.fingerprint,
              principal: input.principal,
              apiVersion: input.apiVersion,
              request: input.request,
              ...(input.client === undefined ? {} : { client: input.client }),
              now,
              ...(action.idempotencyWindowMs === undefined
                ? {}
                : { windowMs: action.idempotencyWindowMs }),
            }),
            status: 'accepted' as const,
          };
          if ((await unit.receipts.claim(receipt)) === 'exists') {
            const existing = await unit.receipts.get(commandId);
            if (existing === undefined) {
              throw errors.internal(`the receipt of command ${commandId} vanished`);
            }
            assertSameRequest(existing, receipt, digests.legacyFingerprint);
            if (existing.status === 'accepted') return { ...accepted, replayed: true as const };
            if (existing.status === 'pending') {
              throw new KeelwerkError({
                kind: 'conflict',
                code: 'core.command_in_progress',
                message: 'A command with this id is still running.',
                retryable: true,
              });
            }
            return replayReceipt(
              unit,
              input.registry,
              action,
              action.contributedBy ?? action.module,
              existing,
            );
          }
          if (action.ref === erasureAction) await checkErasureGrant(unit, input);
          await unit.jobs.enqueue({
            ...jobInput({
              scope: input.scope,
              principal: input.principal,
              caller: action.module,
              action,
              causation: { commandId },
              build: input.build,
              apiVersion: input.apiVersion,
              now,
              queue: commandQueue,
              limits: input.quotas,
            }),
            kind: 'action',
            // An accepted erasure is held, never dropped: its job is tried until it starts.
            ...(action.ref === erasureAction ? { retry: erasureRetry } : {}),
            run: commandJobRun(
              action.ref,
              await sealJobInput(unit, input.registry, commandId, action, input.input),
              commandId,
            ),
          });
          await appendReceiptChange(unit, {
            registry: input.registry,
            scope: input.scope,
            receipt,
            meta: buildEventMeta({
              principal: input.principal,
              commandId,
              action: action.ref,
              correlationId: input.correlationId ?? input.request.requestId,
              build: input.build,
              flags: [],
              decision: null,
            }),
            hybridClock: input.hybridClock ?? hybridClock(input.nodeId ?? defaultNodeId),
            now,
          });
          return accepted;
        },
        input.signal === undefined ? {} : { signal: input.signal },
      ),
    {
      ...input.retry,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  );
}
