import type { Condition } from '@keelwerk/core';
import type { Arbitrary } from 'fast-check';
import { array, boolean, constantFrom, oneof } from 'fast-check';
import { encryptedQueryPools } from './encrypted-query-pools.ts';

const { values, needles } = encryptedQueryPools;
const pick = (name: string): Arbitrary<unknown> => constantFrom(...(values[name] ?? []));
const equalityFields = ['exactName', 'nfcName', 'caselessName', 'mail', 'age', 'label'] as const;

function equality(): Arbitrary<Condition> {
  return constantFrom(...equalityFields).chain((field): Arbitrary<Condition> => {
    const value = pick(field);
    return oneof(
      value.map((operand): Condition => ({ op: 'eq', field, value: operand })),
      value.map((operand): Condition => ({ op: 'ne', field, value: operand })),
      array(value, { maxLength: 3 }).map((list): Condition => ({ op: 'in', field, value: list })),
      array(value, { maxLength: 3 }).map((list): Condition => ({ op: 'nin', field, value: list })),
      boolean().map((flag): Condition => ({ op: 'isNull', field, value: flag })),
    );
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

/** Equality-family conditions nested to two levels, `not` included: every capability the M1 adapters answer exactly. */
const exactConditions = combined(combined(equality()));

/** A prefix on `mail` joins only positive positions (`and`, `or`): under `not` it is refused. */
const prefixLeaf: Arbitrary<Condition> = constantFrom(...needles).map(
  (value): Condition => ({ op: 'startsWith', field: 'mail', value }),
);
const prefixConditions: Arbitrary<Condition> = oneof(
  prefixLeaf,
  array(oneof(prefixLeaf, exactConditions), { minLength: 1, maxLength: 3 }).map(
    (conditions): Condition => ({ op: 'and', conditions }),
  ),
  array(oneof(prefixLeaf, exactConditions), { minLength: 1, maxLength: 3 }).map(
    (conditions): Condition => ({ op: 'or', conditions }),
  ),
);

/** The conditions the cases draw from. */
export const randomPersonConditions: {
  /** Equality-family conditions nested to two levels, `not` included: every capability the M1 adapters answer exactly. */
  readonly exact: Arbitrary<Condition>;
  /** A prefix on `mail` beside them in positive positions only (`and`, `or`); under `not` it is refused. */
  readonly prefixed: Arbitrary<Condition>;
} = { exact: exactConditions, prefixed: prefixConditions };
