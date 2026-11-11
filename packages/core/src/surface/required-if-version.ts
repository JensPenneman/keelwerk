import type { FieldNode } from './field-node.ts';
import type { SurfaceAction } from './surface-action.ts';

/**
 * The `ifVersion` field of an instance command whose input declares it required, else `undefined`.
 * The one place the rule lives: the document of a REST API and the CLI both read it.
 */
export function requiredIfVersion(action: SurfaceAction): FieldNode | undefined {
  if (!action.instance || action.input.kind !== 'shape') {
    return undefined;
  }
  const node = action.input.fields.ifVersion;
  return node === undefined || node.optional ? undefined : node;
}
