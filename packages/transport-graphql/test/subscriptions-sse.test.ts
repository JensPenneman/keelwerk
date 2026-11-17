import { defaultSelectionLimits, type LiveFrame } from '@keelwerk/core';
import {
  freshName,
  lendCall,
  readEventStream,
  sendCall,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { graphqlCodec } from './support/graphql-codec.ts';
import {
  graphqlConformanceApp,
  graphqlConformanceVersions,
} from './support/graphql-conformance-app.ts';
import {
  ask,
  conformanceSurface,
  graphqlSession,
  handlerWithLimits,
  mountedGraphql,
  sendGraphql,
  surfaceWithAction,
  transportSurface,
} from './support/graphql-kit.ts';

const origins = ['https://app.example.test'];
const runtime = await startTransportRuntime({
  app: graphqlConformanceApp,
  host: httpHost({ listen: { port: 0 }, trustedProxies: ['127.0.0.1'] }),
  config: { graphql: { cors: origins, websocket: true } },
  tenants: ['acme', 'legacy'],
  tenantApiVersions: { legacy: graphqlConformanceVersions.older },
});
afterAll(() => runtime.stop());
const target = transportTargetOf(runtime, graphqlCodec, origins, true);
const subscribe = (...args: Parameters<NonNullable<typeof graphqlCodec.subscribe>>) => {
  if (graphqlCodec.subscribe === undefined) throw new Error('the codec has no stream');
  return graphqlCodec.subscribe(...args);
};
const stateOf = /^v2\.[0-9a-z.]+$/;
const eventStream = { accept: 'text/event-stream' };
const sse = (query: string) => ({ query });

describe('a subscription over GraphQL over SSE', () => {
  test('answers head, then items with their state, and after resumes', async () => {
    const ada = freshName('ada');
    const stream = await subscribe(target, {
      action: 'loans.loanEvents',
      input: {},
      caller: { subject: ada },
    });
    let seen: string | undefined;
    let firstLoan: string | undefined;
    try {
      const head = await stream.until((frame) => frame.event === 'head');
      expect(head.at(-1)?.id).toMatch(stateOf);
      await sendCall(target, lendCall(ada, freshName('Dune')));
      const item = await stream.next();
      expect(item?.event).toBe('data');
      seen = item?.id;
      firstLoan = (item?.data as { loanId?: string } | undefined)?.loanId;
      expect(item?.data).toMatchObject({ kind: 'created' });
    } finally {
      await stream.close();
    }
    expect(seen).toMatch(stateOf);
    await sendCall(target, lendCall(ada, freshName('Emma')));
    const resumed = await subscribe(target, {
      action: 'loans.loanEvents',
      input: {},
      caller: { subject: ada },
      ...(seen === undefined ? {} : { after: seen }),
    });
    try {
      const frames = await resumed.until((frame) => frame.event === 'head');
      const loans = frames
        .filter((frame) => frame.event === 'data')
        .map((frame) => (frame.data as { loanId: string }).loanId);
      expect(loans).toHaveLength(1);
      expect(loans).not.toContain(firstLoan);
    } finally {
      await resumed.close();
    }
  });

  test('at a deprecated version the first result carries extensions.keelwerk.deprecations and later results none', async () => {
    const ada = freshName('ada');
    const response = await target.fetch(
      new Request('https://legacy.example.test/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-principal': JSON.stringify({ subject: ada, roles: [], claims: {} }),
          ...eventStream,
        },
        body: JSON.stringify(
          sse(
            'subscription { loansLoanEvents { __typename ... on StreamHead { state } ... on LoansLoanEventsItem { kind } } }',
          ),
        ),
      }),
    );
    const reader = readEventStream(response);
    try {
      const results: { extensions?: { keelwerk?: { deprecations?: unknown[] } } }[] = [];
      const head = await reader.until((frame) => frame.event === 'next');
      results.push(head.at(-1)?.data as (typeof results)[number]);
      await sendCall(
        target,
        lendCall(ada, freshName('Dune'), { caller: { subject: ada, tenant: 'legacy' } }),
      );
      const item = await reader.until((frame) => frame.event === 'next');
      results.push(item.at(-1)?.data as (typeof results)[number]);
      expect(results[0]?.extensions?.keelwerk?.deprecations).toMatchObject([
        { kind: 'deprecation', apiVersion: graphqlConformanceVersions.older },
      ]);
      expect(results[1]).toMatchObject({ data: { loansLoanEvents: { kind: 'CREATED' } } });
      expect(results[1]?.extensions).toBeUndefined();
    } finally {
      await reader.close();
    }
  });

  test('a deprecated subscription puts its notice on the first result only', async () => {
    const surface = surfaceWithAction(
      conformanceSurface(),
      { deprecated: { at: '2026-11-05', sunset: '2099-12-31' } },
      'loans.loanEvents',
    );
    const { handler } = await mountedGraphql(surface, () => ({ ok: true, value: undefined }), {
      subscribe: async function* () {
        yield { control: 'head', state: 'v2.a' } as LiveFrame<unknown>;
        yield { event: { kind: 'created', loanId: 'x' }, state: 'v2.b' } as LiveFrame<unknown>;
      },
    });
    const response = await sendGraphql(
      handler,
      sse(
        'subscription { loansLoanEvents { __typename ... on StreamHead { state } ... on LoansLoanEventsItem { kind } } }',
      ),
      {
        headers: eventStream,
        session: graphqlSession({ app: surface.app, apiVersion: graphqlConformanceVersions.head }),
      },
    );
    const reader = readEventStream(response);
    const frames = await reader.until((frame) => frame.event === 'complete');
    const results = frames
      .filter((frame) => frame.event === 'next')
      .map((frame) => frame.data as { extensions?: { keelwerk?: { deprecations?: unknown[] } } });
    expect(results).toHaveLength(2);
    expect(results[0]?.extensions?.keelwerk?.deprecations).toMatchObject([
      { kind: 'deprecation', action: 'loans.loanEvents', at: '2026-11-05', sunset: '2099-12-31' },
    ]);
    expect(results[1]?.extensions).toBeUndefined();
  });

  test('a query at a deprecated version carries the notice', async () => {
    const { handler } = await mountedGraphql(transportSurface(), () => ({
      ok: true,
      value: undefined,
    }));
    const answer = await ask(handler, '{ __typename }', undefined, {
      session: graphqlSession({
        apiVersion: graphqlConformanceVersions.older,
        deprecation: { at: '2026-11-05', sunset: '2099-12-31' },
      }),
    });
    expect(answer.status).toBe(200);
    expect(answer.body.extensions.keelwerk.deprecations).toEqual([
      {
        kind: 'deprecation',
        apiVersion: graphqlConformanceVersions.older,
        at: '2026-11-05',
        sunset: '2099-12-31',
      },
    ]);
  });

  test('GraphQL SSE takes a stream slot: one anonymous address runs out at bounds.maxStreamsPerPrincipal, another does not', async () => {
    // Removing `host.limits.take` in with-stream-slot.ts makes the refused stream a 200.
    const open = (remoteAddress: string) =>
      subscribe(target, { action: 'loans.loanTicker', input: {}, remoteAddress });
    const held: Awaited<ReturnType<typeof open>>[] = [];
    try {
      for (let index = 0; index < target.bounds.maxStreamsPerPrincipal; index += 1) {
        const stream = await open('203.0.113.150');
        held.push(stream);
        expect(stream.response.status).toBe(200);
      }
      const refused = await open('203.0.113.150');
      held.push(refused);
      expect(refused.response.status).toBe(429);
      const other = await open('203.0.113.151');
      held.push(other);
      expect(other.response.status).toBe(200);
    } finally {
      await Promise.all(held.map((stream) => stream.close()));
    }
  });
});

