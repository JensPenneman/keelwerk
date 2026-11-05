import { commandReceiptDdl } from '../../src/sql/postgres/command-receipt-ddl.ts';

const stamped = `created_at timestamptz(3) not null default now(), updated_at timestamptz(3) not null default now(),
  archived_at timestamptz(3), version bigint not null default 1`;

const tenantPolicy = `tenant_id = nullif(current_setting('keelwerk.tenant_id', true), '')::uuid`;
const backendPolicy = `backend_id = nullif(current_setting('keelwerk.backend_id', true), '')::uuid`;
const deploymentPolicy = `nullif(current_setting('keelwerk.deployment_id', true), '') is not null`;

/** The tables of the store fixtures: one per entity, with forced row-level security like the framework's. */
const tables: readonly { name: string; ddl: string; policy: string }[] = [
  {
    name: 'app__team',
    policy: tenantPolicy,
    ddl: `(tenant_id uuid not null, id uuid not null, ${stamped},
  name text collate "C" not null, owner_id text collate "C", primary key (tenant_id, id))`,
  },
  {
    name: 'app__member',
    policy: tenantPolicy,
    ddl: `(tenant_id uuid not null, id uuid not null, ${stamped},
  team_id uuid not null, user_id text collate "C" not null, role text collate "C", seen_at timestamptz(3),
  primary key (tenant_id, id))`,
  },
  {
    name: 'app__note',
    policy: tenantPolicy,
    ddl: `(tenant_id uuid not null, id uuid not null, ${stamped},
  title text collate "C", body text collate "C", count bigint, big bigint, price numeric(10, 2), ratio double precision,
  done boolean, due date, at timestamptz(3), team_id uuid, tags jsonb, labels jsonb, data jsonb, blob bytea,
  secret jsonb, email bytea, email__eq bytea, primary key (tenant_id, id))`,
  },
  {
    name: 'app__account',
    policy: tenantPolicy,
    ddl: `(tenant_id uuid not null, id uuid not null, ${stamped},
  handle text collate "C", slot bigint, kind text collate "C", email bytea, email__eq bytea,
  primary key (tenant_id, id))`,
  },
  {
    name: 'app__item',
    policy: tenantPolicy,
    ddl: `(tenant_id uuid not null, id uuid not null, ${stamped},
  name text collate "C", primary key (tenant_id, id))`,
  },
  {
    name: 'app__label',
    policy: tenantPolicy,
    ddl: `(tenant_id uuid not null, id uuid not null, ${stamped},
  name text collate "C", primary key (tenant_id, id))`,
  },
  {
    name: 'app__item_label',
    policy: tenantPolicy,
    ddl: `(tenant_id uuid not null, id uuid not null, ${stamped},
  item_id uuid not null, label_id uuid not null, primary key (tenant_id, id))`,
  },
  {
    name: 'app__setting',
    policy: backendPolicy,
    ddl: `(backend_id uuid not null, id uuid not null, ${stamped},
  name text collate "C", primary key (backend_id, id))`,
  },
  {
    name: 'app__global',
    policy: deploymentPolicy,
    ddl: `(id uuid not null primary key, ${stamped}, name text collate "C")`,
  },
];

const indexes = [
  'create unique index on {root}.app__account (tenant_id, handle) where archived_at is null',
  "create unique index on {root}.app__account (tenant_id, slot) where kind = 'primary' and archived_at is null",
  'create unique index on {root}.app__account (tenant_id, email__eq) where archived_at is null',
];

/** The fixture tables, their policies and grants for one root, after the framework tables exist. */
export function storeDdl(root: string, role: string): readonly string[] {
  const statements: string[] = [...commandReceiptDdl(root)];
  for (const table of tables) {
    const qualified = `${root}.${table.name}`;
    statements.push(
      `create table ${qualified} ${table.ddl}`,
      `alter table ${qualified} enable row level security`,
      `alter table ${qualified} force row level security`,
      `create policy scoped on ${qualified} using (${table.policy}) with check (${table.policy})`,
      `grant select, insert, update, delete on ${qualified} to "${role}"`,
    );
  }
  statements.push(...indexes.map((index) => index.replace('{root}', root)));
  statements.push(
    `grant select, insert, update, delete on "${root}".core__command_receipt to "${role}"`,
  );
  return statements;
}
