/** The fields that are not hidden: hidden fields are never written through an app's action inputs. */
export type NonHidden<F> = {
  [K in keyof F as F[K] extends { readonly flags: { readonly hidden: true } } ? never : K]: F[K];
};
