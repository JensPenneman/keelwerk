import type { ReceiptStore, StorageRow } from '@keelwerk/core';
import { commandReceiptUuid, errors, KeelwerkError } from '@keelwerk/core';
import { commandReceiptTable } from '../sql/postgres/command-receipt-table.ts';
import { floorInstant } from './floor-instant.ts';
import { memoryCloneValue } from './memory-clone-value.ts';
import { memoryReceiptOf } from './memory-receipt-of.ts';
import { memoryReceiptRow } from './memory-receipt-row.ts';
import { memoryRowsName } from './memory-rows-name.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * The command receipts of the unit's scope (15.1.7), stored as rows of the `core.commandReceipt`
 * entity in the unit's scope collection of its table, so the generated reads find them. The row's
 * id derives from the scope id (the deployment's id for a deployment unit) and the command id,
 * as on SQL.
 */
export function memoryReceiptStore(ctx: MemoryUnitContext): ReceiptStore {
  const name = (): string => memoryRowsName(commandReceiptTable, ctx.scopeId());
  const idOf = (commandId: string): string =>
    commandReceiptUuid(
      ctx.scope.level === 'deployment' ? ctx.deploymentId : ctx.scopeId(),
      commandId,
    );
  const expired = (row: StorageRow): boolean =>
    Temporal.Instant.compare(row.expiresAt as Temporal.Instant, floorInstant(ctx.clock.now())) <= 0;
  const read = (commandId: string): StorageRow | undefined =>
    ctx.tx.read<StorageRow>(name()).get(idOf(commandId));
  /** Writes a new receipt row; an expired row it replaces keeps its `createdAt` and takes the next version. */
  const store = (receipt: Parameters<ReceiptStore['put']>[0], existing: StorageRow | undefined) => {
    const id = idOf(receipt.commandId);
    const previous =
      existing === undefined
        ? undefined
        : { createdAt: existing.createdAt as Temporal.Instant, version: Number(existing.version) };
    ctx.tx
      .write<StorageRow>(name())
      .set(id, memoryReceiptRow(receipt, id, ctx.clock.now(), previous));
  };
  return {
    get: async (commandId) => {
      const row = read(commandId);
      return row === undefined ? undefined : memoryReceiptOf(row);
    },
    put: async (receipt) => {
      ctx.writable();
      const existing = read(receipt.commandId);
      if (existing === undefined) {
        store(receipt, existing);
        return;
      }
      if (existing.fingerprint !== receipt.fingerprint) {
        throw new KeelwerkError({
          kind: 'conflict',
          code: 'core.idempotency_mismatch',
          message: 'The command id was used with a different request.',
        });
      }
    },
    claim: async (receipt) => {
      ctx.writable();
      const existing = read(receipt.commandId);
      if (existing !== undefined && !expired(existing)) return 'exists';
      store(receipt, existing);
      return 'inserted';
    },
    complete: async (commandId, outcome) => {
      ctx.writable();
      const existing = read(commandId);
      if (existing === undefined) throw errors.not_found(`no receipt for command ${commandId}`);
      ctx.tx.write<StorageRow>(name()).set(String(existing.id), {
        ...existing,
        outcome: memoryCloneValue(outcome),
        status: outcome.ok ? 'completed' : 'failed',
        version: Number(existing.version) + 1,
        updatedAt: floorInstant(ctx.clock.now()),
      });
    },
    forClient: async (clientId, afterSeq, limit) =>
      [...ctx.tx.read<StorageRow>(name()).values()]
        .map(memoryReceiptOf)
        .filter(
          (receipt) =>
            receipt.clientId === clientId &&
            receipt.clientSeq !== null &&
            receipt.clientSeq > afterSeq,
        )
        .sort((a, b) => (a.clientSeq ?? 0) - (b.clientSeq ?? 0))
        .slice(0, limit),
    acknowledge: async (clientId, uptoSeq) => {
      ctx.writable();
      const table = ctx.tx.read<StorageRow>(name());
      const done = [...table.values()].filter(
        (row) =>
          row.clientId === clientId &&
          row.clientSeq !== undefined &&
          row.clientSeq !== null &&
          Number(row.clientSeq) <= uptoSeq,
      );
      if (done.length === 0) return;
      const writable = ctx.tx.write<StorageRow>(name());
      const acknowledgedAt = floorInstant(ctx.clock.now());
      for (const row of done) {
        writable.set(String(row.id), {
          ...row,
          acknowledgedAt,
          version: Number(row.version) + 1,
          updatedAt: acknowledgedAt,
        });
      }
    },
  };
}
