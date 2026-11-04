import type { CompositionProblem } from '../registry/composition-problem.ts';
import type { Registry } from '../registry/registry.ts';
import type { RuleEntry } from '../registry/rule-entry.ts';
import { expandActionAliases } from './expand-action-aliases.ts';
import { readActionNames } from './read-action-names.ts';

const aliasNames: ReadonlySet<string> = new Set(['*', 'read', 'write', 'set']);
/**
 * The problems of a rule that arrives after `defineRule` could check it (a rule of the app's
 * `policies.add` or `replace`, a runtime rule source), as named composition problems:
 * `denyWithoutReason` (decision 5), `unknownRuleActions` (decision 105: a custom action name its
 * target does not mount) and `nonMaskableRuleField` (a read rule lists a field that is not
 * maskable, section 8.1).
 */
export function ruleProblems(
  rule: RuleEntry,
  registry: Pick<Registry, 'actions' | 'entities'>,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  const problem = (code: string, message: string): void => {
    problems.push({ code, severity: 'error', message, module: rule.module, ref: rule.id });
  };
  if (rule.effect === 'deny' && (rule.reason === undefined || rule.reason.trim() === '')) {
    problem('denyWithoutReason', `The deny rule "${rule.id}" carries no reason.`);
  }
  const { subject } = rule;
  const entityRef =
    'module' in subject && subject.entity !== undefined
      ? `${subject.module}.${subject.entity}`
      : undefined;
  const entity = entityRef === undefined ? undefined : registry.entities.get(entityRef);
  if ('module' in subject) {
    const unknown = rule.actions.filter((name) => {
      if (aliasNames.has(name)) return false;
      const ref = entityRef === undefined ? `${subject.module}.${name}` : `${entityRef}.${name}`;
      return !registry.actions.has(ref) && !registry.actions.has(name);
    });
    if (unknown.length > 0) {
      problem(
        'unknownRuleActions',
        `The rule "${rule.id}" names ${unknown.map((name) => `"${name}"`).join(', ')}, which ${entityRef ?? subject.module} does not mount.`,
      );
    }
  }
  if (rule.fields !== undefined && rule.fields.length > 0 && entity !== undefined) {
    const expanded = expandActionAliases(rule.actions);
    const reads =
      expanded.all ||
      expanded.reads ||
      [...expanded.names].some((name) => readActionNames.has(name));
    if (reads) {
      const bad = rule.fields.filter((name) => entity.descriptor.fields[name]?.maskable !== true);
      if (bad.length > 0) {
        problem(
          'nonMaskableRuleField',
          `The read rule "${rule.id}" lists ${bad.map((name) => `"${name}"`).join(', ')}, which ${entity.ref} does not declare maskable.`,
        );
      }
    }
  }
  return problems;
}
