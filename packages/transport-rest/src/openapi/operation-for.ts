import type { FieldNode, SurfaceAction } from '@keelwerk/core';
import { camel } from '@keelwerk/core';
import { bodyNodeOf } from './body-node-of.ts';
import type { DocumentedRoute } from './documented-route.ts';
import { hasIfMatch } from './has-if-match.ts';
import { isSingleGet } from './is-single-get.ts';
import type { JsonObject } from './json-object.ts';
import { keelwerkExtensions } from './keelwerk-extensions.ts';
import type { OperationContext } from './operation-context.ts';
import { plainSchema } from './plain-schema.ts';
import { responsesFor } from './responses-for.ts';
import { schemaName } from './schema-name.ts';
import { schemaRef } from './schema-ref.ts';

function parameterRef(name: string): JsonObject {
  return { $ref: `#/components/parameters/${name}` };
}

function json(schema: JsonObject): JsonObject {
  return { 'application/json': { schema } };
}

function bodyOptional(node: FieldNode): boolean {
  if (node.kind !== 'shape') {
    return node.optional;
  }
  return Object.values(node.fields).every(
    (member) => member.optional || member.default !== undefined || member.access === 'read',
  );
}

function parametersOf(
  action: SurfaceAction,
  route: DocumentedRoute,
  ctx: OperationContext,
): JsonObject[] {
  const parameters: JsonObject[] = [];
  if (route.pathId) {
    const id = ctx.entity?.fields.id;
    parameters.push({
      name: 'id',
      in: 'path',
      required: true,
      schema: id === undefined ? { type: 'string' } : plainSchema(id),
    });
  }
  const node = bodyNodeOf(action);
  if (route.carries === 'query-string' && node.kind === 'shape') {
    for (const [name, member] of Object.entries(node.fields)) {
      if (!route.omit.includes(name)) {
        parameters.push(queryParameter(name, member, ctx));
      }
    }
  }
  if (action.kind === 'command') {
    parameters.push(parameterRef('idempotencyKey'));
  }
  if (hasIfMatch(action)) {
    parameters.push(parameterRef('ifMatch'));
  }
  if (isSingleGet(action, route)) {
    parameters.push(parameterRef('ifNoneMatch'));
  }
  if (action.execution === 'either') {
    parameters.push(parameterRef('prefer'));
  }
  return parameters;
}

function queryParameter(name: string, member: FieldNode, ctx: OperationContext): JsonObject {
  const base: JsonObject = {
    name,
    in: 'query',
    required: !member.optional && member.default === undefined,
    ...(member.description === undefined ? {} : { description: member.description }),
    ...(member.deprecated === undefined ? {} : { deprecated: true }),
  };
  if (name === 'filter') {
    const target = ctx.entity === undefined ? undefined : schemaName('filter', ctx.entity.ref);
    return {
      ...base,
      content: json(target === undefined ? plainSchema(member) : schemaRef(target)),
    };
  }
  if (name === 'sort') {
    return {
      ...base,
      description:
        member.description ?? 'Fields separated by commas; a leading `-` sorts descending.',
      schema: { type: 'string' },
    };
  }
  if (member.kind === 'list' || member.kind === 'set') {
    return { ...base, style: 'form', explode: true, schema: plainSchema(member) };
  }
  return { ...base, schema: plainSchema(member) };
}

function requestBodyOf(
  action: SurfaceAction,
  route: DocumentedRoute,
  ctx: OperationContext,
): JsonObject | undefined {
  const node = bodyNodeOf(action);
  if (route.carries !== 'body' || node.kind === 'void') {
    return undefined;
  }
  const entity = ctx.entity;
  const patch = action.generated === 'update' && entity !== undefined;
  const create = action.generated === 'create' && entity !== undefined;
  let schema = schemaRef(schemaName('input', action.ref));
  if (patch) {
    schema = schemaRef(schemaName('patch', entity.ref));
  } else if (create) {
    schema = schemaRef(schemaName('create', entity.ref));
  }
  return {
    required: !patch && !bodyOptional(node),
    content: {
      'application/json': { schema },
      ...(patch ? { 'application/merge-patch+json': { schema } } : {}),
    },
  };
}

function securityOf(action: SurfaceAction, ctx: OperationContext): JsonObject | undefined {
  if (ctx.securityNames.length === 0) {
    return undefined;
  }
  const alternatives = ctx.securityNames.map((name) => ({ [name]: [] }));
  return { security: action.auth === 'public' ? [{}, ...alternatives] : alternatives };
}

/** The OpenAPI operation of an action at one route (section 16.5.5): parameters, body, success and problem responses, security and the `x-keelwerk-*` members. */
export function operationFor(
  action: SurfaceAction,
  route: DocumentedRoute,
  ctx: OperationContext,
): JsonObject {
  const parameters = parametersOf(action, route, ctx);
  const requestBody = requestBodyOf(action, route, ctx);
  const tag = ctx.version === '3.2' && ctx.entity !== undefined ? ctx.entity.ref : action.module;
  return {
    operationId: `${camel(action.ref)}${route.suffix}`,
    tags: [tag],
    ...(action.description === undefined ? {} : { summary: action.description }),
    ...(action.deprecated === undefined
      ? {}
      : { deprecated: true, description: `Deprecated: ${action.deprecated.reason}` }),
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(requestBody === undefined ? {} : { requestBody }),
    responses: responsesFor(action, route, ctx),
    ...securityOf(action, ctx),
    ...keelwerkExtensions(action),
    ...(route.safe ? { 'x-keelwerk-safe': true } : {}),
  };
}
