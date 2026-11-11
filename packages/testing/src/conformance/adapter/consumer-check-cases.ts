import type { StreamRef, WireError } from '@keelwerk/core';
import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConsumerKit } from './consumer-kit.ts';
import { failureOf } from './failure-of.ts';

const { tenantA } = conformanceScopes;
const scopeA = tenantA.tenantId;
const consumer = 'consumer.one';

const streamOf = (n: number): StreamRef => ({ type: 'library.book', id: conformanceId(n) });
const errorOf = (code: string): WireError => ({
  kind: 'internal',
  code,
  message: 'a personal value: ada@example.org',
  retryable: false,
  requestId: 'request-1',
});

/** What the store checks of what it is given: a position beyond the head, an error kind outside the taxonomy. */
export function consumerCheckCases(kit: ConsumerKit): void {
  const { inA, checkpointOf, headOf, append } = kit;

  test('advance refuses a position above the head of its scope', async () => {
    const invalid = { kind: 'validation', code: 'core.validation' };
    expect(await failureOf(inA((unit) => unit.consumers.advance(consumer, scopeA, 1n)))).toEqual(
      invalid,
    );
    await inA((unit) => unit.consumers.advance(consumer, scopeA, 0n));
    await append(tenantA, 5);
    const head = await headOf(tenantA);
    expect(head).toBe(5n);
    expect(await failureOf(inA((unit) => unit.consumers.advance(consumer, scopeA, 6n)))).toEqual(
      invalid,
    );
    expect(await checkpointOf(consumer, scopeA)).toBe(0n);
    await inA((unit) => unit.consumers.advance(consumer, scopeA, 5n));
    expect(await checkpointOf(consumer, scopeA)).toBe(5n);
  });

  test('a parked stream stores the kind of the taxonomy, and internal for any other kind', async () => {
    const unknown = { ...errorOf('core.internal'), kind: 'free text, ada@example.org' };
    await inA((unit) =>
      unit.consumers.park(consumer, streamOf(1), 3n, unknown as unknown as WireError),
    );
    await inA((unit) =>
      unit.consumers.park(consumer, streamOf(2), 4n, {
        ...errorOf('core.unavailable'),
        kind: 'unavailable',
      }),
    );
    const rows = await inA((unit) => unit.consumers.parked(consumer));
    expect(rows.map((row) => [row.stream.id, row.lastError.kind, row.lastError.code])).toEqual([
      [streamOf(1).id, 'internal', 'core.internal'],
      [streamOf(2).id, 'unavailable', 'core.unavailable'],
    ]);
  });
}