describe('the operation limits over SSE', () => {
  test('a subscription over the limits (aliases, cost, introspection in its document) is refused before any subscribe', async () => {
    const surface = conformanceSurface();
    const aliases = Array.from({ length: 31 }, (_, index) => `a${index}: loanId`).join(' ');
    const attempts: [string, Partial<typeof defaultSelectionLimits>][] = [
      [
        `subscription { loansLoanEvents { __typename ... on LoansLoanEventsItem { ${aliases} } } }`,
        {},
      ],
      [
        'subscription { loansLoanEvents { __typename ... on LoansLoanEventsItem { loanId kind state } } }',
        { cost: 1 },
      ],
      [
        'query Q { __schema { types { name fields { name args { name } } } } } subscription S { loansLoanEvents { __typename } }',
        { cost: 50 },
      ],
    ];
    for (const [query, over] of attempts) {
      const { handler, subscribed } = handlerWithLimits(
        surface,
        () => ({ ok: true, value: undefined }),
        { ...defaultSelectionLimits, ...over },
        async function* () {
          yield { control: 'head', state: 'v2.a' } as LiveFrame<unknown>;
        },
      );
      const response = await sendGraphql(handler, sse(query), { headers: eventStream });
      const body = await response.json();
      expect(response.status, query).toBe(422);
      expect(body.errors[0].extensions.keelwerk.code, query).toBe('core.validation');
      expect(subscribed, query).toEqual([]);
    }
  });
});
