import type { AnyEntity } from './define-entity.ts';
import type { EntityOutputSpec } from './page-of.ts';

/** `output: rowOf(entity)`: one row, masked for the caller (section 4.3). */
export function rowOf<const En extends AnyEntity>(entity: En): EntityOutputSpec<'row', En> {
  return { kind: 'entityOutput', form: 'row', entity };
}
