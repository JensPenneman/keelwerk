import type { StorageScope, Unit } from '@keelwerk/core';
import type { ConformanceClock } from './conformance-clock.ts';

/** What the receipt cases need of an adapter: units in a scope and the clock its units see. */
export interface ReceiptStoreSubject {
  readonly clock?: ConformanceClock | undefined;
  /** A read-write unit. */
  run<T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>): Promise<T>;
  /** A read-only unit. */
  read<T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>): Promise<T>;
}
