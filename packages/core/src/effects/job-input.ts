import type { ActorRef } from '../principals/actor-ref.ts';
import type { Principal } from '../principals/principal.ts';
import type { Scope } from '../storage/scope.ts';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import { checkServiceCaller } from './check-service-caller.ts';
import { principalRefOf } from './principal-ref-of.ts';

/** The lane cap of a queue the kernel upserts; the runtime's queue limits replace it (WP-36). */
const laneCap = 4;

/** What the common members of a job row are built from. */
export interface JobInputOptions {
  readonly scope: Scope;
  /** Who the job acts as: stored as a reference and resolved again when it runs (section 7.4). */
  readonly principal: Principal;
  /** Who caused the job (the command's principal, or the actor of the event a reaction decided on); the principal's own when absent. */
  readonly actor?: ActorRef;
  /** The command and event that caused the job. */
  readonly causation: {
    readonly commandId?: string;
    readonly eventId?: string;
  };
  /** The module whose code builds the job (section 7.7): the service principal of a module is not handed to another module's code for that module's own action. */
  readonly caller: string;
  /** The command the job runs, when it runs one; absent for a job that runs an executor or a reaction. */
  readonly action?: { readonly module: string; readonly ref: string };
  /** The enqueuer's build (section 19.2). */
  readonly build: { readonly id: string; readonly revision: number };
  /** The API version the input is expressed in (external callers). */
  readonly apiVersion?: string;
  readonly now: Temporal.Instant;
}

/**
 * The members every job the write path enqueues shares (F-12): the scope, the principal reference,
 * the causation with the actor, the enqueuer's build, the API version and the creation time. The
 * queue, the `run` and the options of the job come from the caller.
 */
export function jobInput(
  options: JobInputOptions,
): Pick<
  StoredJobSpec,
  'laneCap' | 'createdAt' | 'scope' | 'principal' | 'causation' | 'build' | 'apiVersion'
> {
  const { principal } = options;
  if (options.action !== undefined) checkServiceCaller(principal, options.action, options.caller);
  const ref = principalRefOf(principal);
  return {
    laneCap,
    createdAt: options.now,
    scope: options.scope,
    principal: ref,
    causation: {
      ...options.causation,
      actor: options.actor ?? { kind: principal.kind, id: ref.principalId, via: principal.via },
    },
    build: options.build,
    ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
  };
}
