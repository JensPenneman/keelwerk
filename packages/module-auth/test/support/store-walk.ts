import type { DataAdapter } from '@keelwerk/core';
import { type DumpQuery, dumpDatabase } from '@keelwerk/testing';
import type { StorageKind } from './boot-auth.ts';
import type { BootedBoth } from './boot-both.ts';

/** Everything a store holds that a test looks through: its text and the digests it keeps. */
interface StoreContents {
  /** The text of the whole store: the dump of PGlite, what the units of the memory store saw. */
  readonly text: string;
  /** The fingerprint of every command receipt. */
  readonly fingerprints: readonly string[];
  /** The `inputDigest` of every decision record in the meta of an event. */
  readonly digests: readonly string[];
}

const json = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) => {
    if (typeof member === 'bigint') return member.toString();
    return member instanceof Uint8Array ? [...member] : member;
  });

/** A query over the owner connection of a PGlite adapter. */
function ownerQuery(adapter: DataAdapter): DumpQuery {
  const owner = adapter as unknown as {
    asOwner<T>(
      fn: (database: {
        query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
      }) => Promise<T>,
    ): Promise<T>;
  };
  return (sql) => owner.asOwner(async (database) => (await database.query(sql)).rows);
}

/**
 * The values of one expression over every table of that name, in every schema the query reaches.
 */
async function column(query: DumpQuery, table: string, expression: string): Promise<string[]> {
  const values: string[] = [];
  for (const { schemaname } of await query(
    `select schemaname from pg_tables where tablename = '${table}'`,
  )) {
    for (const row of await query(
      `select ${expression} as value from "${String(schemaname)}"."${table}"`,
    )) {
      if (row.value !== null && row.value !== undefined) values.push(String(row.value));
    }
  }
  return values;
}

/**
 * Starts to watch a store. PGlite is read whole afterwards, by a dump of every table of the data
 * store and the control store, as the erasure dump tests do. The memory store has no dump: every
 * unit the runtime opens from now on is recorded, with what each store method was given and what it
 * answered, which is what the store holds.
 */
function walkStore(
  both: Pick<BootedBoth, 'runtime'>,
  kind: StorageKind,
): { contents(): Promise<StoreContents> } {
  if (kind === 'pglite') {
    const queries = [ownerQuery(both.runtime.adapter), ownerQuery(both.runtime.control.adapter)];
    return {
      contents: async () => {
        const dumps = await Promise.all(queries.map((query) => dumpDatabase(query)));
        const fingerprints = (
          await Promise.all(queries.map((q) => column(q, 'core__command_receipt', 'fingerprint')))
        ).flat();
        const digests = (
          await Promise.all(
            queries.map((q) => column(q, 'kw_events', "meta->'decision'->>'inputDigest'")),
          )
        ).flat();
        return { text: dumps.join('\n'), fingerprints, digests };
      },
    };
  }
  const log: string[] = [];
  const wrap = (target: object, path: string): object =>
    new Proxy(target, {
      get(inner, property, receiver) {
        const value: unknown = Reflect.get(inner, property, receiver);
        if (typeof property !== 'string') return value;
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            log.push(`${path}.${property} ${json(args)}`);
            const answer: unknown = value.apply(inner, args);
            if (answer instanceof Promise) {
              return answer.then((settled: unknown) => {
                log.push(`${path}.${property} => ${json(settled)}`);
                return settled;
              });
            }
            return answer;
          };
        }
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return wrap(value, `${path}.${property}`);
        }
        return value;
      },
    });
  const target = both.runtime.adapter as { unit: DataAdapter['unit'] };
  const inner = target.unit.bind(both.runtime.adapter);
  target.unit = (namespace, scope, fn, options) =>
    inner(namespace, scope, (unit) => fn(wrap(unit, 'unit') as typeof unit), options);
  return {
    contents: async () => {
      const text = log.join('\n');
      const all = (key: string): string[] =>
        [...text.matchAll(new RegExp(`"${key}":"([^"]*)"`, 'g'))].map((match) => match[1] ?? '');
      return { text, fingerprints: all('fingerprint'), digests: all('inputDigest') };
    },
  };
}

export { walkStore };
