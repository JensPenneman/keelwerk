import type { SurfaceAction } from '@keelwerk/core';
import type { JsonObject } from './json-object.ts';

/** The `x-keelwerk-*` members of an operation (section 16.5.5). */
export function keelwerkExtensions(action: SurfaceAction): JsonObject {
  return {
    'x-keelwerk-action': action.ref,
    'x-keelwerk-execution': action.execution,
    'x-keelwerk-scope': action.scope,
    ...(action.contributedBy === undefined
      ? {}
      : { 'x-keelwerk-contributed-by': action.contributedBy }),
  };
}
