import type { SerialStore } from '@keelwerk/core';
import { canonicalizeJson } from '@keelwerk/core';
import { malformedQuery } from './malformed-query.ts';
import { takeSerial } from './postgres/serial-statements.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

function plain(value: unknown): unknown {
  // An integer is the same partition whether it arrives as a number or a bigint.
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Temporal.Instant || value instanceof Temporal.PlainDate) {
    return value.toString();
  }
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64url');
  if (value instanceof Set) return [...value].map(plain).sort();
  if (Array.isArray(value)) return value.map(plain);
  return value;
}

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
            partition: canonicalizeJson(partition.map(plain)),
          },
          count,
        ),
      );
    },
  };
}
