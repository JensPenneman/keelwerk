import { describe, expect, test } from 'vitest';
import type { ApiVersionLedger } from './api-version-ledger.ts';
import { appendLedgerEntry } from './append-ledger-entry.ts';
import { checkLedger } from './check-ledger.ts';
import { emptyApiVersionLedger } from './empty-api-version-ledger.ts';
import { parseApiVersionLedger } from './parse-api-version-ledger.ts';
import { renderApiVersionLedger } from './render-api-version-ledger.ts';

const first = {
  version: '2026-11-04',
  surfaceHash: 'sha256-aaa',
  modules: { library: '0.1.0', core: '0.0.0' },
  changes: [],
};
const ledger = appendLedgerEntry(emptyApiVersionLedger('library'), first);

describe('the ledger file (keelwerk.ledger/1, F-13)', () => {
  test('golden: the committed form is sorted two-space JSON with the format header', () => {
    expect(renderApiVersionLedger(ledger)).toBe(`{
  "app": "library",
  "format": "keelwerk.ledger/1",
  "versions": [
    {
      "changes": [],
      "modules": {
        "core": "0.0.0",
        "library": "0.1.0"
      },
      "surfaceHash": "sha256-aaa",
      "version": "2026-11-04"
    }
  ]
}
`);
  });

  test('rendering and parsing round trip; a file without the header is refused', () => {
    expect(parseApiVersionLedger(renderApiVersionLedger(ledger))).toEqual(ledger);
    expect(() => parseApiVersionLedger('{"app":"library","versions":[]}')).toThrow(
      /keelwerk.ledger\/1/,
    );
    expect(() => parseApiVersionLedger('not json')).toThrow(/not valid JSON/);
  });

  test('entries only go on the end: an older or equal date is refused', () => {
    const next = appendLedgerEntry(ledger, {
      ...first,
      version: '2027-01-12',
      surfaceHash: 'sha256-bbb',
    });
    expect(next.versions.map((entry) => entry.version)).toEqual(['2026-11-04', '2027-01-12']);
    expect(() => appendLedgerEntry(next, first)).toThrow(/cannot be appended/);
  });
});

describe('checkLedger', () => {
  const expected = [{ version: '2026-11-04', surfaceHash: 'sha256-aaa', modules: first.modules }];
  const codes = (subject: ApiVersionLedger, wanted = expected): string[] =>
    checkLedger(subject, 'library', wanted).map((problem) => problem.code);

  test('a ledger that agrees with the app has no problem', () => {
    expect(codes(ledger)).toEqual([]);
  });

  test('a drifted hash, drifted modules, a missing and an undeclared entry are each named', () => {
    expect(
      codes(
        appendLedgerEntry(emptyApiVersionLedger('library'), {
          ...first,
          surfaceHash: 'sha256-zzz',
        }),
      ),
    ).toEqual(['ledgerHashDrift']);
    expect(
      codes(
        appendLedgerEntry(emptyApiVersionLedger('library'), {
          ...first,
          modules: { core: '0.0.0' },
        }),
      ),
    ).toEqual(['ledgerModulesDrift']);
    expect(codes(emptyApiVersionLedger('library'))).toEqual(['ledgerEntryMissing']);
    expect(codes(appendLedgerEntry(ledger, { ...first, version: '2027-01-12' }))).toEqual([
      'ledgerEntryUnknown',
    ]);
    expect(checkLedger(ledger, 'other', expected).map((problem) => problem.code)).toEqual([
      'ledgerApp',
    ]);
  });

  test('entries of retired versions, older than the oldest declared one, stay', () => {
    const older = { ...first, version: '2025-01-01' };
    const kept: ApiVersionLedger = { ...ledger, versions: [older, ...ledger.versions] };
    expect(codes(kept)).toEqual([]);
  });
});
