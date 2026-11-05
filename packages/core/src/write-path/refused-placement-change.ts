import { namesAnyField } from './names-any-field.ts';

/** The fields whose change moves data between placements, by the entity ref of the generated action. */
const placementFields: Readonly<Record<string, readonly string[]>> = {
  'core.tenant': ['backendId', 'placement'],
  'core.backend': ['app', 'placement'],
};

/**
 * The generated `update` or `set` of a `core.tenant` or `core.backend` that names a field moving
 * data (a tenant's backend or placement, a backend's app or placement) is refused: that move is the
 * freeze-and-copy of section 14.4.5, `core.tenant.move`, not a plain write. Returns the entity ref
 * to refuse, or `undefined`.
 */
export function refusedPlacementChange(
  module: string,
  entity: string | undefined,
  kind: string | undefined,
  input: unknown,
): string | undefined {
  if (module !== 'core' || (kind !== 'update' && kind !== 'set')) return undefined;
  if (typeof input !== 'object' || input === null || entity === undefined) return undefined;
  const ref = entity.includes('.') ? entity : `core.${entity}`;
  const fields = placementFields[ref];
  if (fields === undefined) return undefined;
  return namesAnyField(input, fields) ? ref : undefined;
}
