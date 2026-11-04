import { postgresOptionsSchema } from './postgres-options-schema.ts';

/** The placement's `connectionTimeoutMs` (default 10000), for the connections the adapter opens outside the pool. */
export function connectionTimeout(options: unknown): number {
  const parsed = postgresOptionsSchema['~standard'].validate(options);
  if (parsed instanceof Promise || parsed.issues !== undefined) return 10_000;
  return parsed.value.connectionTimeoutMs;
}
