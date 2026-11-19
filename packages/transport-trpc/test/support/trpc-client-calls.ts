import type { createTRPCClient } from '@trpc/client';
import type { TrpcRouter } from './trpc-conformance-router.ts';

/** What a tRPC client of the conformance router reads back from one query, one mutation and one subscription. */
export async function trpcClientCalls(client: ReturnType<typeof createTRPCClient<TrpcRouter>>) {
  const found = await client.library.findByIsbn.query({ isbn: 'x' });
  const lent = await client.loans.lend.mutate({
    bookTitle: 'Dune',
    dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
  });
  const subscription = client.loans.loanEvents.subscribe(
    {},
    {
      onData: () => undefined,
    },
  );
  subscription.unsubscribe();
  return { found, lent };
}
