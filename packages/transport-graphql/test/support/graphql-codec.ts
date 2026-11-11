import { deriveSurface, type ErrorKind } from '@keelwerk/core';
import { statusOfError } from '@keelwerk/core/http';
import {
  type Call,
  type Decoded,
  decodeAnswer,
  originOf,
  requestHeaders,
  type TransportCodec,
} from '@keelwerk/testing';
import {
  type GraphQLField,
  type GraphQLNamedType,
  type GraphQLObjectType,
  type GraphQLOutputType,
  getNamedType,
  isEnumType,
  isObjectType,
  isScalarType,
  isUnionType,
} from 'graphql';
import { buildGraphqlSchema } from '../../src/schema/build-graphql-schema.ts';
import { referenceFieldName } from '../../src/schema/reference-field-name.ts';
import { rootFieldName } from '../../src/schema/root-field-name.ts';
import { enumNamesIn, enumValuesIn } from './graphql-enum-names.ts';
import { filterOf } from './graphql-filter.ts';
import { transportWithGraphql } from './transport-app.ts';

const surface = deriveSurface(transportWithGraphql as never, '2026-11-04').surface;
const projection = buildGraphqlSchema(surface);
const { schema } = projection;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The selection of every leaf of an object type, one level of plain objects below it, never an entity (a reference is followed by `properties` only). */
function leavesOf(type: GraphQLObjectType, withTotal: boolean, depth = 0): string {
  const parts: string[] = [];
  for (const [name, field] of Object.entries(type.getFields())) {
    const named = getNamedType(field.type);
    if (name === 'totalCount' && !withTotal) continue;
    if (isScalarType(named) || isEnumType(named)) {
      parts.push(name);
    } else if (isObjectType(named) && !projection.entityTypes.has(named.name) && depth < 2) {
      if (name === 'nodes') continue;
      parts.push(`${name} { ${leavesOf(named, withTotal, depth + 1)} }`);
    }
  }
  return parts.join(' ');
}

/** The path of `properties`, as a selection: a reference field becomes the object beside it. */
function pathSelection(type: GraphQLObjectType, path: readonly string[]): string {
  const [head, ...rest] = path;
  if (head === undefined) return '';
  const field = type.getFields()[head];
  if (field !== undefined && rest.length === 0) return head;
  const entityRef = projection.entityTypes.get(type.name);
  const entity = surface.entities.find((candidate) => candidate.ref === entityRef);
  const node = entity?.fields[head];
  if (node?.kind === 'ref') {
    const target = surface.entities.find((candidate) => candidate.ref === node.target);
    if (target !== undefined) {
      const objectName = referenceFieldName(head, target);
      const objectType = type.getFields()[objectName];
      const named = objectType === undefined ? undefined : getNamedType(objectType.type);
      if (named !== undefined && isObjectType(named)) {
        return `${objectName} { ${pathSelection(named, rest)} }`;
      }
    }
  }
  return head;
}

function entitySelection(
  entity: GraphQLObjectType,
  properties: unknown,
  withTotal: boolean,
): string {
  if (!Array.isArray(properties)) return leavesOf(entity, withTotal);
  return `id version ${properties.map((path: string) => pathSelection(entity, path.split('.'))).join(' ')}`;
}

/** The default selection of a field's type: every leaf, the union members, the page and its connection members. */
function selectionOf(type: GraphQLNamedType, call: Call): string {
  const properties = call.input?.properties;
  const withTotal = call.input?.total === true;
  if (isUnionType(type)) {
    const members = type.getTypes().map((member) => {
      if (member.name.endsWith('Success')) {
        const result = member.getFields().result;
        const named = result === undefined ? undefined : getNamedType(result.type);
        const inner =
          named !== undefined && isObjectType(named)
            ? ` result { ${leavesOf(named, false)} }`
            : named === undefined
              ? ''
              : ' result';
        return `... on ${member.name} { commandId${inner} }`;
      }
      return `... on ${member.name} { ${leavesOf(member, false)} }`;
    });
    return `__typename ${members.join(' ')}`;
  }
  if (!isObjectType(type)) return '';
  const nodes = type.getFields().nodes;
  if (nodes !== undefined) {
    const entity = getNamedType(nodes.type);
    if (isObjectType(entity)) {
      const total = withTotal ? ' totalCount' : '';
      return `nodes { ${entitySelection(entity, properties, false)} } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } queryState${total}`;
    }
  }
  const list = type.getFields().list;
  if (list !== undefined && isObjectType(getNamedType(list.type))) {
    const entity = getNamedType(list.type);
    if (isObjectType(entity)) return `list { ${leavesOf(entity, false)} } notFound state`;
  }
  return leavesOf(type, false);
}

