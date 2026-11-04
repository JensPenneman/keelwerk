import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { RequestInfo } from '../invoker/request-info.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ComputePool } from '../kernel/compute-pool.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { Principal } from '../principals/principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Scope } from '../storage/scope.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { QueryStateEncoder } from './query-state-encoder.ts';

/** What `runRead` needs to run one query. The invoker has authorized the call and validated `input` by now. */
export interface RunReadInput {
  readonly registry: Registry;
  readonly adapter: DataAdapter;
  /** The namespace of the scope's data. */
  readonly namespace: NamespaceRef;
  /** The scope the query runs in. */
  readonly scope: Scope;
  /** The query's reference, 'library.findByIsbn'. */
  readonly action: string;
  /** The validated input. */
  readonly input: unknown;
  readonly principal: Principal;
  readonly request: RequestInfo;
  readonly clock: Clock;
  readonly keys: KeyService;
  readonly compute: ComputePool;
  readonly log: Logger;
  readonly trace: Span;
  /**
   * Whether the adapter can hold a second unit open beside this one (its capabilities say
   * `processes` other than a single session). When it cannot (PGlite), a tenant query reads
   * backend entities in a read-only savepoint with the scope settings swapped (14.3.6).
   * Default: false (the savepoint), so the member can be retired once capabilities decide.
   */
  readonly concurrentUnits?: boolean;
  /** The namespace of another scope's data, for a backend read; default: `namespace`. */
  readonly namespaceOf?: (scope: StorageScope) => NamespaceRef;
  /** A module's configuration (section 3.4); default: none. */
  readonly config?: (module: string) => unknown;
  /** Normalised rules after the policy overrides; default: the registry's rules. */
  readonly rules?: readonly NormalizedRule[];
  /** Produces the `queryState` of a `query` load; default: the decimal position (the state-token work package supplies the token of 15.2.6). */
  readonly queryState?: QueryStateEncoder;
  /**
   * Aborts the read: the read-only unit ends and `runRead` rejects with the signal's reason.
   * Default: none.
   */
  readonly signal?: AbortSignal;
  /** Replaces the answerer of a kind (the seam of later packages). */
  readonly replace?: Partial<RequestAnswerer>;
}
