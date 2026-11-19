import type { NewEvent, StorageScope, StreamAppend } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { purgeReceiptStream } from './purge-receipt-stream.ts';

/**
 * One append of `events` to the change stream of receipt `number` in a tenant (the stream type is
 * named, as the kernel does for a stream whose entity it holds elsewhere), after `expectedVersion`
 * records.
 */
export function appendPurgeReceipt(
  number: number,
  events: readonly NewEvent[],
  expectedVersion = 0,
  scope: StorageScope = conformanceScopes.tenantA,
): StreamAppend {
  return {
    stream: purgeReceiptStream(number, scope),
    partition: null,
    tenancy: 'invocation',
    expectedVersion,
    events,
  };
}
