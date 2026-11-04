import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { EntityModel } from './entity-model.ts';
import { probeContext } from './probe-context.ts';
import type { RuleEntry } from './rule-entry.ts';

const systemNames: readonly string[] = ['id', 'createdAt', 'updatedAt', 'archivedAt', 'version'];
const quantifiers: readonly string[] = ['some', 'every', 'none', 'is'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownNames(
  condition: unknown,
  model: EntityModel,
  entities: ReadonlyMap<string, EntityModel>,
): readonly string[] {
  if (!isRecord(condition)) return [];
  const bad: string[] = [];
  for (const [key, value] of Object.entries(condition)) {
    if (key === 'and' || key === 'or') {
      for (const part of Array.isArray(value) ? value : []) {
        bad.push(...unknownNames(part, model, entities));
      }
    } else if (key === 'not') {
      bad.push(...unknownNames(value, model, entities));
    } else if (Object.hasOwn(model.entry.descriptor.relations, key)) {
      const target = entities.get(model.entry.descriptor.relations[key]?.target ?? '');
      for (const quantifier of quantifiers) {
        if (target !== undefined && isRecord(value)) {
          bad.push(...unknownNames(value[quantifier], target, entities));
        }
      }
    } else if (!(Object.hasOwn(model.fields, key) || systemNames.includes(key))) {
      bad.push(key);
    }
  }
  return bad;
}

/**
 * `unknownConditionFields`: a `where` or `check` condition names a field or relation its target
 * does not have (section 8.3). The callbacks are plain functions of the principal context, so the
 * registry runs each once on an inert context and reads the condition it returns; a callback that
 * throws on it is left to run time.
 */
export function checkUnknownConditionFields(
  rules: ReadonlyMap<string, RuleEntry>,
  entities: ReadonlyMap<string, EntityModel>,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const rule of rules.values()) {
    const { subject } = rule;
    if (!('entity' in subject) || subject.entity === undefined) continue;
    const model = entities.get(`${subject.module}.${subject.entity}`);
    if (model === undefined) continue;
    for (const [member, callback] of [
      ['where', rule.where],
      ['check', rule.check],
    ] as const) {
      if (callback === undefined) continue;
      let condition: unknown;
      try {
        condition = callback.call(rule, probeContext());
      } catch {
        continue;
      }
      for (const name of unknownNames(condition, model, entities)) {
        problems.push(
          compositionError(
            'unknownConditionFields',
            `The ${member} of the rule '${rule.id}' names '${name}', which ${model.entry.ref} does not have.`,
            { module: rule.module, ref: rule.id },
          ),
        );
      }
    }
  }
  return problems;
}
