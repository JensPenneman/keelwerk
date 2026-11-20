import type { TransportProblem } from '@keelwerk/core';

/** A problem of the oRPC projection. */
export function orpcProblem(
  code: TransportProblem['code'],
  subject: string,
  message: string,
): TransportProblem {
  return { code, transport: 'orpc', subject, message };
}
