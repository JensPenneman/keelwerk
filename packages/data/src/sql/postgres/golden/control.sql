create schema "kw__control";

create table "kw__control".kw_positions (
  scope_id uuid primary key,
  next bigint not null,
  epoch integer not null
);

create table "kw__control".kw_shapes (shape_id bytea primary key, tracks jsonb not null);

create table "kw__control".kw_events (
  scope_id uuid not null,
  position bigint not null,
  backend_id uuid not null,
  stream_type text not null,
  stream_id uuid not null,
  stream_version integer not null,
  partition_key text,
  event_id uuid not null,
  name text not null,
  shape_id bytea not null,
  data jsonb not null,
  before jsonb,
  meta jsonb not null,
  hlc text not null,
  recorded_at timestamptz(3) not null,
  transient boolean not null default false,
  prev_hash bytea,
  hash bytea,
  primary key (scope_id, position),
  unique (scope_id, stream_type, stream_id, stream_version)
);

create index kw_events_type on "kw__control".kw_events (scope_id, stream_type, partition_key, position);

create table "kw__control".kw_job_lanes (
  id bigint generated always as identity primary key,
  scope_id uuid not null,
  queue text not null,
  capability_set text not null,
  priority smallint not null,
  cap integer not null,
  weight integer not null,
  taken bigint not null default 0,
  vtime double precision not null default 0,
  unique (queue, capability_set, scope_id, priority),
  unique (id, scope_id)
);

create table "kw__control".kw_job_lane_counts (
  lane_id bigint not null,
  kind text not null check (kind in ('enqueued', 'done')),
  scope_id uuid not null,
  value bigint not null default 0,
  primary key (lane_id, kind),
  foreign key (lane_id, scope_id) references "kw__control".kw_job_lanes (id, scope_id)
);

create table "kw__control".kw_job_groups (
  id text primary key,
  scope_id uuid,
  concurrency integer,
  running integer not null default 0,
  rate text,
  tokens double precision,
  refilled_at timestamptz(3),
  blocked_until timestamptz
);

create table "kw__control".kw_jobs (
  id bigint generated always as identity primary key,
  scope_id uuid not null,
  lane_id bigint not null,
  queue text not null,
  kind text not null check (kind in ('action', 'effect')),
  state text not null check (state in ('scheduled', 'available', 'waiting', 'running', 'dead')),
  run_at timestamptz not null default now(),
  principal jsonb not null,
  causation jsonb not null,
  build_id text not null,
  revision integer not null,
  api_version text,
  ordering text not null default 'none' check (ordering in ('none', 'fifo-per-key')),
  group_id text,
  group_spec jsonb,
  key text,
  cost integer not null default 1,
  retry jsonb,
  heartbeat_seconds integer not null default 10,
  expire_in_seconds integer,
  dead_letter text,
  input jsonb not null,
  worker text,
  attempt integer not null default 0,
  lease_until timestamptz,
  created_at timestamptz(3) not null,
  foreign key (lane_id, scope_id) references "kw__control".kw_job_lanes (id, scope_id)
);

create index kw_jobs_take on "kw__control".kw_jobs (lane_id, run_at, id) where state = 'available';

create table "kw__control".kw_job_history (
  scope_id uuid,
  job_id bigint,
  queue text,
  kind text,
  outcome text check (outcome in ('succeeded', 'failed', 'dead', 'cancelled')),
  attempts integer,
  started_at timestamptz(3),
  finished_at timestamptz(3),
  error jsonb,
  primary key (scope_id, job_id)
);

create table "kw__control".kw_serials (
  scope_id uuid not null,
  entity text not null,
  field text not null,
  partition text not null,
  next bigint not null,
  primary key (scope_id, entity, field, partition)
);

create table "kw__control".kw_usage (
  scope_id uuid not null,
  dimension text not null,
  value bigint not null default 0,
  primary key (scope_id, dimension)
);

create table "kw__control".kw_rate_buckets (
  scope_id uuid,
  bucket bytea,
  tokens double precision not null,
  refilled_at timestamptz(3) not null,
  primary key (scope_id, bucket)
);

create table "kw__control".kw_subject_keys (
  scope_id uuid not null,
  subject_id uuid not null,
  key_id text not null,
  purpose text not null default 'data' check (purpose in ('data', 'index')),
  wrapped bytea,
  kek_version integer not null,
  created_at timestamptz(3) not null,
  shredded_at timestamptz(3),
  primary key (scope_id, key_id)
);

create index kw_subject_keys_subject on "kw__control".kw_subject_keys (scope_id, subject_id, purpose, created_at);

create table "kw__control".kw_value_keys (
  scope_id uuid not null,
  key_id text not null,
  wrapped bytea not null,
  kek_version integer not null,
  created_at timestamptz(3) not null,
  primary key (scope_id, key_id)
);

create table "kw__control".kw_index_keys (
  scope_id uuid not null,
  version integer not null,
  wrapped bytea not null,
  created_at timestamptz(3) not null,
  retired_at timestamptz(3),
  primary key (scope_id, version)
);

