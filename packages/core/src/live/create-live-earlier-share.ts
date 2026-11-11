import type { LiveEarlierShare } from './live-earlier-share.ts';

/** A fresh share for the `earlier` calls of one pass. */
export function createLiveEarlierShare(): LiveEarlierShare {
  return Object.freeze({ kind: 'liveEarlierShare' });
}
