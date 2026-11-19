import type { Caller } from './call.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/** Closes every open loan of `borrower` in the caller's tenant as an operator (`loans.closeAll`), so a rerun on the same deployment can lend the same titles again. */
export async function closeLoansOf(
  target: TransportTarget,
  borrower: string,
  tenant: string | undefined,
): Promise<void> {
  const operator: Caller = {
    subject: 'cleanup',
    claims: { operator: true },
    ...(tenant === undefined ? {} : { tenant }),
  };
  const sent = await sendCall(target, {
    action: 'loans.closeAll',
    input: { borrower },
    caller: operator,
  });
  if (!sent.decoded.ok) {
    throw new Error(
      `Closing the loans of ${borrower} was refused: ${JSON.stringify(sent.decoded)}`,
    );
  }
}
