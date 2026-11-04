/** What the schema operations need of a database connection: run a statement, read its rows. */
export interface SchemaSession {
  query(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}
