import { expect, test } from 'vitest';
import { commandReceiptDdl } from '../../src/sql/postgres/command-receipt-ddl.ts';

test('the table provisioned from the descriptor holds the columns the receipt store writes', () => {
  const [create] = commandReceiptDdl('app');
  const [columns = ''] = (create ?? '').split(', constraint');
  const names = [...columns.matchAll(/"([a-z_]+)" [a-z]/g)].map((match) => match[1]);
  expect(names).toEqual([
    'scope_id',
    'id',
    'created_at',
    'updated_at',
    'version',
    'command_id',
    'action',
    'fingerprint',
    'principal',
    'principal_resolver',
    'principal_id',
    'status',
    'outcome',
    'api_version',
    'transport',
    'remote_address',
    'user_agent',
    'client_id',
    'client_seq',
    'expires_at',
    'acknowledged_at',
  ]);
});

test('the receipt table DDL is the golden text', () => {
  expect(commandReceiptDdl('app').join(';\n')).toMatchInlineSnapshot(`
    "create table "app"."core__command_receipt" ("scope_id" uuid not null, "id" uuid not null, "created_at" timestamptz(3) default now() not null, "updated_at" timestamptz(3) default now() not null, "version" bigint default 1 not null, "command_id" text collate "C" not null, "action" text collate "C" not null, "fingerprint" text collate "C" not null, "principal" jsonb, "principal_resolver" text collate "C", "principal_id" text collate "C", "status" text not null, "outcome" jsonb, "api_version" text collate "C" not null, "transport" text collate "C" not null, "remote_address" text collate "C", "user_agent" text collate "C", "client_id" text collate "C", "client_seq" bigint, "expires_at" timestamptz(3) not null, "acknowledged_at" timestamptz(3), constraint "core__command_receipt_status_enum" check ("status" in ('pending', 'accepted', 'completed', 'failed')), constraint "core__command_receipt_pkey" primary key ("scope_id", "id"));
    create unique index "core__command_receipt_command" on "app"."core__command_receipt" using btree ("scope_id", "command_id");
    create index "core__command_receipt_client" on "app"."core__command_receipt" using btree ("scope_id", "client_id", "client_seq");
    alter table "app".core__command_receipt enable row level security;
    alter table "app".core__command_receipt force row level security;
    create policy scoped on "app".core__command_receipt using (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid)) with check (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid));
    create policy maintenance on "app".core__command_receipt using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace')"
  `);
});
