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
)
select (select first::text from counter) as first, '0'::text as lanes, (select coalesce(json_agg(position::text), '[]'::json) from appended)::text as appended
