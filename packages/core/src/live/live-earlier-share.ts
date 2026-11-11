/**
 * What the plan groups of one pass share when they ask a view for earlier state: the streams already
 * rebuilt at that position. Make one per pass with `createLiveEarlierShare` and hand it to every
 * `earlier` call of the pass, which runs in one unit: a share is never kept across units.
 */
export interface LiveEarlierShare {
  readonly kind: 'liveEarlierShare';
}
