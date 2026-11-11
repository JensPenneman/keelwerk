import type { Condition } from '../conditions/condition.ts';
import { normalizeWireFilter } from '../conditions/normalize-wire-filter.ts';
import type {
  StandardIssue,
  StandardResult,
  StandardSchemaV1,
} from '../fields/standard-schema-v1.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { FlagTargeting } from './flag-targeting.ts';
import { plainJsonProblem } from './plain-json-problem.ts';
import { targetingAttributeNames } from './targeting-attribute-names.ts';

const ruleIdFormat = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const uuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const mostRules = 100;
const mostListed = 1_000;
const mostShares = 20;
const mostCanonicalChars = 65_536;
const mostDocumentChars = 1_048_576;
const totalWeight = 10_000;

type Path = readonly PropertyKey[];
type Issues = StandardIssue[];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownMembers(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: Path,
  issues: Issues,
): void {
  for (const name of Object.keys(value)) {
    if (!allowed.includes(name))
      issues.push({ message: 'is not a member of this document', path: [...path, name] });
  }
}

function checkVariant(value: unknown, path: Path, issues: Issues): string | undefined {
  if (!isRecord(value)) {
    issues.push({ message: 'expected an object with a value', path });
    return undefined;
  }
  if (!Object.hasOwn(value, 'value')) {
    issues.push({ message: 'needs a value', path: [...path, 'value'] });
    return undefined;
  }
  const served: unknown = value.value;
  const problem = plainJsonProblem(served, 0, false);
  if (problem !== undefined) {
    issues.push({ message: `The value ${problem}.`, path: [...path, 'value'] });
    return undefined;
  }
  if (typeof served === 'object' && canonicalizeJson(served).length > mostCanonicalChars) {
    issues.push({
      message: `The value is longer than ${mostCanonicalChars} characters.`,
      path: [...path, 'value'],
    });
    return undefined;
  }
  const variant: unknown = value.variant;
  if (variant === undefined) {
    if (typeof served === 'object') {
      issues.push({
        message: 'An object or array value needs a variant name.',
        path: [...path, 'variant'],
      });
      return undefined;
    }
    return String(served);
  }
  if (
    typeof variant !== 'string' ||
    variant.length < 1 ||
    variant.length > 200 ||
    !variant.isWellFormed() ||
    variant.includes('\u0000')
  ) {
    issues.push({
      message: 'A variant is a text of 1 to 200 characters.',
      path: [...path, 'variant'],
    });
    return undefined;
  }
  return variant;
}

function checkServe(value: unknown, path: Path, issues: Issues): void {
  if (!isRecord(value)) {
    issues.push({ message: 'expected an object', path });
    return;
  }
  if (!Object.hasOwn(value, 'split')) {
    unknownMembers(value, ['value', 'variant'], path, issues);
    checkVariant(value, path, issues);
    return;
  }
  unknownMembers(value, ['split', 'salt'], path, issues);
  const salt: unknown = value.salt;
  if (
    salt !== undefined &&
    (typeof salt !== 'string' ||
      salt.length < 1 ||
      salt.length > 200 ||
      !salt.isWellFormed() ||
      salt.includes('\u0000'))
  ) {
    issues.push({ message: 'A salt is a text of 1 to 200 characters.', path: [...path, 'salt'] });
  }
  const shares: unknown = value.split;
  if (!Array.isArray(shares) || shares.length < 1 || shares.length > mostShares) {
    issues.push({ message: `A split has 1 to ${mostShares} shares.`, path: [...path, 'split'] });
    return;
  }
  let sum = 0;
  let weighed = true;
  const seen = new Set<string>();
  shares.forEach((share: unknown, index) => {
    const where = [...path, 'split', index];
    if (isRecord(share)) unknownMembers(share, ['value', 'variant', 'weight'], where, issues);
    const variant = checkVariant(share, where, issues);
    if (variant !== undefined) {
      if (seen.has(variant))
        issues.push({
          message: `The variant "${variant}" is listed twice in one split.`,
          path: where,
        });
      seen.add(variant);
    }
    const weight = isRecord(share) ? share.weight : undefined;
    if (
      typeof weight !== 'number' ||
      !Number.isInteger(weight) ||
      weight < 0 ||
      weight > totalWeight
    ) {
      issues.push({
        message: `A weight is an integer from 0 to ${totalWeight} (basis points).`,
        path: [...where, 'weight'],
      });
      weighed = false;
    } else {
      sum += weight;
    }
  });
  if (weighed && sum !== totalWeight) {
    issues.push({
      message: `The weights of a split sum to ${totalWeight}, not ${sum}.`,
      path: [...path, 'split'],
    });
  }
}

function checkIdList(
  value: unknown,
  path: Path,
  issues: Issues,
  valid: (id: string) => boolean,
  expectation: string,
): void {
  if (!Array.isArray(value) || value.length > mostListed) {
    issues.push({ message: `expected a list of at most ${mostListed} ids`, path });
    return;
  }
  value.forEach((id: unknown, index) => {
    if (typeof id !== 'string' || !valid(id)) {
      issues.push({ message: expectation, path: [...path, index] });
    }
  });
}