interface Operation {
  readonly query: string;
  readonly variables: Record<string, unknown>;
  /** The root field the answer's data sits under and its type, to read enum names back as wire values. */
  readonly rootField: string;
  readonly rootType: GraphQLOutputType;
}

function operationOf(call: Call): Operation {
  const action = surface.actions.find((candidate) => candidate.ref === call.action);
  if (action === undefined) throw new Error(`The suite has no action '${call.action}'.`);
  const name = rootFieldName(action);
  const command = action.kind === 'command';
  const root = command ? schema.getMutationType() : schema.getQueryType();
  const field: GraphQLField<unknown, unknown> | undefined = root?.getFields()[name];
  if (field === undefined) throw new Error(`The schema has no field '${name}'.`);
  const input = { ...call.input };
  const variables: Record<string, unknown> = {};
  if (command) {
    if (call.ifVersion !== undefined) input.ifVersion = call.ifVersion;
    const arg = field.args.find((candidate) => candidate.name === 'input');
    const members: Record<string, unknown> =
      action.input.kind === 'foreign' ? { value: call.input } : input;
    const wire = {
      ...members,
      ...(call.commandId === undefined ? {} : { commandId: call.commandId }),
      ...(call.prefer === undefined ? {} : { prefer: call.prefer }),
    };
    variables.input = arg === undefined ? wire : enumNamesIn(arg.type, wire);
    const type = String(arg?.type ?? 'JSON');
    const query = `mutation($input: ${type}) { ${name}(input: $input) { ${selectionOf(getNamedType(field.type), call)} } }`;
    return { query, variables, rootField: name, rootType: field.type };
  }
  if (action.input.kind === 'foreign') {
    variables.input = call.input;
  } else {
    for (const [key, value] of Object.entries(input)) {
      if (key === 'properties' || key === 'total') continue;
      variables[key] = key === 'filter' ? filterOf(value) : value;
    }
  }
  for (const [key, value] of Object.entries(variables)) {
    const arg = field.args.find((candidate) => candidate.name === key);
    if (arg !== undefined) variables[key] = enumNamesIn(arg.type, value);
  }
  const definitions = Object.keys(variables).map((key) => {
    const arg = field.args.find((candidate) => candidate.name === key);
    if (arg === undefined) throw new Error(`The field '${name}' has no argument '${key}'.`);
    return `$${key}: ${arg.type}`;
  });
  const args = Object.keys(variables).map((key) => `${key}: $${key}`);
  const named = getNamedType(field.type);
  const selection = selectionOf(named, call);
  const open = definitions.length === 0 ? '' : `(${definitions.join(', ')})`;
  const call_ = args.length === 0 ? '' : `(${args.join(', ')})`;
  const body = isScalarType(named) ? '' : ` { ${selection} }`;
  return {
    query: `query${open} { ${name}${call_}${body} }`,
    variables,
    rootField: name,
    rootType: field.type,
  };
}

/** GraphQL nulls are absent (16.4.2) and a non-empty `_masked` is the `$masked` member of the row. */
function cleaned(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleaned);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (key === '_masked') {
      if (Array.isArray(member) && member.length > 0) out.$masked = member;
    } else if (member !== null && key !== '__typename') {
      out[key] = cleaned(member);
    }
  }
  return out;
}

function connectionOf(value: Record<string, unknown>): unknown {
  const page = isRecord(value.pageInfo) ? cleaned(value.pageInfo) : undefined;
  return {
    items: cleaned(value.nodes),
    ...(page === undefined ? {} : { pageInfo: page }),
    ...(typeof value.totalCount === 'number' ? { total: value.totalCount } : {}),
    ...(typeof value.queryState === 'string' ? { queryState: value.queryState } : {}),
  };
}

/** The answer with the enum names under the root field read back as wire values, so the shared cases see what REST and JSON carry. */
function wireValuesIn(body: unknown, operation: Operation): unknown {
  if (!isRecord(body) || !isRecord(body.data) || !Object.hasOwn(body.data, operation.rootField)) {
    return body;
  }
  return {
    ...body,
    data: {
      ...body.data,
      [operation.rootField]: enumValuesIn(operation.rootType, body.data[operation.rootField]),
    },
  };
}

function errorKindOf(code: string): string {
  return surface.errors.find((candidate) => candidate.code === code)?.kind ?? 'internal';
}

