import type { AnyEntity } from './define-entity.ts';

/** The output shape of entity rows: a page or one row, masked for the caller. */
export interface EntityOutputSpec<Form extends 'page' | 'row', En> {
  readonly kind: 'entityOutput';
  readonly form: Form;
  readonly entity: En;
}

/** `output: pageOf(entity)`: a page of rows, cursor pagination (section 4.3). */
export function pageOf<const En extends AnyEntity>(entity: En): EntityOutputSpec<'page', En> {
  return { kind: 'entityOutput', form: 'page', entity };
}
