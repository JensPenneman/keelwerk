import { defaultSelectionLimits } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  ask,
  handlerWithLimits,
  mountedGraphql,
  sendGraphql,
  transportSurface,
} from './support/graphql-kit.ts';

const surface = transportSurface();
const nothing = () => ({ ok: true as const, value: undefined });

async function refused(
  query: string | readonly string[],
  pattern: RegExp,
  limits = defaultSelectionLimits,
) {
  const { handler, calls } = handlerWithLimits(surface, nothing, limits);
  const response = await sendGraphql(
    handler,
    typeof query === 'string' ? { query } : query.map((text) => ({ query: text })),
  );
  const body = await response.json();
  expect(response.status).toBe(422);
  expect(body.errors).toHaveLength(1);
  expect(body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
  expect(body.errors[0].extensions.keelwerk.code).toBe('core.validation');
  expect(body.errors[0].message).toMatch(pattern);
  expect(calls).toEqual([]);
}

describe('the operation limits run before any row is read', () => {
  test('an entity type twice on a path is refused', async () => {
    await refused(
      '{ loansLoans { nodes { book { relatedToBook { title } } } } }',
      /repeats the entity type library\.book/,
    );
  });

  test('a path deeper than 12 entity levels is refused', async () => {
    const levels = 13;
    const open = 'relatedToBook { '.repeat(levels - 1);
    const query = `{ libraryBooks { nodes { ${open}title ${'}'.repeat(levels - 1)} } } }`;
    await refused(query, /13 levels deep; the depth limit is 12/, {
      ...defaultSelectionLimits,
      noRepeatedEntity: false,
    });
  });

  test('more than 30 aliases are refused', async () => {
    const aliases = Array.from({ length: 31 }, (_, index) => `a${index}: __typename`).join(' ');
    await refused(`{ ${aliases} }`, /31 aliases; the alias limit is 30/);
  });

  test('more than 20 operations across a batch are refused', async () => {
    await refused(
      Array.from({ length: 21 }, () => '{ __typename }'),
      /21 operations; the operation limit is 20/,
    );
  });

  test('more than 5,000 tokens are refused', async () => {
    const query = `{ ${'__typename '.repeat(5100)} }`;
    await refused(query, /5001 tokens; the token limit is 5000/);
  });

  test('a cost above 1,000 is refused', async () => {
    await refused(`{ ${'__typename '.repeat(1001)} }`, /costs 1001; the cost limit is 1000/);
  });

  test('a connection page costs ten', async () => {
    const fields = 'id '.repeat(995);
    await refused(`{ loansLoans { nodes { ${fields} } } }`, /costs 1001/);
  });

  test('introspection costs its leaves: a __schema selection cannot hide its cost', async () => {
    await refused(`{ __schema { types { ${'name '.repeat(1001)} } } }`, /costs 1001/);
  });

  test('an introspection list answers once per item of the schema, so thirty aliases of it are refused', async () => {
    const one = `__schema { types { name kind description fields(includeDeprecated: true) { name description args { name description type { name kind ofType { name kind ofType { name kind } } } } type { name kind ofType { name kind ofType { name kind } } } } inputFields { name type { name kind ofType { name kind ofType { name } } } } enumValues { name } } }`;
    const aliases = Array.from({ length: 30 }, (_, index) => `a${index}: ${one}`).join(' ');
    await refused(`{ ${aliases} }`, /the cost limit is 1000/);
  });

  test('the selection of an unknown field costs its leaves before validation runs', async () => {
    await refused(`{ nope { ${'a '.repeat(1001)} } }`, /costs 1001/);
  });

  test('a document at the limits passes and runs', async () => {
    const { handler, calls } = handlerWithLimits(surface, nothing, defaultSelectionLimits);
    const response = await sendGraphql(handler, { query: `{ ${'__typename '.repeat(1000)} }` });
    expect(response.status).toBe(200);
    expect(calls).toEqual([]);
  });
});

describe('what a request may be', () => {
  test('a body above maxBodyBytes is payload_too_large', async () => {
    const { handler, calls } = await mountedGraphql(surface, nothing, {
      config: { maxBodyBytes: 1024 },
    });
    const response = await sendGraphql(handler, { query: `{ __typename } # ${'x'.repeat(2000)}` });
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.errors[0].extensions.keelwerk.code).toBe('core.payload_too_large');
    expect(calls).toEqual([]);
  });

  test('a body over the bound is refused without a content-length too', async () => {
    const { handler } = await mountedGraphql(surface, nothing, { config: { maxBodyBytes: 1024 } });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(`{"query":"{ __typename }","pad":"${'x'.repeat(4000)}"}`),
        );
        controller.close();
      },
    });
    const request = new Request('https://portal.example/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const response = await handler(request, {
      session: (await import('./support/graphql-kit.ts')).graphqlSession(),
      carrier: { transport: 'http', headers: {} },
      requestId: '01929b5e-7c3a-7f00-9a51-2f0a0c1b4d11',
      signal: new AbortController().signal,
      path: '/',
      basePath: '/graphql',
    });
    expect(response.status).toBe(413);
  });

  test('a text/plain or form body is refused before execution', async () => {
    const { handler, calls } = await mountedGraphql(surface, nothing);
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const response = await sendGraphql(handler, undefined, {
        rawBody:
          '{"query":"mutation { loansCloseAll(input: { borrower: \\"ada\\" }) { __typename } }"}',
        headers: { 'content-type': type },
      });
      expect(response.status, type).toBe(400);
      const body = await response.json();
      expect(body.errors[0].extensions.keelwerk.code).toBe('core.malformed_request');
    }
    expect(calls).toEqual([]);
  });

  test('application/json with parameters is accepted', async () => {
    const { handler } = await mountedGraphql(surface, nothing);
    const response = await sendGraphql(
      handler,
      { query: '{ __typename }' },
      {
        headers: { 'content-type': 'Application/JSON; charset=utf-8' },
      },
    );
    expect(response.status).toBe(200);
  });

  test('a GET query is 405 outside development', async () => {
    const { handler, calls } = await mountedGraphql(surface, nothing);
    const response = await sendGraphql(handler, undefined, { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    const body = await response.json();
    expect(body.errors[0].extensions.keelwerk.code).toBe('core.unsupported');
    expect(calls).toEqual([]);
  });

  test('a GET query never executes in development either', async () => {
    const { handler, calls } = await mountedGraphql(surface, nothing, { development: true });
    const response = await sendGraphql(handler, undefined, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    expect(response.status).toBe(405);
    expect(calls).toEqual([]);
  });

  test('a persisted operation without query is malformed', async () => {
    const { handler } = await mountedGraphql(surface, nothing);
    const response = await sendGraphql(handler, {
      extensions: { persistedQuery: { version: 1, sha256Hash: 'abc' } },
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors[0].extensions.keelwerk.code).toBe('core.malformed_request');
    expect(body.errors[0].message).toContain('Persisted operations are not served');
  });

  test('an unparsable body, an empty batch and bad variables are malformed', async () => {
    const { handler } = await mountedGraphql(surface, nothing);
    for (const raw of [
      'not json',
      '[]',
      '{"query":"{ __typename }","variables":[]}',
      '5',
      '{"query":1}',
    ]) {
      const response = await sendGraphql(handler, undefined, { rawBody: raw });
      expect(response.status, raw).toBe(400);
    }
  });

  test('a syntax error is malformed and a path other than the root is not found', async () => {
    const { handler } = await mountedGraphql(surface, nothing);
    expect((await ask(handler, '{ loansLoans ')).status).toBe(400);
    const other = await sendGraphql(handler, { query: '{ __typename }' }, { path: '/other' });
    expect(other.status).toBe(404);
  });

  test('a validation error is a core.validation answer with every message and no suggestion', async () => {
    const { handler, calls } = await mountedGraphql(surface, nothing);
    const answer = await ask(handler, '{ loansLoanz { id } }');
    expect(answer.status).toBe(422);
    expect(answer.body.errors[0].extensions.keelwerk.code).toBe('core.validation');
    expect(JSON.stringify(answer.body)).not.toContain('Did you mean');
    expect(JSON.stringify(answer.body)).not.toContain('loansLoans');
    expect(calls).toEqual([]);
  });

  test('a batch answers one answer per document, in order', async () => {
    const { handler } = await mountedGraphql(surface, nothing);
    const response = await sendGraphql(handler, [
      { query: '{ a: __typename }' },
      { query: '{ b: __typename }' },
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ data: { a: 'Query' } }, { data: { b: 'Query' } }]);
  });
});
