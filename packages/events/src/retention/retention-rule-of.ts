import type { RetentionRunRule } from '@keelwerk/core';
import type { RetainRules } from './retain-rules.ts';

/** The rule of one of the four buffers as a run records it, with the duration this worker applies. */
export function retentionRuleOf(
  kind: 'transientRecords' | 'receipts' | 'jobHistory' | 'streamTickets',
  rules: RetainRules,
): RetentionRunRule {
  return kind === 'receipts' ? { kind, olderThan: null } : { kind, olderThan: rules[kind] };
}
