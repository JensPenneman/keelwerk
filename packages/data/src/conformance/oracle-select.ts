import type { Condition, EntityDescriptor } from '@keelwerk/core';
import type { OracleDataset } from './oracle-dataset.ts';
import { oracleEvaluate } from './oracle-evaluate.ts';

/** The ids of the live rows of an entity that satisfy a condition, in id order. */
export function oracleSelect(
  entity: EntityDescriptor,
  condition: Condition | undefined,
  dataset: OracleDataset,
): string[] {
  return dataset
    .rows(entity.ref)
    .filter((row) => row.archivedAt === undefined || row.archivedAt === null)
    .filter((row) => condition === undefined || oracleEvaluate(entity, condition, row, dataset))
    .map((row) => String(row.id))
    .sort();
}
