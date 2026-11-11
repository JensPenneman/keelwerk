import { durationMs } from '../effects/duration-ms.ts';
import { acceptedScopeLevels } from '../invoker/stages/accepted-scope-levels.ts';
import type { ActionEntry } from './action-entry.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { resolvePartReference } from './resolve-part-references.ts';
import type { RuntimeModule } from './runtime-module.ts';
import type { ScheduleEntry } from './schedule-entry.ts';

interface ScheduleSpecView {
  readonly every: string;
  readonly invoke: unknown;
  readonly input?: ScheduleEntry['input'];
  readonly scope?: ScheduleEntry['scope'];
  readonly jitter?: string;
}

/** What is wrong with a schedule's `every` and `jitter`, if anything: both parse, `every` is above zero and the jitter is below it. */
function durationProblem(spec: ScheduleSpecView): string | undefined {
  try {
    const every = durationMs(spec.every);
    if (every <= 0) return `runs every "${spec.every}", which is not above zero`;
    if (spec.jitter !== undefined && durationMs(spec.jitter) >= every) {
      return `has a jitter "${spec.jitter}" that is not below its interval "${spec.every}"`;
    }
    return undefined;
  } catch {
    return `has an interval "${spec.every}" or a jitter "${spec.jitter ?? ''}" that is no duration`;
  }
}

/** The schedules and the problems met resolving what they invoke. */
export interface ScheduleTable {
  readonly schedules: ReadonlyMap<string, ScheduleEntry>;
  readonly problems: readonly CompositionProblem[];
}

/**
 * The schedules of the modules by reference. What a schedule invokes must be an own command the
 * app mounts: an unmounted part (`unresolvedPartReferences`) or a missing, non-command or foreign
 * reference (`unknownScheduleActions`) is refused. The command must also be reachable at the level
 * the schedule ticks at (`mismatchedScheduleScopes`: a backend schedule needs a backend or invocation
 * command, an each-tenant one a tenant or invocation command: a backend command would run once per
 * tenant in the backend unit), and `every` and `jitter` must
 * be durations with the jitter below `every` (`invalidScheduleDurations`).
 */
export function buildScheduleEntries(
  ordered: readonly RuntimeModule[],
  actions: ReadonlyMap<string, ActionEntry>,
): ScheduleTable {
  const schedules = new Map<string, ScheduleEntry>();
  const problems: CompositionProblem[] = [];
  for (const module of ordered) {
    for (const [name, part] of Object.entries(module.schedules)) {
      const ref = `${module.id}.${name}`;
      const spec = Reflect.get(part, 'spec') as ScheduleSpecView;
      const invoke = resolvePartReference(spec.invoke);
      if (invoke === undefined) {
        problems.push(
          compositionError(
            'unresolvedPartReferences',
            `The schedule '${ref}' invokes a part no module mounts.`,
            {
              module: module.id,
              ref,
            },
          ),
        );
        continue;
      }
      const action = actions.get(invoke);
      if (action?.kind !== 'command' || action.module !== module.id) {
        problems.push(
          compositionError(
            'unknownScheduleActions',
            `The schedule '${ref}' invokes '${invoke}', which is not a command of its own module ${module.id}.`,
            {
              module: module.id,
              ref,
            },
          ),
        );
        continue;
      }
      const scope = spec.scope ?? 'backend';
      const level = scope === 'backend' ? 'backend' : 'tenant';
      if (!acceptedScopeLevels[action.scope].includes(level)) {
        problems.push(
          compositionError(
            'mismatchedScheduleScopes',
            `The schedule '${ref}' ticks at the ${level} level and '${invoke}' runs at the ${action.scope} level.`,
            { module: module.id, ref },
          ),
        );
        continue;
      }
      if (scope === 'each-tenant' && action.scope === 'backend') {
        problems.push(
          compositionError(
            'mismatchedScheduleScopes',
            `The schedule '${ref}' ticks in each tenant and '${invoke}' is a backend command: it would run once per tenant in the backend unit as the module's service principal. Use a tenant or invocation command.`,
            { module: module.id, ref },
          ),
        );
        continue;
      }
      const durations = durationProblem(spec);
      if (durations !== undefined) {
        problems.push(
          compositionError('invalidScheduleDurations', `The schedule '${ref}' ${durations}.`, {
            module: module.id,
            ref,
          }),
        );
        continue;
      }
      schedules.set(ref, {
        ref,
        module: module.id,
        name,
        every: spec.every,
        invoke,
        scope,
        ...(spec.jitter === undefined ? {} : { jitter: spec.jitter }),
        ...(spec.input === undefined ? {} : { input: spec.input }),
      });
    }
  }
  return { schedules, problems };
}
