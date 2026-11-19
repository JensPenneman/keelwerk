import { createRetention } from './create-retention.ts';
import type { RetentionOptions } from './retention-options.ts';
import type { RetentionWorker } from './retention-worker.ts';

/**
 * The event worker that purges the operational buffers (`runs: ['retention']`, section 14.7.1):
 * see `RetentionOptions` for what it takes. A pass visits the deployment scope and each backend
 * and tenant served here, archived tenants included, and a scope that lost something or failed
 * gets one row in `kw_retention_runs`.
 */
export function retention(options: RetentionOptions = {}): RetentionWorker {
  return createRetention(options);
}
