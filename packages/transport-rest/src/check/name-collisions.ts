import type { ApiSurface, SurfaceEntity, TransportProblem } from '@keelwerk/core';
import { camel } from '@keelwerk/core';
import { buildRouteTable } from '../build-route-table.ts';
import { collectionName } from '../collection-name.ts';
import { documentedRouteOf } from '../openapi/documented-route-of.ts';
import { schemaName } from '../openapi/schema-name.ts';
import type { RestStaticOptions } from '../rest-static-options.ts';
import { restProblem } from './rest-problem.ts';

/** The collection of an entity as the route table derives it: the first `rest.collection` hint of its actions, else the plural kebab name. */
function collectionOf(surface: ApiSurface, entity: SurfaceEntity): string {
  const hint = surface.actions
    .filter((action) => action.entity === entity.ref)
    .map((action) => action.hints.rest?.collection)
    .find((collection) => collection !== undefined);
  return collectionName(entity.name, hint);
}

function addOwner(owners: Map<string, Set<string>>, name: string, owner: string): void {
  const known = owners.get(name);
  if (known === undefined) {
    owners.set(name, new Set([owner]));
  } else {
    known.add(owner);
  }
}

function collisions(
  owners: Map<string, Set<string>>,
  what: string,
  hint: string,
): TransportProblem[] {
  const problems: TransportProblem[] = [];
  for (const [name, subjects] of [...owners].sort(([left], [right]) => (left < right ? -1 : 1))) {
    if (subjects.size < 2) {
      continue;
    }
    const all = [...subjects].sort();
    for (const subject of all) {
      problems.push(
        restProblem(
          'nameCollision',
          subject,
          `${what} '${name}' is produced by ${all.join(' and ')}; resolve it with ${hint}`,
        ),
      );
    }
  }
  return problems;
}

/**
 * Names that two things project to: operation ids (`camel(ref)`), component schema names and the
 * collection segments of one module (section 16.4.1). Each collision names the hint that resolves it.
 */
export function nameCollisions(
  surface: ApiSurface,
  options: RestStaticOptions = {},
): readonly TransportProblem[] {
  const operations = new Map<string, Set<string>>();
  const schemas = new Map<string, Set<string>>();
  const collections = new Map<string, Set<string>>();
  const routes = buildRouteTable(surface, options).routes;
  for (const entity of surface.entities) {
    for (const role of ['read', 'create', 'patch', 'filter'] as const) {
      addOwner(schemas, schemaName(role, entity.ref), entity.ref);
    }
    addOwner(collections, `${entity.module}/${collectionOf(surface, entity)}`, entity.ref);
  }
  for (const error of surface.errors) {
    if (surface.actions.some((action) => action.errors.includes(error.code))) {
      addOwner(schemas, schemaName('problem', error.code), error.code);
    }
  }
  const exposed = new Set<string>();
  for (const route of routes) {
    addOwner(
      operations,
      `${camel(route.action.ref)}${documentedRouteOf(route).suffix}`,
      route.action.ref,
    );
    if (exposed.has(route.action.ref)) {
      continue;
    }
    exposed.add(route.action.ref);
    const action = route.action;
    if (action.input.kind !== 'void') {
      addOwner(schemas, schemaName('input', action.ref), action.ref);
    }
    if (action.output.kind !== 'void') {
      addOwner(schemas, schemaName('output', action.ref), action.ref);
    }
  }
  return [
    ...collisions(
      operations,
      'the operation id',
      'the `rest.expose` hint (`false` hides an action) or a new action name',
    ),
    ...collisions(
      schemas,
      'the schema name',
      'the `rest.expose` hint (`false` hides an action) or a new name',
    ),
    ...collisions(
      collections,
      'the collection',
      'the `rest.collection` hint on one of the entity actions',
    ),
  ];
}
