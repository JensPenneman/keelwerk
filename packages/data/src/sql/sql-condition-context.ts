import type { EntityDescriptor } from '@keelwerk/core';
import type { ConditionContext } from './compile-condition.ts';
import { entityTable } from './entity-table.ts';
import { postgresCodecs } from './postgres/postgres-codecs.ts';
import { quantifierSql } from './postgres/quantifier-sql.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** The condition context of one entity in the unit's namespace, under the alias `t`. */
export function sqlConditionContext(
  ctx: SqlUnitContext,
  entity: EntityDescriptor,
): ConditionContext {
  return {
    root: ctx.namespace.root,
    table: entityTable(entity, ctx.namespace.root, 't'),
    entities: (ref) => (ref === entity.ref ? entity : ctx.entities.find(ref)),
    dialect: { codecs: postgresCodecs, quantifier: quantifierSql },
  };
}
