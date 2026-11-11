import type { StandardResult } from '../fields/standard-schema-v1.ts';
import type { SurfaceEntity } from '../surface/surface-entity.ts';
import { convertFilter } from './convert-filter.ts';
import { FilterLimitError } from './filter-limit-error.ts';
import { toWire } from './to-wire.ts';

/**
 * The wire form of a filter an in-process caller holds, the inverse of the decoding the transports
 * do (section 16.4.2): the same walk as `decodeFilter`, with `toWire` of the field node on every
 * id operand, so UUIDs become TypeIDs (a set of references may be a `Set` or an array). Answers the
 * filter, or an issue for every operand that does not fit its field, and one at the level that
 * went over for a filter over the bounds of the walk (`mapFilter`).
 */
export function encodeFilter(
  filter: unknown,
  entity: SurfaceEntity,
  entityOf: (ref: string) => SurfaceEntity | undefined,
): StandardResult<unknown> {
  try {
    return convertFilter(filter, entity, entityOf, (node, value) => {
      try {
        return { value: toWire(node, value) };
      } catch (failure) {
        return {
          issues: [{ message: failure instanceof Error ? failure.message : String(failure) }],
        };
      }
    });
  } catch (failure) {
    if (failure instanceof FilterLimitError) {
      return { issues: [{ path: failure.path, message: failure.reason }] };
    }
    throw failure;
  }
}
