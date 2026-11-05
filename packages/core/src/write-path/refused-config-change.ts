import { namesAnyField } from './names-any-field.ts';

/**
 * The generated `update` or `set` of a `core.backend` that names `config`: the stored
 * configuration is validated against the module shapes and its secrets are sealed when the backend
 * is created (section 5.7), and a plain write does neither. Returns the entity ref to refuse, or
 * `undefined`.
 */
export function refusedConfigChange(
  module: string,
  entity: string | undefined,
  kind: string | undefined,
  input: unknown,
): string | undefined {
  if (module !== 'core' || (kind !== 'update' && kind !== 'set')) return undefined;
  if (typeof input !== 'object' || input === null || entity === undefined) return undefined;
  const ref = entity.includes('.') ? entity : `core.${entity}`;
  if (ref !== 'core.backend') return undefined;
  return namesAnyField(input, ['config']) ? ref : undefined;
}
