import type { AppSelection } from './app-selection.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

interface ExecutorView {
  readonly effect: unknown;
  readonly options: { readonly inline?: boolean; readonly capability?: unknown };
}

/**
 * `executorsWithoutEffect`: an executor is mounted under a key with no effect of that name, or for
 * another effect (section 7.9.5). An inline executor with a capability is refused with it (7.9.6).
 */
export function checkExecutorsWithoutEffect(
  selection: AppSelection,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const module of selection.byId.values()) {
    for (const [key, part] of Object.entries(module.executors)) {
      const executor = part as ExecutorView;
      const ref = `${module.id}.${key}`;
      if (module.effects[key] !== executor.effect) {
        problems.push(
          compositionError(
            'executorsWithoutEffect',
            `The executor '${ref}' is not the executor of the effect mounted under '${key}'.`,
            { module: module.id, ref },
          ),
        );
      }
      if (executor.options.inline === true && executor.options.capability !== undefined) {
        problems.push(
          compositionError(
            'inlineExecutorCapabilities',
            `The inline executor '${ref}' declares a capability; only queued executors have one.`,
            { module: module.id, ref },
          ),
        );
      }
    }
  }
  return problems;
}
