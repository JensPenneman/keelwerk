import type { ControlLedger } from '../control/control-ledger.ts';
import { erasureKey } from './erasure-key.ts';

const pageSize = 500;

/**
 * Whether the control ledger holds the erasure record of this erasure. An erasure is identified by
 * its tenant, its command id and its subject together (a command id is unique in one scope only), the
 * subject in its canonical form: `erasureKey`.
 */
export async function isErasureRecorded(
  ledger: ControlLedger,
  erasure: {
    readonly tenantId: string;
    readonly commandId: string;
    readonly subjectId: string;
  },
): Promise<boolean> {
  const key = erasureKey(erasure);
  let after = 0n;
  for (;;) {
    const page = await ledger.since(after, pageSize);
    if (page.length === 0) return false;
    for (const { seq, record } of page) {
      after = seq;
      if (record.type === 'erasure' && erasureKey(record) === key) return true;
    }
  }
}
