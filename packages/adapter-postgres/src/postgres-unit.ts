import type { Unit } from '@keelwerk/core';
import { postgresNotWired } from './postgres-not-wired.ts';
import type { PostgresUnitRequest } from './postgres-unit-request.ts';

/**
 * The `DataAdapter.unit` entry: the finished `Unit` with its stores over the session of
 * `runPostgresSession`. The stores of WP-22, WP-31 and WP-36 are wired here; until then the entry is
 * not available.
 */
export async function runPostgresUnit<T>(
  _request: PostgresUnitRequest,
  _fn: (u: Unit) => Promise<T>,
): Promise<T> {
  throw postgresNotWired('unit');
}
