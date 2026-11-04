import { expect, test } from 'vitest';
import { commandReceiptDdl } from '../../src/conformance/index.ts';

test('the receipt table DDL is the golden text', () => {
  expect(commandReceiptDdl('app').join(';\n')).toMatchInlineSnapshot(`
    "create table "app".core__command_receipt (
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
    );
    create index core__command_receipt_client on "app".core__command_receipt (scope_id, client_id, client_seq);
    alter table "app".core__command_receipt enable row level security;
    alter table "app".core__command_receipt force row level security;
    create policy scoped on "app".core__command_receipt using (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid)) with check (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid));
    create policy maintenance on "app".core__command_receipt using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace')"
  `);
});
