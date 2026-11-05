import { errors } from '../errors/errors.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { Position } from '../storage/position.ts';
import type { Unit } from '../storage/unit.ts';
import type { AsOfContext } from './as-of-context.ts';
import { readAsOfPosition } from './read-as-of-position.ts';
import { selectRows } from './select-rows.ts';

/**
 * A read-only view of a unit in which the rows are the rows of a recorded position (S-25). Each
 * positioned `find` takes the next read of the decision record and answers the entity as of that
 * position, so the interpreter's loads, the target of an entity command and the position they
 * record come out as they did when the decision was made. `lock` and `search` do not exist here,
 * which sends a locked read the way of `find` followed by `EventStore.head`, answered with the
 * position of that `find`. Savepoints open the same view on the inner unit.
 */
export function asOfUnit(unit: Unit, context: AsOfContext): Unit {
  let latest: Position | undefined;
  const entryOf = (descriptor: EntityDescriptor) => {
    const entry = context.registry.entities.get(descriptor.ref);
    if (entry === undefined)
      throw errors.internal(`${descriptor.ref} is not an entity of this app`);
    return entry;
  };
  const rowsAt = (descriptor: EntityDescriptor, at: Position) =>
    readAsOfPosition({
      unit,
      entry: entryOf(descriptor),
      behaviours: context.behaviours,
      at,
      horizon: context.feedHorizon,
    });
  const rowsNow = (descriptor: EntityDescriptor) =>
    rowsAt(descriptor, latest ?? context.reads.ceiling());
  const { lock: _lock, search: _search, countBefore: _countBefore, ...rows } = unit.rows;
  return {
    ...unit,
    rows: {
      ...rows,
      async find(entity, query) {
        const read = context.reads.take(unit.scope.level);
        latest = read.at;
        const page = selectRows(entity, await rowsAt(entity, read.at), query);
        return query.positioned === true ? { ...page, position: read.at } : page;
      },
      async findOne(entity, query) {
        const page = selectRows(entity, await rowsNow(entity), { ...query, page: { first: 1 } });
        return page.rows[0];
      },
      async count(entity, where) {
        const page = selectRows(entity, await rowsNow(entity), {
          ...(where === undefined ? {} : { where }),
          total: true,
        });
        return page.total ?? 0;
      },
      async exists(entity, ids) {
        const found = await rowsNow(entity);
        const wanted = new Set(ids);
        return new Set(found.map((row) => String(row.id)).filter((id) => wanted.has(id)));
      },
      async matching(entity, ids, where) {
        const page = selectRows(entity, await rowsNow(entity), { where, includeArchived: true });
        const wanted = new Set(ids);
        return new Set(page.rows.map((row) => String(row.id)).filter((id) => wanted.has(id)));
      },
    },
    events: {
      ...unit.events,
      head: async () => latest ?? context.reads.ceiling(),
    },
    nested: (fn, options) => unit.nested((inner) => fn(asOfUnit(inner, context)), options),
  };
}
