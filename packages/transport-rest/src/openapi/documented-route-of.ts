import type { RestRoute } from '../rest-route.ts';
import type { DocumentedRoute } from './documented-route.ts';

const idMembers = ['id', 'ifVersion'] as const;

function omitOf(route: RestRoute, pathId: boolean): readonly string[] {
  switch (route.mode) {
    case 'get-one':
      return ['id', 'ids'];
    case 'history':
      return ['id'];
    case 'instance':
      return pathId ? idMembers : ['ifVersion'];
    default:
      return route.action.generated === 'set' && route.action.instance ? idMembers : [];
  }
}

function suffixOf(route: RestRoute): DocumentedRoute['suffix'] {
  if (route.method === 'QUERY') {
    return 'Query';
  }
  const generated = route.action.generated;
  return route.method === 'POST' && (generated === 'get' || generated === 'query') ? 'Post' : '';
}

function carriesOf(route: RestRoute): DocumentedRoute['carries'] {
  if (route.mode === 'body') {
    return 'body';
  }
  if (route.mode === 'instance') {
    return route.method === 'GET' || route.method === 'DELETE' ? 'query-string' : 'body';
  }
  return 'query-string';
}

/** What the document needs of a route of the REST route table: lower-case method, `{id}` paths, the operation id suffix and where the input travels. */
export function documentedRouteOf(route: RestRoute): DocumentedRoute {
  const path = route.path.replace(/:([A-Za-z]+)/g, '{$1}');
  const pathId = path.includes('{id}');
  return {
    method: route.method.toLowerCase() as DocumentedRoute['method'],
    path,
    absolute: route.absolute,
    suffix: suffixOf(route),
    carries: carriesOf(route),
    pathId,
    omit: omitOf(route, pathId),
    safe: route.action.kind === 'query' && route.method !== 'GET',
    stream: route.mode === 'stream',
  };
}
