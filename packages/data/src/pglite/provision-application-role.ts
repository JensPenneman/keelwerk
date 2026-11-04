import type { PGlite } from '@electric-sql/pglite';
import { applicationRoleDdl } from '../sql/postgres/application-role.ts';
import { assertRoleName } from '../sql/postgres/assert-role-name.ts';

/** Which role and root to provision. */
export interface ProvisionApplicationRoleOptions {
  /** The namespace root (the schema) the role is granted on. */
  readonly root: string;
  /** The role every unit drops to with `set local role`. */
  readonly role: string;
  /** The control store's root: its grants include `kw_scope_keys`. */
  readonly control?: boolean;
}

/**
 * Creates the application role if it is missing and grants it what a namespace needs (S-14).
 * PGlite runs statements as its superuser, which row-level security never restricts, so units run
 * as this `NOSUPERUSER NOBYPASSRLS` role instead; migrations and provisioning run as the owner.
 * Safe to repeat: an existing role keeps its name and is pinned to the same attributes. Call it
 * after the root's tables exist.
 */
export async function provisionApplicationRole(
  database: PGlite,
  options: ProvisionApplicationRoleOptions,
): Promise<void> {
  const role = assertRoleName(options.role);
  const existing = await database.query('select 1 from pg_roles where rolname = $1', [role]);
  const attributes = 'nosuperuser nobypassrls nocreatedb nocreaterole nologin';
  await database.query(
    existing.rows.length === 0
      ? `create role "${role}" ${attributes}`
      : `alter role "${role}" ${attributes}`,
  );
  for (const statement of applicationRoleDdl(
    options.root,
    role,
    options.control === true ? { control: true } : {},
  )) {
    await database.query(statement);
  }
}
