create table "example".kw_consumers (
  consumer_id text not null,
  scope_id uuid not null,
  position bigint not null,
  updated_at timestamptz(3) not null,
  primary key (consumer_id, scope_id)
);

create table "example".kw_consumer_leases (
  consumer_id text primary key,
  lease_owner text not null,
  lease_expires_at timestamptz(3) not null
);

create table "example".kw_parked (
  consumer_id text not null,
  scope_id uuid not null,
  stream_type text not null,
  stream_id uuid not null,
  from_position bigint not null,
  attempts integer not null,
  last_error jsonb not null,
  parked_at timestamptz(3) not null,
  primary key (consumer_id, scope_id, stream_type, stream_id)
);

create table "example".kw_stream_records (
  scope_id uuid not null,
  stream text not null,
  key text not null,
  seq bigint not null,
  at timestamptz(3) not null,
  data jsonb not null,
  primary key (scope_id, stream, key, seq)
);

create index kw_stream_records_at on "example".kw_stream_records (scope_id, stream, at);

create table "example".kw_schedules (
  scope_id uuid not null,
  schedule_id text not null,
  last_tick timestamptz(3),
  next_tick timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  primary key (scope_id, schedule_id)
);

create index kw_schedules_due on "example".kw_schedules (next_tick);

alter table "example".kw_consumers enable row level security;

alter table "example".kw_consumers force row level security;

create policy scoped on "example".kw_consumers using (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid)) with check (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid));

create policy maintenance on "example".kw_consumers using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "example".kw_parked enable row level security;

alter table "example".kw_parked force row level security;

create policy scoped on "example".kw_parked using (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid)) with check (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid));

create policy maintenance on "example".kw_parked using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "example".kw_stream_records enable row level security;

alter table "example".kw_stream_records force row level security;

create policy scoped on "example".kw_stream_records using (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid)) with check (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid));

create policy maintenance on "example".kw_stream_records using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "example".kw_schedules enable row level security;

alter table "example".kw_schedules force row level security;

create policy scoped on "example".kw_schedules using (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid)) with check (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid));

create policy maintenance on "example".kw_schedules using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "example".kw_consumer_leases enable row level security;

alter table "example".kw_consumer_leases force row level security;

create policy take on "example".kw_consumer_leases using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

grant select, insert, update, delete on "example".kw_consumers to "kw_app";

grant select, insert, update, delete on "example".kw_consumer_leases to "kw_app";

grant select, insert, update, delete on "example".kw_parked to "kw_app";

grant select, insert, update, delete on "example".kw_stream_records to "kw_app";

grant select, insert, update, delete on "example".kw_schedules to "kw_app";
