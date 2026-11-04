import type { NormalizedRule } from '../authorization/normalized-rule.ts';
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
  readonly keys: KeyService;
  readonly compute: ComputePool;
  readonly log: Logger;
  readonly trace: Span;
  /** Default: a principal with the identity of the recorded actor only. */
  readonly principal?: Principal;
  readonly config?: (module: string) => unknown;
  readonly concurrentUnits?: boolean;
  readonly namespaceOf?: (scope: StorageScope) => NamespaceRef;
}