create table "kw__control".kw_subject_refs (
  scope_id uuid not null,
  subject_id uuid not null,
  stream_type text not null,
  stream_id uuid not null,
  primary key (scope_id, subject_id, stream_type, stream_id)
);

create table "kw__control".kw_migrations (
  track text not null,
  id text not null,
  checksum text not null,
  applied_at timestamptz(3) not null,
  duration_ms integer not null,
  steps_applied integer not null,
  primary key (track, id)
);

create table "kw__control".kw_scope_keys (
  scope_id uuid,
  level text not null check (level in ('deployment', 'backend', 'tenant')),
  version integer,
  wrapped bytea not null,
  created_at timestamptz(3) not null,
  retired_at timestamptz(3),
  primary key (scope_id, version)
);

alter table "kw__control".kw_job_lanes enable row level security;

alter table "kw__control".kw_job_lanes force row level security;

create policy scoped on "kw__control".kw_job_lanes using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy take on "kw__control".kw_job_lanes using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_job_lane_counts enable row level security;

alter table "kw__control".kw_job_lane_counts force row level security;

create policy scoped on "kw__control".kw_job_lane_counts using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy take on "kw__control".kw_job_lane_counts using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_job_groups enable row level security;

alter table "kw__control".kw_job_groups force row level security;

create policy scoped on "kw__control".kw_job_groups using (scope_id is null or scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id is null or scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy take on "kw__control".kw_job_groups using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_jobs enable row level security;

alter table "kw__control".kw_jobs force row level security;

create policy scoped on "kw__control".kw_jobs using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy take on "kw__control".kw_jobs using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_job_history enable row level security;

alter table "kw__control".kw_job_history force row level security;

create policy scoped on "kw__control".kw_job_history using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy take on "kw__control".kw_job_history using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_positions enable row level security;

alter table "kw__control".kw_positions force row level security;

create policy scoped on "kw__control".kw_positions using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_positions using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_events enable row level security;

alter table "kw__control".kw_events force row level security;

create policy scoped on "kw__control".kw_events using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_events using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_serials enable row level security;

alter table "kw__control".kw_serials force row level security;

create policy scoped on "kw__control".kw_serials using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_serials using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_usage enable row level security;

alter table "kw__control".kw_usage force row level security;

create policy scoped on "kw__control".kw_usage using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_usage using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_rate_buckets enable row level security;

alter table "kw__control".kw_rate_buckets force row level security;

create policy scoped on "kw__control".kw_rate_buckets using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_rate_buckets using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_subject_keys enable row level security;

alter table "kw__control".kw_subject_keys force row level security;

create policy scoped on "kw__control".kw_subject_keys using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_subject_keys using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_value_keys enable row level security;

alter table "kw__control".kw_value_keys force row level security;

create policy scoped on "kw__control".kw_value_keys using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_value_keys using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_index_keys enable row level security;

alter table "kw__control".kw_index_keys force row level security;

create policy scoped on "kw__control".kw_index_keys using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_index_keys using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_subject_refs enable row level security;

alter table "kw__control".kw_subject_refs force row level security;

create policy scoped on "kw__control".kw_subject_refs using (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid) with check (scope_id = nullif(current_setting('keelwerk.deployment_id', true), '')::uuid);

create policy maintenance on "kw__control".kw_subject_refs using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

alter table "kw__control".kw_scope_keys enable row level security;

alter table "kw__control".kw_scope_keys force row level security;

create policy deployment on "kw__control".kw_scope_keys using (nullif(current_setting('keelwerk.deployment_id', true), '') is not null) with check (nullif(current_setting('keelwerk.deployment_id', true), '') is not null);

grant usage on schema "kw__control" to "kw_app";

grant select, insert on "kw__control".kw_shapes to "kw_app";

grant select, insert on "kw__control".kw_events to "kw_app";

grant select, insert, update, delete on "kw__control".kw_positions to "kw_app";

grant select, insert, update, delete on "kw__control".kw_job_lanes to "kw_app";

grant select, insert, update, delete on "kw__control".kw_job_lane_counts to "kw_app";

grant select, insert, update, delete on "kw__control".kw_job_groups to "kw_app";

grant select, insert, update, delete on "kw__control".kw_jobs to "kw_app";

grant select, insert, update, delete on "kw__control".kw_job_history to "kw_app";

grant select, insert, update, delete on "kw__control".kw_serials to "kw_app";

grant select, insert, update, delete on "kw__control".kw_usage to "kw_app";

grant select, insert, update, delete on "kw__control".kw_rate_buckets to "kw_app";

grant select, insert, update, delete on "kw__control".kw_subject_keys to "kw_app";

grant select, insert, update, delete on "kw__control".kw_value_keys to "kw_app";

grant select, insert, update, delete on "kw__control".kw_index_keys to "kw_app";

grant select, insert, update, delete on "kw__control".kw_subject_refs to "kw_app";

grant select, insert, update, delete on "kw__control".kw_scope_keys to "kw_app";

grant select on "kw__control".kw_migrations to "kw_app";
