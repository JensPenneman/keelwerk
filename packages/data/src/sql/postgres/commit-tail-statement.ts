import type { PostgresStatement } from './begin-unit-statements.ts';
import type { CommitTailInput } from './commit-tail-input.ts';
import { queuedJobsCount } from './queued-jobs-count.ts';
import { quoteIdentifier } from './quote-identifier.ts';

const eventColumns = [
  'streamType',
  'streamId',
  'streamVersion',
  'partition',
  'eventId',
  'name',
  'schemaVersion',
  'shapeHex',
  'data',
  'before',
  'meta',
  'hlc',
  'recordedAt',
  'transient',
  'prevHash',
  'hash',
] as const;

/**
 * The commit tail of a unit as one statement (section 15.1.4, decision 112): the counter row of the
 * scope advances by the number of events (and is created on the scope's first append), the events
 * are inserted at the positions that opens, the usage counters are moved, and the `enqueued`
 * counters of the lanes that gained available jobs move, all in one round trip, so the counter's row
 * lock is held for one round trip plus the flush. A unit that appended nothing sends only its lane
 * and usage parts and never touches the counter. The statement answers one row: `first`, the position of the
 * first event (null without events), `appended`, the positions of the rows that were inserted as JSON
 * text (null without events): a version another unit took first is skipped by `on conflict`, not
 * raised, because a violation's detail is hidden from a role without `BYPASSRLS`, so the caller finds
 * the events whose position (`first` plus their index) did not come back and throws for their
 * streams; the unit's rollback gives the counter back; `usage`, the counters after the upsert of a
 * unit that charges or gives back usage (in ascending dimension, a give-back being a negative delta);
 * `lanes`, the number of counter rows it moved, which must equal the number of lanes: an update that
 * row-level security hides matches nothing and would otherwise lose the count silently; and, for a
 * queue with a queued cap, `queued`, the queued jobs of the queue in the unit's scope (section
 * 9.5.5, `queuedJobStates`), as the unit leaves them, counted up to the cap plus one by an index
 * range scan that locks no row. The lane counters are matched against the unit's scope.
 *
 * The `queued` part is the first item of the select list, so the count runs before the statement
 * locks any row; it needs nothing from the other parts, which share its snapshot. (The statement
 * takes its relation locks earlier, when it is analysed.) The other parts lock their rows in the
 * order of the rest of the select list: the positions row, the event versions, the usage rows by
 * dimension, then the `enqueued` rows by lane id. The order is what the
 * PostgreSQL executor does with the select-list subqueries, in the order they are written; the
 * documentation of PostgreSQL does not promise it for data-modifying CTEs.
 * `commit-tail-lock-order.postgres.test.ts` pins only that the usage rows are locked before the
 * `enqueued` rows; the order of the positions row, the event versions and the usage rows is not
 * pinned by a case. Every tail asks for them in that order, so two tails form no cycle, and the
 * rows a take's promotion or attempt skips (`skip locked`) are held last and shortest.
 * Every parameter is text, cast in the statement, so PGlite and `pg` bind it alike.
 */
