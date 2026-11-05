import { namesAnyField } from './names-any-field.ts';

/**
 * The generated `update` or `set` of a `core.tenant` or `core.backend` that names `apiVersion`: a
 * pin changes only through `setApiVersion`, which checks the version. Returns the entity ref to
 * refuse, or `undefined`.
 */
export function refusedApiVersionPin(
  module: string,
  entity: string | undefined,
  kind: string | undefined,
  input: unknown,
): string | undefined {
  if (module !== 'core' || (kind !== 'update' && kind !== 'set')) return undefined;
  if (typeof input !== 'object' || input === null || entity === undefined) return undefined;
  const ref = entity.includes('.') ? entity : `core.${entity}`;
  if (ref !== 'core.tenant' && ref !== 'core.backend') return undefined;
  return namesAnyField(input, ['apiVersion']) ? ref : undefined;
}
