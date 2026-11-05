import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { RequestInfo } from '../invoker/request-info.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ComputePool } from '../kernel/compute-pool.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { Principal } from '../principals/principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Scope } from '../storage/scope.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { EntityBehaviours } from '../write-path/entity-behaviours.ts';

/** What `redecide` runs a recorded decision with. */
export interface RedecideInput {
  readonly registry: Registry;
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  /** The scope the command ran in. */
  readonly scope: Scope;
  readonly commandId: string;
  /**
   * The command's input, given by the caller (section 7.9.6); refused unless it matches the
   * recorded digest.
   */
  readonly input: unknown;
  /** The API version the command was expressed in; the digest covers it. */
  readonly apiVersion: string;
  readonly behaviours: EntityBehaviours;
  readonly rules: readonly NormalizedRule[];
  /** The runtime's key service, in the recorded scope: verifications and reveals run on it for real (section 7.9.6). */
  readonly keys: KeyService;
  /** A real pool: computations are reproducible and run again. */
  readonly compute: ComputePool;
  /** Now; the feed horizon counts back from it. */
  readonly clock: Clock;
  /**
   * How long the transient change records of `history: 'state'` entities are kept, as an ISO 8601
   * duration (section 15.1.10); a state read in an older decision is refused. Default `P7D`.
   */
  readonly feedHorizon?: string;
  /** What the record does not hold of the request (user agent, address), as `--input` supplies the input (section 7.9.6). */
  readonly request?: Pick<RequestInfo, 'userAgent' | 'connection'>;
  readonly log: Logger;
  readonly trace: Span;
  /** Default: a principal with the identity of the recorded actor only. */
  readonly principal?: Principal;
  readonly config?: (module: string) => unknown;
  readonly concurrentUnits?: boolean;
  readonly namespaceOf?: (scope: StorageScope) => NamespaceRef;
}
