/** A hybrid logical clock reading, in its sortable string form. */
export type Hlc = string & { readonly __hlc: true };
