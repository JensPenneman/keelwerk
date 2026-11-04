import type { SeededScope } from './seeded-scope.ts';

/** One synchronous command on a chain entity, written as section 15.1.6 lays out the unit. */
export interface AppendRequest {
  readonly scope: SeededScope;
  /** The entity the command changes: loaded `for update`, evolved, appended to. */
  readonly target: string;
  /** Other entities the decision loads (read-only requests of section 7.9.3). */
  readonly loads: readonly string[];
  /** Commands run at READ COMMITTED (section 14.3.6); REPEATABLE READ is the alternative of 26.2 item 6. */
  readonly isolation: 'read committed' | 'repeatable read';
  /**
   * READ COMMITTED: read the scope counter in the same statement as every load (section 7.9.4,
   * phase 5). REPEATABLE READ ignores it: the counter is read once and positions every load.
   */
  readonly positionedLoads: boolean;
  /**
   * Positioned loads only: where the locked target load reads the counter. `same-statement` is the
   * specification's form; `after-lock` reads it in the next statement, once the row lock is held.
   */
  readonly targetPosition: 'same-statement' | 'after-lock';
  /** `statements`: the commit tail of section 15.1.4 as written; `single-statement`: the same work in one CTE. */
  readonly tail: 'statements' | 'single-statement';
  /** Enqueue one available effect job in this lane and count it at the commit tail (section 9.5.2). */
  readonly enqueueLane: string | undefined;
  /** The rejected design: NOTIFY inside the writer's transaction (section 14.3.7). */
  readonly notifyInTransaction: boolean;
  /** Diagnostic: compare the target load's position with the stream's last committed position. */
  readonly auditTargetPosition: boolean;
}
