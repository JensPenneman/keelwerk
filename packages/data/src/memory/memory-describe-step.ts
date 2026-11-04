import type { MigrationStep } from '@keelwerk/core';

/** A step in words, for `keelwerk db plan`: the in-memory adapter has no SQL to render. */
export function memoryDescribeStep(step: MigrationStep): string {
  switch (step.op) {
    case 'createTable':
      return `create table ${step.table.name} for ${step.entity}`;
    case 'dropTable':
      return `drop the table of ${step.entity}`;
    case 'addColumn':
      return `add column ${step.column.name} to ${step.entity}`;
    case 'dropColumn':
      return `drop column ${step.field} of ${step.entity}`;
    case 'alterColumn':
      return `alter column ${step.field} of ${step.entity}`;
    case 'copyColumn':
      return `copy ${step.from} to ${step.to} in ${step.entity}`;
    case 'createIndex':
      return `create index ${step.index.name} on ${step.entity}`;
    case 'dropIndex':
      return `drop index ${step.index.name} on ${step.entity}`;
    case 'addForeignKey':
      return `add foreign key ${step.key.name} to ${step.entity}`;
    case 'dropForeignKey':
      return `drop foreign key ${step.key.name} of ${step.entity}`;
    case 'enableMergeState':
      return `enable merge state of ${step.entity}`;
    case 'rebuild':
      return `rebuild ${step.entity}: ${step.reason}`;
    case 'sql':
      return 'raw SQL (not available in memory)';
  }
}
