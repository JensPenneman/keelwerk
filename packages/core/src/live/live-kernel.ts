import type { StateToken } from '../events/state-token.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { Logger } from '../observability/logger.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { Unit } from '../storage/unit.ts';
import type { LiveView } from './live-view.ts';
import type { WatchInput } from './watch-input.ts';

/** Kernel access for one entity in one session's scope; only the live hub uses it (15.4.3, 15.4.9). */
export interface LiveKernel {
  /** 'loans.loan'. */
  readonly entity: string;
  readonly descriptor: EntityDescriptor;
  /** The tenant's or the backend's id: what the change feed's wake-ups name (15.2.5). */
  readonly scopeId: string;
  /**
   * The tenant (a backend session: the backend) the subscribing session belongs to. A backend entity
   * is read once for all its tenants, but a tenant's subscriptions are counted and fail under its own
   * audience, never under another's.
   */
  readonly audience: string;
  /** Where the entity's data lives: a backend entity of a tenant session reads the backend's. */
  readonly target: ScopeTarget;
  /** A logger bound to the backend and tenant; the hub logs ids and counts only. */
  readonly log: Logger;
  /**
   * Whether a stream type is the state stream of a process (`isProcessStream`): the events of such a
   * stream are the process's own record and reach no subscriber of the hub.
   */
  isProcessStream(streamType: string): boolean;
  /** A read-only unit of the target with the kernel's authority (personal values opened). */
  read<T>(
    fn: (unit: Unit) => Promise<T>,
    options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
  ): Promise<T>;
  /**
   * The view of `session` over `input`: `internal` for a session this invoker did not make or one of
   * another scope or app; a malformed input is `validation`, a filter through a relation
   * `unsupported`, a filter on a field the caller cannot see `forbidden`.
   */
  view(session: InvocationSession, input: WatchInput<unknown>): Promise<LiveView>;
  /**
   * Builds the view of the kernel's own session over `input` (parse, flags, plan, selection) and,
   * when `resume` is given, checks the token's form and scope. The invoker calls it before it reports
   * the decision of a subscription, so every refusal of the input is a refusal of the setup. The
   * kernel keeps the view: the next `view` of the same session and the same input object answers it
   * once, then forgets it.
   */
  prepare(input: WatchInput<unknown>, resume: StateToken | undefined): Promise<LiveView>;
}
