import type { ShapeValue } from '../fields/shape-value.ts';

/** The insert shape of a set of fields: optional and defaulted fields may be omitted; serial fields are allocated by the kernel. */
export type InsertOf<F, Owner extends string = string> = ShapeValue<
  { readonly [K in keyof F as F[K] extends { readonly kind: 'serial' } ? never : K]: F[K] },
  Owner,
  'draft'
>;
