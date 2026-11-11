import type { Invocation, Outcome } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { buildGraphqlSchema } from '../src/schema/build-graphql-schema.ts';
import {
  ask,
  mountedGraphql,
  publicId,
  surfaceWithAction,
  transportSurface,
  uuidOf,
} from './support/graphql-kit.ts';
import { relationSurface } from './support/relation-surface.ts';
import { libraryBookRow, loanRow, rowPage } from './support/rows.ts';

/** Five loans over three books; `get` answers the books asked for. */
function library(inv: Invocation<unknown>): Outcome<unknown> {
  if (inv.action === 'loans.loan.query') {
    const books = [11, 12, 13, 11, 12];
    return {
      ok: true,
      value: rowPage(books.map((book, index) => loanRow(index + 1, { bookId: uuidOf(book) }))),
    };
  }
  if (inv.action === 'library.book.get') {
    const { ids } = inv.input as { ids: readonly string[] };
    return {
      ok: true,
      value: { list: ids.map((id) => libraryBookRow(Number(id.slice(-12)))), notFound: [] },
    };
  }
  return { ok: true, value: undefined };
}

describe('to-one references', () => {
  test('a page of loans loads its books with one get', async () => {
    const { handler, calls } = await mountedGraphql(transportSurface(), library);
    const answer = await ask(handler, '{ loansLoans { nodes { id book { id title } } } }');
    expect(answer.body.errors).toBeUndefined();
    expect(
      answer.body.data.loansLoans.nodes.map((node: { book: { title: string } }) => node.book.title),
    ).toEqual(['Book 11', 'Book 12', 'Book 13', 'Book 11', 'Book 12']);
    const gets = calls.filter((call) => call.action === 'library.book.get');
    expect(gets).toHaveLength(1);
    expect(Reflect.get(gets[0]?.input ?? {}, 'ids')).toHaveLength(3);
  });

  test('a batch holds at most the page maxSize of the target entity', async () => {
    const base = transportSurface();
    const surface = {
      ...base,
      entities: base.entities.map((entity) =>
        entity.ref === 'library.book'
          ? { ...entity, page: { ...entity.page, maxSize: 2 } }
          : entity,
      ),
    };
    const { handler, calls } = await mountedGraphql(surface, library);
    const answer = await ask(handler, '{ loansLoans { nodes { id book { id title } } } }');
    expect(answer.body.errors).toBeUndefined();
    const gets = calls.filter((call) => call.action === 'library.book.get');
    expect(gets).toHaveLength(2);
    for (const get of gets) {
      expect(Reflect.get(get.input as object, 'ids').length).toBeLessThanOrEqual(2);
    }
  });

  test('two requests never share a loader', async () => {
    const { handler, calls } = await mountedGraphql(transportSurface(), library);
    const query = '{ loansLoans { nodes { book { title } } } }';
    await Promise.all([ask(handler, query), ask(handler, query)]);
    await ask(handler, query);
    expect(calls.filter((call) => call.action === 'library.book.get')).toHaveLength(3);
  });

  test('a book reached twice in one request is read once', async () => {
    const { handler, calls } = await mountedGraphql(transportSurface(), library);
    await ask(
      handler,
      '{ a: loansLoans { nodes { book { title } } } b: loansLoans { nodes { book { id } } } }',
    );
    expect(calls.filter((call) => call.action === 'library.book.get').length).toBeLessThanOrEqual(
      2,
    );
  });

  test('a book that does not exist reads as null', async () => {
    const { handler } = await mountedGraphql(transportSurface(), (inv) =>
      inv.action === 'library.book.get'
        ? { ok: true, value: { list: [], notFound: [uuidOf(11)] } }
        : library(inv),
    );
    const answer = await ask(handler, '{ loansLoans { nodes { book { title } } } }');
    expect(answer.body.errors).toBeUndefined();
    expect(answer.body.data.loansLoans.nodes[0]).toEqual({ book: null });
  });

  test('a reference to the same entity type is named after the target and cannot be followed (16.4.12)', async () => {
    const { handler, calls } = await mountedGraphql(transportSurface(), () => ({
      ok: true,
      value: rowPage([libraryBookRow(1, { relatedTo: uuidOf(2) })]),
    }));
    const plain = await ask(handler, '{ libraryBooks { nodes { relatedTo } } }');
    expect(plain.body.data.libraryBooks.nodes).toEqual([{ relatedTo: publicId('book', 2) }]);
    const followed = await ask(handler, '{ libraryBooks { nodes { relatedToBook { title } } } }');
    expect(followed.status).toBe(422);
    expect(followed.body.errors[0].message).toContain('repeats the entity type library.book');
    expect(calls).toHaveLength(1);
  });
});

describe('to-many relations', () => {
  test('a to-many relation runs one query per parent with the relation condition', async () => {
    const { handler, calls } = await mountedGraphql(relationSurface(), (inv) => {
      if (inv.action === 'library.book.query') {
        return { ok: true, value: rowPage([libraryBookRow(1), libraryBookRow(2)]) };
      }
      if (inv.action === 'loans.loan.query') {
        return { ok: true, value: rowPage([loanRow(7)]) };
      }
      return { ok: true, value: undefined };
    });
    const answer = await ask(
      handler,
      '{ libraryBooks(first: 2) { nodes { id loans(first: 2) { nodes { id } } } } }',
    );
    expect(answer.body.errors).toBeUndefined();
    expect(answer.body.data.libraryBooks.nodes).toEqual([
      { id: publicId('book', 1), loans: { nodes: [{ id: publicId('loan', 7) }] } },
      { id: publicId('book', 2), loans: { nodes: [{ id: publicId('loan', 7) }] } },
    ]);
    const queries = calls.filter((call) => call.action === 'loans.loan.query');
    expect(queries).toHaveLength(2);
    expect(queries[0]?.input).toMatchObject({ first: 2 });
    for (const [index, query] of queries.entries()) {
      expect(JSON.stringify((query.input as { filter: unknown }).filter)).toContain(
        uuidOf(index + 1),
      );
      expect(JSON.stringify((query.input as { filter: unknown }).filter)).toContain('bookId');
    }
  });

  test("the caller's own filter is joined to the relation condition", async () => {
    const { handler, calls } = await mountedGraphql(relationSurface(), (inv) =>
      inv.action === 'library.book.query'
        ? { ok: true, value: rowPage([libraryBookRow(1)]) }
        : { ok: true, value: rowPage([]) },
    );
    await ask(
      handler,
      '{ libraryBooks(first: 2) { nodes { loans(first: 2, filter: { state: { eq: OPEN } }) { nodes { id } } } } }',
    );
    const query = calls.find((call) => call.action === 'loans.loan.query');
    const text = JSON.stringify(query?.input);
    expect(text).toContain('"open"');
    expect(text).toContain(uuidOf(1));
  });

  test('a relation to a query that is hidden from GraphQL has no field and invokes nothing', async () => {
    const hidden = surfaceWithAction(
      relationSurface(),
      { hints: { graphql: { expose: false } } },
      'loans.loan.query',
    );
    const book = buildGraphqlSchema(hidden).schema.getType('LibraryBook');
    expect(book !== undefined && 'getFields' in book && book.getFields().loans).toBeUndefined();
    const { handler, calls } = await mountedGraphql(hidden, () => ({
      ok: true,
      value: rowPage([libraryBookRow(1)]),
    }));
    const answer = await ask(
      handler,
      '{ libraryBooks(first: 2) { nodes { loans(first: 2) { nodes { id } } } } }',
    );
    expect(answer.status).toBe(422);
    expect(calls).toEqual([]);
  });
});
