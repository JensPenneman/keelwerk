import { personalInputField } from '../effects/personal-input-field.ts';
import type { ActionEntry } from './action-entry.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { ScheduleEntry } from './schedule-entry.ts';

/**
 * `personalScheduleInput` (9.5.6, 14.7.5): a schedule's input is built from the tick and the scope
 * level alone, so it is the same for every tenant; a personal member there would name a fixed id
 * that is no real subject, and sealing it would create a data key for that id in every tenant.
 * A schedule that invokes a command with a personal input member is refused at compose.
 */
export function checkPersonalScheduleInput(
  schedules: ReadonlyMap<string, ScheduleEntry>,
  actions: ReadonlyMap<string, ActionEntry>,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const schedule of schedules.values()) {
    const action = actions.get(schedule.invoke);
    const personal = action === undefined ? undefined : personalInputField(action.input);
    if (personal === undefined) continue;
    problems.push(
      compositionError(
        'personalScheduleInput',
        `The schedule '${schedule.ref}' invokes '${schedule.invoke}', which takes the personal member '${personal}': a schedule's input is the same for every tenant and names no subject.`,
        { module: schedule.module, ref: schedule.ref },
      ),
    );
  }
  return problems;
}
