import { physicalTableName } from '@keelwerk/core';

/** The physical table of an entity reference such as `accounts.profile` (S-59). */
export function tableOfEntity(entity: string): string {
  const dot = entity.indexOf('.');
  if (dot < 0) throw new TypeError(`${entity} is not an entity reference`);
  return physicalTableName(entity.slice(0, dot), entity.slice(dot + 1));
}
