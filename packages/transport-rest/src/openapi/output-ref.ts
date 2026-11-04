import type { SurfaceAction } from '@keelwerk/core';
import type { JsonObject } from './json-object.ts';
import { schemaName } from './schema-name.ts';
import { schemaRef } from './schema-ref.ts';

/** A reference to the output schema of an action, or `undefined` for a void output. */
export function outputRef(action: SurfaceAction): JsonObject | undefined {
  return action.output.kind === 'void' ? undefined : schemaRef(schemaName('output', action.ref));
}
