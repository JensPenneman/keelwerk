import type { SecretResolver } from '../kernel/secret-resolver.ts';
import type { Logger } from '../observability/logger.ts';
import type { Tracer } from '../observability/tracer.ts';
import type { ScopeKeyWrapper } from './scope-key-wrapper.ts';

/** What the kernel hands an adapter at `create`. */
export interface AdapterEnvironment {
  /** The id of the deployment the runtime hands every adapter; deployment-scope units are scoped to it. */
  readonly deploymentId: string;
  readonly log: Logger;
  /** OpenTelemetry; adapters open child spans per statement batch. */
  readonly tracer: Tracer;
  readonly secrets: SecretResolver;
  readonly signal: AbortSignal;
  /** Wraps the subject and value keys the adapter stores; the SQL adapters pass it on as `keyWrapper` (change note, WP-43). Without it the key stores throw `unsupported`. */
  readonly keyWrapper?: ScopeKeyWrapper;
}
