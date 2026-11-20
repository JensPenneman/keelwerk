import type { ApiSurface, SurfaceAction } from '@keelwerk/core';
import { statusOfError } from '@keelwerk/core/http';
import type { ErrorMap } from '@orpc/server';
import { errorDataJsonSchema } from './error-data-json-schema.ts';
import { nodeSchemaOf } from './node-schema-of.ts';

/**
 * The error map of one procedure: each error code the action declares, at the status of its kind
 * (section 16.4.6), with the wire error as its data. A code the surface does not list is left out;
 * `checkOrpcSurface` refuses it at mount.
 */
export function orpcErrorMapOf(surface: ApiSurface, action: SurfaceAction): ErrorMap {
  const map: ErrorMap = {};
  for (const code of action.errors) {
    const error = surface.errors.find((candidate) => candidate.code === code);
    if (error === undefined) continue;
    map[code] = {
      status: statusOfError({ kind: error.kind, code: error.code }),
      message: error.message,
      data: nodeSchemaOf(() => errorDataJsonSchema(error)),
    };
  }
  return map;
}
