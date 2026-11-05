import type { StoredEvent, startRuntime } from '@keelwerk/core';
import { verifyChain } from '@keelwerk/core';
import { expect } from 'vitest';
import { appendFollowUp } from './append-follow-up.ts';
import { openClients } from './open-clients.ts';
import type { Slice2 } from './slice-2.ts';

/** The slice-1 scenario against a booted runtime, then the event log: positions, decision records, chains. */
export async function runScenario(
  kit: Slice2,
  runtime: Awaited<ReturnType<typeof startRuntime>>,
): Promise<void> {
  const { backendId, tenants, ada, anonymous, inGlobex } = await openClients(kit, runtime);
  const adapter = kit.adapters.adapter('main');

  const added = await ada.invoke('library.addBook', { title: 'Dune', isbn: '978-0441172719' });
  expect(added.bookId).toEqual(expect.any(String));
  expect(await ada.invoke('library.findByIsbn', { isbn: '978-0441172719' })).toEqual({
    bookId: added.bookId,
    title: 'Dune',
  });
  const refused = await anonymous.attempt('library.addBook', { title: 'Emma', isbn: '1' });
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.error).toMatchObject({ kind: 'unauthenticated' });
  const again = await ada.attempt('library.addBook', { title: 'Dune II', isbn: '978-0441172719' });
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.error).toMatchObject({ code: 'library.isbn_taken' });
  await ada.invoke('library.addBook', { title: 'Ulysses', isbn: 'isbn-ulysses' });
  expect(await inGlobex.invoke('library.findByIsbn', { isbn: 'isbn-ulysses' })).toEqual({});
  const other = await inGlobex.invoke('library.addBook', {
    title: 'Ulysses',
    isbn: 'isbn-ulysses',
  });
  expect(other.bookId).toEqual(expect.any(String));

  const namespace = kit.adapters.namespace();
  const read = async (tenant: string): Promise<readonly StoredEvent[]> =>
    adapter.unit(
      namespace,
      { level: 'tenant', backendId, tenantId: tenant },
      async (unit) => (await unit.events.readAll(null, { limit: 100 })).events,
      { readOnly: true },
    );
  // A second event on the first stream, so the chain check walks a link after the first.
  const [dune] = await read(tenants.acme.id);
  if (dune === undefined) throw new Error('the first book left no event');
  await appendFollowUp(
    adapter,
    namespace,
    { level: 'tenant', backendId, tenantId: tenants.acme.id },
    dune,
  );

  for (const [tenant, count] of [
    [tenants.acme.id, 3],
    [tenants.globex.id, 1],
  ] as const) {
    const events = await read(tenant);
    expect(events.map((event) => event.position)).toEqual(
      Array.from({ length: count }, (_, at) => BigInt(at + 1)),
    );
    for (const event of events) {
      expect(event.decision).toMatchObject({
        part: expect.stringContaining('addBook'),
        reads: [expect.anything()],
      });
      if (event.version === 1) expect(event.prevHash).toBeNull();
      expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    const streams = Map.groupBy(events, (event) => event.stream.id);
    if (tenant === tenants.acme.id) {
      expect(Math.max(...[...streams.values()].map((chain) => chain.length))).toBe(2);
    }
    for (const chain of streams.values()) {
      expect(verifyChain(chain as readonly StoredEvent[])).toMatchObject({ ok: true });
    }
  }
}
