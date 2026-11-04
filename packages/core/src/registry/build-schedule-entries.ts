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

/** The schedules and the problems met resolving what they invoke. */
export interface ScheduleTable {
  readonly schedules: ReadonlyMap<string, ScheduleEntry>;
  readonly problems: readonly CompositionProblem[];
}

/**
 * The schedules of the modules by reference. What a schedule invokes must be an own command the
 * app mounts: an unmounted part (`unresolvedPartReferences`) or a missing or non-command reference
 * (`unknownScheduleActions`) is refused.
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
      if (actions.get(invoke)?.kind !== 'command') {
        problems.push(
          compositionError(
            'unknownScheduleActions',
            `The schedule '${ref}' invokes '${invoke}', which is not a command of the app.`,
            {
              module: module.id,
              ref,
            },
          ),
        );
        continue;
      }
      schedules.set(ref, {
        ref,
        module: module.id,
        name,
        every: spec.every,
        invoke,
        scope: spec.scope ?? 'backend',
        ...(spec.jitter === undefined ? {} : { jitter: spec.jitter }),
        ...(spec.input === undefined ? {} : { input: spec.input }),
      });
    }
  }
  return { schedules, problems };
}
