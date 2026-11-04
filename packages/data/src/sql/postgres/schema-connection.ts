import type { SchemaSession } from './schema-session.ts';

/**
 * How the schema operations reach a database as its owner (S-14): one transaction at a time, and
 * a lock that spans several of them. The PostgreSQL adapter and PGlite each implement it.
 */
export interface SchemaConnection {
  /** Runs `fn` in one transaction as the owner, on the connection's database or on the one at `url`. */
  transaction<T>(fn: (session: SchemaSession) => Promise<T>, url?: string): Promise<T>;
  /** Holds the namespace root's migration lock while `fn` runs; `fn` may open transactions. */
  exclusive<T>(root: string, fn: () => Promise<T>): Promise<T>;
}