export function commitTailStatement(input: CommitTailInput): PostgresStatement {
  const root = quoteIdentifier(input.root);
  const parameters: unknown[] = [];
  const bind = (value: unknown, cast: string): string => {
    parameters.push(value);
    return `$${parameters.length}::${cast}`;
  };
  const ctes: string[] = [];
  const count = input.events.length;
  if (count > 0 && input.scopeId === null) {
    throw new TypeError('the events of a commit tail need the scope of their unit');
  }
  if ((input.usage.length > 0 || input.caps.length > 0) && input.scopeId === null) {
    throw new TypeError(
      'the usage and the queued caps of a commit tail need the scope of their unit',
    );
  }
  const scope = input.scopeId === null ? null : bind(input.scopeId, 'uuid');
  if (count > 0 && scope !== null) {
    const added = bind(String(count), 'bigint');
    const backend = bind(input.backendId, 'uuid');
    const arrays = eventColumns.map((column) =>
      bind(
        input.events.map((event) => {
          const value = event[column];
          return value === null || typeof value === 'string' ? value : String(value);
        }),
        'text[]',
      ),
    );
    ctes.push(
      `counter as (
  insert into ${root}.kw_positions as p (scope_id, next, epoch) values (${scope}, ${added} + 1, 1)
  on conflict (scope_id) do update set next = p.next + ${added}
  returning p.next - ${added} as first
)`,
      `appended as (
  insert into ${root}.kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version,
    partition_key, event_id, name, schema_version, shape_id, data, before, meta, hlc, recorded_at, transient, prev_hash, hash)
  select ${scope}, counter.first + e.ordinal - 1, ${backend}, e.stream_type, e.stream_id::uuid,
    e.stream_version::integer, e.partition_key, e.event_id::uuid, e.name, e.schema_version::integer, decode(e.shape_hex, 'hex'),
    e.data::jsonb, e.before::jsonb, e.meta::jsonb, e.hlc, e.recorded_at::timestamptz, e.transient::boolean,
    decode(e.prev_hash, 'hex'), decode(e.hash, 'hex')
  from counter, unnest(${arrays.join(', ')})
    with ordinality as e (stream_type, stream_id, stream_version, partition_key, event_id, name, schema_version,
      shape_hex, data, before, meta, hlc, recorded_at, transient, prev_hash, hash, ordinal)
  on conflict on constraint kw_events_scope_id_stream_type_stream_id_stream_version_key do nothing
  returning position
)`,
    );
  }
  if (input.lanes.length > 0) {
    const scopeOf = (alias: string): string =>
      scope === null ? '' : `\n    and ${alias}.scope_id = ${scope}`;
    const ids = bind(
      input.lanes.map((lane) => lane.laneId),
      'text[]',
    );
    const deltas = bind(
      input.lanes.map((lane) => String(lane.delta)),
      'text[]',
    );
    // The rows are locked first, in ascending lane id, so two units of one scope that move the same
    // lanes take their locks in one order and cannot deadlock; the update then finds them locked.
    ctes.push(
      `locked as (
  select c.lane_id from ${root}.kw_job_lane_counts c
  where c.kind = 'enqueued' and c.lane_id in (select x::bigint from unnest(${ids}) as x)${scopeOf('c')}
  order by c.lane_id for update
)`,
      `enqueued as (
  update ${root}.kw_job_lane_counts c set value = c.value + x.delta::bigint
  from unnest(${ids}, ${deltas}) as x (lane_id, delta)
  where c.lane_id = x.lane_id::bigint and c.kind = 'enqueued'${scopeOf('c')}
    and c.lane_id in (select lane_id from locked)
  returning 1
)`,
    );
  }
  if (input.caps.length > 0 && scope !== null) {
    const queues = bind(
      input.caps.map((entry) => entry.queue),
      'text[]',
    );
    const caps = bind(
      input.caps.map((entry) => String(entry.cap)),
      'text[]',
    );
    // The jobs are read from the statement's snapshot, which holds the unit's own writes, so the
    // value is what the unit leaves in the queue, cancels and replaces included.
    const queuedCount = queuedJobsCount(root, {
      queue: 'x.queue',
      scope,
      limit: 'x.cap::bigint + 1',
    });
    ctes.push(
      `queued as (
  select x.queue, (${queuedCount}) as value from unnest(${queues}, ${caps}) as x (queue, cap)
)`,
    );
  }
  if (input.usage.length > 0 && scope !== null) {
    const dimensions = bind(
      input.usage.map((charge) => charge.dimension),
      'text[]',
    );
    const deltas = bind(
      input.usage.map((charge) => charge.delta),
      'text[]',
    );
    ctes.push(
      `usage as (
  insert into ${root}.kw_usage as u (scope_id, dimension, value)
  select ${scope}, x.dimension, x.delta::bigint from unnest(${dimensions}, ${deltas}) as x (dimension, delta)
  on conflict (scope_id, dimension) do update set value = u.value + excluded.value
  returning u.dimension, u.value
)`,
    );
  }
  if (ctes.length === 0) {
    throw new TypeError('a commit tail needs events, lane counts, queued caps or usage');
  }
  const first = count > 0 ? '(select first::text from counter)' : 'null::text';
  const appended =
    count > 0
      ? `(select coalesce(json_agg(position::text), '[]'::json) from appended)::text`
      : 'null::text';
  const lanes = input.lanes.length > 0 ? '(select count(*) from enqueued)::text' : `'0'::text`;
  const queued =
    input.caps.length > 0
      ? `(select coalesce(json_agg(json_build_array(queue, value::text)), '[]'::json) from queued)::text as queued, `
      : '';
  const usage =
    input.usage.length > 0
      ? `, (select coalesce(json_agg(json_build_array(dimension, value::text)), '[]'::json) from usage)::text as usage`
      : '';
  return {
    sql: `with ${ctes.join(', ')}\nselect ${queued}${first} as first, ${appended} as appended${usage}, ${lanes} as lanes`,
    parameters,
  };
}
