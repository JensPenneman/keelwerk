import type { AdapterEnvironment, Clock } from '@keelwerk/core';
import type { PostgresAdapterOptions } from './postgres-adapter-options.ts';

/** The time source of one adapter: the option, else the runtime's clock, else the system clock. */
export function resolvePostgresClock(
  options: PostgresAdapterOptions,
  env: AdapterEnvironment,
): Clock {
  return options.clock ?? env.clock ?? { now: () => Temporal.Now.instant() };
}
