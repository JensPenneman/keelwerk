import type { RouteMatch, RouteTable } from './route-table.ts';

/** Where a request path falls in the REST mount. */
export type Located =
  | { readonly kind: 'route'; readonly match: RouteMatch; readonly mountPath: string }
  | {
      readonly kind: 'meta';
      readonly name: 'docs' | 'openapi' | 'problem';
      readonly code: string;
      readonly mountPath: string;
    }
  | { readonly kind: 'none'; readonly mountPath: string };

/**
 * Finds the route of a request. The host stripped the tenant prefix and the mount's prefix: `path`
 * is relative to the mount and `stripped` is what it removed. A host-root path of a `rest.path`
 * hint is its own mount, so its full path is the stripped prefix and the rest. `/docs`,
 * `/openapi.json` and `/problems/{code}` are the mount's own pages.
 */
export function locateRoute(
  table: RouteTable,
  method: string,
  mount: {
    readonly path: string;
    readonly stripped: string;
    readonly basePath: string;
    /** The request came through a host-root mount of a `rest.path` hint, not through the base path. */
    readonly root: boolean;
  },
): Located {
  const { path: relative, stripped } = mount;
  const { root } = mount;
  const mountPath = root ? mount.basePath : stripped;
  if (root) {
    const full = `${stripped}${relative === '/' ? '' : relative}`;
    const absolute = table.match(method, full, true);
    return absolute === undefined
      ? { kind: 'none', mountPath }
      : { kind: 'route', match: absolute, mountPath };
  }
  if (method === 'GET') {
    if (relative === '/docs') {
      return { kind: 'meta', name: 'docs', code: '', mountPath };
    }
    if (relative === '/openapi.json') {
      return { kind: 'meta', name: 'openapi', code: '', mountPath };
    }
    if (relative.startsWith('/problems/')) {
      try {
        const code = decodeURIComponent(relative.slice('/problems/'.length));
        return { kind: 'meta', name: 'problem', code, mountPath };
      } catch {
        return { kind: 'none', mountPath };
      }
    }
  }
  const match = table.match(method, relative, false);
  return match === undefined ? { kind: 'none', mountPath } : { kind: 'route', match, mountPath };
}
