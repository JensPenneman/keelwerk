import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { RowQuery } from '../storage/row-query.ts';
import { personalOperatorError } from './personal-operator-error.ts';

/** A sort on a personal field needs the `order` capability, which arrives with M5 (14.7.9.4). */
export function checkSortable(entity: EntityDescriptor, sort: RowQuery['sort']): void {
  for (const { field } of sort ?? []) {
    const declared = Object.hasOwn(entity.fields, field) ? entity.fields[field] : undefined;
    if (declared !== undefined && declared.personal !== false) {
      throw personalOperatorError(
        entity.ref,
        field,
        'sort',
        'order needs the order capability, which arrives with M5',
      );
    }
  }
}
