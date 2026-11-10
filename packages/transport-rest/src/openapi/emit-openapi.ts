import type { ApiSurface, SurfaceAction } from '@keelwerk/core';
import { camel } from '@keelwerk/core';
import { buildRouteTable } from '../build-route-table.ts';
import { actionSchemas } from './action-schemas.ts';
import { commonComponents } from './common-components.ts';
import { documentedRouteOf } from './documented-route-of.ts';
import { entitySchemas } from './entity-schemas.ts';
import { filterSchema } from './filter-schema.ts';
import type { JsonObject } from './json-object.ts';
import type { OpenapiOptions } from './openapi-options.ts';
import { operationFor } from './operation-for.ts';
import { problemSchemas } from './problem-schemas.ts';
import { schemaName } from './schema-name.ts';
import { securitySchemes } from './security-schemes.ts';
import { surfaceSecurityResolvers } from './surface-security-resolvers.ts';

function addOnce(target: JsonObject, key: string, value: unknown, what: string): void {
  if (Object.hasOwn(target, key)) {
    throw new TypeError(`${what} '${key}' is produced twice; run checkRestSurface first`);
  }
  target[key] = value;
}

function tagsOf(surface: ApiSurface, version: '3.1' | '3.2'): JsonObject[] {
  const modules = surface.modules.map((module) => ({
    name: module.id,
    ...(module.description === undefined ? {} : { description: module.description }),
  }));
  if (version === '3.1') {
    return modules;
  }
  return [
    ...modules,
    ...surface.entities.map((entity) => ({
      name: entity.ref,
      summary: entity.name,
      parent: entity.module,
      ...(entity.description === undefined ? {} : { description: entity.description }),
    })),
  ];
}

function hasEntity(surface: ApiSurface, action: SurfaceAction): boolean {
  return (
    action.entity !== undefined && surface.entities.some((entity) => entity.ref === action.entity)
  );
}

/**
 * The OpenAPI document of a surface (section 16.5.5): pure and deterministic. Paths come from the
 * resource mapping of section 16.5.1, components from the entities, actions and declared errors.
 * Throws a `TypeError` when two things produce the same operation or schema name: `checkRestSurface`
 * reports those first, with the hint that resolves them.
 */
export function emitOpenapi(surface: ApiSurface, options: OpenapiOptions = {}): JsonObject {
  const version = options.openapi ?? '3.1';
  const common = commonComponents();
  const security = securitySchemes(options.resolvers ?? surfaceSecurityResolvers(surface));
  const schemas: JsonObject = {};
  const paths: Record<string, JsonObject> = {};
  const operationIds: JsonObject = {};
  for (const [name, schema] of Object.entries({
    ...common.schemas,
    ...problemSchemas(surface),
  })) {
    addOnce(schemas, name, schema, 'the schema');
  }
  for (const entity of surface.entities) {
    for (const [name, schema] of Object.entries(entitySchemas(entity))) {
      addOnce(schemas, name, schema, 'the schema');
    }
    addOnce(schemas, schemaName('filter', entity.ref), filterSchema(entity, surface), 'the schema');
  }
  const table = buildRouteTable(surface, { openapi: version });
  const schemaDone = new Set<string>();
  for (const restRoute of table.routes) {
    const action = restRoute.action;
    const entity = surface.entities.find((candidate) => candidate.ref === action.entity);
    if (!schemaDone.has(action.ref)) {
      schemaDone.add(action.ref);
      const filterName =
        hasEntity(surface, action) && entity !== undefined
          ? schemaName('filter', entity.ref)
          : undefined;
      for (const [name, schema] of Object.entries(actionSchemas(action, filterName))) {
        addOnce(schemas, name, schema, 'the schema');
      }
    }
    const route = documentedRouteOf(restRoute);
    addOnce(operationIds, `${camel(action.ref)}${route.suffix}`, action.ref, 'the operation id');
    const item = paths[route.path] ?? (route.absolute ? { servers: [{ url: '/' }] } : {});
    paths[route.path] = item;
    addOnce(
      item,
      route.method,
      operationFor(action, route, { surface, entity, version, securityNames: security.names }),
      `the ${route.method.toUpperCase()} operation of ${route.path}`,
    );
  }
  return {
    openapi: version === '3.2' ? '3.2.0' : '3.1.1',
    'x-keelwerk-generated': {
      format: 'keelwerk.openapi/1',
      producer: '@keelwerk/transport-rest',
      apiVersion: surface.apiVersion,
      surface: surface.hash,
    },
    info: { title: surface.app, version: surface.hash },
    servers: [{ url: options.basePath ?? '/api' }],
    tags: tagsOf(surface, version),
    paths,
    components: {
      schemas,
      headers: common.headers,
      parameters: common.parameters,
      responses: common.responses,
      ...(security.names.length === 0 ? {} : { securitySchemes: security.schemes }),
    },
  };
}