/** Normalises a rule's `when` and names why it cannot be a targeting condition, or undefined. */
function conditionProblem(when: unknown): string | undefined {
  let condition: Condition;
  try {
    condition = normalizeWireFilter(when);
  } catch (error) {
    return error instanceof Error ? error.message : 'is not a condition';
  }
  const visit = (node: Condition): string | undefined => {
    switch (node.op) {
      case 'never':
        return undefined;
      case 'and':
      case 'or':
        return node.conditions.map(visit).find((problem) => problem !== undefined);
      case 'not':
        return visit(node.condition);
      case 'some':
      case 'none':
      case 'every':
      case 'is':
        return 'A rule condition cannot follow a relation.';
      default:
        return targetingAttributeNames.includes(node.field)
          ? undefined
          : `The attribute "${node.field}" is not set by the kernel; a rule reads ${targetingAttributeNames.join(' and ')} only.`;
    }
  };
  return visit(condition);
}

function whenProblem(when: unknown): string | undefined {
  if (!isRecord(when)) return 'must be a condition object';
  const plain = plainJsonProblem(when, 0, false);
  if (plain !== undefined) return `The condition ${plain}.`;
  if (canonicalizeJson(when).length > mostCanonicalChars) {
    return `The condition is longer than ${mostCanonicalChars} characters.`;
  }
  return conditionProblem(when);
}

function checkRule(rule: unknown, path: Path, ids: Set<string>, issues: Issues): void {
  if (!isRecord(rule)) {
    issues.push({ message: 'expected an object', path });
    return;
  }
  unknownMembers(rule, ['id', 'tenants', 'principals', 'when', 'serve'], path, issues);
  const id: unknown = rule.id;
  if (typeof id !== 'string' || !ruleIdFormat.test(id)) {
    issues.push({
      message: 'A rule id matches /^[a-z0-9][a-z0-9_-]{0,63}$/.',
      path: [...path, 'id'],
    });
  } else if (ids.has(id)) {
    issues.push({ message: `The rule id "${id}" is used twice.`, path: [...path, 'id'] });
  } else {
    ids.add(id);
  }
  const criteria = ['tenants', 'principals', 'when'].filter((name) => rule[name] !== undefined);
  if (criteria.length === 0) {
    issues.push({ message: 'A rule names at least one of tenants, principals and when.', path });
  }
  if (rule.tenants !== undefined) {
    checkIdList(
      rule.tenants,
      [...path, 'tenants'],
      issues,
      (value) => uuidFormat.test(value),
      'A tenant id is a lower-case uuid.',
    );
  }
  if (rule.principals !== undefined) {
    checkIdList(
      rule.principals,
      [...path, 'principals'],
      issues,
      (value) =>
        value.length >= 1 &&
        value.length <= 200 &&
        value.isWellFormed() &&
        !value.includes('\u0000'),
      'A principal id is a text of 1 to 200 characters.',
    );
  }
  if (rule.when !== undefined) {
    const problem = whenProblem(rule.when);
    if (problem !== undefined) issues.push({ message: problem, path: [...path, 'when'] });
  }
  checkServe(rule.serve, [...path, 'serve'], issues);
}

function validate(value: unknown): StandardResult<FlagTargeting> {
  const issues: Issues = [];
  if (!isRecord(value)) return { issues: [{ message: 'expected an object of flag targeting' }] };
  unknownMembers(value, ['enabled', 'rules', 'fallthrough'], [], issues);
  if (typeof value.enabled !== 'boolean')
    issues.push({ message: 'enabled is true or false', path: ['enabled'] });
  const rules: unknown = value.rules;
  if (!Array.isArray(rules) || rules.length > mostRules) {
    issues.push({ message: `rules is a list of at most ${mostRules} rules`, path: ['rules'] });
  } else {
    const ids = new Set<string>();
    for (const [index, rule] of (rules as unknown[]).entries()) {
      checkRule(rule, ['rules', index], ids, issues);
    }
  }
  checkServe(value.fallthrough, ['fallthrough'], issues);
  if (issues.length === 0 && canonicalizeJson(value).length > mostDocumentChars) {
    issues.push({ message: `The targeting is longer than ${mostDocumentChars} characters.` });
  }
  return issues.length > 0 ? { issues } : { value: value as unknown as FlagTargeting };
}

const standard = {
  version: 1 as const,
  vendor: 'keelwerk',
  validate,
  /** Standard JSON Schema, so the surface can describe the field (section 16.2.3). */
  jsonSchema: { input: () => ({ type: 'object' }), output: () => ({ type: 'object' }) },
};

/**
 * Structural check of FlagTargeting, without the flag's declaration (that half is
 * `checkFlagValues`). Answers the value unchanged, so a re-check of a stored value passes.
 */
export const flagTargetingSchema: StandardSchemaV1<FlagTargeting, FlagTargeting> = {
  '~standard': standard,
};