function decodedOf(body: unknown): Decoded {
  if (!isRecord(body)) return { ok: false, kind: 'unparsed', code: 'not_json' };
  if (body.ok === false && isRecord(body.error)) {
    return { ok: false, kind: String(body.error.kind), code: String(body.error.code) };
  }
  const errors = Array.isArray(body.errors) ? body.errors : [];
  const first = errors[0];
  const keelwerk =
    isRecord(first) && isRecord(first.extensions) ? first.extensions.keelwerk : undefined;
  if (isRecord(keelwerk) && (body.data === null || body.data === undefined)) {
    return { ok: false, kind: String(keelwerk.kind), code: String(keelwerk.code) };
  }
  const data = isRecord(body.data) ? Object.values(body.data)[0] : undefined;
  if (isRecord(keelwerk) && data === null) {
    return { ok: false, kind: String(keelwerk.kind), code: String(keelwerk.code) };
  }
  if (isRecord(data) && typeof data.__typename === 'string') {
    if (data.__typename === 'CommandAccepted') {
      return {
        ok: true,
        value: { commandId: data.commandId, status: data.status },
        accepted: true,
      };
    }
    if (data.__typename.endsWith('Success')) {
      return { ok: true, value: cleaned(data.result), accepted: false };
    }
    if (typeof data.code === 'string') {
      return { ok: false, kind: errorKindOf(data.code), code: data.code };
    }
  }
  if (isRecord(data) && Array.isArray(data.nodes))
    return { ok: true, value: connectionOf(data), accepted: false };
  return { ok: true, value: cleaned(data), accepted: false };
}

function commandIdIn(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const data = Object.values(body.data)[0];
  return isRecord(data) && typeof data.commandId === 'string' ? data.commandId : null;
}

/**
 * GraphQL (16.6): one operation per call over `POST /graphql`, `input` and the arguments as
 * variables, a default selection of every scalar leaf plus `_masked` and union fragments. The
 * decoded outcome reads the answer the way a GraphQL client does: nulls are absent, a connection is
 * a page, a union member is the outcome. `Sent.response` keeps the real headers and body and
 * carries the 16.4.6 status of the decoded outcome (202 and `preference-applied` for an accepted
 * command), derived only from what the answer says, because the shared cases assert those REST
 * statuses and a GraphQL answer has no place for them. `Sent.body` is the real body, except that an
 * accepted command's body is its receipt, the `CommandAccepted` member the answer carries. Variables
 * and answers are mapped through the schema's enums (`enumNamesIn`, `enumValuesIn`), so the shared
 * cases keep their wire values. The response also carries a `keelwerk-command-id` header made of the
 * `commandId` the answer holds. That header is the codec's own way to hand the command id of a
 * mutation's answer to the shared cases, which read it there; a real GraphQL answer carries no such
 * header.
 */
export const graphqlCodec: TransportCodec = {
  name: 'GraphQL',
  endpoint: '/graphql',
  async send(target, call) {
    const caller = call.caller ?? {};
    const headers = requestHeaders(caller);
    headers.set('content-type', 'application/json');
    const operation = operationOf(call);
    const response = await target.fetch(
      new Request(`${originOf(target, caller)}${caller.pathPrefix ?? ''}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: operation.query, variables: operation.variables }),
      }),
    );
    const real = await decodeAnswer(response, true);
    const decoded = decodedOf(wireValuesIn(real.body, operation));
    const status = decoded.ok
      ? decoded.accepted
        ? 202
        : 200
      : statusOfError({ kind: decoded.kind as ErrorKind, code: decoded.code });
    const merged = new Headers(response.headers);
    if (decoded.ok && decoded.accepted) merged.set('preference-applied', 'respond-async');
    const commandId = commandIdIn(real.body);
    if (commandId !== null) merged.set('keelwerk-command-id', commandId);
    return {
      decoded,
      // The receipt of an accepted command is the body the shared cases read; the response keeps the real body.
      body: decoded.ok && decoded.accepted ? decoded.value : real.body,
      response: new Response(JSON.stringify(real.body ?? null), { status, headers: merged }),
    };
  },
  receiptLocationOf: () => null,
  expectedReceiptLocation: () => null,
  rowVersionOf(sent) {
    const value =
      sent.decoded.ok && isRecord(sent.decoded.value) ? sent.decoded.value.version : undefined;
    return typeof value === 'number' ? value : null;
  },
  commandIdOf: (sent) => commandIdIn(sent.body),
  reportsChosenCommandId: true,
  isReplay: () => false,
  marksReplays: false,
  configurableCors: true,
  followsRelations: true,
};
