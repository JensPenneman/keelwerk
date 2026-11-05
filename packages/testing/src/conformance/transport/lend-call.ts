import type { Call } from './call.ts';
import { dueAt } from './due-at.ts';

/** `loans.lend` as a signed-in subject. */
export function lendCall(subject: string, bookTitle: string, over: Partial<Call> = {}): Call {
  return {
    action: 'loans.lend',
    input: { bookTitle, dueAt },
    caller: { subject },
    ...over,
  };
}
