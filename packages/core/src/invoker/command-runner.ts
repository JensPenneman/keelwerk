import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ComputePool } from '../kernel/compute-pool.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { CommandReceipt } from './command-receipt.ts';
import type { Invocation } from './invocation.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { RequestInfo } from './request-info.ts';
import type { ScopeTarget } from './scope-target.ts';

/** What the execute stage hands the command write path (the seam WP-38 fills). */
export interface CommandRun {
  readonly action: ActionEntry;
  /** The validated input. */
  readonly input: unknown;
  readonly invocation: Invocation<unknown>;
  readonly session: InvocationSession;
  /** The unit's scope, namespace and placement. */
  readonly target: ScopeTarget;
  /** Aborts on the action's timeout only: a client disconnect never reaches a command (section 16.4.11). */
  readonly signal: AbortSignal;
  /** The registry of the app the action belongs to. */
  readonly registry: Registry;
  /** The invocation's flag snapshot (20.3); absent: declared defaults. */
  readonly flags?: FlagSnapshot | undefined;
  /** The registry's enabled rules, normalised. */
  readonly rules: readonly NormalizedRule[];
  readonly request: RequestInfo;
  /** A module's configuration for the backend, defaults filled (section 3.4); `undefined` for a module without one. */
  readonly config?: (module: string) => unknown;
  readonly clock: Clock;
  readonly keys: KeyService;
  readonly compute: ComputePool;
  readonly log: Logger;
  readonly span: Span;
  /** The build that appends the events. */
  readonly build: { readonly id: string; readonly revision: number };
  /** The scope's epoch, part of every state token (section 15.2.6); default 0. */
  readonly epoch?: number;
  /** Whether a second unit can be open beside the command's (the adapter's capabilities say so). */
  readonly concurrentUnits?: boolean;
  /** The namespace of another scope's data, for a backend read. */
  readonly namespaceOf?: (scope: StorageScope) => NamespaceRef;
}

/** What a command answered. */
export interface CommandResult {
  readonly output: unknown;
  readonly receipt?: CommandReceipt;
  /** Ids of the deferred effects (section 7.9.5). */
  readonly effects?: readonly string[];
  readonly replayed?: true;
  /**
   * On the replay of an entity command: the reference its receipt kept. The shape stage answers it
   * when the caller may not read the row or the row is gone, so a replay shows a caller no more than
   * the first answer did (section 15.1.7).
   */
  readonly replayRef?: { readonly entity: string; readonly id: string; readonly version: number };
  /** The `rcpt_` id of the receipt of an accepted command (section 15.1.7). */
  readonly receiptId?: string;
}

/** Runs one command below the pipeline; an error is thrown and the invoker maps it. */
export type CommandRunner = (run: CommandRun) => Promise<CommandResult>;
