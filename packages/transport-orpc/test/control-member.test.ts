import {
  type ApiSurface,
  deriveSurface,
  type FieldNode,
  type HttpHandler,
  type LiveFrame,
  type MountContext,
  type SurfaceAction,
  versionProjection,
} from '@keelwerk/core';
import { readEventStream, type StreamFrame } from '@keelwerk/testing';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { describe, expect, test } from 'vitest';
import { mountOrpc } from '../src/mount/mount-orpc.ts';
import type { OrpcConfig } from '../src/orpc-config.ts';
import { orpcJsonSerializers } from '../src/wire/orpc-json-serializers.ts';
import { orpcConformanceApp, orpcConformanceVersions } from './support/orpc-conformance-app.ts';
import { orpcFrameOf } from './support/orpc-frame-of.ts';

const base: ApiSurface = deriveSurface(
  orpcConformanceApp as never,
  orpcConformanceVersions.head,
).surface;
const loanEvents = base.actions.find((action) => action.ref === 'loans.loanEvents');
if (loanEvents === undefined) throw new Error('The surface has no loans.loanEvents.');

const text: FieldNode = { kind: 'string', optional: false, access: 'read-write' };
const outputs: Readonly<Record<string, FieldNode>> = {
  shapeControl: {
    kind: 'shape',
    optional: false,
    access: 'read-write',
    fields: { control: text, note: text },
  },
  jsonControl: { kind: 'json', schema: {}, optional: false, access: 'read-write' },
  foreignControl: {
    kind: 'foreign',
    optional: false,
    access: 'read-write',
    input: { type: 'object' },
    output: { type: 'object' },
  },
};
const added: SurfaceAction[] = Object.entries(outputs).map(([name, output]) => ({
  ...loanEvents,
  ref: `loans.${name}`,
  name,
  output,
}));
const surface: ApiSurface = { ...base, actions: [...base.actions, ...added] };

/** Items whose own top-level member `control` names a control frame, then an ordinary one. */
const events = ['reset', 'head', 'gap', 'ordinary'].map((control, index) => ({
  event: { control, note: `n${index}` },
  state: `v2.${index + 2}` as never,
}));
const frames: LiveFrame<unknown>[] = [{ control: 'head', state: 'v2.1' as never }, ...events];

const routes: { prefix: string; handler: HttpHandler }[] = [];
await mountOrpc(
  {
    app: 'orpc-conformance',
    surface,
    surfaces: versionProjection([surface.apiVersion], () => surface),
    invoker: {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => {
          let index = 0;
          return {
            next: async () =>
              index < frames.length
                ? { done: false as const, value: frames[index++] as LiveFrame<unknown> }
                : await new Promise<never>(() => undefined),
            return: async () => ({ done: true as const, value: undefined }),
          };
        },
      }),
    },
    host: {
      route: (spec: { prefix: string }, handler: HttpHandler) =>
        routes.push({ prefix: spec.prefix, handler }),
    },
    config: () => undefined,
    log: { error: () => undefined },
  } as unknown as MountContext<OrpcConfig>,
  { openapi: '/orpc-openapi' },
);

function routeAt(prefix: string): HttpHandler {
  const route = routes.find((candidate) => candidate.prefix === prefix);
  if (route === undefined) throw new Error(`The transport registered no route at ${prefix}.`);
  return route.handler;
}

const ended = new AbortController();
function call(prefix: string, request: Request, subject: string, path: string): Promise<Response> {
  return routeAt(prefix)(request, {
    session: { apiVersion: surface.apiVersion, principal: { kind: 'user', subject } },
    carrier: { transport: 'http', headers: {} },
    requestId: '0192a000-0000-7000-8000-000000000001',
    signal: ended.signal,
    path,
    basePath: prefix,
  } as never);
}

