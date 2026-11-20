/** The per-backend values of the oRPC module's `config` (section 16.3.2). */
export interface OrpcConfig {
  /** Extra allowed origins beside the tenant's domains; the host applies them. */
  readonly cors: readonly string[];
}
