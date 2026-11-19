import { describe } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobHistoryPurgeCases } from './job-history-purge-cases.ts';
import { purgeTransientCases } from './purge-transient-cases.ts';
import { purgeTransientReceiptCases } from './purge-transient-receipt-cases.ts';
import { retentionRunCases } from './retention-run-cases.ts';

/** The retention cases of an adapter (14.7.1): the transient purge, the job history purge and the run store. */
export function retentionCases(subject: ConformanceSubject): void {
  describe('purge transient', () => purgeTransientCases(subject));
  describe('purge transient receipts', () => purgeTransientReceiptCases(subject));
  describe('job history purge', () => jobHistoryPurgeCases(subject));
  describe('retention runs', () =>
    retentionRunCases(subject, { table: subject.name === 'memory' }));
}
