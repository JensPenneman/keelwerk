import { commandReceiptTable } from './command-receipt-table.ts';

/**
 * The receipt table as the receipt store reads and writes it: one row per command, unique on the
 * scope the command ran in (`scope_id` holds the tenant, backend or deployment id, as in the other
 * framework tables) and the command id as the client gave it. `id` is the UUIDv8 derived from the
 * scope id and the command id, so `core.commandReceipt.get` finds the row, and `version`,
 * `created_at` and `updated_at` are the entity's system columns. Only for tests: the core's
 * provisioning (WP-43) creates the table; the descriptor's fields and the column of a backend
 * command's receipt in a tenant namespace are open (section 15.1.7).
 */
export function commandReceiptDdl(root: string): readonly string[] {
  return [
    `create table "${root}".${commandReceiptTable} (
  scope_id uuid not null,
  id uuid not null,
  command_id text collate "C" not null,
  action text collate "C" not null,
  fingerprint text collate "C" not null,
  principal jsonb,
  status text collate "C" not null check (status in ('pending', 'accepted', 'completed', 'failed')),
  outcome jsonb,
  api_version text collate "C" not null,
  transport text collate "C" not null,
  remote_address text collate "C",
  user_agent text collate "C",
  client_id text collate "C",
  client_seq bigint,
  expires_at timestamptz(3) not null,
  acknowledged_at timestamptz(3),
  version bigint not null default 1,
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(),
  primary key (scope_id, id),
  unique (scope_id, command_id)
)`,
    `create index ${commandReceiptTable}_client on "${root}".${commandReceiptTable} (scope_id, client_id, client_seq)`,
    `alter table "${root}".${commandReceiptTable} enable row level security`,
    `alter table "${root}".${commandReceiptTable} force row level security`,
    `create policy scoped on "${root}".${commandReceiptTable} using (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid)) with check (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid))`,
    `create policy maintenance on "${root}".${commandReceiptTable} using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace')`,
  ];
}
