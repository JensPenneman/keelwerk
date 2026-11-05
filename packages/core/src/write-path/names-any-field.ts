/**
 * Whether the input, or the `patch` of a generated `update`, the values of a `create` item or the
 * `patch` of an `update` item of a generated `set`, name any of the fields.
 */
export function namesAnyField(input: object, fields: readonly string[]): boolean {
  const named = (value: unknown): boolean =>
    typeof value === 'object' &&
    value !== null &&
    fields.some((name) => Reflect.get(value, name) !== undefined);
  if (named(input)) return true;
  // The generated `update` carries its fields in a `patch`.
  if (named(Reflect.get(input, 'patch'))) return true;
  // The generated `set` carries its writes in lists: the values of each `create`, the `patch` of each `update`.
  const create: unknown = Reflect.get(input, 'create');
  if (Array.isArray(create) && create.some(named)) return true;
  const update: unknown = Reflect.get(input, 'update');
  return (
    Array.isArray(update) &&
    update.some(
      (item: unknown) =>
        typeof item === 'object' && item !== null && named(Reflect.get(item, 'patch')),
    )
  );
}
