import { describe, expect, test } from 'vitest';
import { note } from '../../test/support/note.ts';
import { entityTable } from './entity-table.ts';
import { sqlEncodeRow } from './sql-encode-row.ts';

describe('sqlEncodeRow', () => {
  const row = {
    id: '0198a1e0-0000-7000-8000-0000000000a1',
    title: 'x',
    kwLastHlc: 'h',
    version: 1,
  };

  test('a framework column on an invocation table is refused, as on every table that has no such column', () => {
    const table = entityTable({ ...note, tenancy: 'invocation' }, 'app', 't');
    expect(() => sqlEncodeRow(table, { ...row, kwLastHash: 'x' })).toThrowError(
      expect.objectContaining({ kind: 'validation' }),
    );
    expect(() => sqlEncodeRow(table, row)).toThrowError(
      expect.objectContaining({ kind: 'validation' }),
    );
  });

  test('a tracked table keeps them, and a name no column answers to is refused', () => {
    const table = entityTable(note, 'app', 't');
    expect(Object.keys(sqlEncodeRow(table, row))).toContain('kw_last_hlc');
    expect(() => sqlEncodeRow(table, { nope: 1 })).toThrow(/has no column nope/);
  });
});
