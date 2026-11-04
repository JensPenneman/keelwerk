/** The union of every action reference of an app. */
export type ActionRef<P> = P extends { readonly '~types'?: infer T }
  ? NonNullable<T> extends { readonly actions: infer R }
    ? R
    : never
  : never;
