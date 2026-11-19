import { transientPurgeTypes } from '@keelwerk/core';
import { malformedQuery } from './malformed-query.ts';

/**
 * `validation` (`core.malformed_request`) for a list of stream types to purge that names a type
 * outside `transientPurgeTypes`; every adapter asks the same question. On PostgreSQL the function
 * `kw_purge_transient` refuses the same lists on its own (42501), whoever calls it.
 */
export function checkPurgeTypes(streamTypes: readonly string[]): void {
  for (const type of streamTypes) {
    if (!transientPurgeTypes.includes(type)) {
      throw malformedQuery(`stream type ${type} is not one that retention may purge`);
    }
  }
}
