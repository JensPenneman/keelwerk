import { defaultSelectionLimits } from '@keelwerk/core';
import { recordingLogger } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { nodesResolver } from '../src/resolve/nodes-resolver.ts';
import {
  ask,
  graphqlRequestId,
  graphqlSession,
  handlerWithLimits,
  mountedGraphql,
  publicId,
  sendGraphql,
  transportSurface,
} from './support/graphql-kit.ts';
import { relationSurface } from './support/relation-surface.ts';

const surface = transportSurface();
const nothing = () => ({ ok: true as const, value: undefined });

describe('a page below a page costs its own pages times the page size above it', () => {
  const relation = relationSurface();
  const refusedBy = async (query: string, variables?: Record<string, unknown>) => {
    const { handler, calls } = handlerWithLimits(relation, nothing, defaultSelectionLimits);
    const answer = await ask(handler, query, variables);
    expect(answer.status).toBe(422);
    expect(answer.body.errors[0].extensions.keelwerk.code).toBe('core.validation');
    expect(answer.body.errors[0].message).toMatch(/costs \d+; the cost limit is 1000/);
    expect(calls).toEqual([]);
  };

  test('first: 500 under first: 500 is refused by the cost limit before any row is read', async () => {
    await refusedBy(
      '{ libraryBooks(first: 500) { nodes { loans(first: 500) { nodes { id } } } } }',
    );
  });

  test('the sizes come from the variables, and an absent first is the largest page', async () => {
    await refusedBy(
      'query($n: Int) { libraryBooks(first: $n) { nodes { loans(first: $n) { nodes { id } } } } }',
      { n: 500 },
    );
    await refusedBy('{ libraryBooks { nodes { loans(first: 2) { nodes { id } } } } }');
  });

  test('small pages under small pages pass and run', async () => {
    const { handler } = handlerWithLimits(relation, () => ({ ok: true, value: undefined }), {
      ...defaultSelectionLimits,
    });
    const answer = await ask(
      handler,
      '{ libraryBooks(first: 10) { nodes { loans(first: 10) { nodes { id } } } } }',
    );
    expect(answer.status).not.toBe(422);
  });
});

