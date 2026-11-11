import { renderTypeId } from '@keelwerk/core';
import { startTransportRuntime, testPrincipal } from '@keelwerk/testing';
import type { TransportApp } from '@keelwerk/testing/fixtures';
import { transportApp } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, it } from 'vitest';
import { createRemoteClient } from '../src/index.ts';

const runtime = await startTransportRuntime({ app: transportApp, host: httpHost() });
afterAll(() => runtime.stop());

const domain = runtime.domains.acme ?? '';
const principal = JSON.stringify(testPrincipal('ada'));
const sent: unknown[] = [];

const client = createRemoteClient<TransportApp>({
  url: `https://${domain}`,
  apiVersion: '2026-11-04',
  fetch: async (input, init) => {
    const request = new Request(input, init);
    request.headers.set('x-test-principal', principal);
    if (request.method === 'POST') sent.push(await request.clone().json());
    return runtime.fetch(request);
  },
});

async function newBook() {
  const title = `Emma-${crypto.randomUUID().slice(0, 8)}`;
  const { bookId } = await client.invoke('library.addBook', {
    title,
    isbn: crypto.randomUUID().slice(0, 13),
  });
  return { id: bookId, title };
}

describe('a client filter on an id or a reference', () => {
  it('reaches the server as public ids and finds the row', async () => {
    const book = await newBook();
    const page = await client.invoke('library.book.query', {
      filter: { and: [{ id: book.id }, { not: { relatedTo: book.id } }] },
    });
    expect(page.items.map((row) => row.title)).toEqual([book.title]);
    const body = sent.at(-1) as { input: { filter: unknown } };
    expect(body.input.filter).toEqual({
      and: [
        { id: renderTypeId('book', book.id) },
        { not: { relatedTo: renderTypeId('book', book.id) } },
      ],
    });
  });

  it('carries the ids of in and nin as public ids, and a reference that no row holds finds nothing', async () => {
    const book = await newBook();
    const other = await newBook();
    const found = await client.invoke('library.book.query', {
      filter: { id: { in: [book.id], nin: [other.id] } },
    });
    expect(found.items.map((row) => row.title)).toEqual([book.title]);
    const none = await client.invoke('library.book.query', {
      filter: { relatedTo: { in: [book.id] } },
    });
    expect(none.items).toEqual([]);
    const body = sent.at(-2) as { input: { filter: unknown } };
    expect(body.input.filter).toEqual({
      id: { in: [renderTypeId('book', book.id)], nin: [renderTypeId('book', other.id)] },
    });
  });

  it('finds the row that holds a reference by the reference as a public id', async () => {
    const book = await newBook();
    const other = await newBook();
    await client.invoke('library.book.update', { id: book.id, patch: { relatedTo: other.id } });
    const found = await client.invoke('library.book.query', {
      filter: { relatedTo: other.id },
    });
    expect(found.items.map((row) => row.title)).toEqual([book.title]);
    const body = sent.at(-1) as { input: { filter: unknown } };
    expect(body.input.filter).toEqual({ relatedTo: renderTypeId('book', other.id) });
  });

  it('refuses an operand that is no id before anything is sent', async () => {
    const before = sent.length;
    const result = await client.attempt('library.book.query', {
      // A caller that ignores its types: a plain string is no id.
      filter: { id: { eq: 'not-a-uuid' as never } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: 'validation', code: 'core.validation' });
      expect(result.error.issues?.[0]?.path).toEqual(['filter', 'id', 'eq']);
    }
    expect(sent.length).toBe(before);
  });
});
