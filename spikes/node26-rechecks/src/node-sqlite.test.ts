import { expect, test } from 'vitest';
import { runNode } from './run-node.ts';

const script = `
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT) STRICT');
db.prepare('INSERT INTO t (name) VALUES (?)').run('a');
const select = db.prepare('SELECT id, name FROM t');
const insert = db.prepare('INSERT INTO t (name) VALUES (?)');
const version = db.prepare('SELECT sqlite_version() AS v').get().v;
console.log(JSON.stringify({
  version,
  rows: select.all(),
  selectColumns: select.columns().map((c) => c.name),
  insertColumns: insert.columns().length,
  readerKeyPresent: 'reader' in select,
}));
`;

test('node:sqlite opens, prepares and lists columns without a warning', () => {
  const run = runNode(['--input-type=module', '--eval', script]);
  expect(run.stderr).not.toContain('ExperimentalWarning');
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  const out = JSON.parse(run.stdout) as {
    version: string;
    rows: unknown[];
    selectColumns: string[];
    insertColumns: number;
    readerKeyPresent: boolean;
  };
  expect(out.rows).toEqual([{ id: 1, name: 'a' }]);
  expect(out.selectColumns).toEqual(['id', 'name']);
  expect(out.insertColumns).toBe(0);
  expect(out.version).toMatch(/^\d+\.\d+\.\d+/);
  // Kysely's SqliteDialect reads `reader`; the shim derives it from columns().
  expect(out.readerKeyPresent).toBe(false);
});
