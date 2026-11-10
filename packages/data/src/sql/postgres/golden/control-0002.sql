create table "kw__control".kw_consumers (
  consumer_id text not null,
  scope_id uuid not null,
  position bigint not null,
  updated_at timestamptz(3) not null,
  primary key (consumer_id, scope_id)
);

create table "kw__control".kw_consumer_leases (
  consumer_id text primary key,
  lease_owner text not null,
  lease_expires_at timestamptz(3) not null
);

create table "kw__control".kw_parked (
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

create table "kw__control".kw_stream_records (
  scope_id uuid not null,
  stream text not null,
  key text not null,
  seq bigint not null,
  at timestamptz(3) not null,
  data jsonb not null,
  primary key (scope_id, stream, key, seq)
);

create index kw_stream_records_at on "kw__control".kw_stream_records (scope_id, stream, at);

create table "kw__control".kw_schedules (
  scope_id uuid not null,
  schedule_id text not null,
  last_tick timestamptz(3),
  next_tick timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  primary key (scope_id, schedule_id)
);

create index kw_schedules_due on "kw__control".kw_schedules (next_tick);

create table "kw__control".kw_namespace_identities (
  namespace_id text primary key,
  system_id text not null,
  timeline text not null,
  recorded_at timestamptz(3) not null
);

create table "kw__control".kw_scope_marks (
  scope_id uuid not null,
  namespace_id text not null,
  position bigint not null,
  serials jsonb not null,
  epoch integer not null,
  updated_at timestamptz(3) not null,
  primary key (scope_id, namespace_id)
);

create index kw_scope_marks_namespace on "kw__control".kw_scope_marks (namespace_id);

create table "kw__control".kw_leases (
  kind text not null,
  scope_id uuid,
  key text not null,
  holder text not null,
  units integer not null,
  expires_at timestamptz(3) not null,
  primary key (kind, key, holder)
);

create index kw_leases_expires on "kw__control".kw_leases (expires_at);

create table "kw__control".kw_queue_pauses (
  namespace_id text,
  queue text not null,
  scope_id uuid,
  paused_by jsonb not null,
  reason text not null,
  paused_at timestamptz(3) not null,
  unique nulls not distinct (namespace_id, queue, scope_id)
);

create table "kw__control".kw_ledger (
  seq bigint generated always as identity primary key,
  type text not null,
  record jsonb not null,
  recorded_at timestamptz(3) not null
);

create table "kw__control".kw_api_usage (
  day date not null,
  backend_id uuid not null,
  tenant_id uuid not null,
  api_version text not null,
  transport text not null,
  item text not null,
  count bigint not null,
  primary key (day, backend_id, tenant_id, api_version, transport, item)
);

create table "kw__control".kw_retention_runs (
  run_id uuid primary key,
  started_at timestamptz(3) not null,
  ended_at timestamptz(3) not null,
  backend_id uuid not null,
  tenant_id uuid,
  rule jsonb not null,
  removed jsonb not null,
  horizons jsonb not null
);

create index kw_retention_runs_scope on "kw__control".kw_retention_runs (backend_id, tenant_id, started_at);

alter table "kw__control".kw_consumers enable row level security;

alter table "kw__control".kw_consumers force row level security;

create policy scoped on "kw__control".kw_consumers using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_consumers using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_parked enable row level security;

alter table "kw__control".kw_parked force row level security;

create policy scoped on "kw__control".kw_parked using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_parked using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_stream_records enable row level security;

alter table "kw__control".kw_stream_records force row level security;

create policy scoped on "kw__control".kw_stream_records using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_stream_records using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_schedules enable row level security;

alter table "kw__control".kw_schedules force row level security;

create policy scoped on "kw__control".kw_schedules using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_schedules using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_consumer_leases enable row level security;

alter table "kw__control".kw_consumer_leases force row level security;

create policy take on "kw__control".kw_consumer_leases using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_namespace_identities enable row level security;

alter table "kw__control".kw_namespace_identities force row level security;

create policy deployment on "kw__control".kw_namespace_identities using (nullif(current_setting('keelwerk.deployment_id', true), '') is not null) with check (nullif(current_setting('keelwerk.deployment_id', true), '') is not null);

alter table "kw__control".kw_scope_marks enable row level security;

alter table "kw__control".kw_scope_marks force row level security;

create policy deployment on "kw__control".kw_scope_marks using (nullif(current_setting('keelwerk.deployment_id', true), '') is not null) with check (nullif(current_setting('keelwerk.deployment_id', true), '') is not null);

alter table "kw__control".kw_leases enable row level security;

alter table "kw__control".kw_leases force row level security;

create policy deployment on "kw__control".kw_leases using (nullif(current_setting('keelwerk.deployment_id', true), '') is not null) with check (nullif(current_setting('keelwerk.deployment_id', true), '') is not null);

alter table "kw__control".kw_queue_pauses enable row level security;

alter table "kw__control".kw_queue_pauses force row level security;

create policy deployment on "kw__control".kw_queue_pauses using (nullif(current_setting('keelwerk.deployment_id', true), '') is not null) with check (nullif(current_setting('keelwerk.deployment_id', true), '') is not null);

alter table "kw__control".kw_ledger enable row level security;

alter table "kw__control".kw_ledger force row level security;

create policy deployment on "kw__control".kw_ledger using (nullif(current_setting('keelwerk.deployment_id', true), '') is not null) with check (nullif(current_setting('keelwerk.deployment_id', true), '') is not null);

alter table "kw__control".kw_api_usage enable row level security;

alter table "kw__control".kw_api_usage force row level security;

create policy deployment on "kw__control".kw_api_usage using (nullif(current_setting('keelwerk.deployment_id', true), '') is not null) with check (nullif(current_setting('keelwerk.deployment_id', true), '') is not null);

alter table "kw__control".kw_retention_runs enable row level security;

alter table "kw__control".kw_retention_runs force row level security;

create policy deployment on "kw__control".kw_retention_runs using (nullif(current_setting('keelwerk.deployment_id', true), '') is not null) with check (nullif(current_setting('keelwerk.deployment_id', true), '') is not null);

grant select, insert, update, delete on "kw__control".kw_consumers to "kw_app";

grant select, insert, update, delete on "kw__control".kw_consumer_leases to "kw_app";

grant select, insert, update, delete on "kw__control".kw_parked to "kw_app";

grant select, insert, update, delete on "kw__control".kw_stream_records to "kw_app";

grant select, insert, update, delete on "kw__control".kw_schedules to "kw_app";

grant select, insert on "kw__control".kw_ledger to "kw_app";

grant select, insert on "kw__control".kw_retention_runs to "kw_app";

grant select, insert, update, delete on "kw__control".kw_namespace_identities to "kw_app";

grant select, insert, update, delete on "kw__control".kw_scope_marks to "kw_app";

grant select, insert, update, delete on "kw__control".kw_leases to "kw_app";

grant select, insert, update, delete on "kw__control".kw_queue_pauses to "kw_app";

grant select, insert, update, delete on "kw__control".kw_api_usage to "kw_app";
