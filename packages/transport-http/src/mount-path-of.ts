/**
 * The one rule of path handling (16.3.3, register entry 395): the host strips the mount's prefix,
 * the transport never does. `path` is what is left (`/` when nothing is), `basePath` the stripped
 * prefix (empty for a mount at `/`).
 */
export function mountPathOf(
  prefix: string,
  pathname: string,
): { readonly path: string; readonly basePath: string } {
  const basePath = prefix === '/' ? '' : prefix;
  return { path: pathname.slice(basePath.length) || '/', basePath };
}
