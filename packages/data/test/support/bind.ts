import type { EntityDescriptor } from '@keelwerk/core';
import { postgresCodecs } from '../../src/sql/postgres/postgres-codecs.ts';
import { systemColumns } from './system-columns.ts';

/** The column and bound value of one field of a row. */
export function bind(entity: EntityDescriptor, name: string, value: unknown): [string, unknown] {
  const field = entity.fields[name];
  if (field !== undefined) return [field.column, postgresCodecs.forField(field).encode(value)];
  const column = systemColumns[name];
  if (column === undefined) throw new Error(`unknown field ${name}`);
  return [column, value instanceof Temporal.Instant ? value.toString() : value];
}
