import type { SecretRef } from '../ids/secret-ref.ts';
import type { Logger } from '../observability/logger.ts';
import type { Tracer } from '../observability/tracer.ts';

/** Resolves secret references through the deployment's secret providers. */
interface AdapterSecrets {
  resolve(ref: SecretRef, reason: string): Promise<string>;
}

/** What the kernel hands an adapter at `create`. */
export interface AdapterEnvironment {
  readonly log: Logger;
  /** OpenTelemetry; adapters open child spans per statement batch. */
  readonly tracer: Tracer;
  readonly secrets: AdapterSecrets;
  readonly signal: AbortSignal;
}
