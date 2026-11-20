// The program the type budget "orpc-client" measures (scripts/type-budgets/budgets.json): the oRPC
// client type over the oRPC conformance app, with one typed call of each kind. It is not a test.
import type { SubjectId } from '@keelwerk/core';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { OrpcRouterOf } from '../src/orpc-router-of.ts';
import type { OrpcConformanceApp } from './support/orpc-conformance-app.ts';

const client = createORPCClient<OrpcRouterOf<OrpcConformanceApp>>(
  new RPCLink({ url: 'https://tenant.example.test/orpc' }),
);

export async function measured(borrower: SubjectId) {
  const found = await client.library.findByIsbn({ isbn: '978-3-16-148410-0' });
  const lent = await client.loans.lend({
    bookTitle: 'Dune',
    dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
  });
  const closed = await client.loans.closeAll({ borrower });
  const events = await client.loans.loanEvents({});
  return { found, lent, closed, events };
}
