import type { StorageRow } from '@keelwerk/core';
import { conformanceEntities, conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { plainValue } from './plain-value.ts';
import { rowAt } from './row-at.ts';

const { kitchen, owner, credential } = conformanceEntities;
const scope = conformanceScopes.tenantA;

/** The value of each kind that is hardest to store, stated here and not derived from any adapter. */
const edges: readonly (readonly [string, string, readonly unknown[]])[] = [
  ['string', 'name', ['', 'plain', "quote's", 'a\\b', '%_', '\u{1f600} \u{10ffff}', 'é']],
  ['text', 'notes', ['', 'line one\nline two\r\n', 'x'.repeat(10_000), 'café \u{1f600}']],
  ['integer', 'count', [0, -1, 1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]],
  ['integer (wide)', 'wide', [0n, 1n, -1n, 9_007_199_254_740_993n, 2n ** 63n - 1n, -(2n ** 63n)]],
  [
    'decimal',
    'price',
    [
      '0.0000',
      '0.0001',
      '-0.0001',
      '1.5000',
      '10.0000',
      '-1.0000',
      '123456789012345.1234',
      '-99999999999999.9999',
    ],
  ],
  [
    'float',
    'ratio',
    [0, -1.5, 0.1, 1e300, -1e-300, Number.MAX_VALUE, Number.MIN_VALUE, Number.EPSILON],
  ],
  ['boolean', 'flag', [true, false]],
  [
    'instant',
    'happened',
    [
      Temporal.Instant.from('2026-01-01T00:00:00.000Z'),
      Temporal.Instant.from('2026-01-01T00:00:00.001Z'),
      Temporal.Instant.from('2026-12-31T23:59:59.999Z'),
      Temporal.Instant.from('1969-12-31T23:59:59.999Z'),
      Temporal.Instant.from('2999-01-01T00:00:00.123Z'),
    ],
  ],
  [
    'date',
    'day',
    [
      Temporal.PlainDate.from('2026-01-01'),
      Temporal.PlainDate.from('2024-02-29'),
      Temporal.PlainDate.from('1969-12-31'),
    ],
  ],
  ['timeZone', 'zone', ['UTC', 'Europe/Brussels', 'America/Argentina/Buenos_Aires']],
  ['enum', 'mood', ['calm', 'busy', 'away']],
  [
    'json',
    'payload',
    [
      {},
      [],
      { a: 1, b: [true, null, 'x'], c: { d: 'e\u{1f600}' } },
      'text',
      12.5,
      { 'key with spaces': 0 },
    ],
  ],
  ['subject', 'who', [conformanceId(77), 'subject-with-text']],
  ['set', 'tags', [new Set<string>(), new Set(['a']), new Set(['a', 'b', '\u{1f600}', '', '%'])]],
  ['list', 'scores', [[], [1n], [3n, 1n, 3n, 2n ** 62n]]],
  ['richText', 'story', [new Uint8Array([]), new Uint8Array([0, 1, 2, 255])]],
  [
    'binary',
    'raw',
    [
      new Uint8Array([]),
      new Uint8Array([0]),
      new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256)),
    ],
  ],
  [
    'blob',
    'attachment',
    [
      { ref: 'blob-1', size: 12 },
      { ref: 'blob-2', size: 0, type: 'text/plain' },
    ],
  ],
];

function plainRow(row: StorageRow | undefined, fields: readonly string[]): unknown {
  return plainValue(Object.fromEntries(fields.map((field) => [field, row?.[field]])));
}

