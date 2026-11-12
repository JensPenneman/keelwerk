import { describe, expect, test } from 'vitest';
import { deprecationsOf } from './deprecations-of.ts';

const deprecated = {
  apiVersion: '2026-11-04',
  deprecation: { at: '2026-11-10', sunset: '2026-12-01' },
};

describe('deprecationsOf (section 18.5)', () => {
  test('a deprecated session gives one version notice with its dates', () => {
    expect(deprecationsOf(deprecated, undefined, '2026-11-12')).toEqual([
      { kind: 'deprecation', apiVersion: '2026-11-04', at: '2026-11-10', sunset: '2026-12-01' },
    ]);
  });

  test('an action deprecated from a date that has come adds an action notice after it', () => {
    const action = {
      ref: 'library.book.list',
      deprecated: { at: '2026-11-05', sunset: '2026-12-01' },
    };
    expect(deprecationsOf(deprecated, action, '2026-11-12')).toEqual([
      { kind: 'deprecation', apiVersion: '2026-11-04', at: '2026-11-10', sunset: '2026-12-01' },
      { kind: 'deprecation', action: 'library.book.list', at: '2026-11-05', sunset: '2026-12-01' },
    ]);
  });

  test('an action whose at is later, or that is not deprecated, gives none', () => {
    const none = { apiVersion: '2026-11-11', deprecation: null };
    expect(
      deprecationsOf(none, { ref: 'a.b', deprecated: { at: '2026-11-13' } }, '2026-11-12'),
    ).toEqual([]);
    expect(deprecationsOf(none, { ref: 'a.b' }, '2026-11-12')).toEqual([]);
  });

  test('an action deprecated without at is announced at once, without a date', () => {
    const none = { apiVersion: '2026-11-11', deprecation: null };
    expect(deprecationsOf(none, { ref: 'a.b', deprecated: {} }, '2026-11-12')).toEqual([
      { kind: 'deprecation', action: 'a.b' },
    ]);
    expect(
      deprecationsOf(none, { ref: 'a.b', deprecated: { sunset: '2026-12-01' } }, '2026-11-12'),
    ).toEqual([{ kind: 'deprecation', action: 'a.b', sunset: '2026-12-01' }]);
  });

  test('without a session only action notices', () => {
    expect(
      deprecationsOf(undefined, { ref: 'a.b', deprecated: { at: '2026-11-12' } }, '2026-11-12'),
    ).toEqual([{ kind: 'deprecation', action: 'a.b', at: '2026-11-12' }]);
  });

  test('an at that carries a time counts from the start of its UTC day', () => {
    const at = '2026-11-12T23:30:00Z';
    expect(deprecationsOf(undefined, { ref: 'a.b', deprecated: { at } }, '2026-11-12')).toEqual([
      { kind: 'deprecation', action: 'a.b', at },
    ]);
    expect(deprecationsOf(undefined, { ref: 'a.b', deprecated: { at } }, '2026-11-11')).toEqual([]);
    expect(
      deprecationsOf(
        undefined,
        { ref: 'a.b', deprecated: { at: '2026-11-12T01:00:00+05:00' } },
        '2026-11-11',
      ),
    ).toHaveLength(1);
  });
});
