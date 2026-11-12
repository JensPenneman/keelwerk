import { expect, test } from 'vitest';
import { effectRecordDdl } from '../../src/sql/postgres/effect-record-ddl.ts';

test('the table provisioned from the descriptor holds the columns the row store writes for an effect', () => {
  const [create] = effectRecordDdl('app');
  const [columns = ''] = (create ?? '').split(', constraint');
  const names = [...columns.matchAll(/"([a-z_]+)" [a-z]/g)].map((match) => match[1]);
  expect(names).toEqual([
    'scope_id',
    'id',
    'created_at',
    'updated_at',
    'version',
    'type',
    'command_id',
    'status',
    'attempts',
    'performer',
    'input',
    'event_ids',
    'continuation',
    'continuation_with',
    'key',
    'run_at',
    'deadline',
    'output',
    'error',
    'output_digest',
    'settled_at',
    'principal_resolver',
    'principal_id',
  ]);
});

test('the effect table DDL is the golden text', () => {
  expect(effectRecordDdl('app').join(';\n')).toMatchInlineSnapshot(`
    "create table "app"."core__effect" ("scope_id" uuid not null, "id" uuid not null, "created_at" timestamptz(3) default now() not null, "updated_at" timestamptz(3) default now() not null, "version" bigint default 1 not null, "type" text collate "C" not null, "command_id" text collate "C" not null, "status" text not null, "attempts" bigint not null, "performer" text not null, "input" jsonb, "event_ids" jsonb not null, "continuation" text collate "C", "continuation_with" jsonb, "key" text collate "C", "run_at" timestamptz(3), "deadline" timestamptz(3), "output" jsonb, "error" jsonb, "output_digest" text collate "C", "settled_at" timestamptz(3), "principal_resolver" text collate "C", "principal_id" text collate "C", constraint "core__effect_status_enum" check ("status" in ('requested', 'succeeded', 'failed', 'abandoned')), constraint "core__effect_performer_enum" check ("performer" in ('executor', 'external')), constraint "core__effect_pkey" primary key ("scope_id", "id"));
    create index "core__effect_pending" on "app"."core__effect" using btree ("scope_id", "type", "status");
    alter table "app".core__effect enable row level security;
    alter table "app".core__effect force row level security;
    create policy scoped on "app".core__effect using (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid)) with check (scope_id = coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid));
    create policy maintenance_select on "app".core__effect for select using (current_setting('keelwerk.scope', true) = 'namespace');
    create policy maintenance_delete on "app".core__effect for delete using (current_setting('keelwerk.scope', true) = 'namespace')"
  `);
});
