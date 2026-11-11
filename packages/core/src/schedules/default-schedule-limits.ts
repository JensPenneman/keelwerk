import type { ScheduleLimits } from './schedule-limits.ts';

/** The ticker's default bounds: thousands of tenants are ticked in many short passes, never in one. */
export const defaultScheduleLimits: ScheduleLimits = {
  passEveryMs: 1000,
  dueLimit: 500,
  perBackend: 100,
  concurrency: 8,
  seedPerPass: 200,
  pageSize: 100,
  retryMs: 60_000,
  staleMs: 3_600_000,
  reseedMs: 60_000,
  backendBudgetMs: 5000,
  unitTimeoutMs: 10_000,
};
