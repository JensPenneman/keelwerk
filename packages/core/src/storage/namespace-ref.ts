export interface NamespaceRef {
  /** Stable id, recorded in the control store. */
  readonly id: string;
  readonly placementId: string;
  readonly appId: string;
  /** Set for schema-per-tenant and database-per-tenant. */
  readonly tenantId: string | null;
  /** PostgreSQL schema, MySQL database or name prefix, SQLite file or prefix. */
  readonly root: string;
}
