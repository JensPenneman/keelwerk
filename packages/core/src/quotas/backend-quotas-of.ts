/**
 * The quota values of a stored backend row: the own string members of `config.core.quotas`, by
 * dimension. Anything else is dropped; it cannot occur after the check at creation.
 */
export function backendQuotasOf(config: unknown): ReadonlyMap<string, string> {
  const core: unknown =
    typeof config === 'object' && config !== null ? Reflect.get(config, 'core') : undefined;
  const quotas: unknown =
    typeof core === 'object' && core !== null ? Reflect.get(core, 'quotas') : undefined;
  const values = new Map<string, string>();
  if (typeof quotas !== 'object' || quotas === null || Array.isArray(quotas)) return values;
  for (const [dimension, limit] of Object.entries(quotas)) {
    if (typeof limit === 'string') values.set(dimension, limit);
  }
  return values;
}
