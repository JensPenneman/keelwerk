import type { ApiSurface, Artifact, TransportAdapter } from '@keelwerk/core';

/** What a transport finds in one surface: its check problems, and its artefacts when there are none. */
interface Projection {
  readonly problems: ReturnType<TransportAdapter['check']>;
  readonly artifacts: readonly Artifact[];
}

const projections = new WeakMap<ApiSurface, Map<TransportAdapter, Projection>>();

/**
 * What `transport` derives from `surface`: `check` first, and `artifacts` only when the check is
 * clean. Derived once per surface object, so the producers of one run that read the same surface
 * (the transport documents and the type fragments of the head) share the work.
 */
export function projectSurface(transport: TransportAdapter, surface: ApiSurface): Projection {
  let mine = projections.get(surface);
  if (mine === undefined) {
    mine = new Map();
    projections.set(surface, mine);
  }
  const known = mine.get(transport);
  if (known !== undefined) return known;
  const problems = transport.check(surface);
  const projection = {
    problems,
    artifacts: problems.length > 0 ? [] : transport.artifacts(surface),
  };
  mine.set(transport, projection);
  return projection;
}
