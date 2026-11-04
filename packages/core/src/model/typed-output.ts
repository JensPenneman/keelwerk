/**
 * `output: typedOutput<T>()`: an action whose result is a document of type `T` rather than a
 * shape or an entity row (the core's `introspect`, `composition` and `capabilities`). The type is
 * phantom; the surface describes the result as an open object.
 */
export interface TypedOutput<T> {
  readonly kind: 'typedOutput';
  readonly '~output'?: T;
}
