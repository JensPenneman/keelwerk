const systemSchemas = "('pg_catalog', 'information_schema', 'pg_toast')";

const quoted = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

/** Runs one statement and answers its rows: a `pg` client's `query` adapted by the caller. */
export type DumpQuery = (sql: string) => Promise<readonly Readonly<Record<string, unknown>>[]>;

/**
 * Everything a logical dump of a database holds, as text: the rows of every table of every
 * non-system schema (a bytea as `\x` hex, a jsonb as its text), the definitions of the indexes
 * and the planner statistics a column keeps (most common values and histogram bounds), which
 * are copies of the stored values too. The test database is analysed first, so the statistics
 * exist. Reading needs the owner's connection.
 */
export async function dumpDatabase(query: DumpQuery): Promise<string> {
  await query('analyze');
  const tables = await query(
    `select schemaname, tablename from pg_tables where schemaname not in ${systemSchemas} order by 1, 2`,
  );
  const parts: string[] = [];
  for (const table of tables) {
    const name = `${quoted(String(table.schemaname))}.${quoted(String(table.tablename))}`;
    const rows = await query(`select t::text as row from ${name} t`);
    parts.push(`-- table ${name}`, ...rows.map((row) => String(row.row)));
  }
  const indexes = await query(
    `select indexdef from pg_indexes where schemaname not in ${systemSchemas} order by 1`,
  );
  parts.push('-- indexes', ...indexes.map((row) => String(row.indexdef)));
  const statistics = await query(
    `select attname, most_common_vals::text as common, histogram_bounds::text as bounds from pg_stats where schemaname not in ${systemSchemas} order by 1`,
  );
  parts.push(
    '-- statistics',
    ...statistics.map(
      (row) => `${String(row.attname)} ${String(row.common)} ${String(row.bounds)}`,
    ),
  );
  return parts.join('\n');
}
