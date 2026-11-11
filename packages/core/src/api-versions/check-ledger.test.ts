import { describe, expect, test } from 'vitest';
import type { ApiVersionLedger } from './api-version-ledger.ts';
import { checkLedger } from './check-ledger.ts';
import { refreshHeadEntry } from './refresh-head-entry.ts';
import { renderApiVersionLedger } from './render-api-version-ledger.ts';

const modules = { roster: '1.0.0' };
const ledger: ApiVersionLedger = {
  format: 'keelwerk.ledger/1',
  app: 'versioned',
  versions: [
    { version: '2026-11-04', surfaceHash: 'sha256-a', modules, changes: [] },
    {
      version: '2026-11-11',
      surfaceHash: 'sha256-b',
      modules,
      changes: ['roster.contactDisplayName'],
    },
  ],
};
const expected = [
  { version: '2026-11-04', surfaceHash: 'sha256-a', modules, changes: [] },
  {
    version: '2026-11-11',
    surfaceHash: 'sha256-b',
    modules,
    changes: ['roster.contactDisplayName'],
  },
];
const registered = new Set(['roster.contactDisplayName']);

const withIds = registered;

function codes(
  subject: ApiVersionLedger,
  wanted: typeof expected = expected,
  known?: ReadonlySet<string>,
): string[] {
  return checkLedger(subject, 'versioned', wanted, known).map((problem) => problem.code);
}

describe('checkLedger and the adopted changes (section 13.7)', () => {
  test('a ledger that agrees with the app and the registered ids has no problem', () => {
    expect(codes(ledger, expected, withIds)).toEqual([]);
  });

  test('an unknown change id is ledgerChangeUnknown', () => {
    const unknown: ApiVersionLedger = {
      ...ledger,
      versions: [
        ...ledger.versions.slice(0, -1),
        { ...expected[1], changes: ['roster.gone'] } as never,
      ],
    };
    const problems = checkLedger(unknown, 'versioned', expected, registered).filter(
      (problem) => problem.code === 'ledgerChangeUnknown',
    );
    expect(problems).toEqual([
      expect.objectContaining({ code: 'ledgerChangeUnknown', version: '2026-11-11' }),
    ]);
    expect(problems[0]?.message).toContain('roster.gone');
  });

  test('adopted ids that differ from the ledger are ledgerChangesDrift, released entries included', () => {
    const released = expected.map((entry) =>
      entry.version === '2026-11-04' ? { ...entry, changes: ['roster.contactDisplayName'] } : entry,
    );
    expect(codes(ledger, released)).toEqual(['ledgerChangesDrift']);
    const head = expected.map((entry) =>
      entry.version === '2026-11-11' ? { ...entry, changes: [] } : entry,
    );
    expect(codes(ledger, head)).toEqual(['ledgerChangesDrift']);
  });

  test('the order of the ids does not matter', () => {
    const two: ApiVersionLedger = {
      ...ledger,
      versions: [{ ...ledger.versions[0], changes: ['a.x', 'a.y'] } as never],
    };
    expect(
      checkLedger(two, 'versioned', [{ ...expected[0], changes: ['a.y', 'a.x'] } as never]),
    ).toEqual([]);
  });

  test('without registered ids only drift is checked', () => {
    const unknown: ApiVersionLedger = {
      ...ledger,
      versions: [ledger.versions[0] as never, { ...ledger.versions[1], changes: ['x.y'] } as never],
    };
    expect(codes(unknown, expected)).toEqual(['ledgerChangesDrift']);
    expect(codes(unknown, expected, registered)).toEqual([
      'ledgerChangeUnknown',
      'ledgerChangesDrift',
    ]);
  });

  test('an expectation without changes compares none', () => {
    expect(
      checkLedger(ledger, 'versioned', [
        { version: '2026-11-04', surfaceHash: 'sha256-a', modules },
        { version: '2026-11-11', surfaceHash: 'sha256-b', modules },
      ]),
    ).toEqual([]);
  });
});

describe('refreshHeadEntry and the adopted changes', () => {
  test('copies the implied ids onto the head entry only', () => {
    const refreshed = refreshHeadEntry(ledger, {
      version: '2026-11-11',
      surfaceHash: 'sha256-b',
      modules,
      changes: ['roster.contactDisplayName', 'roster.other'],
    });
    expect(refreshed.versions[1]?.changes).toEqual(['roster.contactDisplayName', 'roster.other']);
    expect(refreshed.versions[0]).toBe(ledger.versions[0]);
  });

  test('an implied entry without ids keeps the recorded ones, and an unchanged head is the same ledger', () => {
    expect(
      refreshHeadEntry(ledger, { version: '2026-11-11', surfaceHash: 'sha256-b', modules }),
    ).toBe(ledger);
    expect(refreshHeadEntry(ledger, expected[1] as never)).toBe(ledger);
  });

  test('the same ids in another order leave the ledger as it is', () => {
    const two: ApiVersionLedger = {
      ...ledger,
      versions: [
        ...ledger.versions.slice(0, 1),
        {
          version: '2026-11-11',
          surfaceHash: 'sha256-b',
          modules,
          changes: ['roster.a', 'roster.b'],
        },
      ],
    };
    expect(
      refreshHeadEntry(two, {
        version: '2026-11-11',
        surfaceHash: 'sha256-b',
        modules,
        changes: ['roster.b', 'roster.a'],
      }),
    ).toBe(two);
  });

  test('golden: the ledger of an app with an adopted change', () => {
    expect(renderApiVersionLedger(ledger)).toBe(`{
  "app": "versioned",
  "format": "keelwerk.ledger/1",
  "versions": [
    {
      "changes": [],
      "modules": {
        "roster": "1.0.0"
      },
      "surfaceHash": "sha256-a",
      "version": "2026-11-04"
    },
    {
      "changes": [
        "roster.contactDisplayName"
      ],
      "modules": {
        "roster": "1.0.0"
      },
      "surfaceHash": "sha256-b",
      "version": "2026-11-11"
    }
  ]
}
`);
  });
  test('golden: a head entry refreshed with the changes its version now adopts', () => {
    const recorded: ApiVersionLedger = {
      format: 'keelwerk.ledger/1',
      app: 'versioned',
      versions: [
        { version: '2026-11-04', surfaceHash: 'sha256-a', modules, changes: [] },
        { version: '2026-11-11', surfaceHash: 'sha256-old', modules, changes: [] },
      ],
    };
    const refreshed = refreshHeadEntry(recorded, {
      version: '2026-11-11',
      surfaceHash: 'sha256-b',
      modules: { roster: '1.1.0' },
      changes: ['roster.contactDisplayName', 'roster.other'],
    });
    expect(renderApiVersionLedger(refreshed)).toBe(`{
  "app": "versioned",
  "format": "keelwerk.ledger/1",
  "versions": [
    {
      "changes": [],
      "modules": {
        "roster": "1.0.0"
      },
      "surfaceHash": "sha256-a",
      "version": "2026-11-04"
    },
    {
      "changes": [
        "roster.contactDisplayName",
        "roster.other"
      ],
      "modules": {
        "roster": "1.1.0"
      },
      "surfaceHash": "sha256-b",
      "version": "2026-11-11"
    }
  ]
}
`);
  });
});
