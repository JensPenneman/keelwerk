/** What a data step's pure transform may know about the row it rewrites. */
export interface MigrationStepContext {
  readonly entity: string;
  /** Null for backend and deployment scope. */
  readonly tenantId: string | null;
}
