import type { StorageRow } from '@keelwerk/core';
import { conformanceId } from '@keelwerk/data/conformance';
import { ownerId } from './owner-id.ts';
import { rowAt } from './row-at.ts';
import { stamp } from './stamp.ts';

const at = (text: string): Temporal.Instant => Temporal.Instant.from(text);
const day = (text: string): Temporal.PlainDate => Temporal.PlainDate.from(text);

/**
 * Eight live probes and one archived one, written by hand. The suites state the ids a condition
 * must select by reading this table, so no interpreter decides what is right.
 */
export const probeRows: readonly StorageRow[] = [
  rowAt(201, {
    label: 'a',
    note: 'hello world',
    n: 1,
    price: '0.50',
    ratio: 0.5,
    flag: true,
    at: at('2026-01-01T00:00:00.123Z'),
    day: day('2026-01-01'),
    mood: 'calm',
    tags: new Set(['x', 'y']),
    scores: [1, 2],
    raw: new Uint8Array([1, 2]),
    ownerId: ownerId(1),
  }),
  rowAt(202, {
    label: 'ab',
    note: '100%',
    n: 2,
    price: '2.00',
    ratio: 2.25,
    flag: false,
    at: at('2026-06-15T12:00:00.000Z'),
    day: day('2026-02-28'),
    mood: 'busy',
    tags: new Set(['z']),
    scores: [3],
    raw: new Uint8Array([0, 255]),
    ownerId: ownerId(1),
  }),
  rowAt(203, {
    label: 'B',
    note: 'a_b',
    n: -1,
    price: '-1.50',
    ratio: -1.5,
    mood: 'away',
    tags: new Set<string>(),
    scores: [],
    ownerId: ownerId(2),
  }),
  rowAt(204, {
    label: '%',
    note: 'back\\slash',
    n: 0,
    price: '0.00',
    flag: true,
    ownerId: ownerId(2),
  }),
  rowAt(205, { label: '_', n: 7, ownerId: ownerId(3) }),
  rowAt(206, { label: '\u{1f600}', n: 3, ownerId: conformanceId(999) }),
  rowAt(207, { label: '～' }),
  rowAt(208, { n: 2 }),
  rowAt(209, { label: 'a', n: -100, ownerId: ownerId(4), archivedAt: stamp }),
];
