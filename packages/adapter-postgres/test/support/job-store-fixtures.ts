import type { StorageScope, StoredJobSpec } from '@keelwerk/core';
import { testScopes } from './test-scopes.ts';

const { backendId } = testScopes;

export const tenant = (n: number): Extract<StorageScope, { level: 'tenant' }> => ({
  level: 'tenant',
  backendId,
  tenantId: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
});

export const spec = (n: number, over: Partial<StoredJobSpec> = {}): StoredJobSpec => ({
  queue: 'commands',
  run: { action: 'a', input: n },
  scope: tenant(0),
  principal: { resolver: 'system', principalId: 'p' },
  causation: {},
  build: { id: 'b1', revision: 1 },
  kind: 'action',
  laneCap: 10,
  createdAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
  ...over,
});

export const takeRequest = (limit: number, leaseMs = 60_000) => ({
  limit,
  capabilitySets: [''],
  maxRevision: 100,
  leaseMs,
});

export const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
