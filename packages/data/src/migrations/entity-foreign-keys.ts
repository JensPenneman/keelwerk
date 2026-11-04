import type { EntityDescriptor, ForeignKeySpec } from '@keelwerk/core';
import { physicalTableName } from '@keelwerk/core';

/** A foreign key and the field whose column it constrains. */
export interface OwnedForeignKey {
  readonly spec: ForeignKeySpec;
  readonly field: string;
}

/**
 * The composite foreign keys of an entity's hard references (section 14.4.3): the scope column
 * and the reference column towards the target's scope column and `id`.
 */
export function entityForeignKeys(
  descriptor: EntityDescriptor,
  scopeColumn: string | null,
): readonly OwnedForeignKey[] {
  const lead = scopeColumn === null ? [] : [scopeColumn];
  const keys: OwnedForeignKey[] = [];
  for (const [name, field] of Object.entries(descriptor.fields)) {
    if (field.ref === null || !field.ref.foreignKey) continue;
    const dot = field.ref.entity.indexOf('.');
    keys.push({
      field: name,
      spec: {
        name: physicalTableName(descriptor.module, descriptor.name, {
          suffix: `${field.column}_fk`,
        }),
        columns: [...lead, field.column],
        references: {
          table: physicalTableName(field.ref.entity.slice(0, dot), field.ref.entity.slice(dot + 1)),
          columns: [...lead, 'id'],
        },
      },
    });
  }
  return keys;
}
