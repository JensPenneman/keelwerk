import type { UsageCharge } from '@keelwerk/core';

/** A usage charge of the conformance cases; `core.rows` unless a dimension is named. */
export const usageChargeOf = (
  delta: bigint,
  limit: bigint | null,
  dimension = 'core.rows',
): UsageCharge => ({ dimension, delta, limit });