describe('the ids of nodes and of a get field are bounded before any row is read', () => {
  const ids = (count: number) =>
    Array.from({ length: count }, (_, index) => publicId('book', index + 1));
  const bound = 100;
  const maxBook = surface.entities.find((entity) => entity.ref === 'library.book')?.page.maxSize;

  test('more ids than the bound, in a variable or a literal, are refused with core.validation', async () => {
    const { handler, calls } = handlerWithLimits(surface, nothing, defaultSelectionLimits);
    const tooMany = ids(bound + 1);
    const viaVariable = await ask(handler, 'query($ids: [ID!]!) { nodes(ids: $ids) { id } }', {
      ids: tooMany,
    });
    const viaLiteral = await ask(
      handler,
      `{ nodes(ids: [${tooMany.map((id) => `"${id}"`).join(', ')}]) { id } }`,
    );
    for (const answer of [viaVariable, viaLiteral]) {
      expect(answer.status).toBe(422);
      expect(answer.body.errors[0].extensions.keelwerk.code).toBe('core.validation');
      expect(answer.body.errors[0].message).toContain(`takes at most ${bound} ids`);
    }
    expect(calls).toEqual([]);
  });

  test('a get field takes at most the page maxSize of its entity, and the bound itself passes', async () => {
    const { handler, calls } = handlerWithLimits(surface, nothing, defaultSelectionLimits);
    const over = await ask(
      handler,
      'query($ids: [ID!]!) { libraryBookGet(ids: $ids) { list { id } } }',
      { ids: ids((maxBook ?? 0) + 1) },
    );
    expect(over.status).toBe(422);
    expect(over.body.errors[0].message).toContain(`takes at most ${maxBook} ids`);
    expect(calls).toEqual([]);
    const atBound = await ask(handler, 'query($ids: [ID!]!) { nodes(ids: $ids) { id } }', {
      ids: ids(bound),
    });
    expect(atBound.status).toBe(200);
  });

  test('one entity with a page maximum of 1 does not limit nodes below the flat bound', async () => {
    const small = {
      ...surface,
      entities: surface.entities.map((entity, index) =>
        index === 0 ? { ...entity, page: { ...entity.page, maxSize: 1 } } : entity,
      ),
    };
    const { handler } = handlerWithLimits(small, nothing, defaultSelectionLimits);
    const answer = await ask(handler, 'query($ids: [ID!]!) { nodes(ids: $ids) { id } }', {
      ids: ids(100),
    });
    expect(answer.status).toBe(200);
  });

  test('the nodes resolver refuses a list above the bound itself, before any load', () => {
    let loaded = 0;
    const context = {
      surface,
      session: graphqlSession(),
      development: false,
      requestId: graphqlRequestId,
      log: recordingLogger(),
      loaderOf: () => {
        loaded += 1;
        throw new Error('no load may run');
      },
    };
    expect(() =>
      nodesResolver(undefined, { ids: ids(bound + 1) }, context as never, {} as never),
    ).toThrow(`takes at most ${bound} ids`);
    expect(loaded).toBe(0);
  });

  test('nodes is charged as a connection page: ten per field', async () => {
    const wide = { ...defaultSelectionLimits, aliases: 1000 };
    const fields = (count: number) =>
      Array.from({ length: count }, (_, index) => `n${index}: nodes(ids: ["x"]) { id }`).join(' ');
    const passes = handlerWithLimits(surface, nothing, wide);
    // 90 pages at ten and 90 leaves are 990.
    expect((await ask(passes.handler, `{ ${fields(90)} }`)).status).toBe(200);
    const { handler, calls } = handlerWithLimits(surface, nothing, wide);
    // 101 pages at ten and 101 leaves are 1111; as plain leaves they would cost 202.
    const answer = await ask(handler, `{ ${fields(101)} }`);
    expect(answer.status).toBe(422);
    expect(answer.body.errors[0].message).toMatch(/costs \d+; the cost limit is 1000/);
    expect(calls).toEqual([]);
  });
});

describe('the limits the gate uses are the ones the server library batches by', () => {
  test('a configured number of operations above the default holds for a batch', async () => {
    const limits = { ...defaultSelectionLimits, operations: 25 };
    const { handler } = handlerWithLimits(surface, nothing, limits);
    const response = await sendGraphql(
      handler,
      Array.from({ length: 22 }, () => ({ query: '{ __typename }' })),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(22);
    const refusedToo = await sendGraphql(
      handler,
      Array.from({ length: 26 }, () => ({ query: '{ __typename }' })),
    );
    expect(refusedToo.status).toBe(422);
    expect((await refusedToo.json()).errors[0].extensions.keelwerk.code).toBe('core.validation');
  });
});

describe('what the variables may be', () => {
  test('variables nested deeper than 64 levels are malformed, never run', async () => {
    const { handler, calls } = await mountedGraphql(surface, nothing);
    const nested = (levels: number): unknown => {
      let value: unknown = { state: { eq: 'open' } };
      for (let level = 0; level < levels; level += 1) value = { not: value };
      return value;
    };
    const query = 'query($f: LoansLoanFilter) { loansLoans(filter: $f) { nodes { id } } }';
    const deep = await ask(handler, query, { f: nested(100) });
    expect(deep.status).toBe(400);
    expect(deep.body.errors[0].extensions.keelwerk.code).toBe('core.malformed_request');
    expect(calls).toEqual([]);
    const ok = await ask(handler, query, { f: nested(40) });
    expect(ok.status).toBe(200);
    const json = await ask(handler, 'query($v: JSON) { __typename }', { v: nested(70000) });
    expect(json.status).toBe(400);
  });
});
