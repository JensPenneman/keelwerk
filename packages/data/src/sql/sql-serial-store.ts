import type { SerialStore } from '@keelwerk/core';
import { malformedQuery } from './malformed-query.ts';
import { takeSerial } from './postgres/serial-statements.ts';
import { serialPartition } from './serial-partition.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * The counters of `field.serial({ per })` (15.1.4): one row per entity, field and partition of the
 * unit's scope, starting at 1. The row lock is held until the unit ends, so values grow in commit
 * order within a partition and a rolled-back unit gives its values back.
 */
export function sqlSerialStore(ctx: SqlUnitContext): SerialStore {
  return {
    next: async (entity, field, partition, count = 1) => {
      ctx.writable();
      if (entity.fields[field]?.kind !== 'serial') {
        throw malformedQuery(`${entity.ref}.${field} is not a serial field`);
      }
      if (!Number.isInteger(count) || count < 1) {
        throw malformedQuery('count must be a positive integer');
      }
      return sqlGuard(async () =>
        takeSerial(
          ctx.scopedDb([entity]),
          {
            table: ctx.table('kw_serials'),
            entity: entity.ref,
            field,
            partition: serialPartition(partition),
          },
          count,
        ),
      );
    },
  };
}
