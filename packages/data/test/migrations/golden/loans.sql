create table "golden"."loans__loan" ("tenant_id" uuid not null, "id" uuid not null, "created_at" timestamptz(3) default now() not null, "updated_at" timestamptz(3) default now() not null, "archived_at" timestamptz(3), "version" bigint default 1 not null, "kw_last_hlc" text collate "C", "kw_last_hash" text collate "C", "kw_erased_at" timestamptz(3), "borrower" text collate "C" not null, "due_on" date not null, constraint "loans__loan_pkey" primary key ("tenant_id", "id"));

create index "loans__loan__borrower_ix" on "golden"."loans__loan" using btree ("tenant_id", "borrower");

alter table "golden"."loans__loan" enable row level security;

alter table "golden"."loans__loan" force row level security;

create policy scoped on "golden"."loans__loan" using (tenant_id = nullif(current_setting('keelwerk.tenant_id', true), '')::uuid) with check (tenant_id = nullif(current_setting('keelwerk.tenant_id', true), '')::uuid);

create policy maintenance on "golden"."loans__loan" using (current_setting('keelwerk.scope', true) = 'namespace') with check (current_setting('keelwerk.scope', true) = 'namespace');

grant select, insert, update, delete on "golden"."loans__loan" to "kw_app";
