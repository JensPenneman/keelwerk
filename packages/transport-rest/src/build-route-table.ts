import type { ApiSurface, SurfaceAction, SurfaceEntity, TransportProblem } from '@keelwerk/core';
import { TrieRouter } from 'hono/router/trie-router';
import { collectionName } from './collection-name.ts';
import { kebab } from './kebab.ts';
import { queryStringRepresentable } from './query-string-representable.ts';
import type { RestRoute, RouteMode } from './rest-route.ts';
import type { RestStaticOptions } from './rest-static-options.ts';
import type { RouteMatch, RouteTable } from './route-table.ts';

const reservedSegments: ReadonlySet<string> = new Set([
  'get',
  'query',
  'changes',
  'query-changes',
  'set',
  'watch',
  'history',
  'restore',
]);

interface Draft {
  readonly method: string;
  readonly path: string;
  readonly absolute: boolean;
  readonly mode: RouteMode;
  readonly creates?: boolean;
}

function entityOf(surface: ApiSurface, action: SurfaceAction): SurfaceEntity | undefined {
  return action.entity === undefined
    ? undefined
    : surface.entities.find((entity) => entity.ref === action.entity);
}

function collectionOf(surface: ApiSurface, entity: SurfaceEntity): string {
  const hint = surface.actions
    .filter((action) => action.entity === entity.ref)
    .map((action) => action.hints.rest?.collection)
    .find((collection) => collection !== undefined);
  return collectionName(entity.name, hint);
}

function generatedRoutes(kind: string, base: string): readonly Draft[] {
  const rel = (path: string) => ({ absolute: false, path });
  switch (kind) {
    case 'query':
      return [
        { method: 'GET', ...rel(base), mode: 'query-string' },
        { method: 'POST', ...rel(`${base}/query`), mode: 'body' },
      ];
    case 'get':
      return [
        { method: 'GET', ...rel(`${base}/:id`), mode: 'get-one' },
        { method: 'POST', ...rel(`${base}/get`), mode: 'body' },
      ];
    case 'changes':
      return [{ method: 'GET', ...rel(`${base}/changes`), mode: 'query-string' }];
    case 'queryChanges':
      return [{ method: 'POST', ...rel(`${base}/query-changes`), mode: 'body' }];
    case 'create':
      return [{ method: 'POST', ...rel(base), mode: 'body', creates: true }];
    case 'update':
      return [{ method: 'PATCH', ...rel(`${base}/:id`), mode: 'instance' }];
    case 'archive':
      return [{ method: 'DELETE', ...rel(`${base}/:id`), mode: 'instance' }];
    case 'restore':
      return [{ method: 'POST', ...rel(`${base}/:id/restore`), mode: 'instance' }];
    case 'set':
      return [{ method: 'POST', ...rel(`${base}/set`), mode: 'body' }];
    case 'watch':
      return [{ method: 'GET', ...rel(`${base}/watch`), mode: 'stream' }];
    case 'history':
      return [{ method: 'GET', ...rel(`${base}/:id/history`), mode: 'history' }];
    default:
      return [];
  }
}

/** The path segment a custom action takes below its base: the relative `rest.path` hint or the kebab-cased name; undefined for a host-root hint. */
function segmentOf(action: SurfaceAction): string | undefined {
  const hinted = action.hints.rest?.path;
  if (hinted === undefined) {
    return kebab(action.name);
  }
  return hinted.startsWith('/') ? undefined : hinted.replace(/^\/+/, '');
}

function customRoutes(
  action: SurfaceAction,
  base: string,
  options: RestStaticOptions,
): readonly Draft[] {
  const hinted = action.hints.rest?.path;
  const absolute = hinted?.startsWith('/') === true;
  const segment = segmentOf(action) ?? '';
  const instance = action.mount === 'entity' && action.instance;
  const path =
    absolute && hinted !== undefined ? hinted : `${base}${instance ? '/:id' : ''}/${segment}`;
  const draft = (method: string, mode: RouteMode): Draft => ({ method, path, absolute, mode });
  if (action.kind === 'subscription') {
    return [draft('GET', 'stream')];
  }
  if (action.kind === 'command') {
    return [draft('POST', instance ? 'instance' : 'body')];
  }
  if (queryStringRepresentable(action.input)) {
    return [draft('GET', instance ? 'instance' : 'query-string')];
  }
  const mode = instance ? 'instance' : 'body';
  return [draft('POST', mode), ...(options.openapi === '3.2' ? [draft('QUERY', mode)] : [])];
}

