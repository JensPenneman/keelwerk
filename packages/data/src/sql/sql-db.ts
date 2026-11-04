/** The database type map every statement of the SQL family builds against: tables and columns by name. */
export type SqlDb = Record<string, Record<string, unknown>>;
