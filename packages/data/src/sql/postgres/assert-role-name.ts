const rolePattern = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Returns the database role name when it is a plain lower-case identifier that PostgreSQL accepts
 * as a role name: names starting with `pg_` are reserved by the server. DDL emits the name
 * double-quoted.
 */
export function assertRoleName(role: string): string {
  if (!rolePattern.test(role) || role.startsWith('pg_')) {
    throw new TypeError(`role name ${JSON.stringify(role)} is not a usable role name`);
  }
  return role;
}
