import type { FieldValue } from '../fields/shape-value.ts';
import type { RowView } from './row-view.ts';

type IsHidden<Fd> = Fd extends { readonly flags: { readonly hidden: true } } ? true : false;
type IsVisible<Fd, View extends RowView> = View extends 'own'
  ? true
  : IsHidden<Fd> extends true
    ? false
    : true;
type IsOptionalAt<Fd, View extends RowView> = Fd extends {
  readonly flags: { readonly optional: true };
}
  ? true
  : View extends 'readable'
    ? Fd extends { readonly flags: { readonly maskable: true } }
      ? true
      : false
    : false;

/** The row type of a set of fields in one view. */
export type RowOf<F, Owner extends string, View extends RowView> = {
  readonly [K in keyof F as IsVisible<F[K], View> extends true
    ? IsOptionalAt<F[K], View> extends true
      ? never
      : K
    : never]: FieldValue<F[K], Owner, 'stored'>;
} & {
  readonly [K in keyof F as IsVisible<F[K], View> extends true
    ? IsOptionalAt<F[K], View> extends true
      ? K
      : never
    : never]?: FieldValue<F[K], Owner, 'stored'> | undefined;
};

/** Fields that may be absent (conditional and contributed fields seen from outside their part). */
export type PartialRowOf<F, Owner extends string, View extends RowView> = {
  readonly [K in keyof F as IsVisible<F[K], View> extends true ? K : never]?:
    | FieldValue<F[K], Owner, 'stored'>
    | undefined;
};