function post(prefix: string, name: string, subject: string, body: unknown): Promise<Response> {
  return call(
    prefix,
    new Request(`https://acme.example.test${prefix}/loans/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
    }),
    subject,
    `/loans/${name}`,
  );
}

/** The frames of one stream as the suite reads them: the head, then every item. */
async function framesOf(response: Response, openapi: boolean): Promise<StreamFrame[]> {
  const stream = readEventStream(response);
  const seen: StreamFrame[] = [];
  try {
    for (let count = 0; count < frames.length; count += 1) {
      const event = await stream.next(5000);
      if (event === undefined) break;
      // The OpenAPI handler writes the frame itself, the RPC handler under `json`.
      const frame = orpcFrameOf(openapi ? { ...event, data: { json: event.data } } : event);
      if (typeof frame === 'object') seen.push(frame);
    }
  } finally {
    await stream.close();
  }
  return seen;
}

function expectItems(seen: readonly StreamFrame[]): void {
  expect(seen.map((frame) => frame.event)).toEqual(['head', 'data', 'data', 'data', 'data']);
  expect(seen.slice(1).map((frame) => (frame.data as { control: string }).control)).toEqual([
    'reset',
    'head',
    'gap',
    'ordinary',
  ]);
  expect(seen.slice(1).map((frame) => frame.id)).toEqual(['v2.2', 'v2.3', 'v2.4', 'v2.5']);
  expect(seen.slice(1).map((frame) => (frame.data as { note: string }).note)).toEqual([
    'n0',
    'n1',
    'n2',
    'n3',
  ]);
}

describe('an event with a member named control, whatever its kind', () => {
  for (const name of Object.keys(outputs)) {
    test(`${name}: two subscribers receive items, and none is reset`, async () => {
      for (const subject of ['ada', 'grace']) {
        const response = await post('/orpc', name, subject, { json: {} });
        expect(response.status).toBe(200);
        const seen = await framesOf(response, false);
        expect(seen[0]).toMatchObject({ event: 'head', id: 'v2.1' });
        expectItems(seen);
      }
    });
  }

  test('jsonControl: the OpenAPI route sends the same envelope', async () => {
    for (const subject of ['ada', 'grace']) {
      const response = await post('/orpc-openapi', 'jsonControl', subject, {});
      expect(response.status).toBe(200);
      expectItems(await framesOf(response, true));
    }
  });

  test('the real client receives them as items with their id', async () => {
    const link = new RPCLink({
      url: 'https://acme.example.test/orpc',
      customJsonSerializers: orpcJsonSerializers,
      fetch: (request) =>
        call('/orpc', request, 'ada', new URL(request.url).pathname.slice('/orpc'.length)),
    });
    type Source = AsyncIterable<{ control?: string; data?: { control: string }; id?: string }>;
    const client = createORPCClient<{ loans: Record<string, (input: object) => Promise<Source>> }>(
      link,
    );
    for (const name of Object.keys(outputs)) {
      const seen: { control?: string; data?: { control: string }; id?: string }[] = [];
      for await (const frame of await (client.loans[name] ?? (() => Promise.reject()))({})) {
        seen.push(frame);
        if (seen.length === frames.length) break;
      }
      expect(seen[0]?.control).toBe('head');
      expect(seen.slice(1).map((frame) => frame.data?.control)).toEqual([
        'reset',
        'head',
        'gap',
        'ordinary',
      ]);
      expect(seen.slice(1).map((frame) => frame.id)).toEqual(['v2.2', 'v2.3', 'v2.4', 'v2.5']);
    }
  });
});

describe('orpcFrameOf', () => {
  const message = (json: unknown, id?: string | undefined): StreamFrame => ({
    event: 'message',
    id,
    data: { json },
  });

  test('a frame with both data and control is malformed', () => {
    expect(() => orpcFrameOf(message({ data: {}, control: 'reset' }))).toThrow(
      /^A malformed oRPC frame/,
    );
  });

  test('a frame with neither is malformed', () => {
    expect(() => orpcFrameOf(message({ note: 'x' }))).toThrow(/^A malformed oRPC frame/);
    expect(() => orpcFrameOf(message(7))).toThrow(/^A malformed oRPC frame/);
  });

  test('an item with another member, or an id other than the event id, is malformed', () => {
    expect(() => orpcFrameOf(message({ data: 1, note: 'x' }, 'v2.1'))).toThrow(
      /^A malformed oRPC frame/,
    );
    expect(() => orpcFrameOf(message({ data: 1, id: 'v2.9' }, 'v2.1'))).toThrow(
      /^A malformed oRPC frame/,
    );
  });

  test('an event id the server never sends is malformed', () => {
    const refused = (json: unknown, id?: string) =>
      expect(() => orpcFrameOf(message(json, id))).toThrow(/^A malformed oRPC frame/);
    refused({ control: 'gap', missed: 3 }, 'v2.1');
    refused({ control: 'reset', reason: 'resync' }, 'v2.1');
    refused({ control: 'head', state: 'v2.1' }, 'v2.2');
    refused({ control: 'head', state: 'v2.1' });
    refused({ control: 'reset', reason: 'overflow', state: 'v2.1' });
    refused({ data: 1 }, 'v2.1');
    refused({ control: 'head' });
    refused({ control: 'head', state: 7 });
  });

  test('the event id of a head and of a reset with a state is that state', () => {
    expect(orpcFrameOf(message({ control: 'head', state: 'v2.1' }, 'v2.1'))).toEqual({
      event: 'head',
      id: 'v2.1',
      data: { state: 'v2.1' },
    });
    expect(
      orpcFrameOf(message({ control: 'reset', reason: 'overflow', state: 'v2.2' }, 'v2.2')),
    ).toEqual({ event: 'reset', id: 'v2.2', data: { reason: 'overflow', state: 'v2.2' } });
  });

  test('a control of a kind the reader does not know is skipped', () => {
    expect(orpcFrameOf(message({ control: 'other' }))).toBe('skip');
  });

  test('an item whose event has a member named control is an item', () => {
    expect(orpcFrameOf(message({ data: { control: 'reset' }, id: 'v2.2' }, 'v2.2'))).toEqual({
      event: 'data',
      id: 'v2.2',
      data: { control: 'reset' },
    });
  });

  test('a control frame is its own event', () => {
    expect(orpcFrameOf(message({ control: 'gap', missed: 3 }))).toEqual({
      event: 'gap',
      id: undefined,
      data: { missed: 3 },
    });
  });
});
