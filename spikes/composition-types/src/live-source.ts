/** A resume position of a subscription (section 15.2.6). */
export type StateToken = string;

/** A live source description, run by the live module (section 15.4.11). */
export interface LiveSource<T> {
  readonly kind: 'liveSource';
  readonly '~item'?: T;
}
