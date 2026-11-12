import type { LiveSource } from '../model/live-source.ts';
import type { LivePokesSource } from './live-pokes-source.ts';
import type { Poke } from './poke.ts';

/** What `live.pokes` returns from its source: `{ kind: 'liveSource', source: { kind: 'pokes' } }`. */
export function pokesSourceOf(): LiveSource<Poke> {
  const source: LivePokesSource = { kind: 'pokes' };
  return { kind: 'liveSource', source };
}
