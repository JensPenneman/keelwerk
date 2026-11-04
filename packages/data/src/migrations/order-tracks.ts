import { parseTrackId } from './parse-track-id.ts';

/** A selected module as the order sees it: its dependencies by module id. */
export interface TrackModule {
  readonly id: string;
  readonly requires: readonly string[];
  readonly optional: readonly string[];
}

/**
 * The order in which tracks run (section 14.6.3): own tracks topologically by `requires` and
 * `optional` (an optional module that is not selected adds no edge), a contribution after the
 * own tracks of its target and its contributor, a conditional part after the own tracks of its
 * contributor's `when` modules; ties break by the tuple order of `modules`, then by track id. A
 * cycle throws. `modules` is in tuple order; `tracks` may list any subset in any order.
 */
export function orderTracks(
  modules: readonly TrackModule[],
  tracks: readonly string[],
): readonly string[] {
  const position = new Map(modules.map((module, index) => [module.id, index]));
  const present = new Set(modules.map((module) => module.id));
  const rank = (track: string): readonly [number, number, string] => {
    const parsed = parseTrackId(track);
    const own = parsed.target === null && parsed.when.length === 0;
    return [own ? 0 : 1, position.get(parsed.module) ?? Number.MAX_SAFE_INTEGER, track];
  };
  const owners = new Map<string, string>();
  for (const track of tracks) {
    const parsed = parseTrackId(track);
    if (parsed.target === null && parsed.when.length === 0) owners.set(parsed.module, track);
  }
  const waitsFor = (track: string): readonly string[] => {
    const parsed = parseTrackId(track);
    const wanted: string[] = [];
    if (parsed.target === null && parsed.when.length === 0) {
      const module = modules.find((candidate) => candidate.id === parsed.module);
      for (const dependency of [...(module?.requires ?? []), ...(module?.optional ?? [])]) {
        if (present.has(dependency)) wanted.push(dependency);
      }
    } else {
      wanted.push(parsed.module);
      if (parsed.target !== null) wanted.push(parsed.target);
      wanted.push(...parsed.when);
    }
    return wanted.flatMap((module) => {
      const owner = owners.get(module);
      return owner === undefined || owner === track ? [] : [owner];
    });
  };
  const waiting = new Map(tracks.map((track) => [track, new Set(waitsFor(track))]));
  const compare = (a: string, b: string): number => {
    const [ak, ap, at] = rank(a);
    const [bk, bp, bt] = rank(b);
    return ak - bk || ap - bp || (at < bt ? -1 : at > bt ? 1 : 0);
  };
  const ordered: string[] = [];
  while (waiting.size > 0) {
    const ready = [...waiting.entries()]
      .filter(([, needs]) => needs.size === 0)
      .map(([track]) => track)
      .sort(compare);
    const next = ready[0];
    if (next === undefined) {
      throw new TypeError(`the tracks ${[...waiting.keys()].join(', ')} wait for each other`);
    }
    ordered.push(next);
    waiting.delete(next);
    for (const needs of waiting.values()) needs.delete(next);
  }
  return ordered;
}
