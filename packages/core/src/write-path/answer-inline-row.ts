import type { StoredEvent } from '../events/stored-event.ts';
import { coreError } from '../http/core-error.ts';
import { isKernelCommandId } from '../ids/is-kernel-command-id.ts';
import type { ActorRef } from '../principals/actor-ref.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { assertInlineRowOwned } from './assert-inline-row-owned.ts';
import { assertSameInlineInput } from './assert-same-inline-input.ts';
import { defaultReceiptWindowMs } from './default-receipt-window-ms.ts';
import type { InlineAnswer } from './inline-answer.ts';
import { inlineAnswerOf } from './inline-answer-of.ts';
import { inlineGuardGraceMs } from './inline-guard-grace-ms.ts';
import { isFinishedReceipt } from './is-finished-receipt.ts';
import type { PerformInlineInput } from './perform-inline.ts';
import { readInlineReceipt } from './read-inline-receipt.ts';
import { receiptWindowMs } from './receipt-window-ms.ts';
import { refusesAnonymousReplay } from './refuses-anonymous-replay.ts';

const different = () =>
  coreError('core.idempotency_mismatch', {
    message: 'The command id was used with a different request.',
  });

/** What answering an existing inline effect row is given. */
export interface AnswerInlineRowInput {
  readonly unit: Unit;
  readonly perform: PerformInlineInput;
  readonly entry: EffectEntry;
  readonly row: StorageRow;
  /** The effect's input after `validateEffectInput`. */
  readonly validated: unknown;
  /** The caller's principal reference; undefined for an anonymous caller and a module's service principal. */
  readonly submitter: PrincipalRef | undefined;
  /** The actor the run writes (`buildEventMeta`). */
  readonly actor: ActorRef;
  readonly now: Temporal.Instant;
}

/**
 * What an existing row of an inline effect answers, as the run that asks (section 7.9.4, phase 2).
 * Every check comes before any answer, and the first that fails refuses:
 * 1. `assertInlineRowOwned`: the same effect type, command id and principal reference, inside the
 *    receipt window of the current action.
 * 2. A caller with no submitter (anonymous or a module's service principal) must carry the actor
 *    (kind, id, resolver) of the effect's `requested` record, the first record of its stream.
 * 3. An unexpired receipt of the command id must be of the same request (`readInlineReceipt`).
 * 4. A finished unexpired receipt that `refusesAnonymousReplay` (the test of section 7.5, shared with
 *    `replayReceipt`, not written a second time here) refuses with `core.idempotency_mismatch`: the
 *    caller has no principal reference and the action declares a credential member, so the row's
 *    output reaches no one, and nothing is handed to `prepare`, before the effect's input is
 *    compared. A pending receipt and no receipt are not refused by this step.
 * 5. With no unexpired receipt, a caller with no submitter and no actor id (anonymous) is refused
 *    whatever it sends, so no input is confirmed: `core.command_in_progress` while the run that made
 *    the row can be alive (the `timeoutMs` of its action, which declares `prepare`, plus
 *    `inlineGuardGraceMs`), `core.idempotency_mismatch` after it. The bound assumes that the host
 *    enforces `timeoutMs` through the run's signal for every run with a `prepare`, as the invoker's
 *    execute stage does (see `runCommand`). An action with no `timeoutMs`, or one the registry does
 *    not know, has no bound: the refusal stays `core.command_in_progress` until the receipt window
 *    ends (step 1). The kernel's own command ids are never refused here: no caller can present one,
 *    and a job that was cut retries under the same id.
 * 6. The effect's stored input must equal the given one (`assertSameInlineInput`).
 * 7. A `requested` row is `core.command_in_progress`; any other row is its outcome.
 */
export async function answerInlineRow(input: AnswerInlineRowInput): Promise<InlineAnswer> {
  const { unit, perform, entry, row, submitter, actor, now } = input;
  const { run, commandId, effectId } = perform;
  assertInlineRowOwned(row, {
    type: entry.ref,
    commandId,
    submitter,
    now,
    windowMs: receiptWindowMs(run.action, run.job) ?? defaultReceiptWindowMs,
  });
  let first: StoredEvent | undefined;
  if (submitter === undefined) {
    [first] = await unit.events.readStream(
      { type: 'core.effect', id: effectId },
      { fromVersion: 1, toVersion: 1, limit: 1 },
    );
    if (
      first === undefined ||
      first.version !== 1 ||
      first.commandId !== commandId ||
      first.actor.kind !== actor.kind ||
      first.actor.id !== actor.id ||
      first.actor.via !== actor.via
    ) {
      throw different();
    }
  }
  const receipt = await readInlineReceipt(unit, perform, now);
  if (
    receipt !== undefined &&
    isFinishedReceipt(receipt) &&
    refusesAnonymousReplay(run.action, run.registry, receipt, run.job)
  ) {
    throw different();
  }
  if (
    receipt === undefined &&
    submitter === undefined &&
    actor.id === null &&
    !isKernelCommandId(commandId)
  ) {
    const made = run.registry.actions.get(first?.action ?? '');
    const { createdAt } = row;
    if (
      made?.prepare !== undefined &&
      made.timeoutMs !== undefined &&
      createdAt instanceof Temporal.Instant &&
      Temporal.Instant.compare(
        now,
        createdAt.add({ milliseconds: made.timeoutMs + inlineGuardGraceMs }),
      ) >= 0
    ) {
      throw different();
    }
    throw coreError('core.command_in_progress');
  }
  await assertSameInlineInput(unit, entry, effectId, row.input, input.validated);
  if (row.status === 'requested') throw coreError('core.command_in_progress');
  return inlineAnswerOf(row);
}
