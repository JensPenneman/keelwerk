import { errors } from '@keelwerk/core';
import type pg from 'pg';

/**
 * Refuses a connection whose role is a superuser or has `BYPASSRLS`: forced row-level security is
 * the tenant backstop (section 14.3.7, decision 111), and either attribute would switch it off.
 */
export async function checkRole(client: pg.ClientBase): Promise<void> {
  const result = await client.query<{
    readonly name: string;
    readonly superuser: boolean;
    readonly bypass: boolean;
  }>(
    'select rolname as name, rolsuper as superuser, rolbypassrls as bypass from pg_roles where rolname = current_user',
  );
  const role = result.rows[0];
  if (role === undefined) {
    throw errors.internal('the connection role is not listed in pg_roles');
  }
  if (role.superuser || role.bypass) {
    throw errors.internal(
      `the role ${role.name} is ${role.superuser ? 'a superuser' : 'allowed to bypass row-level security'}; the adapter needs a role with NOSUPERUSER and NOBYPASSRLS`,
    );
  }
}
