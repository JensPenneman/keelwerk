import type { Condition } from '@keelwerk/core';
import type { Arbitrary } from 'fast-check';
import { array, boolean, constantFrom, oneof } from 'fast-check';
import { conformanceValues } from './conformance-values.ts';

interface FieldSpec {
  readonly field: string;
  readonly ops: readonly string[];
  readonly values: readonly unknown[];
  /** What `contains` looks for: a needle for strings, an element for collections. */
  readonly needles?: readonly unknown[];
}

const ordered = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'isNull'];
const textual = [...ordered, 'contains', 'startsWith'];
const pool = (name: string): readonly unknown[] => conformanceValues[name] ?? [];

/** The operators each kind takes (14.3.4): the restricted kinds take only what the table lists. */
const probeFields: readonly FieldSpec[] = [
  { field: 'label', ops: textual, values: pool('label'), needles: pool('needle') },
  { field: 'note', ops: textual, values: pool('note'), needles: pool('needle') },
  { field: 'n', ops: ordered, values: [...pool('n'), 4, -2] },
  { field: 'price', ops: ordered, values: [...pool('price'), '0.5', '2', '-1.5', '10.250'] },
  { field: 'ratio', ops: ordered, values: pool('ratio') },
  { field: 'flag', ops: ['eq', 'ne', 'isNull'], values: pool('flag') },
  { field: 'at', ops: ordered, values: pool('at') },
  { field: 'day', ops: ordered, values: pool('day') },
  { field: 'mood', ops: ['eq', 'ne', 'in', 'nin', 'isNull'], values: pool('mood') },
  { field: 'tags', ops: ['contains', 'isNull'], values: [], needles: pool('tag') },
  { field: 'scores', ops: ['contains', 'isNull'], values: [], needles: pool('score') },
  { field: 'raw', ops: ['eq', 'ne', 'isNull'], values: pool('raw') },
  { field: 'payload', ops: ['isNull'], values: [] },
  { field: 'ownerId', ops: ['isNull'], values: [] },
];

const ownerFields: readonly FieldSpec[] = [
  { field: 'name', ops: textual, values: pool('label'), needles: pool('needle') },
  { field: 'rank', ops: ordered, values: pool('rank') },
];

function leaf(spec: FieldSpec): Arbitrary<Condition> {
  const { field } = spec;
  const value = (): Arbitrary<unknown> => constantFrom(...spec.values);
  const needle = (): Arbitrary<unknown> => constantFrom(...(spec.needles ?? spec.values));
  return constantFrom(...spec.ops).chain((op): Arbitrary<Condition> => {
    switch (op) {
      case 'isNull':
        return boolean().map((flag) => ({ op: 'isNull', field, value: flag }));
      case 'in':
      case 'nin':
        return array(value(), { maxLength: 3 }).map(
          (list) => ({ op, field, value: list }) as Condition,
        );
      case 'contains':
      case 'startsWith':
        return needle().map((operand) => ({ op, field, value: operand }) as Condition);
      default:
        return value().map((operand) => ({ op, field, value: operand }) as Condition);
    }
  });
}

function combined(inner: Arbitrary<Condition>): Arbitrary<Condition> {
  return oneof(
    inner,
    array(inner, { minLength: 1, maxLength: 3 }).map(
      (conditions): Condition => ({ op: 'and', conditions }),
    ),
    array(inner, { minLength: 1, maxLength: 3 }).map(
      (conditions): Condition => ({ op: 'or', conditions }),
    ),
    inner.map((condition): Condition => ({ op: 'not', condition })),
  );
}

function ofFields(specs: readonly FieldSpec[], depth: number): Arbitrary<Condition> {
  const leaves = oneof(...specs.map(leaf));
  let current: Arbitrary<Condition> = leaves;
  for (let level = 0; level < depth; level++) current = combined(current);
  return current;
}

/**
 * Conditions over `conf.probe` (`'probe'`) or `conf.owner` (`'owner'`): every operator each kind
 * takes with values from the same pools the rows are drawn from, nested to `depth` levels of
 * `and`, `or` and `not`. A probe condition may test its owner with `is`; an owner condition may
 * quantify its probes with `some`, `none` and `every`, each over a quantifier-free probe condition.
 */
export function randomConditions(entity: 'probe' | 'owner', depth = 2): Arbitrary<Condition> {
  if (entity === 'probe') {
    const owner = ofFields(ownerFields, 1);
    const quantified = owner.map((where): Condition => ({ op: 'is', relation: 'owner', where }));
    return combined(oneof(ofFields(probeFields, depth), quantified));
  }
  const probes = ofFields(probeFields, 1);
  const quantified = constantFrom('some', 'none', 'every').chain((op) =>
    probes.map((where): Condition => ({ op, relation: 'probes', where }) as Condition),
  );
  return combined(oneof(ofFields(ownerFields, depth), quantified));
}
