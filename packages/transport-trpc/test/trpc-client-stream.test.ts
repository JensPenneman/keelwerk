import { freshName } from '@keelwerk/testing';
import { createTRPCClient, httpBatchStreamLink } from '@trpc/client';
import { afterAll, describe, expect, test } from 'vitest';
import { keelwerkSuperjson } from '../src/transformer/keelwerk-superjson.ts';
import { trpcClientHost } from './support/trpc-client-host.ts';
import type { TrpcRouter } from './support/trpc-conformance-router.ts';

const host = await trpcClientHost();
afterAll(() => host.stop());

describe('httpBatchStreamLink against the host', () => {
  /** A client of the streaming link, and what its calls sent and received. */
  function streamClient() {
    const seen: { jsonLines: boolean; status: number; commandId: string | null }[] = [];
    const fetchWith = host.hostFetch(freshName('ada'));
    const client = createTRPCClient<TrpcRouter>({
      links: [
        httpBatchStreamLink({
          url: host.url,
          transformer: keelwerkSuperjson(),
          fetch: (async (input: string | URL | Request, init?: RequestInit) => {
            const request = new Request(input, init);
            const response = await fetchWith(request);
            seen.push({
              jsonLines: request.headers.get('trpc-accept') === 'application/jsonl',
              status: response.status,
              commandId: response.headers.get('keelwerk-command-id'),
            });
            return response;
          }) as never,
        }),
      ],
    });
    return { client, seen };
  }

  test('httpBatchStreamLink streams JSON lines through the host and passes its stream gate', async () => {
    const { client, seen } = streamClient();
    const [first, second] = await Promise.all([
      client.library.findByIsbn.query({ isbn: freshName('isbn') }),
      client.library.findByIsbn.query({ isbn: freshName('isbn') }),
    ]);
    expect(first).toEqual({});
    expect(second).toEqual({});
    expect(seen).toEqual([{ jsonLines: true, status: 200, commandId: null }]);
  });

  test('httpBatchStreamLink reads the answer of a command, which still carries the command id', async () => {
    const { client, seen } = streamClient();
    const answer = await client.loans.lend.mutate({
      bookTitle: freshName('Emma'),
      dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
    });
    expect(answer).toMatchObject({ loanId: expect.any(String) });
    expect(seen).toEqual([
      { jsonLines: true, status: 200, commandId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    ]);
  });
});
