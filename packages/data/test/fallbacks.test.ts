import { fallbackReport, maskCapabilities } from '@keelwerk/data';
import { expect, test } from 'vitest';
import { fullCapabilities } from './support/full-capabilities.ts';

test('an adapter with every acceleration has no fallback rows', () => {
  expect(fallbackReport(fullCapabilities)).toEqual([]);
});

test('masking rowLocks and the change feed adds the two rows of 14.3.3 with kernel path and cost', () => {
  const masked = maskCapabilities(fullCapabilities, ['rowLocks', 'changeFeed']);
  expect(masked.rowLocks).toBe(false);
  expect(masked.changeFeed).toBe('poll');
  expect(masked.search).toBe('tsvector');
  const rows = fallbackReport(masked);
  expect(rows.map((row) => row.capability)).toEqual(['rowLocks', 'changeFeed']);
  expect(rows[0]?.cost).toBe('repeated units under contention');
  expect(rows[1]?.path).toContain('polling the heads');
  expect(rows[1]?.cost).toBe('up to one polling interval of extra delay');
});

test('masking leaves the input untouched and names every masked member', () => {
  const masked = maskCapabilities(fullCapabilities, [
    'search',
    'positionPaging',
    'broadcast',
    'jobs',
  ]);
  expect(fullCapabilities.search).toBe('tsvector');
  expect(fallbackReport(masked).map((row) => row.capability)).toEqual([
    'search',
    'positionPaging',
    'broadcast',
    'jobs',
  ]);
});

test('personal-field and unsupported-condition absences are reported', () => {
  const rows = fallbackReport({
    ...fullCapabilities,
    encryptedQueries: { equality: true, tagSets: false, order: false, maxScan: 100 },
    unsupportedConditions: [{ op: 'contains', reason: 'none' }],
    transactions: { ...fullCapabilities.transactions, isolation: ['read-committed'] },
  });
  expect(rows.map((row) => row.capability)).toEqual([
    'encryptedQueries.order',
    'encryptedQueries.tagSets',
    'transactions.isolation',
    'unsupportedConditions',
  ]);
});

test('index tables for tag sets are reported with their path and cost', () => {
  const rows = fallbackReport({
    ...fullCapabilities,
    encryptedQueries: { ...fullCapabilities.encryptedQueries, tagSets: 'table' },
  });
  expect(rows).toEqual([
    {
      capability: 'encryptedQueries.tagSets',
      path: 'index tables per entity (14.7.9.6)',
      cost: 'one more table and join per query',
    },
  ]);
});
