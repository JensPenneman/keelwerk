import type { StandardSchemaV1 } from '@keelwerk/core';
import type { PostgresPlacementOptions } from './postgres-placement-options.ts';

const known: readonly string[] = ['idleInTransactionTimeoutMs', 'connectionTimeoutMs'];

function positiveInteger(
  input: Readonly<Record<string, unknown>>,
  key: keyof PostgresPlacementOptions,
  fallback: number,
  issues: { message: string; path: readonly string[] }[],
): number {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    issues.push({
      message: `${key} must be a positive integer number of milliseconds`,
      path: [key],
    });
    return fallback;
  }
  return value;
}

/** The options schema of the `postgres` factory: placement `options`, defaults applied, unknown keys refused. */
export const postgresOptionsSchema: StandardSchemaV1<unknown, PostgresPlacementOptions> = {
  '~standard': {
    version: 1,
    vendor: 'keelwerk',
    validate: (value) => {
      if (value === undefined || value === null) {
        return { value: { idleInTransactionTimeoutMs: 30_000, connectionTimeoutMs: 10_000 } };
      }
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [{ message: 'the postgres placement options must be an object' }] };
      }
      const input = value as Readonly<Record<string, unknown>>;
      const issues: { message: string; path: readonly string[] }[] = [];
      for (const key of Object.keys(input)) {
        if (!known.includes(key)) issues.push({ message: `unknown option ${key}`, path: [key] });
      }
      const result = {
        idleInTransactionTimeoutMs: positiveInteger(
          input,
          'idleInTransactionTimeoutMs',
          30_000,
          issues,
        ),
        connectionTimeoutMs: positiveInteger(input, 'connectionTimeoutMs', 10_000, issues),
      };
      return issues.length > 0 ? { issues } : { value: result };
    },
  },
};
