import type { ApiUsageTotal } from '../storage/api-usage-store.ts';

/** What `core.apiUsage` answers: at most 1000 totals; `truncated` when more matched. */
export interface ApiUsageDocument {
  readonly items: readonly ApiUsageTotal[];
  readonly truncated: boolean;
}
