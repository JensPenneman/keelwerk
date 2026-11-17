import { malformedQuery } from './malformed-query.ts';

/** The greatest limit `JobStore.queued` takes: the statement reads `limit + 1` rows, which must stay a 32-bit integer. */
const greatestLimit = 2_147_483_646;

/** `validation` (`core.malformed_request`) for a `JobStore.queued` limit that is no integer from 0 to 2,147,483,646; both adapters ask the same question. */
export function checkQueuedLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 0 || limit > greatestLimit) {
    throw malformedQuery(
      `the limit of a queued count is a whole number from 0 to ${greatestLimit}`,
    );
  }
}
