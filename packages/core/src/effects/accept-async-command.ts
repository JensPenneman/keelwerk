import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { CommandResult } from '../invoker/command-runner.ts';
import { assertSameRequest } from '../write-path/assert-same-request.ts';
import { commandFingerprint } from '../write-path/command-fingerprint.ts';
import { receiptRow } from '../write-path/receipt-row.ts';
import { replayReceipt } from '../write-path/replay-receipt.ts';
import { retryUnit } from '../write-path/retry-unit.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { commandJobRun } from './command-job-run.ts';
import { commandQueue } from './command-queue.ts';
import { jobInput } from './job-input.ts';

/**
 * Accepts an asynchronous command (section 7.4): the invoker has validated and authorized it, and
 * this writes its `accepted` receipt and its job in one unit, so either both exist or neither.
 * The answer is `{ commandId, status: 'accepted' }`; the receipt stays `accepted` until a worker
 * takes the job (S-24: none runs in this release). The job carries the principal reference, the
 * causation, the enqueuer's build and the API version of the input, and its command id is the
 * receipt's. A retry with the same id and input answers `accepted` again and enqueues nothing; a
 * receipt a worker finished replays its outcome; another input is `core.idempotency_mismatch`.
 */
export async function acceptAsyncCommand(input: RunCommandInput): Promise<CommandResult> {
  const { action } = input;
  input.signal?.throwIfAborted();
  const commandId = input.commandId ?? newUuidV7();
  const now = input.clock.now();
  const fingerprint = await commandFingerprint(input);
  const receipt = {
    ...receiptRow({
      commandId,
      action: action.ref,
      fingerprint,
      principal: input.principal,
      apiVersion: input.apiVersion,
      request: input.request,
      ...(input.client === undefined ? {} : { client: input.client }),
      now,
      ...(action.idempotencyWindowMs === undefined ? {} : { windowMs: action.idempotencyWindowMs }),
    }),
    status: 'accepted' as const,
  };
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
          if ((await unit.receipts.claim(receipt)) === 'exists') {
            const existing = await unit.receipts.get(commandId);
            if (existing === undefined) {
              throw errors.internal(`the receipt of command ${commandId} vanished`);
            }
            assertSameRequest(existing, receipt);
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
          await unit.jobs.enqueue({
            ...jobInput({
              scope: input.scope,
              principal: input.principal,
              causation: { commandId },
              build: input.build,
              apiVersion: input.apiVersion,
              now,
            }),
            kind: 'action',
            queue: commandQueue,
            run: commandJobRun(action.ref, input.input, commandId),
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
