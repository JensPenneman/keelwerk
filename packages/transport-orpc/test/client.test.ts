import type { CommandReceipt } from '@keelwerk/core';
import { requestHeaders, startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { createORPCClient, getEventMeta, isDefinedError, safe } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { afterAll, describe, expect, test } from 'vitest';
import type { OrpcRouterOf } from '../src/orpc-router-of.ts';
import { orpcJsonSerializers } from '../src/wire/orpc-json-serializers.ts';
import { orpcConformanceApp } from './support/orpc-conformance-app.ts';

const runtime = await startTransportRuntime({
  app: orpcConformanceApp,
  host: httpHost(),
  config: { orpc: { cors: [] } },
});
afterAll(() => runtime.stop());

/** A typed client of the conformance app over the runtime's host, signed in as `subject`. */
function clientOf(subject: string, headers: Record<string, string> = {}) {
  const principal = Object.fromEntries(requestHeaders({ subject }));
  return createORPCClient<OrpcRouterOf<typeof orpcConformanceApp>>(
    new RPCLink({
      url: `https://${runtime.domains.acme}/orpc`,
      headers: { ...principal, ...headers },
      customJsonSerializers: orpcJsonSerializers,
      fetch: (request) => runtime.fetch(request),
    }),
  );
}

describe('a real oRPC client', () => {
  test('a query answers Temporal values natively', async () => {
    const client = clientOf('ada-values');
    const lent = await client.loans.lend({
      bookTitle: 'Dune',
      dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
    });
    expect('loanId' in lent).toBe(true);
    const page = await client.loans.loan.query({ first: 5 });
    const row = page.items[0];
    expect(row?.dueAt).toBeInstanceOf(Temporal.Instant);
    expect(String(row?.dueAt)).toBe('2026-12-01T00:00:00Z');
  });

  test('prefer respond-async answers the receipt with 202', async () => {
    const commandId = crypto.randomUUID();
    const answer = await clientOf('ada-async', {
      prefer: 'respond-async',
      'idempotency-key': commandId,
    }).loans.lend({
      bookTitle: 'Emma',
      dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
    });
    expect(answer).toEqual({ commandId, status: 'accepted' } satisfies CommandReceipt);
  });

  test('a declared error is defined with its code and details', async () => {
    const client = clientOf('ada-error');
    const add = () => client.library.addBook({ title: 'Dune', isbn: '978-0-441-17271-9' });
    await add();
    const [error, , defined] = await safe(add());
    expect(defined).toBe(true);
    expect(error).not.toBeNull();
    if (error !== null && isDefinedError(error)) {
      expect(error.code).toBe('library.isbn_taken');
      expect(error.status).toBe(409);
      expect(error.data.details.isbn).toBe('978-0-441-17271-9');
      expect(error.data.kind).toBe('conflict');
    } else {
      throw new Error('The error is not a defined error.');
    }
  });

  test('iterating loanEvents yields the head and an item with its token as event id', async () => {
    const client = clientOf('ada-stream');
    const events = await client.loans.loanEvents({});
    const seen: unknown[] = [];
    const ids: (string | undefined)[] = [];
    for await (const event of events) {
      seen.push(event);
      ids.push(getEventMeta(event)?.id);
      if (seen.length === 1) {
        await client.loans.lend({
          bookTitle: 'Hamlet',
          dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
        });
      }
      if (seen.length === 2) break;
    }
    expect(seen[0]).toMatchObject({ control: 'head' });
    expect(seen[1]).toMatchObject({ data: { kind: 'created' } });
    expect(ids[0]).toMatch(/^v2\./);
    expect(ids[1]).toMatch(/^v2\./);
    expect(ids[0]).toBe((seen[0] as { state: string }).state);
    expect((seen[1] as { id: string }).id).toBe(ids[1]);
  });
});
