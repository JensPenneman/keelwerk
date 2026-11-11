import type { StorageRow } from '../storage/storage-row.ts';

/**
 * What a plan selected at an earlier position (15.2.6 steps 2 to 5), for the streams asked about:
 * `rows` holds the ones it selected, each as it was then (an archived row too). `uncertain`: the
 * evidence did not suffice, and a subscriber that needs the answer must reset to `resync`.
 */
export interface LiveEarlier {
  readonly rows: ReadonlyMap<string, StorageRow>;
  readonly uncertain: boolean;
}
