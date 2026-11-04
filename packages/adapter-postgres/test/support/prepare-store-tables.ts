import { commandReceiptDdl } from '@keelwerk/data/conformance';
import pg from 'pg';

const stamped = `created_at timestamptz(3) not null default now(), updated_at timestamptz(3) not null default now(),
  archived_at timestamptz(3), version bigint not null default 1`;

const tenantPolicy = `tenant_id = nullif(current_setting('keelwerk.tenant_id', true), '')::uuid`;
const backendPolicy = `backend_id = nullif(current_setting('keelwerk.backend_id', true), '')::uuid`;

const tables: readonly { name: string; columns: string; policy: string }[] = [
  {
    name: 'app__ticket',
    policy: tenantPolicy,
    columns: `tenant_id uuid not null, id uuid not null, ${stamped}, title text collate "C", number bigint, primary key (tenant_id, id)`,
  },
  {
    name: 'app__setting',
    policy: backendPolicy,
    columns: `backend_id uuid not null, id uuid not null, ${stamped}, name text collate "C", primary key (backend_id, id)`,
  },
  {
    name: 'app__item',
    policy: tenantPolicy,
    columns: `tenant_id uuid not null, id uuid not null, ${stamped}, name text collate "C", primary key (tenant_id, id)`,
  },
  {
    name: 'app__label',
    policy: tenantPolicy,
    columns: `tenant_id uuid not null, id uuid not null, ${stamped}, name text collate "C", primary key (tenant_id, id)`,
  },
  {
    name: 'app__item_label',
    policy: tenantPolicy,
    columns: `tenant_id uuid not null, id uuid not null, ${stamped}, item_id uuid not null, label_id uuid not null, primary key (tenant_id, id)`,
  },
];

/**
 * The entity tables of the store tests and the receipt table in both roots, with forced
 * row-level security and grants for `kw_app`. Run after `prepareNamespaces`.
 */
export async function prepareStoreTables(adminUrl: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    for (const root of ['app', 'kw__control']) {
      const statements = [...commandReceiptDdl(root)];
      for (const table of tables) {
        const name = `${root}.${table.name}`;
        statements.push(
          `create table ${name} (${table.columns})`,
          `alter table ${name} enable row level security`,
          `alter table ${name} force row level security`,
          `create policy scoped on ${name} using (${table.policy}) with check (${table.policy})`,
          `grant select, insert, update, delete on ${name} to kw_app`,
        );
      }
      statements.push(
        `create unique index on ${root}.app__ticket (tenant_id, title) where archived_at is null`,
      );
      statements.push(
        `grant select, insert, update, delete on ${root}.core__command_receipt to kw_app`,
      );
      for (const statement of statements) await admin.query(statement);
    }
  } finally {
    await admin.end();
  }
}
