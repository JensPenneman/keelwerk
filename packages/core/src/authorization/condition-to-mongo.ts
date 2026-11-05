import type { Condition } from '../conditions/condition.ts';
import type { FieldKind } from '../storage/field-kind.ts';
import { isAlways } from './is-always.ts';

type Mongo = Readonly<Record<string, unknown>>;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function allOf(parts: readonly (Mongo | undefined)[]): Mongo[] | undefined {
  const done: Mongo[] = [];
  for (const part of parts) {
    if (part === undefined) return undefined;
    done.push(part);
  }
  return done;
}

/** A relation quantifier node of a condition. */
export type RelationNode = Extract<Condition, { readonly relation: string }>;

/** The ids of the rows of the rule's entity that meet a relation quantifier; `undefined` when that set is unbounded. */
export type RelationReach = (node: RelationNode) => readonly string[] | undefined;

/** The kind of a field of the rule's entity; `undefined` when it is unknown or a path through a relation. */
export type FieldKindOf = (field: string) => FieldKind | undefined;

/**
 * The mongo-style form of a condition for CASL's matcher (section 8.7). A relation quantifier
 * becomes `id in <ids>` when `reach` answers it, and only in a positive position: under `not` it
 * is left to the server. `contains` is a membership test on a list or set field and a pattern on a
 * string field with a string operand; every other use is left to the server. `undefined` means the condition cannot be
 * written without data the client lacks, so the rule is exported `serverOnly`.
 */
export function conditionToMongo(
  condition: Condition,
  reach: RelationReach | undefined,
  kindOf: FieldKindOf | undefined = undefined,
): Mongo | undefined {
  switch (condition.op) {
    case 'eq':
      return { [condition.field]: condition.value };
    case 'ne':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
    case 'in':
    case 'nin':
      return { [condition.field]: { [`$${condition.op}`]: condition.value } };
    case 'contains': {
      const kind = kindOf?.(condition.field);
      if (kind === 'list' || kind === 'set') return { [condition.field]: condition.value };
      if ((kind === 'string' || kind === 'text') && typeof condition.value === 'string') {
        return { [condition.field]: { $regex: escaped(condition.value) } };
      }
      return undefined;
    }
    case 'startsWith':
      return typeof condition.value === 'string'
        ? { [condition.field]: { $regex: `^${escaped(condition.value)}` } }
        : undefined;
    case 'isNull':
      return { [condition.field]: condition.value ? null : { $ne: null } };
    case 'and': {
      if (isAlways(condition)) return {};
      const parts = allOf(condition.conditions.map((one) => conditionToMongo(one, reach, kindOf)));
      return parts === undefined ? undefined : { $and: parts };
    }
    case 'or': {
      const parts = allOf(condition.conditions.map((one) => conditionToMongo(one, reach, kindOf)));
      return parts === undefined ? undefined : { $or: parts };
    }
    case 'not': {
      // A quantifier under `not` flips from "at least these ids" to "not these ids": never resolved here.
      const inner = conditionToMongo(condition.condition, undefined, kindOf);
      return inner === undefined ? undefined : { $nor: [inner] };
    }
    case 'never':
      return { $nor: [{}] };
    case 'some':
    case 'none':
    case 'every':
    case 'is': {
      const ids = reach?.(condition);
      return ids === undefined ? undefined : { id: { $in: [...ids] } };
    }
  }
}
