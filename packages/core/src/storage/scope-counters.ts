import type { Position } from './position.ts';

/** One scope's counters in a namespace (15.1.4): what a mark records and a bump raises. */
export interface ScopeCounters {
  readonly scopeId: string;
  /** Last committed position: kw_positions.next - 1; 0n without a counter row. */
  readonly position: Position;
  /** kw_positions.epoch; 1 without a counter row (the row's insert default). */
  readonly epoch: number;
  /** Mark name to the last value handed out (next - 1); `stream:` entities and `core.effectAttempt` left out (S-119). */
  readonly serials: Readonly<Record<string, bigint>>;
}
