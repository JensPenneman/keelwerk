import { quota } from '../dsl/quota.ts';
import type { CoreBase } from './core-base-type.ts';

/** The quota dimensions of the core, all at tenant level (section 12.2; defaults of sheets/WP-108-lead.md answer 4). */
export const coreQuotas: CoreBase['quotas'] = {
  rows: quota.count().default(10_000_000),
  eventBytes: quota.bytes().default('10GiB'),
  requestRate: quota.rate().default('6000/1m'),
  principalRequestRate: quota.rate().default('1200/1m'),
  commandRate: quota.rate().default('3000/1m'),
  queryRate: quota.rate().default('6000/1m'),
  subscribeRate: quota.rate().default('600/1m'),
  concurrentInvocations: quota.count().default(100),
  liveSubscriptions: quota.count().default(1000),
  liveConnections: quota.count().default(1000),
};
