/** The object with one member renamed, in the same place; the object itself when it lacks the member. */
export function renameKey(
  row: Readonly<Record<string, unknown>>,
  from: string,
  to: string,
): Readonly<Record<string, unknown>> {
  if (!Object.hasOwn(row, from)) return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key === from ? to : key, value]),
  );
}
