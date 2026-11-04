import type { StorageRow } from '@keelwerk/core';
import { noteRow } from './note-row.ts';
import { stamp } from './stamp.ts';
import { teamBlue } from './team-blue.ts';
import { teamOther } from './team-other.ts';
import { teamRed } from './team-red.ts';

export const notes: readonly StorageRow[] = [
  noteRow(1, {
    title: 'alpha',
    body: 'Hello World',
    count: 1,
    big: 9007199254740993n,
    price: '1.50',
    ratio: 0.5,
    done: true,
    due: Temporal.PlainDate.from('2026-01-01'),
    at: Temporal.Instant.from('2026-01-01T00:00:00.123Z'),
    teamId: teamRed,
    tags: new Set(['x', 'y']),
    labels: ['a', 'b'],
    data: { k: 1 },
    blob: new Uint8Array([1, 2]),
  }),
  noteRow(2, {
    title: 'beta',
    count: 2,
    price: '10.00',
    done: false,
    at: Temporal.Instant.from('2026-02-01T00:00:00Z'),
    teamId: teamRed,
    tags: new Set(['y']),
    labels: [],
    blob: new Uint8Array([1, 2]),
  }),
  noteRow(3, { title: 'alpha_beta', teamId: teamBlue, labels: ['b'], big: 5n }),
  noteRow(4, { count: 3, price: '2.50', due: Temporal.PlainDate.from('2026-03-01') }),
  noteRow(5, { title: 'Alpha', count: -1, price: '-1.00' }),
  noteRow(6, { title: '50% off', count: 5, body: 'a\\b' }),
  noteRow(7, { title: 'alpha', archivedAt: stamp }),
  noteRow(8, { title: 'ab\\c', count: 2, tags: new Set<string>() }),
  // Points at a team of the other tenant, which a tenant-scoped subquery must not see.
  noteRow(9, { teamId: teamOther }),
];
