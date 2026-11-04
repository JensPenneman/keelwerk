import type { EntityRef } from './entity-ref.ts';
import type { RequestMatcher } from './request-matcher.ts';

/** The request `ctx.newId(entity)` yields. */
export function newId(entity: EntityRef): RequestMatcher {
  return { kind: 'id', prefix: entity.prefix };
}
