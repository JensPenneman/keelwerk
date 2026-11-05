/** The URL of a placement entry as text: a string as is, an `env()` or `secret()` reference looked up in `env`; undefined when it cannot be resolved. */
function urlOf(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return undefined;
  if (
    'kind' in value &&
    value.kind === 'env' &&
    'name' in value &&
    typeof value.name === 'string'
  ) {
    return env[value.name];
  }
  if ('ref' in value && typeof value.ref === 'string') return env[value.ref];
  return undefined;
}

/**
 * Adapter and host of a placement entry, so two entries on one database server compare equal.
 * Undefined when the entry has a URL that cannot be resolved (an `env()` reference to a variable
 * that is not set): the cluster is then unknown.
 */
export function clusterOf(
  entry: { readonly adapter: string; readonly [member: string]: unknown },
  env: Readonly<Record<string, string | undefined>> = {},
): string | undefined {
  if (entry.url === undefined) return `${entry.adapter}://local`;
  const url = urlOf(entry.url, env);
  if (url === undefined) return undefined;
  try {
    return `${entry.adapter}://${new URL(url).host}`;
  } catch {
    return `${entry.adapter}:${url}`;
  }
}
