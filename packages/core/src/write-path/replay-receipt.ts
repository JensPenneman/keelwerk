import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { CommandResult } from '../invoker/command-runner.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { decodeRow } from '../repositories/decode-row.ts';
import type { Receipt } from '../storage/receipt.ts';
import type { Unit } from '../storage/unit.ts';
import { decodeCommandValue } from './decode-command-value.ts';

/**
 * Answers a retried command from its finished receipt (section 7.5): the stored error again, the
 * stored value, or for an entity command the row re-read as it is now (the stored reference stands
 * in for it when the row is gone, and for a caller who may not read it). The replay carries the same
 * ids of deferred effects and `replayed`.
 */
export async function replayReceipt(
  unit: Unit,
  registry: Registry,
  action: ActionEntry,
  authority: string,
  receipt: Receipt,
): Promise<CommandResult> {
  const { outcome } = receipt;
  if (outcome === null) throw errors.internal(`the receipt of ${receipt.commandId} has no outcome`);
  if (!outcome.ok) {
    const { error } = outcome;
    throw new KeelwerkError({
      kind: error.kind,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
  }
  const effects = outcome.effects.length > 0 ? { effects: outcome.effects } : {};
  if (!('ref' in outcome) && action.shownOnce !== undefined && action.shownOnce.length > 0) {
    throw errors.conflict('Shown once; issue a new token.');
  }
  if (!('ref' in outcome))
    return { output: decodeCommandValue(action, outcome.value), ...effects, replayed: true };
  const entry = registry.entities.get(outcome.ref.entity);
  if (entry === undefined) throw errors.internal(`${outcome.ref.entity} is no longer an entity`);
  const row = await unit.rows.findOne(entry.descriptor, {
    where: { op: 'eq', field: 'id', value: outcome.ref.id },
    includeArchived: true,
  });
  const { ref } = outcome;
  // A row that is gone answers the stored reference too; the shape stage decides what the caller sees.
  if (row === undefined) return { output: ref, replayRef: ref, ...effects, replayed: true };
  return { output: decodeRow(entry, row, authority), replayRef: ref, ...effects, replayed: true };
}
