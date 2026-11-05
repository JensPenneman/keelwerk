import { errors, parseTypeId } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { decodeQueryString } from './decode-query-string.ts';
import type { Preconditions } from './preconditions.ts';
import { readJsonBody } from './read-json-body.ts';
import type { RestRoute } from './rest-route.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pathId(context: DecodeContext): string {
  const raw = context.params.id ?? '';
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw coreError('core.malformed_request', { message: 'The id in the path is not valid.' });
  }
  const prefix = context.route.entity?.prefix;
  if (prefix !== undefined && parseTypeId(id, prefix) === undefined) {
    throw errors.validation('The id in the path is not valid.', {
      issues: [{ path: ['id'], message: `Expected an id with the prefix '${prefix}'.` }],
    });
  }
  return id;
}

function selectionKey(context: DecodeContext): string {
  const input = context.route.action.input;
  return input.kind === 'shape' && Object.hasOwn(input.fields, 'properties')
    ? 'properties'
    : 'fields';
}

function readSelection(
  params: URLSearchParams,
  allowed: readonly string[],
): Record<string, unknown> {
  const unknown = [...new Set(params.keys())].filter(
    (name) => name !== 'keelwerk-version' && !allowed.includes(name),
  );
  if (unknown.length > 0) {
    throw errors.validation('The query string is invalid.', {
      issues: unknown.map((name) => ({ path: [name], message: 'Unknown parameter.' })),
    });
  }
  const out: Record<string, unknown> = {};
  const fields = params.get('fields');
  if (fields !== null) {
    out.fields = fields.split(',').filter((name) => name !== '');
  }
  const asOf = params.get('asOf');
  if (asOf !== null) {
    out.asOf = asOf;
  }
  return out;
}

function selectionRenamed(
  selection: Record<string, unknown>,
  context: DecodeContext,
): Record<string, unknown> {
  const key = selectionKey(context);
  if (key === 'fields' || selection.fields === undefined) {
    return selection;
  }
  const { fields, ...rest } = selection;
  return { ...rest, [key]: fields };
}

async function instanceInput(request: Request, context: DecodeContext): Promise<unknown> {
  const id = pathId(context);
  const body =
    request.method === 'GET' || request.method === 'DELETE'
      ? decodeQueryString(context.route, new URL(request.url).searchParams)
      : await readJsonBody(request, context.maxBodyBytes);
  if (body !== undefined && !isRecord(body)) {
    throw errors.validation('The body must be a JSON object.', {
      issues: [{ path: [], message: 'Expected an object.' }],
    });
  }
  const { ifVersion } = context.preconditions;
  if (body?.id !== undefined && body.id !== id) {
    throw errors.validation('The id in the body differs from the id in the path.', {
      issues: [{ path: ['id'], message: 'It must equal the id in the path.' }],
    });
  }
  if (ifVersion !== undefined && body?.ifVersion !== undefined && body.ifVersion !== ifVersion) {
    throw errors.validation('The ifVersion in the body differs from If-Match.', {
      issues: [{ path: ['ifVersion'], message: 'It must equal the version in If-Match.' }],
    });
  }
  const versioned = ifVersion === undefined ? {} : { ifVersion };
  if (context.route.action.generated === 'update') {
    const patch = Object.fromEntries(
      Object.entries(body ?? {}).filter(([key]) => key !== 'id' && key !== 'ifVersion'),
    );
    return { id, patch, ...versioned };
  }
  return { ...body, id, ...versioned };
}

/**
 * Turns a request into the invocation's wire-form input (section 16.5.2): the id from the path
 * with its prefix checked, scalars from the query string, a JSON or merge-patch body, and
 * `If-Match` as `ifVersion`. The pipeline's validate stage does the rest.
 */
export async function decodeRequest(request: Request, context: DecodeContext): Promise<unknown> {
  const { route } = context;
  const params = new URL(request.url).searchParams;
  switch (route.mode) {
    case 'get-one':
      return {
        ids: [pathId(context)],
        ...selectionRenamed(readSelection(params, ['fields', 'asOf']), context),
      };
    case 'history':
      return { id: pathId(context), ...readSelection(params, ['asOf']) };
    case 'query-string':
      return decodeQueryString(route, params);
    case 'instance':
      return instanceInput(request, context);
    case 'stream':
      return undefined;
    case 'body': {
      if (route.action.input.kind === 'void') {
        return undefined;
      }
      const body = await readJsonBody(request, context.maxBodyBytes);
      if (route.action.generated === 'get' && isRecord(body) && body.fields !== undefined) {
        const { fields, ...rest } = body;
        return { ...rest, [selectionKey(context)]: fields };
      }
      return body ?? {};
    }
  }
}

/** What the route needs of the request besides the request itself. */
export interface DecodeContext {
  readonly route: RestRoute;
  /** Path parameters as the router read them. */
  readonly params: Readonly<Record<string, string>>;
  readonly preconditions: Preconditions;
  readonly maxBodyBytes: number;
}
