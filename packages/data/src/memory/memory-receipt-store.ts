import type { Receipt, ReceiptStore } from '@keelwerk/core';
import { errors, KeelwerkError } from '@keelwerk/core';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** The command receipts of the unit's scope (15.1.7). */
export function memoryReceiptStore(ctx: MemoryUnitContext): ReceiptStore {
  const name = (): string => `receipts/${ctx.scopeId()}`;
  return {
    get: async (commandId) => ctx.tx.read<Receipt>(name()).get(commandId),
    put: async (receipt) => {
      ctx.writable();
      const existing = ctx.tx.read<Receipt>(name()).get(receipt.commandId);
      if (existing === undefined) {
        ctx.tx.write<Receipt>(name()).set(receipt.commandId, receipt);
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
      if (ctx.tx.read<Receipt>(name()).has(receipt.commandId)) return 'exists';
      ctx.tx.write<Receipt>(name()).set(receipt.commandId, receipt);
      return 'inserted';
    },
    complete: async (commandId, outcome) => {
      ctx.writable();
      const existing = ctx.tx.read<Receipt>(name()).get(commandId);
      if (existing === undefined) throw errors.not_found(`no receipt for command ${commandId}`);
      ctx.tx
        .write<Receipt>(name())
        .set(commandId, { ...existing, outcome, status: outcome.ok ? 'completed' : 'failed' });
    },
    forClient: async (clientId, afterSeq, limit) =>
      [...ctx.tx.read<Receipt>(name()).values()]
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
      const table = ctx.tx.read<Receipt>(name());
      const done = [...table.values()].filter(
        (receipt) =>
          receipt.clientId === clientId &&
          receipt.clientSeq !== null &&
          receipt.clientSeq <= uptoSeq,
      );
      if (done.length === 0) return;
      const writable = ctx.tx.write<Receipt>(name());
      const acknowledgedAt = ctx.clock.now();
      for (const receipt of done) writable.set(receipt.commandId, { ...receipt, acknowledgedAt });
    },
  };
}
