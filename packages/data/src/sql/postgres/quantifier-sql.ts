import { KeelwerkError } from '@keelwerk/core';
import type { Expression } from 'kysely';
import { expressionBuilder, sql } from 'kysely';
import type { QuantifierCompiler, QuantifierRequest } from '../compile-condition.ts';
import type { SqlDb } from '../sql-db.ts';

function link(step: QuantifierRequest['steps'][number]): Expression<boolean> {
  // `by` names the field on the related rows, `to` the field it matches here (RelationKeys, 6.3).
  const by = step.target.column(step.relation.by);
  const to = step.owner.column(step.relation.to);
  if (by === undefined || to === undefined) {
    throw new KeelwerkError({
      kind: 'validation',
      code: 'core.malformed_request',
      message: `the relation keys ${step.relation.by} and ${step.relation.to} do not name fields of the related entities`,
    });
  }
  return sql<boolean>`${sql.ref(step.target.reference(by.column))} = ${sql.ref(step.owner.reference(to.column))}`;
}

/**
 * The relation quantifiers of section 14.3.4 as correlated subqueries, one per hop of the path:
 * `some` and `is` are `EXISTS`, `none` is `NOT EXISTS`, and `every` is `NOT EXISTS` of the rows
 * that fail the `where`, so it holds for an empty relation. Related rows that are archived do not
 * count. Every subquery selects from a scoped table and the scoping plugin adds the scope
 * predicate to each of them (section 14.4.3).
 */
export const quantifierSql: QuantifierCompiler = (request) => {
  const negated = request.op === 'every';
  const where = request.predicate;
  // Subqueries come from a builder without plugins: the scoping plugin transforms the whole
  // statement once, and a plugin-bound builder would scope each subquery a second time.
  const builder = expressionBuilder<SqlDb, never>();
  let inner: Expression<boolean> = negated
    ? where.nullable
      ? sql<boolean>`not coalesce(${where.expression}, false)`
      : sql<boolean>`not (${where.expression})`
    : where.nullable
      ? sql<boolean>`coalesce(${where.expression}, false)`
      : where.expression;
  for (const step of request.steps.toReversed()) {
    const subquery = builder
      .selectFrom(step.target.from)
      .select(sql.lit(1).as('one'))
      .where(link(step))
      .where(sql<boolean>`${sql.ref(step.target.reference('archived_at'))} is null`)
      .where(inner);
    inner = sql<boolean>`exists ${subquery}`;
  }
  return request.op === 'none' || negated ? sql<boolean>`not ${inner}` : inner;
};
