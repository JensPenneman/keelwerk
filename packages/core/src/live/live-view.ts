import type { Condition } from '../conditions/condition.ts';
import type { StateToken } from '../events/state-token.ts';
import type { Position } from '../storage/position.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import type { LiveEarlier } from './live-earlier.ts';
import type { LiveEarlierShare } from './live-earlier-share.ts';
import type { LiveReplay } from './live-replay.ts';

/** One subscriber's read view of an entity (8.4, 15.4.3); equal `planKey`s evaluate and mask identically. */
export interface LiveView {
  readonly entity: string;
  /**
   * sha256 hex of the canonical form of the plan compiled for the principal: its kind, its `where`
   * with the principal's values and flags substituted, its maskable fields, and its allow and field-deny
   * clauses (rule id, condition, sorted field list or null). Two views share a key only when they
   * evaluate and mask every row alike.
   */
  readonly planKey: string;
  /** Where the stream starts: `now` unless the input says `beginning`. */
  readonly from: 'now' | 'beginning';
  /** The token the input resumes from (`WatchInput.after`), if any. */
  readonly after: string | undefined;
  readonly includeArchived: boolean;
  readonly partition: string | undefined;
  /** The filter, the ids and the plan's selection together. */
  readonly selection: Condition;
  /** Whether the plan selects each row, one `rows.matching` per quantifier node of the plan for all rows; in the order of `rows`. */
  inPlan(unit: Unit, rows: readonly StorageRow[]): Promise<readonly boolean[]>;
  /** The subscriber's own filter, ids and partition, evaluated in memory. */
  inFilter(row: StorageRow): boolean;
  /** False when the subscriber's `ids` leave the stream out: such a stream never was in its view and never changes that. */
  inIds(id: string): boolean;
  /**
   * What the plan selected at `since` among the streams `ids`, each as it was then. It depends on
   * the plan alone (not on the filter, the ids or the archive setting of the subscriber), so one answer
   * serves every view with the same `planKey`; the subscriber applies its own filter to the rows.
   */
  earlier(
    unit: Unit,
    input: {
      readonly since: Position;
      readonly ids: readonly string[];
      /** The streams already rebuilt by the other plan groups of the pass; absent: rebuilt for this call alone. */
      readonly share?: LiveEarlierShare;
    },
  ): Promise<LiveEarlier>;
  /** Masks the rows by the plan, then takes out what no client sees (chain columns, hidden, sealed and verifier fields). */
  present(unit: Unit, rows: readonly StorageRow[]): Promise<readonly StorageRow[]>;
  /** The subscriber's `fields` of an already presented row; the row itself without `fields`. */
  project(row: StorageRow): StorageRow;
  /** The stream token for a position: bound to the principal, tenant, selector and API version. */
  token(position: Position): StateToken;
  /**
   * The position a token resumes from. A token that is not a token is `validation` `core.malformed_request`;
   * one of another scope is `validation` `core.token_scope_mismatch`; another epoch, another check
   * (principal, rules, flags, selector or API version) or a position past `head` is `resync`.
   */
  judge(token: string, head: Position): Position | 'resync';
  /** Steps 1 to 5 of 15.2.6 over (since, head] under `selection`. */
  replay(
    unit: Unit,
    input: {
      readonly since: Position;
      readonly head: Position;
      readonly maxStreams: number;
    },
  ): Promise<LiveReplay>;
}
