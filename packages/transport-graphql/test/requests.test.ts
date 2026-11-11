import type { Invocation, Outcome } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  ask,
  mountedGraphql,
  publicId,
  surfaceWithAction,
  transportSurface,
  uuidOf,
} from './support/graphql-kit.ts';
import { loanRow, rowPage } from './support/rows.ts';

const surface = transportSurface();

type Respond = (inv: Invocation<unknown>) => Outcome<unknown>;

const loans =
  (
    rows: readonly Record<string, unknown>[],
    over: Respond = () => ({ ok: true, value: undefined }),
  ): Respond =>
  (inv) =>
    inv.action === 'loans.loan.query' ? { ok: true, value: rowPage(rows) } : over(inv);

describe('answers and masks', () => {
  test('a masked field is null and named in _masked', async () => {
    const { handler } = await mountedGraphql(
      surface,
      loans([loanRow(1, { $masked: ['note'] }), loanRow(2, { note: 'kept' })]),
    );
    const answer = await ask(handler, '{ loansLoans { nodes { id note _masked } } }');
    expect(answer.body).toEqual({
      data: {
        loansLoans: {
          nodes: [
            { id: publicId('loan', 1), note: null, _masked: ['note'] },
            { id: publicId('loan', 2), note: 'kept', _masked: [] },
          ],
        },
      },
    });
    expect(answer.body.errors).toBeUndefined();
  });

  test('a masked reference is null and the book is never read', async () => {
    const hidden = loanRow(1, { $masked: ['bookId'] });
    const { handler, calls } = await mountedGraphql(surface, loans([hidden]));
    const answer = await ask(handler, '{ loansLoans { nodes { bookId book { title } _masked } } }');
    expect(answer.body.data.loansLoans.nodes).toEqual([
      { bookId: null, book: null, _masked: ['bookId'] },
    ]);
    expect(calls.map((call) => call.action)).toEqual(['loans.loan.query']);
  });

  test('a reference the row names as masked is never loaded, even if its id is still there', async () => {
    const { handler, calls } = await mountedGraphql(
      surface,
      loans([loanRow(1, { bookId: uuidOf(9), $masked: ['bookId'] })]),
    );
    const answer = await ask(handler, '{ loansLoans { nodes { book { title } } } }');
    expect(answer.body.data.loansLoans.nodes).toEqual([{ book: null }]);
    expect(calls.map((call) => call.action)).toEqual(['loans.loan.query']);
  });

  test('every value is encoded in its wire form, an enum as its name', async () => {
    const { handler } = await mountedGraphql(surface, loans([loanRow(1)]));
    const answer = await ask(
      handler,
      '{ loansLoans { nodes { dueAt version state } pageInfo { hasNextPage } } }',
    );
    expect(answer.body.data.loansLoans.nodes[0]).toEqual({
      dueAt: '2026-12-01T00:00:00.000Z',
      version: 1,
      state: 'OPEN',
    });
  });

  test('totalCount sets total on the query and reads the page total', async () => {
    const { handler, calls } = await mountedGraphql(surface, (inv) =>
      inv.action === 'loans.loan.query'
        ? { ok: true, value: rowPage([loanRow(1)], { total: 7 }) }
        : { ok: true, value: undefined },
    );
    const answer = await ask(handler, '{ loansLoans(first: 1) { totalCount nodes { id } } }');
    expect(answer.body.data.loansLoans.totalCount).toBe(7);
    expect(calls[0]?.input).toMatchObject({ first: 1, total: true });
    await ask(handler, '{ loansLoans { nodes { id } } }');
    expect(calls[1]?.input).not.toHaveProperty('total');
  });

  test('arguments reach the invoker in decoded form', async () => {
    const { handler, calls } = await mountedGraphql(surface, loans([]));
    await ask(
      handler,
      `{ loansLoans(first: 5, sort: [{ field: CREATED_AT, direction: DESC }], filter: { state: { eq: OPEN }, bookTitle: { startsWith: "T" } }) { nodes { id } } }`,
    );
    expect(calls[0]?.input).toMatchObject({
      first: 5,
      sort: [{ field: 'createdAt', direction: 'desc' }],
    });
  });

  test('a filter id operand as a bare UUID is refused', async () => {
    const { handler, calls } = await mountedGraphql(surface, loans([]));
    const bare = await ask(
      handler,
      `{ loansLoans(filter: { bookId: { eq: "${uuidOf(9)}" } }) { nodes { id } } }`,
    );
    expect(bare.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    expect(bare.body.errors[0].extensions.keelwerk.code).toBe('core.validation');
    expect(calls).toEqual([]);
    const public_ = await ask(
      handler,
      `{ loansLoans(filter: { bookId: { eq: "${publicId('book', 9)}" } }) { nodes { id } } }`,
    );
    expect(public_.body.errors).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test('a custom query takes its input members as arguments', async () => {
    const { handler, calls } = await mountedGraphql(surface, (inv) =>
      inv.action === 'library.findByIsbn'
        ? { ok: true, value: { bookId: uuidOf(4), title: 'Found' } }
        : { ok: true, value: undefined },
    );
    const answer = await ask(handler, '{ libraryFindByIsbn(isbn: "x-1") { bookId title } }');
    expect(answer.body).toEqual({
      data: { libraryFindByIsbn: { bookId: publicId('book', 4), title: 'Found' } },
    });
    expect(calls[0]?.input).toEqual({ isbn: 'x-1' });
    expect(calls[0]?.carrier.transport).toBe('graphql');
  });

  test('node reads an entity by the prefix of its public id', async () => {
    const { handler, calls } = await mountedGraphql(surface, (inv) =>
      inv.action === 'loans.loan.get'
        ? { ok: true, value: { list: [loanRow(3)], notFound: [] } }
        : { ok: true, value: undefined },
    );
    const answer = await ask(
      handler,
      `{ node(id: "${publicId('loan', 3)}") { __typename id ... on LoansLoan { bookTitle } } nodes(ids: ["nope_1", "${publicId('loan', 3)}"]) { id } }`,
    );
    expect(answer.body.data.node).toEqual({
      __typename: 'LoansLoan',
      id: publicId('loan', 3),
      bookTitle: 'Title 3',
    });
    expect(answer.body.data.nodes).toEqual([null, { id: publicId('loan', 3) }]);
    expect(calls.filter((call) => call.action === 'loans.loan.get').length).toBeGreaterThan(0);
  });

  test('node of an entity whose get is hidden answers null and invokes nothing', async () => {
    const hidden = surfaceWithAction(
      surface,
      { hints: { graphql: { expose: false } } },
      'loans.loan.get',
    );
    const { handler, calls } = await mountedGraphql(hidden, () => ({
      ok: true,
      value: { list: [loanRow(3)], notFound: [] },
    }));
    const answer = await ask(handler, `{ node(id: "${publicId('loan', 3)}") { id } }`);
    expect(answer.body).toEqual({ data: { node: null } });
    expect(calls).toEqual([]);
  });

  test('an enum answers its name and an argument name reaches the invoker as the wire value', async () => {
    const { handler, calls } = await mountedGraphql(surface, (inv) =>
      inv.action === 'loans.loan.query'
        ? { ok: true, value: rowPage([loanRow(1, { state: 'open' })]) }
        : { ok: true, value: undefined },
    );
    const answer = await ask(
      handler,
      '{ loansLoans(filter: { state: { eq: OPEN } }) { nodes { state } } }',
    );
    expect(answer.body.errors).toBeUndefined();
    expect(answer.body.data.loansLoans.nodes).toEqual([{ state: 'OPEN' }]);
    expect(calls[0]?.input).toMatchObject({ filter: { state: { eq: 'open' } } });
    const wire = await ask(
      handler,
      '{ loansLoans(filter: { state: { eq: open } }) { nodes { state } } }',
    );
    expect(wire.body.errors[0].extensions.keelwerk.code).toBe('core.validation');
    expect(calls).toHaveLength(1);
  });

  test('the entity by id is the first of the get', async () => {
    const { handler } = await mountedGraphql(surface, (inv) =>
      inv.action === 'loans.loan.get'
        ? { ok: true, value: { list: [], notFound: [uuidOf(1)] } }
        : { ok: true, value: undefined },
    );
    const answer = await ask(handler, `{ loansLoan(id: "${publicId('loan', 1)}") { id } }`);
    expect(answer.body).toEqual({ data: { loansLoan: null } });
  });
});
