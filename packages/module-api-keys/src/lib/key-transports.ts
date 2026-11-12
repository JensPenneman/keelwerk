const transportPrefix = 'transport:';

/** The transport ids named by the `transport:<id>` scopes, in order. */
export function keyTransports(scopes: readonly string[]): readonly string[] {
  return scopes.flatMap((scope) =>
    scope.startsWith(transportPrefix) ? [scope.slice(transportPrefix.length)] : [],
  );
}
