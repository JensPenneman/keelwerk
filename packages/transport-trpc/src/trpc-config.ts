/** The per-backend values of the tRPC module's `config` (section 16.3.2). */
export interface TrpcConfig {
  /** Extra allowed origins beside the tenant's domains; the host applies them. */
  readonly cors: readonly string[];
  /** The most bytes of a request body. */
  readonly maxBodyBytes: number;
}
