import { describe, expect, test } from 'vitest';
import { global } from '../../test/support/global.ts';
import { note } from '../../test/support/note.ts';
import { entityTable } from './entity-table.ts';

describe('entityTable', () => {
  const table = entityTable(note, 'app', 't');

  test('names the table, its alias and its scope column', () => {
    expect(table.from).toBe('app.app__note as t');
    expect(table.reference('title')).toBe('t.title');
    expect(table.scopeColumn).toBe('tenant_id');
    expect(entityTable(global, null, 'g')).toMatchObject({
      from: 'app__global as g',
      scopeColumn: null,
    });
  });

  test('resolves declared fields to their columns', () => {
    expect(table.column('teamId')).toMatchObject({ column: 'team_id', system: false });
  });

  test('resolves system fields the descriptor does not declare', () => {
    expect(table.column('createdAt')).toMatchObject({ column: 'created_at', system: true });
    expect(table.column('archivedAt')?.field.kind).toBe('instant');
    expect(table.column('id')?.field.kind).toBe('ref');
    expect(table.column('kwLastHlc')?.column).toBe('kw_last_hlc');
  });

  test('resolves derived index names', () => {
    const column = table.column('emailEq');
    expect(column).toMatchObject({ column: 'email__eq' });
    expect(column?.derived?.field).toBe('email');
  });

  test('knows nothing else, not even inherited names', () => {
    expect(table.column('nope')).toBeUndefined();
    expect(table.column('constructor')).toBeUndefined();
  });

  test('backend and deployment tenancy map to their scope columns', () => {
    expect(entityTable({ ...note, tenancy: 'backend' }, 'app', 't').scopeColumn).toBe('backend_id');
    expect(entityTable({ ...note, tenancy: 'invocation' }, 'app', 't').scopeColumn).toBeNull();
  });
});
