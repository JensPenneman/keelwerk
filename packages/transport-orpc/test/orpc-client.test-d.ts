import type { CommandReceipt, Id, Page, StreamControl, SubjectId } from '@keelwerk/core';
import { createORPCClient, isDefinedError, type NestedClient, safe } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { expectTypeOf, test } from 'vitest';
import type { OrpcRouterOf } from '../src/orpc-router-of.ts';
import type { OrpcConformanceApp } from './support/orpc-conformance-app.ts';

type Router = OrpcRouterOf<OrpcConformanceApp>;
type JsonRouter = OrpcRouterOf<OrpcConformanceApp, 'json'>;
const client = createORPCClient<Router>(new RPCLink({ url: 'https://tenant.example.test/orpc' }));
const jsonClient = createORPCClient<JsonRouter>(
  new RPCLink({ url: 'https://tenant.example.test/orpc' }),
);
const dueAt = Temporal.Instant.from('2026-12-01T00:00:00Z');
const borrower = 'u1' as SubjectId;

test('the router type is a tree the oRPC client accepts', () => {
  expectTypeOf<Router>().toExtend<NestedClient<Record<never, never>>>();
});

test('a query takes its input and answers its output', async () => {
  const found = await client.library.findByIsbn({ isbn: '978-3-16-148410-0' });
  expectTypeOf(found.title).toEqualTypeOf<string | undefined>();
  expectTypeOf(found.bookId).toEqualTypeOf<Id<'library.book'> | undefined>();
});

test('lend answers its output or a receipt, closeAll a receipt', async () => {
  const lent = await client.loans.lend({ bookTitle: 'Dune', dueAt });
  expectTypeOf(lent).toEqualTypeOf<{ readonly loanId: Id<'loans.loan'> } | CommandReceipt>();
  const closed = await client.loans.closeAll({ borrower });
  expectTypeOf(closed).toEqualTypeOf<CommandReceipt>();
});

test('loanEvents is an async iterator of items and stream controls', async () => {
  const events = await client.loans.loanEvents({});
  expectTypeOf(events).toExtend<AsyncIteratorObject<unknown, void, void>>();
  for await (const frame of events) {
    if ('data' in frame) {
      expectTypeOf(frame.data.loanId).toEqualTypeOf<Id<'loans.loan'>>();
      expectTypeOf(frame.data.kind).toEqualTypeOf<'created' | 'closed'>();
      expectTypeOf(frame.id).toEqualTypeOf<string | undefined>();
    } else {
      expectTypeOf(frame).toEqualTypeOf<StreamControl>();
    }
  }
});

test('the generated entity actions sit under their entity', async () => {
  const page = await client.library.book.query({ first: 5 });
  expectTypeOf(page).toExtend<Page<unknown>>();
  const row = await client.library.book.create({
    title: 'Dune',
    isbn: '978-3-16-148410-0',
    addedBy: borrower,
  });
  expectTypeOf(row.title).toBeString();
});

test('a declared error narrows the failure to its code and details', async () => {
  const [error, , isDefined] = await safe(
    client.library.addBook({ title: 'Dune', isbn: '978-3-16-148410-0' }),
  );
  expectTypeOf(isDefined).toBeBoolean();
  if (error !== null && isDefinedError(error)) {
    expectTypeOf(error.code).toEqualTypeOf<'library.isbn_taken'>();
    expectTypeOf(error.data.details.isbn).toBeString();
    expectTypeOf(error.data.requestId).toBeString();
  }
});

test('the json wire types an instant as a string', async () => {
  await jsonClient.loans.lend({ bookTitle: 'Dune', dueAt: '2026-12-01T00:00:00.000Z' });
  // @ts-expect-error an instant is a string on the json wire
  await jsonClient.loans.lend({ bookTitle: 'Dune', dueAt });
  await client.loans.lend({ bookTitle: 'Dune', dueAt });
  // @ts-expect-error an instant is a Temporal.Instant on the default wire
  await client.loans.lend({ bookTitle: 'Dune', dueAt: '2026-12-01T00:00:00.000Z' });
});

test('an unknown procedure and a wrong input are refused', async () => {
  // @ts-expect-error the library has no such procedure
  await client.library.lookUp({ isbn: '1' });
  // @ts-expect-error the isbn is a string
  await client.library.findByIsbn({ isbn: 1 });
});
