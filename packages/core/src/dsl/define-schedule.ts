import type { ActionPart, Execution, PartTypes } from '../model/action-part.ts';
import type { PartSource } from '../model/part-source.ts';

type AnyCommand = ActionPart<'command', unknown, string | null, Execution, PartTypes>;

/** One firing of a schedule, handed to its pure `input` function. */
export interface ScheduleTick {
  readonly at: Temporal.Instant;
  readonly scope: 'backend' | 'tenant';
}

/** The literal of a schedule: it enqueues `invoke` every `every` under the module's service principal (section 9.5.6). */
export interface ScheduleSpec<A extends AnyCommand> {
  /** A duration such as '5m' or '1d'. */
  readonly every: string;
  readonly invoke: A;
  readonly input?: (tick: ScheduleTick) => NonNullable<A['~types']>['input'];
  readonly scope?: 'backend' | 'each-tenant';
  /** A duration such as '30s'. */
  readonly jitter?: string;
}

/** A schedule part: data, mounted as `schedules.<name>`. */
export interface SchedulePart<S, A extends AnyCommand> {
  readonly kind: 'schedule';
  readonly source: S;
  readonly spec: ScheduleSpec<A>;
}

/** Declares the schedule of an own action (typed declaration in M1; the worker that fires it is not, S-24). */
export function defineSchedule<const S extends PartSource, const A extends AnyCommand>(
  source: S,
  spec: ScheduleSpec<A>,
): SchedulePart<S, A> {
  return { kind: 'schedule', source, spec };
}
