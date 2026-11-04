/** A pure function a module offers its dependants, bound to the provider's context (section 5.5). */
export interface Service<S, A extends readonly unknown[], R> {
  readonly kind: 'service';
  readonly source: S;
  readonly fn: object;
  readonly '~call'?: (...args: A) => R;
}
