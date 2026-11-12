import type { DataAdapter } from '@keelwerk/core';
import type { DumpQuery } from '../../../src/dump/dump-database.ts';

interface OwnerDatabase {
  query(sql: string): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

/** The rows of a dump by table (`schema.table`): the text after each `-- table` header. */
export function sectionsOf(dump: string): Map<string, string> {
  const sections = new Map<string, string>();
  let name: string | undefined;
  const lines: string[] = [];
  const close = () => {
    if (name !== undefined) sections.set(name, lines.join('\n'));
    lines.length = 0;
  };
  for (const line of dump.split('\n')) {
    const header = /^-- table "([^"]+)"\."([^"]+)"$/.exec(line);
    if (header !== null) {
      close();
      name = `${header[1]}.${header[2]}`;
    } else if (line.startsWith('-- ')) {
      close();
      name = undefined;
    } else lines.push(line);
  }
  close();
  return sections;
}

/** A dump query over the owner connection of a PGlite adapter (`asOwner`). */
export function pgliteQuery(adapter: DataAdapter): DumpQuery {
  const owner = adapter as unknown as {
    asOwner<T>(fn: (database: OwnerDatabase) => Promise<T>): Promise<T>;
  };
  return (sql) => owner.asOwner(async (database) => (await database.query(sql)).rows);
}
