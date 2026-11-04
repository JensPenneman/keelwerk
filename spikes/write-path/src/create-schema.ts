import type { Client } from 'pg';
import { namespaceRoot } from './namespace-root.ts';

// Tenant rows: forced row-level security keyed by the unit's tenant setting (section 14.3.7). The
// setting is wrapped in nullif because a pooled connection that ran a tenant unit keeps the setting
// as '' after commit, and ''::uuid raises instead of matching nothing (see REPORT.md).
const tenantPolicy = (table: string, column: string): string => `
  alter table ${namespaceRoot}.${table} enable row level security;
  alter table ${namespaceRoot}.${table} force row level security;
  create policy tenant on ${namespaceRoot}.${table}
    using (${column} = nullif(current_setting('keelwerk.tenant_id', true), '')::uuid)
    with check (${column} = nullif(current_setting('keelwerk.tenant_id', true), '')::uuid);`;

// Queue tables also admit namespace-scope units, which the take and the completions run in (section 9.5.3).
const queuePolicy = (table: string): string => `
  alter table ${namespaceRoot}.${table} enable row level security;
  alter table ${namespaceRoot}.${table} force row level security;
  create policy scoped on ${namespaceRoot}.${table}
    using (scope_id = nullif(current_setting('keelwerk.tenant_id', true), '')::uuid
           or current_setting('keelwerk.scope', true) = 'namespace')
    with check (scope_id = nullif(current_setting('keelwerk.tenant_id', true), '')::uuid
           or current_setting('keelwerk.scope', true) = 'namespace');`;

const ddl = `
create role kw_app login password 'kw_app' nosuperuser nobypassrls;
create schema ${namespaceRoot};
grant usage on schema ${namespaceRoot} to kw_app;

-- Section 15.1.2, as written.
create table ${namespaceRoot}.kw_positions (
  scope_id        uuid            primary key,
  next            bigint          not null,
  epoch           integer         not null
);
create table ${namespaceRoot}.kw_shapes (shape_id bytea primary key, tracks jsonb not null);
create table ${namespaceRoot}.kw_events (
  scope_id        uuid            not null,
  position        bigint          not null,
  backend_id      uuid            not null,
  stream_type     text            not null,
  stream_id       uuid            not null,
  stream_version  integer         not null,
  partition_key   text,
  event_id        uuid            not null,
  name            text            not null,
  shape_id        bytea           not null,
  data            jsonb           not null,
  before          jsonb,
  meta            jsonb           not null,
  hlc             text            not null,
  recorded_at     timestamptz(3)  not null,
  transient       boolean         not null default false,
  prev_hash       bytea,
  hash            bytea,
  primary key (scope_id, position),
  unique (scope_id, stream_type, stream_id, stream_version)
);
create index kw_events_type on ${namespaceRoot}.kw_events (scope_id, stream_type, partition_key, position);

-- A chain entity's state table (module demo, entity item; section 14.4.2 naming) and the receipts (15.1.7).
create table ${namespaceRoot}.demo__item (
  tenant_id       uuid            not null,
  id              uuid            not null,
  version         integer         not null,
  title           text            not null,
  count           bigint          not null,
  kw_last_hlc     text            not null,
  kw_last_hash    bytea,
  primary key (tenant_id, id)
);
create table ${namespaceRoot}.core__command_receipt (
  tenant_id       uuid            not null,
  id              uuid            not null,
  command_id      text            not null,
  action          text            not null,
  fingerprint     bytea           not null,
  status          text            not null,
  outcome         jsonb,
  expires_at      timestamptz     not null,
  primary key (tenant_id, id),
  unique (tenant_id, command_id)
);

-- Sections 9.5.2 and 14.3.9 name these tables and their columns but give no DDL; the columns below
-- are the ones the fair take of section 9.5.3 and the JobSpec of section 9.5.1 reference.
create table ${namespaceRoot}.kw_job_lanes (
  id              bigint          generated always as identity primary key,
  scope_id        uuid            not null,
  queue           text            not null,
  capability_set  text            not null,
  priority        smallint        not null,
  cap             integer         not null,
  weight          integer         not null,
  taken           bigint          not null default 0,
  vtime           double precision not null default 0,
  unique (queue, capability_set, scope_id, priority)
);
create table ${namespaceRoot}.kw_job_lane_counts (
  lane_id         bigint          not null references ${namespaceRoot}.kw_job_lanes (id),
  kind            text            not null check (kind in ('enqueued', 'done')),
  scope_id        uuid            not null,
  value           bigint          not null default 0,
  primary key (lane_id, kind)
);
create table ${namespaceRoot}.kw_job_groups (
  id              text            primary key,
  concurrency     integer,
  running         integer         not null default 0,
  blocked_until   timestamptz
);
create table ${namespaceRoot}.kw_jobs (
  id              bigint          generated always as identity primary key,
  scope_id        uuid            not null,
  lane_id         bigint          not null,
  queue           text            not null,
  state           text            not null check (state in ('scheduled', 'available', 'waiting', 'running')),
  run_at          timestamptz     not null default now(),
  revision        integer         not null,
  group_id        text,
  key             text,
  cost            integer         not null default 1,
  input           jsonb           not null,
  worker          text,
  attempt         integer         not null default 0,
  lease_until     timestamptz
);
create index kw_jobs_take on ${namespaceRoot}.kw_jobs (lane_id, run_at, id) where state = 'available';
create table ${namespaceRoot}.kw_job_history (
  job_id          bigint          not null,
  scope_id        uuid            not null,
  queue           text            not null,
  outcome         text            not null,
  attempts        integer         not null,
  finished_at     timestamptz     not null default now()
);

-- A one-column table for the commit-cost baseline of the environment row.
create table ${namespaceRoot}.probe (id bigint generated always as identity primary key, at timestamptz not null default now());

${tenantPolicy('kw_positions', 'scope_id')}
${tenantPolicy('kw_events', 'scope_id')}
${tenantPolicy('demo__item', 'tenant_id')}
${tenantPolicy('core__command_receipt', 'tenant_id')}
${queuePolicy('kw_jobs')}
${queuePolicy('kw_job_lanes')}
${queuePolicy('kw_job_lane_counts')}
${queuePolicy('kw_job_history')}

grant select, insert, update, delete on all tables in schema ${namespaceRoot} to kw_app;
create extension if not exists pg_stat_statements;
`;

/** Creates the adapter role and the namespace's tables, as the container's superuser. */
export async function createSchema(admin: Client): Promise<void> {
  await admin.query(ddl);
}
