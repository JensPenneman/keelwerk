import { refuseFilterLimit } from '../api-versions/refuse-filter-limit.ts';
import type { StandardResult } from '../fields/standard-schema-v1.ts';
import type { SurfaceEntity } from '../surface/surface-entity.ts';
import { convertFilter } from '../wire/convert-filter.ts';
import { fromWire } from '../wire/from-wire.ts';

/**
 * Decodes the id operands of a filter of `entity` in the object form of section 16.4.4 with the
 * field nodes of the surface (`convertFilter` through `fromWire`): TypeIDs become UUIDs, a bare
 * UUID or another entity's id is refused like in a plain input. Answers the filter with those
 * operands as UUIDs, or every issue, its path starting with `at`. A filter over the bounds of the
 * walk throws its `core.malformed_request`.
 */
export function decodeFilter(
  filter: unknown,
  entity: SurfaceEntity,
  entityOf: (ref: string) => SurfaceEntity | undefined,
  at: readonly (string | number)[] = [],
): StandardResult<unknown> {
  return refuseFilterLimit(() => convertFilter(filter, entity, entityOf, fromWire, at));
}
