import { describe, expectTypeOf, test } from 'vitest';
import { field } from '../fields/field.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { Where } from './where.ts';

describe('Where', () => {
  const fields = {
    email: field.string().personal().unique(),
    nickname: field.string().personal({ queries: ['prefix'] }),
    born: field.date().personal({ queries: ['eq', 'order'] }),
    name: field.string(),
    secretNote: field.string().personal(),
  };
  type Row = ShapeValue<typeof fields, 'm', 'stored'>;

  test('personal fields offer only the operators of their capabilities', () => {
    const ok: Where<Row, typeof fields> = {
      email: { eq: 'a@b.c', in: ['a@b.c'] },
      nickname: { startsWith: 'je' },
      born: { gte: Temporal.PlainDate.from('2000-01-01') },
      name: { contains: 'x', lt: 'z' },
      secretNote: { isNull: true },
      or: [{ email: 'a@b.c' }, { name: null }],
    };
    expectTypeOf(ok).toExtend<Where<Row, typeof fields>>();
    // @ts-expect-error a unique personal field has no prefix capability
    const prefix: Where<Row, typeof fields> = { email: { startsWith: 'a' } };
    // @ts-expect-error a prefix-only field has no equality, also as a bare value
    const bare: Where<Row, typeof fields> = { nickname: 'jens' };
    // @ts-expect-error a prefix-only field has no equality operator
    const eq: Where<Row, typeof fields> = { nickname: { eq: 'jens' } };
    // @ts-expect-error without order, no range operator
    const range: Where<Row, typeof fields> = { email: { gt: 'a' } };
    // @ts-expect-error a personal field without capabilities supports isNull only
    const none: Where<Row, typeof fields> = { secretNote: { eq: 'x' } };
    // @ts-expect-error a bare value needs eq, also on a field with no capabilities
    const bareNone: Where<Row, typeof fields> = { secretNote: 'x' };
    expectTypeOf([prefix, bare, eq, range, none, bareNone]).not.toBeAny();
  });

  test('a number field that only declares order takes no bare value', () => {
    const numbers = { rank: field.integer().personal({ queries: ['order'] }) };
    type Ranked = ShapeValue<typeof numbers, 'm', 'stored'>;
    // @ts-expect-error order is not equality
    const bare: Where<Ranked, typeof numbers> = { rank: 5 };
    const range: Where<Ranked, typeof numbers> = { rank: { gt: 5 } };
    expectTypeOf([bare, range]).not.toBeAny();
  });

  test('without the fields every operator is offered', () => {
    const loose: Where<Row> = { email: { startsWith: 'a', gt: 'b' }, nickname: 'jens' };
    expectTypeOf(loose).toExtend<Where<Row>>();
  });
});

describe('Where relation quantifiers', () => {
  const fields = { name: field.string(), teamId: field.string() };
  type Row = ShapeValue<typeof fields, 'm', 'stored'>;
  interface Member {
    readonly userId: string;
    readonly active: boolean;
  }
  interface Rels {
    readonly members: readonly Member[];
    readonly owner: Member;
  }

  test('some, none and every (to-many) and is (to-one) take a condition on the related rows', () => {
    const ok: Where<Row, typeof fields, Rels> = {
      name: 'x',
      members: { some: { userId: 'u1', active: true }, none: { active: false } },
      owner: { is: { userId: 'u2' } },
      or: [{ members: { every: { active: true } } }, { owner: { is: { active: true } } }],
    };
    expectTypeOf(ok).toExtend<Where<Row, typeof fields, Rels>>();
    // @ts-expect-error a quantifier's condition names the related row's fields
    const wrong: Where<Row, typeof fields, Rels> = { members: { some: { nope: 1 } } };
    // @ts-expect-error only the four quantifiers exist
    const other: Where<Row, typeof fields, Rels> = { members: { any: {} } };
    // @ts-expect-error `is` belongs to to-one relations
    const isOnMany: Where<Row, typeof fields, Rels> = { members: { is: {} } };
    // @ts-expect-error `some` belongs to to-many relations
    const someOnOne: Where<Row, typeof fields, Rels> = { owner: { some: {} } };
    expectTypeOf([wrong, other, isOnMany, someOnOne]).not.toBeAny();
  });

  test('without relations nothing else is accepted', () => {
    // @ts-expect-error a relation that does not exist
    const none: Where<Row, typeof fields> = { members: { some: {} } };
    expectTypeOf(none).not.toBeAny();
  });
});
