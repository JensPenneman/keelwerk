import type { EntityDescriptor } from '@keelwerk/core';
import type { ConditionContext } from '../../src/sql/compile-condition.ts';
import { entityTable } from '../../src/sql/entity-table.ts';
import { postgresCodecs } from '../../src/sql/postgres/postgres-codecs.ts';
import { quantifierSql } from '../../src/sql/postgres/quantifier-sql.ts';
import { entities } from './entities.ts';

export function contextFor(entity: EntityDescriptor): ConditionContext {
  return {
    root: 'app',
    table: entityTable(entity, 'app', 't'),
    entities: (ref) => entities.get(ref),
    dialect: { codecs: postgresCodecs, quantifier: quantifierSql },
  };
}
