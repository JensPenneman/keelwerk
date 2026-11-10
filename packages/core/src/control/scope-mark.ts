import type { Position } from '../storage/position.ts';
import type { ScopeEpoch } from '../storage/scope-epoch.ts';

/** One row of kw__control.kw_scope_marks (section 14.7.6, S-119); its epoch is authoritative. */
export interface ScopeMark extends ScopeEpoch {
  readonly namespaceId: string;
  readonly position: Position;
  /** Serial name to its high-water value. */
  readonly serials: Readonly<Record<string, bigint>>;
  readonly updatedAt: Temporal.Instant;
}
