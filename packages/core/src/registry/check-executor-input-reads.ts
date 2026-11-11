import { effectDataSubject } from '../effects/effect-data-subject.ts';
import type { AnyField } from '../fields/field-def.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { EffectEntry } from './effect-entry.ts';
import type { ExecutorEntry } from './executor-entry.ts';

/** An input whose every member reads as undefined and whose reads are recorded. */
function recordingInput(reads: Set<string>): object {
  return new Proxy(
    {},
    {
      get: (_target, name) => {
        if (typeof name === 'string') reads.add(name);
        return undefined;
      },
    },
  );
}

function probe(
  option: (context: { config: unknown; input: unknown }) => unknown,
): ReadonlySet<string> {
  const reads = new Set<string>();
  try {
    option({ config: {}, input: recordingInput(reads) });
  } catch {
    // The probe feeds the option nothing real: a throw after its reads says nothing about them.
  }
  return reads;
}

/**
 * `executorReadsPersonal` (error, lead 6): probes the `group` and the `capabilityOf` of each
 * executor with a recording input (every member undefined) and an empty config, swallowing what
 * they throw; a read of a member the effect declares personal is a problem, because the lane an
 * effect job waits in must not depend on a value that is sealed in its record. A member read only
 * under a condition the probe does not meet is refused at enqueue instead (`executorOptionInput`).
 */
export function checkExecutorInputReads(
  effects: ReadonlyMap<string, EffectEntry>,
  executors: ReadonlyMap<string, ExecutorEntry>,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const executor of executors.values()) {
    const effect = effects.get(executor.effect);
    if (effect === undefined) continue;
    const { fields } = effect.input as { readonly fields?: Readonly<Record<string, AnyField>> };
    const options: [string, (context: { config: unknown; input: unknown }) => unknown][] = [];
    if (executor.group !== undefined)
      options.push(['group', (context) => executor.group?.(context)]);
    if (executor.capabilityOf !== undefined) {
      options.push(['capabilityOf', (context) => executor.capabilityOf?.(context)]);
    }
    for (const [name, option] of options) {
      for (const read of probe(option)) {
        const field = Object.hasOwn(fields ?? {}, read) ? fields?.[read] : undefined;
        if (field === undefined || effectDataSubject(effect, field) === undefined) continue;
        problems.push(
          compositionError(
            'executorReadsPersonal',
            `The ${name} of the executor ${executor.ref} reads the personal input member "${read}". A lane must not depend on a sealed value: derive it from a member that is not personal.`,
            { module: executor.module, ref: executor.ref },
          ),
        );
      }
    }
  }
  return problems;
}
