import type { ApiSurface, ErrorKind } from '@keelwerk/core';
import { statusOfError } from '@keelwerk/core/http';
import {
  type EventStreamReader,
  originOf,
  readEventStream,
  requestHeaders,
  type StreamFrame,
  type SubscribeCall,
  type TransportTarget,
} from '@keelwerk/testing';
import {
  type GraphQLField,
  type GraphQLObjectType,
  type GraphQLSchema,
  getNamedType,
  isUnionType,
} from 'graphql';
import { rootFieldName } from '../../src/schema/root-field-name.ts';
import { enumNamesIn, enumValuesIn } from './graphql-enum-names.ts';
import { cleaned } from './graphql-wire.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The event of one `next` result as the suite's frame: head, data, reset, gap or an error; undefined for a result that is no event. */
function frameOf(result: unknown, field: GraphQLField<unknown, unknown>): StreamFrame | undefined {
  if (!isRecord(result)) return undefined;
  const failures = Array.isArray(result.errors) ? result.errors : [];
  const first = failures[0];
  if (first !== undefined) {
    const keelwerk =
      isRecord(first) && isRecord(first.extensions) ? first.extensions.keelwerk : undefined;
    return { event: 'error', id: undefined, data: { error: keelwerk ?? first } };
  }
  const data = isRecord(result.data) ? result.data[field.name] : undefined;
  if (!isRecord(data)) return undefined;
  const wire = enumValuesIn(field.type, data);
  if (!isRecord(wire)) return undefined;
  const { __typename, state, ...rest } = wire;
  const stateText = typeof state === 'string' ? state : undefined;
  switch (__typename) {
    case 'StreamHead':
      return { event: 'head', id: stateText, data: { state: stateText } };
    case 'StreamReset':
      return { event: 'reset', id: undefined, data: cleaned({ ...rest, state }) };
    case 'StreamGap':
      return { event: 'gap', id: undefined, data: cleaned(rest) };
    default:
      return { event: 'data', id: stateText, data: cleaned(rest) };
  }
}

/** The frames of a GraphQL over SSE answer as the suite's frames: `next` results are events and `complete` ends the stream. */
function framesOf(real: Response, field: GraphQLField<unknown, unknown>): EventStreamReader {
  const inner = readEventStream(real);
  let ended = false;
  const next = async (ms?: number): Promise<StreamFrame | undefined> => {
    while (!ended) {
      const event = await inner.next(ms);
      if (event === undefined || event.event === 'complete') {
        ended = true;
        return undefined;
      }
      const frame = event.event === 'next' ? frameOf(event.data, field) : undefined;
      if (frame !== undefined) return frame;
    }
    return undefined;
  };
  return {
    response: real,
    next,
    until: async (test, ms) => {
      const seen: StreamFrame[] = [];
      for (;;) {
        const frame = await next(ms);
        if (frame === undefined) return seen;
        seen.push(frame);
        if (test(frame)) return seen;
      }
    },
    close: inner.close,
  };
}

/** What the subscription of a codec reads of its schema: the surface, the schema and the selection of an item's leaves. */
export interface GraphqlSubscribeEnv {
  readonly surface: ApiSurface;
  readonly schema: GraphQLSchema;
  readonly leaves: (type: GraphQLObjectType) => string;
}

/**
 * One subscription over GraphQL over SSE (distinct connections): `POST /graphql` with
 * `Accept: text/event-stream` and a `subscription` document that selects the control members and
 * the leaves of the item. `lastEventId` wins over `after`. The answer is read as the suite's frames
 * (head, data, reset, gap, error; enum names back as wire values), and the response carries the
 * status of the first result's error kind, else 200, with the real headers.
 */
export async function graphqlSubscribeOver(
  target: TransportTarget,
  call: SubscribeCall,
  env: GraphqlSubscribeEnv,
): Promise<EventStreamReader> {
  const action = env.surface.actions.find((candidate) => candidate.ref === call.action);
  if (action === undefined) throw new Error(`The suite has no action '${call.action}'.`);
  const field = env.schema.getSubscriptionType()?.getFields()[rootFieldName(action)];
  if (field === undefined) throw new Error(`The schema has no subscription '${action.ref}'.`);
  const event = getNamedType(field.type);
  const item = isUnionType(event)
    ? event.getTypes().find((member) => member.name.endsWith('Item'))
    : undefined;
  if (item === undefined) throw new Error(`The event of '${action.ref}' has no item type.`);
  const variables: Record<string, unknown> = {};
  const resume = call.lastEventId ?? call.after;
  if (resume !== undefined) variables.after = resume;
  if (isRecord(call.input)) {
    for (const [key, value] of Object.entries(call.input)) {
      const arg = field.args.find((candidate) => candidate.name === key);
      if (arg !== undefined) variables[key] = enumNamesIn(arg.type, value);
    }
  }
  const definitions = Object.keys(variables).map((key) => {
    const arg = field.args.find((candidate) => candidate.name === key);
    return `$${key}: ${arg === undefined ? 'String' : String(arg.type)}`;
  });
  const args = Object.keys(variables).map((key) => `${key}: $${key}`);
  const selection = `__typename ... on StreamHead { state } ... on StreamReset { reason state } ... on StreamGap { missed } ... on ${item.name} { state ${env.leaves(item)} }`;
  const head = definitions.length === 0 ? '' : `(${definitions.join(', ')})`;
  const call_ = args.length === 0 ? '' : `(${args.join(', ')})`;
  const query = `subscription${head} { ${field.name}${call_} { ${selection} } }`;
  const caller = call.caller ?? {};
  const headers = requestHeaders(caller);
  headers.set('content-type', 'application/json');
  headers.set('accept', 'text/event-stream');
  const response = await target.fetch(
    new Request(`${originOf(target, caller)}/graphql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    }),
    call.remoteAddress === undefined ? undefined : { remoteAddress: call.remoteAddress },
  );
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    return readEventStream(response);
  }
  const frames = framesOf(response, field);
  // The first frame decides the status the answer stands for; it is handed back first.
  const first = await frames.next();
  const failure = first?.event === 'error' && isRecord(first.data) ? first.data.error : undefined;
  const status = isRecord(failure)
    ? statusOfError({ kind: String(failure.kind) as ErrorKind, code: String(failure.code) })
    : 200;
  const queue: (StreamFrame | undefined)[] = [first];
  const next = async (ms?: number): Promise<StreamFrame | undefined> =>
    queue.length > 0 ? queue.shift() : frames.next(ms);
  return {
    response: new Response(null, { status, headers: response.headers }),
    next,
    until: async (test, ms) => {
      const seen: StreamFrame[] = [];
      for (;;) {
        const frame = await next(ms);
        if (frame === undefined) return seen;
        seen.push(frame);
        if (test(frame)) return seen;
      }
    },
    close: frames.close,
  };
}
