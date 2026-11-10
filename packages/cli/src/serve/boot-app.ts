import type { DeploymentDefinition, Logger, ProcessRole, RuntimeOptions } from '@keelwerk/core';
import { startRuntime } from '@keelwerk/core';
import type { BootedApp } from './booted-app.ts';

/** What one process is started with. */
export interface BootOptions {
  readonly role: ProcessRole;
  readonly environment: NonNullable<RuntimeOptions['environment']>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
}

/**
 * Starts the process the deployment describes (section 3.3): the runtime builds the deployment's
 * HTTP host, mounts the transports and opens the listeners after `migrate` (open point 458); this
 * answers where it listens.
 */
export async function bootApp(
  definition: DeploymentDefinition,
  options: BootOptions,
): Promise<BootedApp> {
  const runtime = await startRuntime(definition, {
    role: options.role,
    listen: true,
    environment: options.environment,
    env: options.env,
    logger: options.logger,
  });
  return {
    runtime,
    port: runtime.port,
    operatorSocket: runtime.operatorSocket,
    stop: (deadlineMs) => runtime.stop(deadlineMs),
  };
}
