create index kw_events_transient on "example".kw_events (scope_id, recorded_at, position) where transient and stream_type = 'core.commandReceipt';

create function "example".kw_purge_transient(before timestamptz, max_rows integer, stream_types text[]) returns table (removed integer, more boolean, records jsonb)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $kw_purge$
declare
  cutoff timestamptz := before;
  unit_scope uuid := coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);
  has_receipts boolean := pg_catalog.to_regclass('"example".core__command_receipt') is not null;
begin
  if current_setting('keelwerk.scope', true) is not distinct from 'namespace' then
    raise exception 'kw_purge_transient: a namespace-scope unit purges nothing' using errcode = '42501';
  end if;
  if unit_scope is null then
    raise exception 'kw_purge_transient: the unit names no scope' using errcode = '42501';
  end if;
  if max_rows is null or max_rows < 1 or max_rows > 100000 then
    raise exception 'kw_purge_transient: max_rows is a whole number from 1 to 100000' using errcode = '22023';
  end if;
  if cutoff is null then
    raise exception 'kw_purge_transient: before is an instant' using errcode = '22023';
  end if;
  if stream_types is null then
    raise exception 'kw_purge_transient: stream_types is a list of stream types' using errcode = '22023';
  end if;
  if not (stream_types <@ array['core.commandReceipt']::text[]) then
    raise exception 'kw_purge_transient: only the stream type core.commandReceipt may be purged' using errcode = '42501';
  end if;
  if cardinality(stream_types) = 0 then
    removed := 0;
    more := false;
    records := '[]'::jsonb;
    return next;
    return;
  end if;
  if has_receipts then
    with doomed as (
    select e.position from "example".kw_events as e
    where e.scope_id = unit_scope and e.transient and e.stream_type = 'core.commandReceipt'
      and e.hash is null and e.prev_hash is null and e.recorded_at < cutoff
      and (exists (select 1 from "example".kw_events as n
        where n.scope_id = e.scope_id and n.stream_type = e.stream_type
          and n.stream_id = e.stream_id and n.stream_version > e.stream_version offset 0)
      or not exists (select 1 from "example".core__command_receipt as r
        where r.scope_id = e.scope_id and r.id = e.stream_id offset 0))
    order by e.recorded_at, e.position
    limit max_rows
  ), deleted as (
    delete from "example".kw_events as events
    where events.scope_id = unit_scope
      and events.position = any(array(select d.position from doomed as d))
      and events.transient and events.stream_type = 'core.commandReceipt'
      and events.hash is null and events.prev_hash is null
    returning events.data, events.before, events.meta
  )
  select count(*)::integer,
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(x.data, x.before, x.meta)), '[]'::jsonb)
  into removed, records from deleted as x;
    -- A statement of its own: under read committed it sees what other units committed since the
    -- delete began, so a batch that skipped rows another pass took does not pass for an empty
    -- buffer. Rows another pass is still deleting stay visible, which errs towards "more".
    select exists (select 1 from "example".kw_events as c where c.scope_id = unit_scope and c.transient and c.stream_type = 'core.commandReceipt'
      and c.hash is null and c.prev_hash is null and c.recorded_at < cutoff
      and (exists (select 1 from "example".kw_events as n
        where n.scope_id = c.scope_id and n.stream_type = c.stream_type
          and n.stream_id = c.stream_id and n.stream_version > c.stream_version offset 0)
      or not exists (select 1 from "example".core__command_receipt as r
        where r.scope_id = c.scope_id and r.id = c.stream_id offset 0))) into more;
  else
    with doomed as (
    select e.position from "example".kw_events as e
    where e.scope_id = unit_scope and e.transient and e.stream_type = 'core.commandReceipt'
      and e.hash is null and e.prev_hash is null and e.recorded_at < cutoff
      and (exists (select 1 from "example".kw_events as n
        where n.scope_id = e.scope_id and n.stream_type = e.stream_type
          and n.stream_id = e.stream_id and n.stream_version > e.stream_version offset 0))
    order by e.recorded_at, e.position
    limit max_rows
  ), deleted as (
    delete from "example".kw_events as events
    where events.scope_id = unit_scope
      and events.position = any(array(select d.position from doomed as d))
      and events.transient and events.stream_type = 'core.commandReceipt'
      and events.hash is null and events.prev_hash is null
    returning events.data, events.before, events.meta
  )
  select count(*)::integer,
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(x.data, x.before, x.meta)), '[]'::jsonb)
  into removed, records from deleted as x;
    select exists (select 1 from "example".kw_events as c where c.scope_id = unit_scope and c.transient and c.stream_type = 'core.commandReceipt'
      and c.hash is null and c.prev_hash is null and c.recorded_at < cutoff
      and (exists (select 1 from "example".kw_events as n
        where n.scope_id = c.scope_id and n.stream_type = c.stream_type
          and n.stream_id = c.stream_id and n.stream_version > c.stream_version offset 0))) into more;
  end if;
  return next;
end
$kw_purge$;

revoke execute on function "example".kw_purge_transient(timestamptz, integer, text[]) from public;

grant execute on function "example".kw_purge_transient(timestamptz, integer, text[]) to "kw_app";
