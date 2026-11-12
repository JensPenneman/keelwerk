import type { StateToken } from '../events/state-token.ts';
import type { PokesChange } from '../invoker/pokes-concern-of.ts';
import type { Position } from '../storage/position.ts';

/** One subscriber's view of `live.pokes` in its session's own scope (15.2.5, 15.4.2). */
export interface LivePokesView {
  /** sha256 hex over the sorted pairs (entity ref, its `get` token check): equal keys poke alike. */
  readonly key: string;
  /**
   * The entity types whose data lives in the session's own scope (tenancy `tenant` for a tenant
   * session, `backend` for a backend session) and whose plan for the principal is not `never`.
   * An `invocation` entity (command receipts, effects) is never in it: the submitter follows its own
   * receipts with the generated `watch` and `ids`.
   */
  readonly entities: ReadonlySet<string>;
  /**
   * The entities of `entities` whose plan selects rows (a `where` with no relation quantifier): a
   * change is named only when it concerns a row of the plan, so `concerns` needs their post-images.
   */
  readonly conditional: ReadonlySet<string>;
  /** Whether the changes of a batch to a conditional `entity` concern the principal (true when it cannot be decided in memory). */
  concerns(entity: string, changes: readonly PokesChange[]): boolean;
  /** The token `get` and `changes` of `entity` answer at `position` (selector without partition). */
  stateToken(entity: string, position: Position): StateToken;
  /** `Poke.upto` and the item's state: check = sha256 hex of canonical `{ pokes: key, apiVersion }`, first 8. */
  token(position: Position): StateToken;
  /** As `LiveView.judge` for a pokes token: malformed `validation`, other scope `core.token_scope_mismatch`, else `resync` or the position. */
  judge(token: string, head: Position): Position | 'resync';
}
