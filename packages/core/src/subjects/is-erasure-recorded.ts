import type { ControlLedger } from '../control/control-ledger.ts';
import { canonicalSubject } from './canonical-subject.ts';

/**
 * Whether the control ledger holds the erasure record of this erasure: one indexed lookup of its
 * tenant, its command id and its subject together (a command id is unique in one scope only), the
 * subject in its canonical form.
 */
export async function isErasureRecorded(
  ledger: ControlLedger,
  erasure: {
    readonly tenantId: string;
    readonly commandId: string;
    readonly subjectId: string;
  },
): Promise<boolean> {
  const found = await ledger.find(
    [
      {
        type: 'erasure',
        tenantId: erasure.tenantId,
        commandId: erasure.commandId,
        subjectId: canonicalSubject(erasure.subjectId),
      },
    ],
    { limit: 1 },
  );
  return found.length > 0;
}
