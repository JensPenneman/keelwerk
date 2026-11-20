import { coreError } from '../http/core-error.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';
import type { StorageRow } from '../storage/storage-row.ts';

/**
 * The first check of `answerInlineRow`. An existing `core.effect` row answers a `perform` only to
 * the run that wrote it: a command id is a key one principal chose (`insertPendingReceipt`), so
 * another principal, another effect type or an id reused after the receipt window never reads the
 * outcome of the first. Anything else is `core.idempotency_mismatch`, before any executor runs. A
 * caller learns that the window ended only when the row is its own (a row with a submitter equal to
 * its own principal); every other refusal says the same, so a prober cannot tell a row's age or
 * owner. A row with no submitter (an anonymous caller or a module's service principal)
 * goes on to the later checks of `answerInlineRow`, whose numbered list gives their order.
 */
export function assertInlineRowOwned(
  row: StorageRow,
  expected: {
    readonly type: string;
    readonly commandId: string;
    readonly submitter: PrincipalRef | undefined;
    readonly now: Temporal.Instant;
    readonly windowMs: number;
  },
): void {
  const { createdAt } = row;
  const sameRun =
    row.type === expected.type &&
    row.commandId === expected.commandId &&
    (row.principalResolver ?? undefined) === expected.submitter?.resolver &&
    (row.principalId ?? undefined) === expected.submitter?.principalId;
  const inWindow =
    createdAt instanceof Temporal.Instant &&
    Temporal.Instant.compare(createdAt.add({ milliseconds: expected.windowMs }), expected.now) > 0;
  if (!sameRun || !inWindow) {
    throw coreError('core.idempotency_mismatch', {
      message:
        sameRun && expected.submitter !== undefined
          ? 'The command id was used before, and the window of its receipt has ended.'
          : 'The command id was used with a different request.',
    });
  }
}