export function codecCases(subject: ConformanceSubject): void {
  describe('codec round trips (14.10 case 1)', () => {
    describe.each(edges)('%s', (_kind, field, values) => {
      test('every edge value reads back as written, alone and among others', async () => {
        const rows = values.map((value, index) => rowAt(10 + index, { [field]: value }));
        await subject.run(scope, (unit) => unit.rows.insert(kitchen, rows));
        const page = await subject.read(scope, (unit) =>
          unit.rows.find(kitchen, { sort: [{ field: 'id', direction: 'asc' }] }),
        );
        expect(page.rows.map((row) => plainRow(row, [field]))).toEqual(
          values.map((value) => plainRow({ [field]: value }, [field])),
        );
        for (const [index, value] of values.entries()) {
          const found = await subject.read(scope, (unit) =>
            unit.rows.findOne(kitchen, {
              where: { op: 'eq', field: 'id', value: conformanceId(10 + index) },
            }),
          );
          expect(plainRow(found, [field])).toEqual(plainRow({ [field]: value }, [field]));
        }
      });
    });

    test('a row with every field set reads back whole, and an update replaces it whole', async () => {
      const everything = edges.map(([, field, values]) => [field, values.at(-1)] as const);
      await subject.run(scope, async (unit) => {
        await unit.rows.insert(owner, [rowAt(1, { name: 'o', rank: 1 })]);
        await unit.rows.insert(kitchen, [
          rowAt(2, { ...Object.fromEntries(everything), ownerId: conformanceId(1) }),
        ]);
      });
      const fields = [...everything.map(([field]) => field), 'ownerId'];
      const stored = await subject.read(scope, (unit) => unit.rows.findOne(kitchen, {}));
      expect(plainRow(stored, fields)).toEqual(
        plainRow({ ...Object.fromEntries(everything), ownerId: conformanceId(1) }, fields),
      );
      expect(stored).toMatchObject({ id: conformanceId(2), version: 1 });
      expect(plainValue(stored?.createdAt)).toEqual(plainValue(rowAt(2).createdAt));
      await subject.run(scope, (unit) =>
        unit.rows.update(kitchen, [
          {
            id: conformanceId(2),
            expectedVersion: 1,
            values: rowAt(2, { version: 2, name: 'only' }),
          },
        ]),
      );
      const replaced = await subject.read(scope, (unit) => unit.rows.findOne(kitchen, {}));
      expect(replaced).toMatchObject({ name: 'only', version: 2 });
      for (const field of ['notes', 'count', 'wide', 'price', 'tags', 'scores', 'raw', 'ownerId']) {
        expect(replaced?.[field]).toBeUndefined();
      }
    });

    test('absent optional fields stay absent and are not null or empty', async () => {
      await subject.run(scope, (unit) => unit.rows.insert(kitchen, [rowAt(1, { name: 'bare' })]));
      const stored = await subject.read(scope, (unit) => unit.rows.findOne(kitchen, {}));
      for (const [, field] of edges.filter(([, name]) => name !== 'name'))
        expect(stored?.[field] ?? undefined).toBeUndefined();
      expect(stored?.name).toBe('bare');
    });

    test('sealed values (secret and verifier) round trip with their bytes intact', async () => {
      const sealed = {
        keyId: 'key-1',
        nonce: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
        ciphertext: new Uint8Array([0, 255, 128, 7]),
      };
      await subject.run(scope, (unit) =>
        unit.rows.insert(credential, [
          rowAt(1, { label: 'c', token: sealed, verifier: 'argon2id$v=19$m=19456' }),
        ]),
      );
      const stored = await subject.read(scope, (unit) => unit.rows.findOne(credential, {}));
      expect(plainRow(stored, ['label', 'token', 'verifier'])).toEqual(
        plainRow({ label: 'c', token: sealed, verifier: 'argon2id$v=19$m=19456' }, [
          'label',
          'token',
          'verifier',
        ]),
      );
    });

    test('a returned set, list or byte value is a copy the caller may change', async () => {
      await subject.run(scope, (unit) =>
        unit.rows.insert(kitchen, [rowAt(1, { tags: new Set(['x']), raw: new Uint8Array([1]) })]),
      );
      const first = await subject.read(scope, (unit) => unit.rows.findOne(kitchen, {}));
      const copied = first?.tags;
      if (copied instanceof Set) copied.add('changed');
      const bytes = first?.raw;
      if (bytes instanceof Uint8Array) bytes.fill(9);
      const second = await subject.read(scope, (unit) => unit.rows.findOne(kitchen, {}));
      expect(plainRow(second, ['tags', 'raw'])).toEqual(
        plainRow({ tags: new Set(['x']), raw: new Uint8Array([1]) }, ['tags', 'raw']),
      );
    });

    test('instants are stored at millisecond precision (the column has exactly that)', async () => {
      const fine = Temporal.Instant.from('2026-03-04T05:06:07.123456789Z');
      await subject.run(scope, (unit) => unit.rows.insert(kitchen, [rowAt(1, { happened: fine })]));
      const stored = await subject.read(scope, (unit) => unit.rows.findOne(kitchen, {}));
      expect(stored?.happened).toBeInstanceOf(Temporal.Instant);
      const happened = stored?.happened;
      expect(happened).toBeInstanceOf(Temporal.Instant);
      expect(
        happened instanceof Temporal.Instant &&
          happened.equals(Temporal.Instant.fromEpochMilliseconds(fine.epochMilliseconds)),
      ).toBe(true);
    });
  });
}
