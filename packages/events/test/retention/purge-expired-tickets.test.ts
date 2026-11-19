import type { Registry, Unit } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { purgeExpiredTickets } from '../../src/retention/purge-expired-tickets.ts';

const registry = {
  entities: new Map([['live.streamTicket', { descriptor: {} }]]),
} as unknown as Registry;
const before = Temporal.Instant.from('2026-11-17T12:00:00Z');

/** A unit whose page reads answer in turn: the purge's page, then the read of what is left. */
function unitOf(pages: readonly (readonly string[])[]): { unit: Unit; purged: string[][] } {
  const purged: string[][] = [];
  let at = 0;
  const unit = {
    rows: {
      find: async () => ({ rows: (pages[at++] ?? []).map((id) => ({ id })) }),
      purge: async (_descriptor: unknown, ids: string[]) => {
        purged.push(ids);
        return ids.length;
      },
    },
  } as unknown as Unit;
  return { unit, purged };
}

test('a short page that skipped tickets another pass took does not pass for an empty buffer', async () => {
  const { unit, purged } = unitOf([['t1'], ['t2']]);
  expect(await purgeExpiredTickets(unit, registry, before, 5)).toEqual({ removed: 1, more: true });
  expect(purged).toEqual([['t1']]);
});

test('an empty read after a short page says nothing is left, a full page says more may wait', async () => {
  const short = unitOf([['t1', 't2'], []]);
  expect(await purgeExpiredTickets(short.unit, registry, before, 5)).toEqual({
    removed: 2,
    more: false,
  });
  const full = unitOf([['t1', 't2']]);
  expect(await purgeExpiredTickets(full.unit, registry, before, 2)).toEqual({
    removed: 2,
    more: true,
  });
});
