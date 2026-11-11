import type { TransportProblem } from '@keelwerk/core';

/** A problem of the GraphQL projection. */
export function graphqlProblem(
  code: TransportProblem['code'],
  subject: string,
  message: string,
): TransportProblem {
  return { code, transport: 'graphql', subject, message };
}
