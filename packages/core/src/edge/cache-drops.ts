import type { PrincipalResolution } from './principal-resolution.ts';

/** The rows whose change drops a cached resolution: one `{ entity, id }`, or the list of `drops`. */
export function cacheDrops(
  cache: NonNullable<PrincipalResolution['cache']>,
): readonly { readonly entity: string; readonly id: string }[] {
  return 'drops' in cache ? cache.drops : [{ entity: cache.entity, id: cache.id }];
}
