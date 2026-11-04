import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { Unit } from '../storage/unit.ts';
import type { ContextFactory } from './context-factory.ts';
import type { CallerViews } from './create-caller-views.ts';
import type { QueryStateEncoder } from './query-state-encoder.ts';
import type { RequestAuthorities } from './request-authorities.ts';

/** Runs `fn` in a read-only unit of another scope of the same namespace, for a tenant invocation's reads of backend entities (14.3.6). */
export type ScopeRunner = <T>(
  from: Unit,
  scope: StorageScope,
  fn: (unit: Unit) => Promise<T>,
) => Promise<T>;

/** What the answerers share beyond the `AnswerContext`. */
export interface AnswerDeps {
  readonly views: CallerViews;
  readonly inScope: ScopeRunner;
  readonly contexts: ContextFactory;
  /** Produces the `queryState` of a `query` load. */
  readonly queryState: QueryStateEncoder;
  /** The module whose context built each request of the invocation. */
  readonly authorities: RequestAuthorities;
  /** The answerers themselves, for a derived context that answers its nested requests. */
  readonly answerer: RequestAnswerer;
}
