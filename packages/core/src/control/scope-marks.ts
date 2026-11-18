import type { ScopeMark } from './scope-mark.ts';

/** The marks of kw__control.kw_scope_marks (14.7.6, S-119). */
export interface ScopeMarks {
  /** One namespace's marks in scope id order after `after`, at most `limit`. */
  list(
    namespaceId: string,
    page: { readonly after?: string; readonly limit: number },
  ): Promise<readonly ScopeMark[]>;
  /** Every row whose epoch is above 0 (doctor, the epoch cache). */
  bumped(): Promise<readonly ScopeMark[]>;
  /**
   * Upsert: position and each serial take the greater of stored and given, updatedAt the given; a
   * stored epoch is kept, a new row takes the mark's.
   */
  raise(marks: readonly ScopeMark[]): Promise<void>;
  /**
   * Sets epoch = mark.epoch (and raises position, serials, updatedAt) only while the row holds
   * `from`; a missing row counts as 0 and is inserted. Answers the epoch the row holds afterwards
   * (the winner's when another process moved it first).
   */
  bump(mark: ScopeMark, from: number): Promise<number>;
}
