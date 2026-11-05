import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { decodeRow } from '../repositories/decode-row.ts';
import type { ReceiptOutcome } from '../storage/receipt-outcome.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { encodeEventValue } from './encode-event-value.ts';
import { withoutShownOnce } from './without-shown-once.ts';
import type { WrittenRow } from './written-row.ts';

/** What a command answers and what its receipt keeps. */
export interface CommandOutput {
  readonly output: unknown;
  readonly outcome: Extract<ReceiptOutcome, { readonly ok: true }>;
}

/** What the output of a command is built from. */
export interface CommandOutputInput {
  readonly registry: Registry;
  readonly action: ActionEntry;
  /** The module whose authority reads the output row. */
  readonly authority: string;
  readonly written: readonly WrittenRow[];
  /** The target row of an entity command as it was loaded. */
  readonly target: StorageRow | undefined;
  /** The `result` of the decision. */
  readonly result: unknown;
  readonly effects: readonly string[];
}

/**
 * The output of a command (section 15.1.7). A command whose output is a row of an entity answers
 * that row after the command, and its receipt keeps a reference `{ entity, id, version }`, which a
 * replay re-reads; every other command answers the decision's `result` and its receipt keeps the
 * serialised value.
 */
export function commandOutput(input: CommandOutputInput): CommandOutput {
  const { action, registry } = input;
  const marker = action.entityOutput;
  if (marker?.shape === 'row') {
    const entry = registry.entities.get(marker.entity);
    const targetId = input.target === undefined ? undefined : String(input.target.id);
    const chosen =
      (targetId === undefined
        ? undefined
        : input.written.find((item) => item.entry === entry && item.id === targetId)) ??
      input.written.find((item) => item.entry === entry && (item.created || action.instance)) ??
      input.written.find((item) => item.entry === entry);
    const row = chosen?.row ?? (action.instance ? input.target : undefined);
    if (entry !== undefined && row !== undefined) {
      return {
        output: decodeRow(entry, row, input.authority),
        outcome: {
          ok: true,
          ref: { entity: entry.ref, id: String(row.id), version: Number(row.version) },
          effects: input.effects,
        },
      };
    }
  }
  const output = input.result ?? {};
  return {
    output,
    outcome: {
      ok: true,
      value: encodeEventValue(withoutShownOnce(action, output)),
      effects: input.effects,
    },
  };
}
