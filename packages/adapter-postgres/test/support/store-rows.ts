// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { StorageRow, StorageScope } from '@keelwerk/core';
import { item, itemLabel, label, setting, ticket } from './store-entities.ts';
import { testScopes } from './test-scopes.ts';

export const backendScope: StorageScope = { level: 'backend', backendId: testScopes.backendId };
export const deploymentScope: StorageScope = { level: 'deployment' };
export const known = new Map(
  [ticket, setting, item, label, itemLabel].map((entity) => [entity.ref, entity]),
);
export const stamp = Temporal.Instant.from('2026-01-01T00:00:00Z');

export const id = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const row = (n: number, over: Record<string, unknown>): StorageRow => ({
  id: id(n),
  createdAt: stamp,
  updatedAt: stamp,
  version: 1,
  ...over,
});
