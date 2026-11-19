import { malformedQuery } from './malformed-query.ts';

/** `validation` (`core.malformed_request`) for the limit of a retention purge that is no whole number from 1 to 100000; every adapter asks the same question. */
export function checkPurgeLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) {
    throw malformedQuery('the limit of a purge is a whole number from 1 to 100000');
  }
}
