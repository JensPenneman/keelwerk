import type { LiveSource } from '../model/live-source.ts';
import type { Gen } from '../protocol/gen.ts';

/** Maps the items of a live source, keeping stream tokens and control frames; `undefined` drops an item. */
export function mapItems<T, const U>(
  source: LiveSource<T>,
  map: (item: T) => U | undefined | Gen<U | undefined>,
): LiveSource<U> {
  return { kind: 'liveSource', source, map };
}
