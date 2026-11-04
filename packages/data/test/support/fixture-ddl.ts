export const fixtureDdl = `
create table app.app__team (
  tenant_id uuid not null, id uuid not null, created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(), archived_at timestamptz(3), version bigint not null default 1,
  name text collate "C" not null, owner_id text collate "C", primary key (tenant_id, id));
create table app.app__member (
  tenant_id uuid not null, id uuid not null, created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(), archived_at timestamptz(3), version bigint not null default 1,
  team_id uuid not null, user_id text collate "C" not null, role text collate "C", seen_at timestamptz(3),
  primary key (tenant_id, id));
create table app.app__note (
  tenant_id uuid not null, id uuid not null, created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(), archived_at timestamptz(3), version bigint not null default 1,
  title text collate "C", body text collate "C", count bigint, big bigint, price numeric(10, 2), ratio double precision,
  done boolean, due date, at timestamptz(3), team_id uuid, tags jsonb, labels jsonb, data jsonb, blob bytea,
  secret jsonb, email bytea, email__eq bytea, primary key (tenant_id, id));
`;
