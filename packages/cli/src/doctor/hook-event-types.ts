/**
 * Where doctor reads failed tenant hooks (S-27, decided by WP-50): the control store's event log.
 * The runtime appends `core.tenant.hookFailed` to the tenant's stream (data `{ hook }`) when an
 * `onTenantCreated` hook throws, and `core.tenant.hookCompleted` (same data) when a rerun
 * succeeds; doctor lists the hooks that failed and have not completed since.
 */
export const hookEventTypes = {
  failed: 'core.tenant.hookFailed',
  completed: 'core.tenant.hookCompleted',
} as const;
