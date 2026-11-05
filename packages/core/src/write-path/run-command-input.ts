import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { HybridClock } from '../clock/hybrid-clock.ts';
import type { RequestInfo } from '../invoker/request-info.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ComputePool } from '../kernel/compute-pool.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { Principal } from '../principals/principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Scope } from '../storage/scope.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { EntityBehaviours } from './entity-behaviours.ts';

/** What `runCommand` needs to run one command. The invoker has authorized the call and validated `input` by now. */
export interface RunCommandInput {
  readonly registry: Registry;
  readonly adapter: DataAdapter;
  /** The namespace of the scope's data. */
  readonly namespace: NamespaceRef;
  readonly scope: Scope;
  /** The command, a module command or an entity command (generated commands are WP-47's). */
  readonly action: ActionEntry;
  /** The validated input; instance commands carry `id` and an optional `ifVersion`. */
  readonly input: unknown;
  /** What the receipt's fingerprint covers when it is not `input`: the client's own input, for a command whose `input` holds values sealed on the way in (S-109). */
  readonly fingerprintInput?: unknown;
  /** Set by the runtime's control path only: it alone may run `core.backend.create` and `core.tenant.create` (S-109). */
  readonly controlPath?: boolean;
  /** Set by the control path when it saw a live receipt and skipped its checks: the command must replay, never run. If the receipt turns out to be gone (it expired before the claim), the unit rolls back with a retryable `core.command_in_progress` and the retry takes the full path (S-111). */
  readonly replayOnly?: boolean;
  readonly principal: Principal;
  readonly request: RequestInfo;
  readonly clock: Clock;
  readonly keys: KeyService;
  readonly compute: ComputePool;
  readonly log: Logger;
  readonly trace: Span;
  readonly rules: readonly NormalizedRule[];
  /** The API version the outcome is expressed in; the fingerprint covers it. */
  readonly apiVersion: string;
  /** The build that appends the events (section 19.1). */
  readonly build: { readonly id: string; readonly revision: number };
  /** The `evolve`, invariant and defaults of the entities. */
  readonly behaviours: EntityBehaviours;
  /** The client's id for the command, or one is minted. */
  readonly commandId?: string;
  /** Offline-authored mutations (M6). */
  readonly client?: { readonly id: string; readonly seq: number };
  /** The writer part of the events' clock readings (`s` and ten base32 characters, 14.5.3); default: a fixed placeholder until the clock package names one. */
  readonly nodeId?: string;
  /** The process clock the events' readings come from (14.5.3); default: a fresh clock for the attempt, which only orders that command's own events. The runtime passes one. */
  readonly hybridClock?: HybridClock;
  readonly traceparent?: string;
  /** Default: the request id. */
  readonly correlationId?: string;
  /** The scope's epoch, part of every state token (section 15.2.6); default 0. */
  readonly epoch?: number;
  /** Aborts on the action's timeout: the unit rolls back and `runCommand` rejects with the reason. */
  readonly signal?: AbortSignal;
  /** Whether a second unit can be open beside this one (see `RunReadInput.concurrentUnits`). */
  readonly concurrentUnits?: boolean;
  /** The namespace of another scope's data, for a backend read; default: `namespace`. */
  readonly namespaceOf?: (scope: StorageScope) => NamespaceRef;
  /** A module's configuration (section 3.4); default: none. */
  readonly config?: (module: string) => unknown;
  /** Replaces the answerer of a kind (the seam of later packages). */
  readonly replace?: Partial<RequestAnswerer>;
  /** How the retries wait and draw their jitter; default: the clock and `Math.random`. */
  readonly retry?: {
    readonly sleep?: (ms: number) => Promise<void>;
    readonly random?: () => number;
  };
}
