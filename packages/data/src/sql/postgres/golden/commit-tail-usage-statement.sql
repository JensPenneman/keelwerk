with counter as (
  insert into "app".kw_positions as p (scope_id, next, epoch) values ($1::uuid, $2::bigint + 1, 1)
  on conflict (scope_id) do update set next = p.next + $2::bigint
  returning p.next - $2::bigint as first
), appended as (
  insert into "app".kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version,
    partition_key, event_id, name, schema_version, shape_id, data, before, meta, hlc, recorded_at, transient, prev_hash, hash)
  select $1::uuid, counter.first + e.ordinal - 1, $3::uuid, e.stream_type, e.stream_id::uuid,
    e.stream_version::integer, e.partition_key, e.event_id::uuid, e.name, e.schema_version::integer, decode(e.shape_hex, 'hex'),
    e.data::jsonb, e.before::jsonb, e.meta::jsonb, e.hlc, e.recorded_at::timestamptz, e.transient::boolean,
    decode(e.prev_hash, 'hex'), decode(e.hash, 'hex')
  from counter, unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[], $15::text[], $16::text[], $17::text[], $18::text[], $19::text[])
    with ordinality as e (stream_type, stream_id, stream_version, partition_key, event_id, name, schema_version,
      shape_hex, data, before, meta, hlc, recorded_at, transient, prev_hash, hash, ordinal)
  on conflict on constraint kw_events_scope_id_stream_type_stream_id_stream_version_key do nothing
  returning position
), locked as (
  select c.lane_id from "app".kw_job_lane_counts c
  where c.kind = 'enqueued' and c.lane_id in (select x::bigint from unnest($20::text[]) as x)
    and c.scope_id = $1::uuid
  order by c.lane_id for update
), enqueued as (
  update "app".kw_job_lane_counts c set value = c.value + x.delta::bigint
  from unnest($20::text[], $21::text[]) as x (lane_id, delta)
  where c.lane_id = x.lane_id::bigint and c.kind = 'enqueued'
    and c.scope_id = $1::uuid
    and c.lane_id in (select lane_id from locked)
  returning c.lane_id, c.value
), queued as (
  select x.lane_id, o.queue, sum(coalesce(m.value, e.value) - l.taken) as value
  from unnest($22::text[]) as x (lane_id)
  join "app".kw_job_lanes o on o.id = x.lane_id::bigint and o.scope_id = $1::uuid
  join "app".kw_job_lanes l on l.scope_id = o.scope_id and l.queue = o.queue
  join "app".kw_job_lane_counts e on e.lane_id = l.id and e.kind = 'enqueued'
  left join enqueued m on m.lane_id = l.id
  group by x.lane_id, o.queue
), usage as (
  insert into "app".kw_usage as u (scope_id, dimension, value)
  select $1::uuid, x.dimension, x.delta::bigint from unnest($23::text[], $24::text[]) as x (dimension, delta)
  on conflict (scope_id, dimension) do update set value = u.value + excluded.value
  returning u.dimension, u.value
)
select (select first::text from counter) as first, (select count(*) from enqueued)::text as lanes, (select coalesce(json_agg(position::text), '[]'::json) from appended)::text as appended, (select coalesce(json_agg(json_build_array(lane_id::text, queue, value::text)), '[]'::json) from queued)::text as queued, (select coalesce(json_agg(json_build_array(dimension, value::text)), '[]'::json) from usage)::text as usage
