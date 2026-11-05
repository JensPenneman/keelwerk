import type { SurfaceAction } from '@keelwerk/core';
import { statusOfError } from '@keelwerk/core/http';
import { bodyNodeOf } from './body-node-of.ts';
import type { DocumentedRoute } from './documented-route.ts';
import { hasIfMatch } from './has-if-match.ts';
import { headersOf } from './header-refs.ts';
import { isSingleGet } from './is-single-get.ts';
import type { JsonObject } from './json-object.ts';
import type { OperationContext } from './operation-context.ts';
import { outputRef } from './output-ref.ts';
import { problemResponse } from './problem-response.ts';
import { schemaName } from './schema-name.ts';
import { schemaRef } from './schema-ref.ts';
import { statusTitles } from './status-titles.ts';

function json(schema: JsonObject): JsonObject {
  return { 'application/json': { schema } };
}

function streamResponse(action: SurfaceAction, ctx: OperationContext): JsonObject {
  const item = outputRef(action);
  return {
    description: 'A stream of server-sent events.',
    headers: headersOf(),
    content: {
      'text/event-stream':
        ctx.version === '3.2'
          ? { itemSchema: item ?? {} }
          : {
              schema: { type: 'string' },
              ...(item === undefined ? {} : { 'x-keelwerk-item-schema': item }),
            },
    },
  };
}

function cookieHeaders(action: SurfaceAction): JsonObject {
  const cookie = action.hints.http?.cookie;
  const name = cookie?.set?.name ?? cookie?.clear?.name;
  return name === undefined
    ? {}
    : {
        'Set-Cookie': {
          description: `Sets or clears the \`${name}\` cookie (browser requests only).`,
          schema: { type: 'string' },
        },
      };
}

function hintedResponses(action: SurfaceAction): Record<string, JsonObject> | undefined {
  const hint = action.hints.http?.response;
  switch (hint?.kind) {
    case 'raw':
      return {
        '200': {
          description: 'The raw body.',
          headers: headersOf(),
          content: { [hint.contentType]: { schema: { type: 'string' } } },
        },
      };
    case 'download':
      return {
        '200': {
          description: 'A download.',
          headers: {
            ...headersOf(),
            'Content-Disposition': {
              description: 'The attachment file name.',
              schema: { type: 'string' },
            },
          },
          content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
        },
      };
    case 'redirect':
      return {
        [String(hint.status ?? 302)]: {
          description: 'A redirect.',
          headers: {
            ...headersOf('location'),
          },
        },
      };
    case 'empty':
      return { [String(hint.status ?? 204)]: { description: 'No content.', headers: headersOf() } };
    default:
      return undefined;
  }
}

function okResponse(
  action: SurfaceAction,
  route: DocumentedRoute,
  ctx: OperationContext,
): JsonObject {
  const names: string[] = [];
  const command = action.kind === 'command';
  if (command) {
    names.push('keelwerkCommandId', 'keelwerkEffects', 'idempotentReplayed');
  }
  if (
    isSingleGet(action, route) ||
    action.generated === 'create' ||
    action.generated === 'update' ||
    action.generated === 'restore' ||
    (command && action.instance)
  ) {
    names.push('etag');
  }
  if (action.generated === 'create') {
    names.push('location');
  }
  if (action.execution === 'either') {
    names.push('preferenceApplied');
  }
  if (action.output.kind === 'page' || action.generated === 'query') {
    names.push('link');
  }
  const schema =
    isSingleGet(action, route) && ctx.entity !== undefined
      ? schemaRef(schemaName('read', ctx.entity.ref))
      : outputRef(action);
  return {
    description: action.output.kind === 'void' ? 'Done; no content.' : 'Success.',
    headers: { ...headersOf(...names), ...cookieHeaders(action) },
    ...(schema === undefined || action.output.kind === 'void' ? {} : { content: json(schema) }),
  };
}

function successResponses(
  action: SurfaceAction,
  route: DocumentedRoute,
  ctx: OperationContext,
): Record<string, JsonObject> {
  const hinted = hintedResponses(action);
  const receipt: JsonObject = {
    description: 'The command was accepted; follow `Location` for its receipt.',
    headers: headersOf('location', 'preferenceApplied', 'keelwerkCommandId'),
    content: json(schemaRef('CommandReceipt')),
  };
  if (action.kind === 'command' && action.execution === 'async') {
    return { '202': receipt };
  }
  const responses: Record<string, JsonObject> = {};
  if (hinted !== undefined) {
    Object.assign(responses, hinted);
  } else if (route.stream) {
    responses['200'] = streamResponse(action, ctx);
  } else {
    responses[
      action.generated === 'create' ? '201' : action.output.kind === 'void' ? '204' : '200'
    ] = okResponse(action, route, ctx);
  }
  if (action.kind === 'command' && action.execution === 'either') {
    responses['202'] = receipt;
  }
  if (isSingleGet(action, route)) {
    responses['304'] = { description: statusTitles[304] ?? '', headers: headersOf('etag') };
  }
  return responses;
}

function errorResponses(
  action: SurfaceAction,
  route: DocumentedRoute,
  ctx: OperationContext,
): Record<string, JsonObject> {
  const declared = new Map<number, string[]>();
  for (const code of action.errors) {
    const error = ctx.surface.errors.find((candidate) => candidate.code === code);
    if (error === undefined) {
      throw new TypeError(
        `the action ${action.ref} declares the error ${code}, which the surface does not list`,
      );
    }
    const status = statusOfError(error);
    declared.set(status, [...(declared.get(status) ?? []), code]);
  }
  const statuses = new Set([400, 401, 403, 422, 429, 500, 503, ...declared.keys()]);
  if (route.pathId) {
    statuses.add(404);
  }
  if (hasIfMatch(action)) {
    statuses.add(412);
  }
  // 413 is `core.payload_too_large` from the JSON body reader. 410 is not produced until version
  // resolution (section 18.3) lands; `statusOfError` already maps `core.api_version_retired` to 410.
  if (route.carries === 'body' && bodyNodeOf(action).kind !== 'void') {
    statuses.add(413);
  }
  return Object.fromEntries(
    [...statuses]
      .sort((left, right) => left - right)
      .map((status) => [
        String(status),
        declared.has(status)
          ? problemResponse(status, declared.get(status) ?? [], ctx.version)
          : { $ref: `#/components/responses/problem${status}` },
      ]),
  );
}

/** The success and problem responses of an operation (sections 16.4.6, 16.5.3 and 16.5.5). */
export function responsesFor(
  action: SurfaceAction,
  route: DocumentedRoute,
  ctx: OperationContext,
): Record<string, JsonObject> {
  return { ...successResponses(action, route, ctx), ...errorResponses(action, route, ctx) };
}
