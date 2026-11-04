const rootPattern = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Returns the namespace root (a PostgreSQL schema, section 14.4.2) when it is a plain lower-case
 * identifier that PostgreSQL accepts as a schema name: names starting with `pg_` are reserved by
 * the server. DDL emits the root double-quoted, so reserved words such as `order` work.
 */
export function assertNamespaceRoot(root: string): string {
  if (!rootPattern.test(root) || root.startsWith('pg_')) {
    throw new TypeError(`namespace root ${JSON.stringify(root)} is not a usable schema name`);
  }
  return root;
}
