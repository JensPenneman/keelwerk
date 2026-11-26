import type { DataAdapter, EntityDescriptor, KeyedUpdate, Unit } from '@keelwerk/core';
import { execInContainer, type startPostgres } from '@keelwerk/testing/postgres';

/** A unit held right after it rewrote a row of one entity: its row lock stays until `release`. */
interface Parked {
  /** Settles once a unit rewrote a row of the entity and is held. */
  readonly arrived: Promise<void>;
  release(): void;
}

/** What a test reads of the units a runtime opens: the rows they rewrite, and the one it holds. */
export interface ParkedUnits {
  /** The entity of every row rewrite started since `forget`, in order. */
  readonly rewrites: string[];
  forget(): void;
  /** Holds the next unit that rewrites a row of `entity`, after the rewrite and before its commit. */
  parkOn(entity: string): Parked;
}

/** Wraps the adapter's units, in place, so that a test can hold one of them with its row lock taken. */
export function parkUnits(adapter: DataAdapter): ParkedUnits {
  const rewrites: string[] = [];
  let park: { entity: string; arrive(): void; gate: Promise<void> } | undefined;
  const wrap = (unit: Unit): Unit => {
    const rows = new Proxy(unit.rows, {
      get(store, property) {
        const value: unknown = Reflect.get(store, property, store);
        if (property !== 'update' || typeof value !== 'function') {
          return typeof value === 'function' ? value.bind(store) : value;
        }
        return async (entity: EntityDescriptor, updates: readonly KeyedUpdate[]) => {
          // Counted when the rewrite starts, so an attempt that waits for a lock and then fails still counts.
          rewrites.push(entity.ref);
          await (value as (e: EntityDescriptor, u: readonly KeyedUpdate[]) => Promise<void>).call(
            store,
            entity,
            updates,
          );
          const held = park;
          if (held !== undefined && held.entity === entity.ref) {
            park = undefined;
            held.arrive();
            await held.gate;
          }
        };
      },
    });
    return new Proxy(unit, {
      get(inside, property) {
        if (property === 'rows') return rows;
        if (property === 'nested') {
          return (run: (one: Unit) => Promise<unknown>, options: unknown) =>
            inside.nested((one) => run(wrap(one)), options as never);
        }
        const value: unknown = Reflect.get(inside, property, inside);
        return typeof value === 'function' ? value.bind(inside) : value;
      },
    });
  };
  const target = adapter as { unit: DataAdapter['unit'] };
  const inner = target.unit.bind(adapter);
  target.unit = (namespace, scope, fn, options) =>
    inner(namespace, scope, (unit) => fn(wrap(unit)), options);
  return {
    rewrites,
    forget: () => {
      rewrites.length = 0;
    },
    parkOn: (entity) => {
      let arrive = (): void => undefined;
      let release = (): void => undefined;
      const arrived = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      park = { entity, arrive, gate };
      return { arrived, release };
    },
  };
}

/**
 * Settles with `'blocked'` once the database itself lists a session that waits for a lock another
 * holds (`pg_blocking_pids`); `stop` ends the watch. It reads the database's own view, never a clock.
 */
export function watchBlocked(postgres: Awaited<ReturnType<typeof startPostgres>>): {
  readonly blocked: Promise<'blocked'>;
  stop(): void;
} {
  const url = new URL(postgres.adminUrl);
  const command = [
    'psql',
    '-U',
    decodeURIComponent(url.username),
    '-d',
    decodeURIComponent(url.pathname.slice(1)),
    '-tAc',
    'select count(*) from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0',
  ];
  let stopped = false;
  const blocked = (async (): Promise<'blocked'> => {
    while (!stopped) {
      const result = await execInContainer(postgres.containerId, command);
      if (Number(result.output.trim()) > 0) return 'blocked';
    }
    return await new Promise<'blocked'>(() => undefined);
  })();
  return {
    blocked,
    stop: () => {
      stopped = true;
    },
  };
}
