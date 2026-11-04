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
 * Finds the route of a request: a host-root path of a `rest.path` hint first, then the path below
 * the mount (the tenant prefix the host consumed, then the base path). `/docs`, `/openapi.json`
 * and `/problems/{code}` are the mount's own pages.
 */
export function locateRoute(
  table: RouteTable,
  method: string,
  pathname: string,
  mount: { readonly tenantPrefix: string; readonly basePath: string },
): Located {
  const mountPath = `${mount.tenantPrefix}${mount.basePath}`;
  if (table.absolutePaths.length > 0) {
    const absolute = table.match(method, pathname, true);
    if (absolute !== undefined) {
      return { kind: 'route', match: absolute, mountPath };
    }
  }
  if (pathname !== mountPath && !pathname.startsWith(`${mountPath}/`)) {
    return { kind: 'none', mountPath };
  }
  const relative = pathname.slice(mountPath.length) || '/';
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
