import type { ApiSurface, SurfaceAction } from '@keelwerk/core';
import { orpcPathOf } from '../../src/router/orpc-path-of.ts';
import type { OpenapiComparison } from './openapi-comparison.ts';

type Facts = OpenapiComparison['own'];
type Json = Readonly<Record<string, unknown>>;

const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const versionHeaders = ['keelwerk-version', 'deprecation', 'sunset', 'link'];

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function membersOf(value: unknown, name: string): Json {
  const held = isJson(value) ? value[name] : undefined;
  return isJson(held) ? held : {};
}

/** The node with every local `$ref` replaced by its target; a reference met again on its own path stays a reference. */
function resolved(document: Json, node: unknown, path: readonly string[] = []): unknown {
  if (Array.isArray(node)) return node.map((item) => resolved(document, item, path));
  if (!isJson(node)) return node;
  const ref = node.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    if (path.includes(ref)) return node;
    let target: unknown = document;
    for (const part of ref.slice(2).split('/')) {
      target = isJson(target)
        ? target[part.replaceAll('~1', '/').replaceAll('~0', '~')]
        : undefined;
    }
    return resolved(document, target, [...path, ref]);
  }
  return Object.fromEntries(
    Object.entries(node).map(([name, member]) => [name, resolved(document, member, path)]),
  );
}

interface Operation {
  readonly method: string;
  readonly path: string;
  readonly node: Json;
  readonly action: SurfaceAction | undefined;
}

function operationsOf(
  document: Json,
  actionOf: (operation: Json) => SurfaceAction | undefined,
): readonly Operation[] {
  return Object.entries(membersOf(document, 'paths')).flatMap(([path, item]) =>
    methods.flatMap((method) => {
      const node = membersOf(item, method);
      return Object.keys(node).length === 0 ? [] : [{ method, path, node, action: actionOf(node) }];
    }),
  );
}

function isErrorStatus(status: string): boolean {
  return status === 'default' || /^[45]/.test(status);
}

function responsesOf(document: Json, operation: Operation): readonly [string, Json][] {
  return Object.entries(membersOf(operation.node, 'responses')).map(([status, response]) => {
    const found = resolved(document, response);
    return [status, isJson(found) ? found : {}];
  });
}

/** Every string `const` below `value`. */
function constantsIn(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) constantsIn(item, into);
  } else if (isJson(value)) {
    if (typeof value.const === 'string') into.add(value.const);
    for (const member of Object.values(value)) constantsIn(member, into);
  }
}

/** The property names a schema takes at its top level, through `allOf`, `anyOf` and `oneOf`. */
function propertiesOf(schema: unknown): ReadonlySet<string> {
  const names = new Set<string>();
  if (!isJson(schema)) return names;
  for (const name of Object.keys(membersOf(schema, 'properties'))) names.add(name);
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    const parts = schema[keyword];
    if (Array.isArray(parts)) {
      for (const part of parts) for (const name of propertiesOf(part)) names.add(name);
    }
  }
  return names;
}

function takesPaging(document: Json, operation: Operation): boolean {
  const names = new Set<string>();
  const parameters = resolved(document, operation.node.parameters);
  if (Array.isArray(parameters)) {
    for (const parameter of parameters) {
      if (isJson(parameter) && typeof parameter.name === 'string') names.add(parameter.name);
    }
  }
  const body = resolved(document, operation.node.requestBody);
  for (const media of Object.values(membersOf(body, 'content'))) {
    for (const name of propertiesOf(membersOf(media, 'schema'))) names.add(name);
  }
  return names.has('first') && names.has('after');
}

function hasHeaderParameter(document: Json, operation: Operation, name: string): boolean {
  const parameters = resolved(document, operation.node.parameters);
  return (
    Array.isArray(parameters) &&
    parameters.some(
      (parameter) =>
        isJson(parameter) &&
        parameter.in === 'header' &&
        typeof parameter.name === 'string' &&
        parameter.name.toLowerCase() === name,
    )
  );
}

/** A schema anywhere in the document that requires `commandId` and holds `status` as 'accepted'. */
function holdsReceiptSchema(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsReceiptSchema);
  if (!isJson(value)) return false;
  const required = value.required;
  const status = membersOf(membersOf(value, 'properties'), 'status');
  if (Array.isArray(required) && required.includes('commandId') && status.const === 'accepted') {
    return true;
  }
  return Object.values(value).some(holdsReceiptSchema);
}

