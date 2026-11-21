import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { HybridClock } from '../clock/hybrid-clock.ts';
import type { EgressPolicy } from '../executors/egress-policy.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import type { JobCarrier } from '../invoker/job-carrier.ts';
import type { RequestInfo } from '../invoker/request-info.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ComputePool } from '../kernel/compute-pool.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { Principal } from '../principals/principal.ts';
import type { QuotaLimits } from '../quotas/quota-limits.ts';
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
  /**
   * Set by the control path only: applied to `fingerprintInput ?? input` before both digests of the
   * command, never to the 0.1.0 form of the fingerprint.
   */
  readonly fingerprintMask?: (input: unknown) => unknown;
  /** Set by the runtime's control path only: it alone may run `core.backend.create` and `core.tenant.create` (S-109). */
  readonly controlPath?: boolean;
  /** Set from `CommandRun.quotaChecked` (the runtime's routing checked `core.quota.set`); it opens no other command and a nested command carries none. */
  readonly quotaChecked?: boolean;
  /** Set by the control path when it saw a live receipt and skipped its checks, and by the admission of a command with `prepare` (`admitPrepare`) when it found a finished one: the command must replay, never run, and a `perform` of its `prepare` starts no effect. If the receipt turns out to be gone (it expired before the claim, or before a `perform` had to start), the run is refused with a retryable `core.command_in_progress` and the retry takes the full path (S-111). */
  readonly replayOnly?: boolean;
  readonly principal: Principal;
  readonly request: RequestInfo;
  readonly clock: Clock;
  readonly keys: KeyService;
  /**
   * The job key secret of the scope (`jobKeyInfo`), derived before the unit opens (`runCommand`
   * sets it): the timer and enqueue effects take it from here, never from `keys` inside the unit,
   * where the derivation could open a second unit. Absent outside a write (a dry run), where the
   * effects derive it.
   */
  readonly jobKeySecret?: Uint8Array;
  /** The key of the keyed fingerprint, derived before the unit opens like `jobKeySecret`. */
  readonly fingerprintKey?: Uint8Array;
  /**
   * The key that seals state tokens (`stateTokenKey`), derived before the unit opens like
   * `jobKeySecret`. A nested run is always in the same scope and inherits it.
   */
  readonly stateSealKey?: Uint8Array;
  readonly compute: ComputePool;
  readonly log: Logger;
  readonly trace: Span;
  readonly rules: readonly NormalizedRule[];
  /** The invocation's flag snapshot; absent: declared defaults. */
  readonly flags?: FlagSnapshot | undefined;
  /** The API version the outcome is expressed in; the fingerprint covers it. */
  readonly apiVersion: string;
  /** The build that appends the events (section 19.1). */
  readonly build: { readonly id: string; readonly revision: number };
  /** The `evolve`, invariant and defaults of the entities. */
  readonly behaviours: EntityBehaviours;
  /** Set when a worker runs the command of a job: the receipt is taken over and the job completes in the command's unit. */
  readonly job?: JobCarrier;
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
  /** The id of the command that caused this one, when the caller is not a command of the same write path (a control command run for an operator's); default: none. */
  readonly causationId?: string;
  /** The scope's epoch, part of every state token (section 15.2.6); default 0. */
  readonly epoch?: number;
  /** New at every start of a development runtime, absent otherwise: the cache of a process state is bound to it, so an edit of the code `evolve` calls never meets a state folded by the old code. */
  readonly bootNonce?: string;
  /** The epoch of the scope a token names, which may differ from the command's (a read into the backend's data); default: `epoch`. */
  readonly epochOf?: (scope: Scope) => number;
  /** Aborts on the action's timeout: the unit rolls back and `runCommand` rejects with the reason. */
  readonly signal?: AbortSignal;
  /** Whether a second unit can be open beside this one (see `RunReadInput.concurrentUnits`). */
  readonly concurrentUnits?: boolean;
  /** The namespace of another scope's data, for a backend read; default: `namespace`. */
  readonly namespaceOf?: (scope: StorageScope) => NamespaceRef;
  /** The outbound policy of the inline executors (12.3); absent: no special-purpose address is allowlisted. */
  readonly egress?: EgressPolicy;
  /** A module's configuration (section 3.4); default: none. */
  readonly config?: (module: string) => unknown;
  /** Replaces the answerer of a kind (the seam of later packages). */
  readonly replace?: Partial<RequestAnswerer>;
  /** How the retries wait and draw their jitter; default: the clock and `Math.random`. */
  readonly retry?: {
    readonly sleep?: (ms: number) => Promise<void>;
    readonly random?: () => number;
  };
  /** The resolved quota limits (12.2); absent: writes are counted, never refused. */
  readonly quotas?: QuotaLimits;
}
