import type { TransportProblem } from '@keelwerk/core';

/** A problem of the REST projection. */
export function restProblem(
  code: TransportProblem['code'],
  subject: string,
  message: string,
): TransportProblem {
  return { code, transport: 'rest', subject, message };
}
