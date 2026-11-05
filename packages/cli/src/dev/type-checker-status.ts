/** What the type checker last reported: nothing yet, running, or a count of errors. */
export type TypeCheckerStatus =
  | { readonly kind: 'off' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'done'; readonly errors: number };
