import type { LiveFrame, StateToken } from '@keelwerk/core';
import { readEventStream } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import {
  ask,
  conformanceSurface,
  type GraphqlSubscribe,
  mountedGraphql,
  sendGraphql,
} from './support/graphql-kit.ts';
import { rowPage } from './support/rows.ts';

const ticker =
  'subscription { loansLoanEvents { __typename ... on StreamHead { state } ... on LoansLoanEventsItem { kind } } }';

/** The hub's stream: a head, then it waits for the invocation to be aborted. */
const head: GraphqlSubscribe = (inv) =>
  (async function* (): AsyncGenerator<LiveFrame<unknown>> {
    yield { control: 'head', state: 'v2.a' as StateToken };
    await new Promise<void>((done) => {
      if (inv.signal?.aborted === true) done();
      else inv.signal?.addEventListener('abort', () => done(), { once: true });
    });
  })();

async function mounted() {
  return await mountedGraphql(conformanceSurface(), () => ({ ok: true, value: undefined }), {
    subscribe: head,
  });
}

describe('a subscription over POST is a stream the host gated', () => {
  test('without a stream Accept it is refused before any subscribe (406 core.unsupported)', async () => {
    // Take the `runsSubscription` refusal out of create-graphql-handler.ts: each of these subscribes.
    const accepts: (string | undefined)[] = [
      'application/json',
      'application/graphql-response+json',
      undefined,
      '*/*',
      'text/event-stream;q=0',
      'text/html',
    ];
    const { handler, subscribed } = await mounted();
    for (const accept of accepts) {
      const response = await sendGraphql(
        handler,
        { query: ticker },
        { headers: accept === undefined ? {} : { accept } },
      );
      const body = await response.json();
      expect(response.status, String(accept)).toBe(406);
      expect(body.errors[0].extensions.keelwerk.code, String(accept)).toBe('core.unsupported');
    }
    expect(subscribed).toEqual([]);
  });

  test('a batch that holds a subscription is refused before any subscribe, whatever its Accept', async () => {
    const { handler, subscribed } = await mounted();
    const batch = [{ query: ticker }, { query: ticker }];
    for (const accept of ['text/event-stream', 'application/json', '*/*']) {
      const response = await sendGraphql(handler, batch, { headers: { accept } });
      expect(response.status, accept).toBe(406);
      expect((await response.json()).errors[0].extensions.keelwerk.code).toBe('core.unsupported');
    }
    const mixed = await sendGraphql(handler, [{ query: '{ __typename }' }, { query: ticker }], {
      headers: { accept: 'text/event-stream' },
    });
    expect(mixed.status).toBe(406);
    expect(subscribed).toEqual([]);
  });

  test('the operation the operationName names decides: a query beside a subscription still runs', async () => {
    const { handler, subscribed } = await mounted();
    const document = `query Q { __typename } subscription S { loansLoanEvents { __typename } }`;
    const answer = await ask(handler, document, undefined, {
      headers: { accept: 'application/json' },
    });
    // No operationName names no operation: Yoga refuses it, and no subscribe ran.
    expect(answer.status).toBeGreaterThanOrEqual(400);
    const query = await sendGraphql(
      handler,
      { query: document, operationName: 'Q' },
      { headers: { accept: 'application/json' } },
    );
    expect(query.status).toBe(200);
    expect(await query.json()).toMatchObject({ data: { __typename: 'Query' } });
    expect(subscribed).toEqual([]);
  });

  test('one subscription that asks for text/event-stream streams, whatever else Accept names, and ends with its body', async () => {
    const { handler, subscribed } = await mounted();
    const response = await sendGraphql(
      handler,
      { query: ticker },
      { headers: { accept: 'application/json, text/event-stream;q=0.5' } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(subscribed).toHaveLength(1);
    const signal = subscribed[0]?.signal;
    expect(signal?.aborted).toBe(false);
    const reader = readEventStream(response);
    await reader.until((frame) => frame.event === 'next');
    await reader.close();
    await expect.poll(() => signal?.aborted).toBe(true);
  });

  test('Yoga is given text/event-stream whatever parameters the stream range carries', async () => {
    // Pass the request's own Accept on (acceptForYoga.ts, the subscription line): Yoga skips a range
    // whose charset is not utf-8, finds no processor and answers 406 with an empty body.
    const { handler, subscribed } = await mounted();
    const response = await sendGraphql(
      handler,
      { query: ticker },
      { headers: { accept: 'text/event-stream; charset=iso-8859-1' } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(subscribed).toHaveLength(1);
    const reader = readEventStream(response);
    await reader.until((frame) => frame.event === 'next');
    await reader.close();
  });

  test('a query that did not ask for a stream is never answered as one, whatever Yoga would match', async () => {
    // Pass the request's own Accept on for a query (acceptForYoga.ts): `text/*` and `text/event-stream;q=0`
    // make Yoga choose its event-stream processor, which the host refuses as an internal error (500).
    const { handler } = await mounted();
    for (const accept of [
      'text/*',
      'text/event-stream;q=0',
      'text/html',
      'text/*, application/json',
      'application/json; charset=iso-8859-1, text/*',
      'application/json; charset=iso-8859-1',
    ]) {
      const response = await sendGraphql(
        handler,
        { query: '{ __typename }' },
        { headers: { accept } },
      );
      expect(response.status, accept).toBe(200);
      expect(response.headers.get('content-type'), accept).not.toMatch(/text\/event-stream/);
      expect(await response.json(), accept).toMatchObject({ data: { __typename: 'Query' } });
    }
    const mapped = await sendGraphql(
      handler,
      { query: '{ nope }' },
      { headers: { accept: 'text/*, application/graphql-response+json' } },
    );
    expect(mapped.headers.get('content-type')).toMatch(/^application\/graphql-response\+json/);
    expect(mapped.status).toBe(422);
    // The first range that names a JSON type decides, as in Yoga: a wildcard names both and means
    // application/json, whatever follows it.
    for (const [accept, type] of [
      ['*/*, application/graphql-response+json', /^application\/json/],
      ['application/*, application/graphql-response+json', /^application\/json/],
      ['application/graphql-response+json, */*', /^application\/graphql-response\+json/],
    ] as const) {
      const answer = await sendGraphql(
        handler,
        { query: '{ __typename }' },
        { headers: { accept } },
      );
      expect(answer.status, accept).toBe(200);
      expect(answer.headers.get('content-type'), accept).toMatch(type);
    }
  });

  test('the request signal ends a stream: the invocation is aborted with it', async () => {
    const { handler, subscribed } = await mounted();
    const leaves = new AbortController();
    const response = await sendGraphql(
      handler,
      { query: ticker },
      { headers: { accept: 'text/event-stream' }, signal: leaves.signal },
    );
    const reader = readEventStream(response);
    await reader.until((frame) => frame.event === 'next');
    expect(subscribed[0]?.signal?.aborted).toBe(false);
    leaves.abort();
    await expect.poll(() => subscribed[0]?.signal?.aborted).toBe(true);
    await reader.close();
  });
});

describe('the work of a request ends with its answer', () => {
  test('a plain answer aborts the signal its resolvers were given, and the request signal stays open', async () => {
    // Take the `endWithResponse` call out of create-graphql-handler.ts: the signal of the query stays open.
    const { handler, calls } = await mountedGraphql(conformanceSurface(), (inv) =>
      inv.action === 'loans.loan.query'
        ? { ok: true, value: rowPage([]) }
        : { ok: true, value: undefined },
    );
    const parent = new AbortController();
    const answer = await sendGraphql(
      handler,
      { query: '{ loansLoans(first: 1) { nodes { id } } }' },
      { signal: parent.signal },
    );
    expect(answer.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
  });

  test('a refusal of the gate leaves nothing running', async () => {
    const { handler, calls } = await mountedGraphql(conformanceSurface(), () => ({
      ok: true,
      value: undefined,
    }));
    const answer = await sendGraphql(handler, { query: '{ nope }' });
    expect(answer.status).toBe(422);
    expect(calls).toEqual([]);
  });
});