function isExposed(action: SurfaceAction): boolean {
  return action.hints.rest?.expose !== false;
}

function sortRoutes(routes: readonly RestRoute[]): readonly RestRoute[] {
  const dynamic = (route: RestRoute) => route.path.includes(':');
  return [...routes.filter((route) => !dynamic(route)), ...routes.filter(dynamic)];
}

function signature(route: RestRoute): string {
  return `${route.method} ${route.absolute ? 'abs' : 'rel'} ${route.path.replace(/:[a-z]+/g, ':')}`;
}

/**
 * Derives the route table of 16.5.1 from a surface: collections from entity names, verbs and paths
 * from the action kinds, `rest` hints applied. Conflicts and reserved names come back as problems
 * (section 16.3.2), never resolved silently.
 */
export function buildRouteTable(surface: ApiSurface, options: RestStaticOptions = {}): RouteTable {
  const problems: TransportProblem[] = [];
  const problem = (code: string, subject: string, message: string) => {
    problems.push({ code, transport: 'rest', subject, message });
  };
  const collections = new Map<string, Set<string>>();
  for (const entity of surface.entities) {
    const names = collections.get(entity.module) ?? new Set<string>();
    names.add(collectionOf(surface, entity));
    collections.set(entity.module, names);
  }
  const routes: RestRoute[] = [];
  for (const action of surface.actions) {
    if (!isExposed(action)) {
      continue;
    }
    const cookie = action.hints.http?.cookie;
    for (const name of [cookie?.set?.name, cookie?.clear?.name]) {
      if (name !== undefined && !name.startsWith('__Host-')) {
        problem(
          'cookieName',
          action.ref,
          `The cookie '${name}' must carry the '__Host-' prefix (section 16.4.10).`,
        );
      }
    }
    const entity = entityOf(surface, action);
    const moduleCollections = collections.get(action.module);
    let drafts: readonly Draft[];
    if (entity !== undefined && action.mount === 'entity') {
      const base = `/${action.module}/${collectionOf(surface, entity)}`;
      const segment = action.generated === undefined ? segmentOf(action) : undefined;
      if (segment !== undefined && reservedSegments.has(segment)) {
        problem(
          'reservedName',
          action.ref,
          `'${segment}' is reserved in an entity's action namespace; rename the action or set the rest.path hint.`,
        );
        continue;
      }
      drafts =
        action.generated === undefined
          ? customRoutes(action, base, options)
          : generatedRoutes(action.generated, base);
    } else {
      const segment = segmentOf(action);
      if (segment !== undefined && moduleCollections?.has(segment) === true) {
        problem(
          'routeConflict',
          action.ref,
          `The path '/${action.module}/${segment}' is also a collection of module '${action.module}'; set the rest.path hint.`,
        );
        continue;
      }
      drafts = customRoutes(action, `/${action.module}`, options);
    }
    for (const draft of drafts) {
      routes.push({
        method: draft.method,
        path: draft.path,
        absolute: draft.absolute,
        mode: draft.mode,
        action,
        ...(entity !== undefined && action.mount === 'entity' && { entity }),
        creates: draft.creates === true,
      });
    }
  }
  const seen = new Map<string, RestRoute>();
  const unique: RestRoute[] = [];
  for (const route of routes) {
    const key = signature(route);
    const clash = seen.get(key);
    if (clash !== undefined) {
      problem(
        'routeConflict',
        route.action.ref,
        `${route.method} ${route.path} is already the route of '${clash.action.ref}'; set the rest.path hint of one of them.`,
      );
      continue;
    }
    seen.set(key, route);
    unique.push(route);
  }
  const ordered = sortRoutes(unique);
  const relative = new TrieRouter<RestRoute>();
  const absolute = new TrieRouter<RestRoute>();
  for (const route of ordered) {
    (route.absolute ? absolute : relative).add(route.method, route.path, route);
  }
  return {
    routes: ordered,
    absolutePaths: [
      ...new Set(ordered.filter((route) => route.absolute).map((route) => route.path)),
    ],
    problems,
    match(method, path, isAbsolute): RouteMatch | undefined {
      const router = isAbsolute ? absolute : relative;
      const result = router.match(method, path);
      const first = result[0][0];
      if (first === undefined) {
        return undefined;
      }
      const [route, indexes] = first;
      const params: Record<string, string> = {};
      const stash = result.length === 2 ? result[1] : undefined;
      for (const [name, value] of Object.entries(indexes)) {
        params[name] = typeof value === 'number' ? (stash?.[value] ?? '') : value;
      }
      return { route, params };
    },
  };
}
