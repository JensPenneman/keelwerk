import type {
  ColumnSpec,
  FieldConstraints,
  ForeignKeySpec,
  IndexSpec,
  TableSpec,
} from '@keelwerk/core';
import { isInvocationTable } from '../../migrations/is-invocation-table.ts';
import type { LiveCatalogue } from '../../migrations/live-catalogue.ts';
import type { SchemaSession } from './schema-session.ts';

const tablesSql = `select c.oid::bigint as oid, c.relname as name,
    c.relrowsecurity as row_security, c.relforcerowsecurity as force_row_security
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = $1 and c.relkind in ('r', 'p') and ($2::text[] is null or c.relname = any($2::text[]))
  order by c.relname`;

const columnsSql = `select a.attrelid::bigint as oid, a.attname::text as name, a.attnotnull as not_null,
    format_type(a.atttypid, a.atttypmod) as type,
    case when a.attcollation <> t.typcollation then co.collname::text end as collation,
    pg_get_expr(d.adbin, d.adrelid) as default_expression
  from pg_attribute a
  join pg_type t on t.oid = a.atttypid
  left join pg_collation co on co.oid = a.attcollation
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = any($1::oid[]) and a.attnum > 0 and not a.attisdropped
  order by a.attrelid, a.attnum`;

const indexesSql = `select i.indrelid::bigint as oid, ic.relname::text as name, i.indisunique as is_unique,
    i.indisprimary as is_primary, am.amname::text as method, pg_get_expr(i.indpred, i.indrelid) as predicate,
    array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum, ord)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum order by k.ord) as columns
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  join pg_am am on am.oid = ic.relam
  where i.indrelid = any($1::oid[])
  order by i.indrelid, ic.relname`;

const keysSql = `select c.conrelid::bigint as oid, c.conname::text as name, rc.relname::text as referenced,
    array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord) as columns,
    array(select a.attname::text from unnest(c.confkey) with ordinality k(attnum, ord)
      join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum order by k.ord) as referenced_columns
  from pg_constraint c join pg_class rc on rc.oid = c.confrelid
  where c.contype = 'f' and c.conrelid = any($1::oid[])
  order by c.conrelid, c.conname`;

const policiesSql = `select tablename::text as table_name, policyname::text as name
  from pg_policies where schemaname = $1 order by tablename, policyname`;

/** An array column as the driver delivers it: a list, or the `{a,b}` text an unparsed array type returns. */
function listOf(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1);
    return inner === '' ? [] : inner.split(',').map((item) => item.replace(/^"|"$/g, ''));
  }
  return [];
}

function kindOf(type: string): ColumnSpec['kind'] {
  if (type === 'uuid') return 'uuid';
  if (type === 'boolean') return 'boolean';
  if (type === 'bigint') return 'integer';
  if (type === 'double precision') return 'float';
  if (type === 'date') return 'date';
  if (type === 'jsonb') return 'json';
  if (type === 'bytea') return 'binary';
  if (type === 'timestamp(3) with time zone') return 'instant';
  if (type === 'text collate "C"') return 'text';
  if (type.startsWith('numeric')) return 'decimal';
  if (type.endsWith('[]')) return 'tags';
  return 'framework';
}

function constraintsOf(type: string): FieldConstraints {
  const match = /^numeric\((\d+),(\d+)\)$/.exec(type);
  return match?.[1] === undefined || match[2] === undefined
    ? {}
    : { precision: Number(match[1]), scale: Number(match[2]) };
}

/** A default that is a plain literal; expressions such as `now()` read as no default. */
function defaultOf(expression: unknown): ColumnSpec['default'] {
  if (typeof expression !== 'string') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(expression)) return Number(expression);
  if (expression === 'true' || expression === 'false') return expression === 'true';
  const text = /^'((?:[^']|'')*)'(?:::[a-z ]+)?$/.exec(expression);
  return text?.[1] === undefined ? null : text[1].replaceAll("''", "'");
}

/**
 * Reads the live catalogue of one schema (section 14.6.7, `introspect`): tables with their
 * columns, primary key, indexes and foreign keys, plus the exact column types, the row-level
 * security policy names, whether row-level security is enabled and forced, and the predicate of each partial index. `tables` narrows the read.
 */
export async function introspectCatalogue(
  session: SchemaSession,
  schema: string,
  tables?: readonly string[],
): Promise<LiveCatalogue> {
  const found = (
    await session.query(tablesSql, [schema, tables === undefined ? null : [...tables]])
  ).rows;
  const oids = found.map((row) => Number(row.oid));
  if (oids.length === 0)
    return { tables: [], types: {}, policies: {}, security: {}, predicates: {} };
  const columns = await session.query(columnsSql, [oids]);
  const indexes = await session.query(indexesSql, [oids]);
  const keys = await session.query(keysSql, [oids]);
  const policies = await session.query(policiesSql, [schema]);
  const types: Record<string, string> = {};
  const predicates: Record<string, string> = {};
  const security: Record<string, { enabled: boolean; forced: boolean }> = {};
  const specs: TableSpec[] = found.map((table) => {
    const oid = Number(table.oid);
    const name = String(table.name);
    security[name] = {
      enabled: table.row_security === true,
      forced: table.force_row_security === true,
    };
    const own = columns.rows
      .filter((row) => Number(row.oid) === oid)
      .map((row): ColumnSpec => {
        const collation = row.collation === null ? '' : ` collate "${String(row.collation)}"`;
        const type = `${String(row.type)}${collation}`;
        types[`${name}.${String(row.name)}`] = type;
        return {
          name: String(row.name),
          field: null,
          kind: kindOf(type),
          nullable: row.not_null !== true,
          default: defaultOf(row.default_expression),
          constraints: constraintsOf(type),
        };
      });
    const primary = indexes.rows.find((row) => Number(row.oid) === oid && row.is_primary === true);
    const ownIndexes = indexes.rows
      .filter((row) => Number(row.oid) === oid && row.is_primary !== true)
      .map((row): IndexSpec => {
        if (typeof row.predicate === 'string') predicates[String(row.name)] = row.predicate;
        return {
          name: String(row.name),
          columns: listOf(row.columns),
          unique: row.is_unique === true,
          method: row.method === 'gin' ? 'gin' : 'btree',
          where: null,
        };
      });
    const ownKeys = keys.rows
      .filter((row) => Number(row.oid) === oid)
      .map(
        (row): ForeignKeySpec => ({
          name: String(row.name),
          columns: listOf(row.columns),
          references: { table: String(row.referenced), columns: listOf(row.referenced_columns) },
        }),
      );
    const primaryKey = primary === undefined ? [] : listOf(primary.columns);
    const has = (column: string): boolean => own.some((candidate) => candidate.name === column);
    return {
      name,
      columns: own,
      primaryKey,
      indexes: ownIndexes,
      foreignKeys: ownKeys,
      scoped:
        has('tenant_id') || isInvocationTable({ primaryKey })
          ? 'tenant'
          : has('backend_id')
            ? 'backend'
            : 'deployment',
    };
  });
  const byTable: Record<string, string[]> = {};
  for (const row of policies.rows) {
    const table = String(row.table_name);
    byTable[table] = [...(byTable[table] ?? []), String(row.name)];
  }
  return { tables: specs, types, policies: byTable, security, predicates };
}