function factsOf(
  producer: Facts['producer'],
  document: Json,
  actionOf: (operation: Json) => SurfaceAction | undefined,
): Facts {
  const operations = operationsOf(document, actionOf);
  const mediaTypes = new Set<string>();
  const headerNames = new Set<string>();
  const documented = new Set<string>();
  let withDeclared = 0;
  let linked = false;
  let paged = 0;
  let accepted = 0;
  let prefer = 0;
  let idempotency = 0;
  for (const operation of operations) {
    const responses = responsesOf(document, operation);
    const held = new Set<string>();
    for (const [status, response] of responses) {
      for (const name of Object.keys(membersOf(response, 'headers'))) {
        const lower = name.toLowerCase();
        if (versionHeaders.includes(lower)) headerNames.add(lower);
        if (lower === 'link') linked = true;
      }
      if (!isErrorStatus(status)) continue;
      for (const media of Object.keys(membersOf(response, 'content'))) mediaTypes.add(media);
      constantsIn(response, held);
    }
    const declared = operation.action?.errors ?? [];
    if (declared.some((code) => held.has(code))) withDeclared += 1;
    for (const code of declared) {
      if (!code.startsWith('core.') && held.has(code)) documented.add(code);
    }
    if (operation.action?.output.kind === 'page' && takesPaging(document, operation)) paged += 1;
    if (responses.some(([status]) => status === '202')) accepted += 1;
    if (hasHeaderParameter(document, operation, 'prefer')) prefer += 1;
    if (hasHeaderParameter(document, operation, 'idempotency-key')) idempotency += 1;
  }
  return {
    producer,
    openapi: String(document.openapi),
    operations: operations.length,
    schemas: Object.keys(membersOf(membersOf(document, 'components'), 'schemas')).length,
    problemDetails: {
      errorMediaTypes: [...mediaTypes].sort(),
      operationsWithDeclaredErrors: withDeclared,
      declaredCodesDocumented: documented.size,
    },
    pagination: {
      pagedOperations: paged,
      linkHeader: linked,
    },
    executionModes: {
      acceptedResponses: accepted,
      preferHeader: prefer,
      idempotencyKeyHeader: idempotency,
      receiptSchema: holdsReceiptSchema(document),
    },
    versionHeaders: { responseHeaders: [...headerNames].sort() },
  };
}

function leavesOf(prefix: string, value: unknown): readonly [string, unknown][] {
  if (isJson(value)) {
    return Object.entries(value).flatMap(([name, member]) =>
      leavesOf(prefix === '' ? name : `${prefix}.${name}`, member),
    );
  }
  return [[prefix, value]];
}

/**
 * Counts what the two OpenAPI documents of one surface say (F-30): the document `emitOpenapi` wrote
 * (`own`) and the one oRPC's generator wrote (`orpc`), with every local `$ref` resolved. An
 * operation belongs to the action named by `x-keelwerk-action` in the first and by the
 * `operationId` (the router path joined by `.`) in the second.
 */
export function compareOpenapi(
  surface: ApiSurface,
  own: unknown,
  orpc: unknown,
): OpenapiComparison {
  const byRef = new Map(surface.actions.map((action) => [action.ref, action]));
  const byPath = new Map(surface.actions.map((action) => [orpcPathOf(action).join('.'), action]));
  const ownDocument = isJson(own) ? own : {};
  const orpcDocument = isJson(orpc) ? orpc : {};
  const ownFacts = factsOf('@keelwerk/transport-rest', ownDocument, (operation) => {
    const ref = operation['x-keelwerk-action'];
    return typeof ref === 'string' ? byRef.get(ref) : undefined;
  });
  const orpcFacts = factsOf('@orpc/openapi', orpcDocument, (operation) => {
    const id = operation.operationId;
    return typeof id === 'string' ? byPath.get(id) : undefined;
  });
  const left = new Map(leavesOf('', ownFacts));
  const differences = leavesOf('', orpcFacts).flatMap(([path, right]) => {
    const first = left.get(path);
    return JSON.stringify(first) === JSON.stringify(right)
      ? []
      : [`${path}: own ${JSON.stringify(first)}, orpc ${JSON.stringify(right)}`];
  });
  return {
    format: 'keelwerk.orpc-comparison/1',
    app: surface.app,
    apiVersion: surface.apiVersion,
    actions: surface.actions.length,
    own: ownFacts,
    orpc: orpcFacts,
    differences,
  };
}
