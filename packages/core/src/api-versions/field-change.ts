/** One field change of a version change, its entity resolved to '<module>.<entity>' (section 18.2). */
export type FieldChange =
  | {
      readonly kind: 'renamed';
      readonly entity: string;
      readonly field: string;
      readonly was: string;
    }
  | { readonly kind: 'added'; readonly entity: string; readonly field: string }
  | { readonly kind: 'removed'; readonly entity: string; readonly field: string };
