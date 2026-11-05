import type { LoanRow } from './loan-row.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the subject's loans (all pages up to `first`) through `loans.loan.query`. */
export async function loansOf(
  target: TransportTarget,
  subject: string | null,
  input: Readonly<Record<string, unknown>> = {},
  tenant?: string,
): Promise<readonly LoanRow[]> {
  const sent = await sendCall(target, {
    action: 'loans.loan.query',
    input,
    caller: { subject, ...(tenant === undefined ? {} : { tenant }) },
  });
  if (!sent.decoded.ok || !isRecord(sent.decoded.value)) {
    throw new Error(`loans.loan.query failed: ${JSON.stringify(sent.decoded)}`);
  }
  const items = sent.decoded.value.items;
  return (Array.isArray(items) ? items : []).map((item: Record<string, string>) => ({
    borrower: String(item.borrower),
    bookTitle: String(item.bookTitle),
    state: String(item.state),
    dueAt: String(item.dueAt),
  }));
}
