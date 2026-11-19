import type { StorageScope } from '@keelwerk/core';
import { commandReceiptDescriptor, conformanceScopes } from '@keelwerk/data/conformance';
import { conformanceReceipt } from './conformance-receipt.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { purgeCommandOf } from './purge-command-of.ts';
import { purgeReceiptStream } from './purge-receipt-stream.ts';
import { purgeReceiptType } from './purge-receipt-type.ts';
import { stamp } from './stamp.ts';

const { tenantA } = conformanceScopes;

/** What the purge cases do to an adapter: batches, receipts and reads of a receipt stream. */
export function purgeTransientKit(subject: Pick<ConformanceSubject, 'run' | 'read'>) {
  return {
    /** One batch of `purgeTransient` before `hours` after the stamp. */
    purgeBatch: (
      hours: number,
      limit: number,
      scope: StorageScope = tenantA,
      types: readonly string[] = [purgeReceiptType],
    ) =>
      subject.run(scope, (unit) => unit.events.purgeTransient(stamp.add({ hours }), limit, types)),
    /** How many records one batch removed. */
    async purge(hours: number, limit: number, scope: StorageScope = tenantA): Promise<number> {
      const batch = await subject.run(scope, (unit) =>
        unit.events.purgeTransient(stamp.add({ hours }), limit, [purgeReceiptType]),
      );
      return batch.removed;
    },
    /** The versions left in the stream of receipt `number`. */
    async versions(number = 1, scope: StorageScope = tenantA): Promise<readonly number[]> {
      const events = await subject.read(scope, (unit) =>
        unit.events.readStream(purgeReceiptStream(number, scope), { limit: 100 }),
      );
      return events.map((event) => event.version);
    },
    /** Stores the receipts whose streams the cases append to; a live one keeps its newest. */
    async receipts(numbers: readonly number[], scope: StorageScope = tenantA): Promise<void> {
      for (const number of numbers) {
        await subject.run(scope, (unit) =>
          unit.receipts.put(conformanceReceipt(purgeCommandOf(number), { status: 'completed' })),
        );
      }
    },
    /** Removes the receipt row of command `number`, as the receipt purge does. */
    dropReceipt: (number: number, scope: StorageScope = tenantA) =>
      subject.run(scope, (unit) =>
        unit.rows.purge(commandReceiptDescriptor(), [purgeReceiptStream(number, scope).id]),
      ),
  };
}
