import type { RuleSelector } from './rule-selector.ts';

function isTextList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Whether a rule target is a selector: it names `kinds` or `transports` as lists and is no action part (no `spec`, no `kind`). */
export function isRuleSelector(target: unknown): target is RuleSelector {
  if (typeof target !== 'object' || target === null) return false;
  if ('spec' in target || 'kind' in target) return false;
  const kinds = Reflect.get(target, 'kinds');
  const transports = Reflect.get(target, 'transports');
  if (kinds === undefined && transports === undefined) return false;
  return (
    (kinds === undefined || isTextList(kinds)) &&
    (transports === undefined || isTextList(transports))
  );
}
