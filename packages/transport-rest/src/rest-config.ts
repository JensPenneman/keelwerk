/** The per-backend values of the REST module's `config` (section 16.3.2). */
export interface RestConfig {
  /** Extra allowed origins beside the tenant's domains; the host applies them. */
  readonly cors: readonly string[];
  /** The API reference page; development always serves it. */
  readonly docs: boolean;
  readonly maxBodyBytes: number;
}
