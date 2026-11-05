import type { PlacementConfig } from '@keelwerk/core';

const strategies = ['shared-tables', 'schema-per-tenant', 'database-per-tenant'] as const;

/** The `PlacementConfig` of a placement or control entry, its `url` resolved against `env`; undefined when the url reads a variable that is not set. */
export function placementConfigOf(
  id: string,
  entry: { readonly adapter: string; readonly [member: string]: unknown },
  env: Readonly<Record<string, string | undefined>>,
): PlacementConfig | undefined {
  const { adapter: _adapter, url, strategy, apps, naming, pool, ...rest } = entry;
  let resolved: string | undefined;
  if (typeof url === 'string') resolved = url;
  else if (typeof url === 'object' && url !== null && Reflect.get(url, 'kind') === 'env') {
    const name: unknown = Reflect.get(url, 'name');
    resolved = typeof name === 'string' ? env[name] : undefined;
    if (resolved === undefined) return undefined;
  }
  return {
    id,
    strategy: strategies.find((candidate) => candidate === strategy) ?? 'shared-tables',
    ...(resolved === undefined ? {} : { url: resolved }),
    ...(Array.isArray(apps) ? { apps: apps as readonly string[] } : {}),
    ...(typeof naming === 'object' && naming !== null
      ? { naming: naming as NonNullable<PlacementConfig['naming']> }
      : {}),
    ...(typeof pool === 'object' && pool !== null
      ? { pool: pool as NonNullable<PlacementConfig['pool']> }
      : {}),
    options: rest,
  };
}
