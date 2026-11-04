/** A live source description, run by the live module (section 15.4.11); `source` and `map` are set by `mapItems`. */
export interface LiveSource<T> {
  readonly kind: 'liveSource';
  readonly source?: unknown;
  readonly map?: unknown;
  readonly '~item'?: T;
}
