/** The per-backend values of the GraphQL module's `config` (section 16.3.2). */
export interface GraphqlConfig {
  /** Extra allowed origins beside the tenant's domains; the host applies them. */
  readonly cors: readonly string[];
  /** The most bytes of a request body. */
  readonly maxBodyBytes: number;
}
