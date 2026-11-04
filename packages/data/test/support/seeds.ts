import { groupSeed } from './group-seed.ts';
import { laneSeed } from './lane-seed.ts';
import { ns } from './ns.ts';

/** One insert per scoped table; `$1` is the scope. */
export const seeds: ReadonlyArray<readonly [table: string, statement: string]> = [
  ['kw_positions', `insert into ${ns}.kw_positions values ($1, 1, 1)`],
  [
    'kw_events',
    `insert into ${ns}.kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version, event_id, name, shape_id, data, meta, hlc, recorded_at)
    values ($1, 1, $1, 'a.b', $1, 1, $1, 'created', '\\x00', '{}', '{}', 'h', now())`,
  ],
  ['kw_serials', `insert into ${ns}.kw_serials values ($1, 'a.b', 'n', '[]', 1)`],
  ['kw_usage', `insert into ${ns}.kw_usage values ($1, 'bytes', 1)`],
  ['kw_rate_buckets', `insert into ${ns}.kw_rate_buckets values ($1, '\\x01', 1, now())`],
  [
    'kw_subject_keys',
    `insert into ${ns}.kw_subject_keys (scope_id, subject_id, key_id, wrapped, kek_version, created_at)
    values ($1, $1, 'k1', '\\x02', 1, now())`,
  ],
  ['kw_value_keys', `insert into ${ns}.kw_value_keys values ($1, 'k1', '\\x02', 1, now())`],
  [
    'kw_index_keys',
    `insert into ${ns}.kw_index_keys (scope_id, version, wrapped, created_at) values ($1, 1, '\\x02', now())`,
  ],
  ['kw_subject_refs', `insert into ${ns}.kw_subject_refs values ($1, $1, 'a.b', $1)`],
  [
    'kw_job_history',
    `insert into ${ns}.kw_job_history (scope_id, job_id, queue, kind, outcome) values ($1, 9001, 'q', 'action', 'succeeded')`,
  ],
  ['kw_job_groups', groupSeed],
  ['kw_job_lanes', laneSeed],
];
