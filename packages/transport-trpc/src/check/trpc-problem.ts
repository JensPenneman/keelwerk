import type { TransportProblem } from '@keelwerk/core';

/** A problem of the tRPC projection. */
export function trpcProblem(
  code: TransportProblem['code'],
  subject: string,
  message: string,
): TransportProblem {
  return { code, transport: 'trpc', subject, message };
}
