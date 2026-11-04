import type { DraftMatcher } from './draft-matcher.ts';
import type { EntityRef } from './entity-ref.ts';

/** A `create` draft: `values` include the `id` when the handler names one. */
export function created(
  entity: EntityRef,
  values: Readonly<Record<string, unknown>>,
): DraftMatcher {
  const { id, ...rest } = values;
  return {
    kind: 'create',
    prefix: entity.prefix,
    values: rest,
    ...(typeof id === 'string' ? { id } : {}),
  };
}
