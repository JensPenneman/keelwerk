import type { DataAdapterFactory } from '@keelwerk/core';

function isFactory(value: unknown): value is DataAdapterFactory {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'create' in value &&
    typeof value.create === 'function'
  );
}

/** The infrastructure entry that provides the adapter with this id; undefined when none does. */
export function factoryOf(
  infrastructure: readonly unknown[],
  adapterId: string,
): DataAdapterFactory | undefined {
  return infrastructure.filter(isFactory).find((candidate) => candidate.id === adapterId);
}
